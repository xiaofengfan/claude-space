// ── 全局日志缓冲区（供控制台窗口使用）────────────────
const LOG_BUFFER_SIZE = 5000
const logBuffer: string[] = []

function pushLog(text: string, source: string = 'terminal') {
  const line = `[${new Date().toLocaleTimeString()}][${source}] ${text}`
  logBuffer.push(line)
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.splice(0, logBuffer.length - LOG_BUFFER_SIZE)
  // 广播到所有窗口
  for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send('console:log-line', line) } catch {} }
}
/**
 * Electron 主进程 — 窗口管理、IPC 路由、Claude 进程生命周期。
 */
import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { spawn } from 'child_process'
import { ClaudeProcess, ClaudeEvent } from './claudeProcess'
import { AgentPool } from './agentPool'
import { detectCli, testApiEndpoint, runHealthCheck, getEnvConfig } from './connectionService'
import { TerminalProcess } from './terminalProcess'
import { SshService } from './sshService'
import type { SshServerConfig, DeployTarget } from './sshService'
import { SshTerminalProcess } from './sshTerminalProcess'
import { encodeClaudePath, decodeClaudePath, maskApiKey, readJsonlSafe, enqueueFileWrite, getWorkspaceRoot, withFileLock } from './utils'

// ── 全局状态 ────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null  // 首个窗口，兼容旧代码引用
let claudeProcess: ClaudeProcess | null = null  // 保留单聊向后兼容（路由到 'default' 会话）
const sessionProcesses = new Map<string, { process: ClaudeProcess; projectPath?: string; createdAt: number }>()
const agentPool = new AgentPool()              // 多智能体群聊池
let terminalProcess: TerminalProcess | null = null  // 当前活跃终端（向后兼容）
const terminalProcesses = new Map<string, TerminalProcess>()  // 会话→终端进程池
const windowTerminals = new Map<number, string>()  // 窗口ID→会话ID（多窗口隔离）
const terminalWindowBindings = new Map<string, Set<number>>()  // sessionId→窗口集合（广播终端事件到所有绑定窗口）

// ── 终端多窗口广播辅助 ────────────────────────────────

function registerTerminalWindow(sessionId: string, windowId: number): void {
  if (!terminalWindowBindings.has(sessionId)) {
    terminalWindowBindings.set(sessionId, new Set())
  }
  terminalWindowBindings.get(sessionId)!.add(windowId)
}

function unregisterTerminalWindow(windowId: number): void {
  for (const [sid, winIds] of terminalWindowBindings) {
    winIds.delete(windowId)
    if (winIds.size === 0) terminalWindowBindings.delete(sid)
  }
}

function broadcastTerminalEvent(sessionId: string, channel: string, ...args: any[]): void {
  const winIds = terminalWindowBindings.get(sessionId)
  if (!winIds) return
  for (const winId of winIds) {
    try {
      const win = BrowserWindow.fromId(winId)
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    } catch (_e) { /* 窗口可能已关闭 */ }
  }
}
const sshService = new SshService()               // SSH 连接池与文件操作
const sshTerminals = new Map<string, SshTerminalProcess>()  // serverId→远程终端
let activeSshTerminal: SshTerminalProcess | null = null
const windows: BrowserWindow[] = []  // 所有窗口追踪

// Inject settings loader into AgentPool for per-agent model resolution
agentPool.setSettingsLoader(() => loadSettings())

// ── 工作空间管理（多空间支持）──────────────────────
export interface WorkspaceConfig {
  id: string; name: string; path: string; isActive: boolean
  createdAt: string
}
let _workspaceRoot = getWorkspaceRoot()  // 初始值，loadSettings 时更新
let _workspaces: WorkspaceConfig[] = []  // 持久化的工作空间列表

function getActiveWorkspaceRoot(): string {
  // 优先使用持久化的活跃工作空间
  if (_workspaces.length > 0) {
    const active = _workspaces.find(w => w.isActive)
    if (active) return active.path
  }
  return _workspaceRoot
}

function syncWorkspaceRootFromSettings(settings: AppSettings | null): void {
  if (settings?.workspaces?.length) {
    _workspaces = settings.workspaces
    const active = _workspaces.find(w => w.isActive)
    if (active) _workspaceRoot = active.path
  }
}

const CLAUDE_HOME = path.join(os.homedir(), '.claude')

// ── JSONL 安全读取 ──────────────────────────────────────────
// ── 文件写入队列 ────────────────────────────────────────────
const TASKS_FILE = path.join(os.homedir(), '.claude', 'claude-space-tasks.json')
const SETTINGS_FILE = path.join(os.homedir(), '.claude', 'claude-space-settings.json')
const SESSION_NAMES_FILE = path.join(os.homedir(), '.claude', 'claude-space-session-names.json')

const isDev = !app.isPackaged

// Splash screen 路径：dev 时在 electron/ 目录，prod 时在同级 dist-electron/
const SPLASH_PATH = isDev
  ? `file://${path.join(__dirname, 'splash.html')}`
  : `file://${path.join(__dirname, 'splash.html')}`

// ── 启动画面 ────────────────────────────────────────────

let splashWindow: BrowserWindow | null = null

function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 420,
    height: 340,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: true,
  })

  // 居中显示
  splash.center()

  splash.loadURL(SPLASH_PATH)
  return splash
}

// ── 窗口创建 ────────────────────────────────────────────

function createWindow(projectPath?: string): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
    backgroundColor: '#0d0d0d',
  })

  win.on('ready-to-show', () => {
    win.show()
    // 关闭启动画面
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }
  })

  const mainWinId = win.id

  // 窗口关闭 — 仅从追踪列表移除，不干扰其他窗口
  win.on('closed', () => {
    const idx = windows.indexOf(win)
    if (idx >= 0) windows.splice(idx, 1)
    if (win === mainWindow) {
      mainWindow = windows.length > 0 ? windows[0] : null
    }
    // 清理终端绑定
    windowTerminals.delete(mainWinId)
    unregisterTerminalWindow(mainWinId)
    // 所有窗口关闭 → 退出应用
    if (windows.length === 0) {
      claudeProcess?.kill()
      app.quit()
    }
  })

  windows.push(win)
  if (!mainWindow) mainWindow = win

  const url = isDev
    ? (process.env.VITE_DEV_SERVER_URL || 'http://localhost:55173')
    : `file://${path.join(__dirname, '../dist/index.html')}`

  const fullUrl = projectPath
    ? `${url}?project=${encodeURIComponent(projectPath)}`
    : url

  win.loadURL(fullUrl)
}

// ── 文件查看器窗口 ────────────────────────────────────────

function createFileViewerWindow(filePath: string, fileName: string, projectPath?: string): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 400,
    title: `${fileName} — Claude Space`,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
    backgroundColor: '#0d0d0d',
  })

  win.on('ready-to-show', () => win.show())

  const viewerWinId = win.id

  win.on('closed', () => {
    const idx = windows.indexOf(win)
    if (idx >= 0) windows.splice(idx, 1)
    if (win === mainWindow) {
      mainWindow = windows.length > 0 ? windows[0] : null
    }
    // 清理终端绑定
    windowTerminals.delete(viewerWinId)
    unregisterTerminalWindow(viewerWinId)
    if (windows.length === 0) {
      claudeProcess?.kill()
      app.quit()
    }
  })

  windows.push(win)
  if (!mainWindow) mainWindow = win

  const url = isDev
    ? (process.env.VITE_DEV_SERVER_URL || 'http://localhost:55173')
    : `file://${path.join(__dirname, '../dist/index.html')}`

  const params = new URLSearchParams()
  params.set('fileViewer', '1')
  params.set('filePath', filePath)
  params.set('fileName', fileName)
  if (projectPath) params.set('project', projectPath)

  const fullUrl = `${url}?${params.toString()}`
  win.loadURL(fullUrl)
}

// ── 二进制文件检测 ────────────────────────────────────────

function isBinaryExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  const binaryExts = new Set([
    '.png','.jpg','.jpeg','.gif','.bmp','.ico','.webp','.svg',
    '.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx',
    '.zip','.tar','.gz','.rar','.7z',
    '.exe','.dll','.so','.dylib',
    '.mp3','.wav','.mp4','.avi','.mov',
    '.ttf','.otf','.woff','.woff2','.eot',
    '.pyc','.class','.o','.obj','.lib',
    '.db','.sqlite','.sqlite3',
  ])
  return binaryExts.has(ext)
}

// ── 菜单 ────────────────────────────────────────────────

function applyMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '新建会话', click: () => mainWindow?.webContents.send('menu:new-session') },
        { type: 'separator' },
        { label: '打开项目文件夹...', click: () => dialog.showOpenDialog({ properties: ['openDirectory'] }).then(r => {
          if (!r.canceled && r.filePaths[0]) {
            mainWindow?.webContents.send('menu:add-project', r.filePaths[0])
          }
        })},
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '重置缩放' },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// ── 项目扫描 ────────────────────────────────────────────

interface ProjectInfo {
  name: string
  path: string
  description: string
  techStack: string
  sessions: number
  modifiedAt: string
}

function scanProjects(rootPath?: string): ProjectInfo[] {
  const root = rootPath || getActiveWorkspaceRoot()
  const projects: ProjectInfo[] = []

  try {
    const entries = fs.readdirSync(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue

      const projectPath = path.join(root, entry.name)
      const claudeMdPath = path.join(projectPath, 'CLAUDE.md')
      let description = ''
      let techStack = ''

      // 读取 CLAUDE.md 获取项目信息
      if (fs.existsSync(claudeMdPath)) {
        const content = fs.readFileSync(claudeMdPath, 'utf-8')
        const lines = content.split('\n')
        // 提取第一行作为描述
        for (const line of lines) {
          if (line.startsWith('## 项目定位') || line.startsWith('## Project Overview')) {
            const idx = lines.indexOf(line) + 1
            if (idx < lines.length && lines[idx].trim()) {
              description = lines[idx].trim()
            }
          }
          if (line.startsWith('## 技术栈') || line.includes('技术栈') || line.includes('Tech Stack')) {
            const idx = lines.indexOf(line) + 1
            for (let i = idx; i < Math.min(idx + 5, lines.length); i++) {
              const t = lines[i].trim()
              if (t && !t.startsWith('##') && !t.startsWith('|')) {
                techStack += (techStack ? ', ' : '') + t.replace(/^-\s*/, '')
              }
            }
          }
        }
      }

      // 读取 package.json 或 pom.xml 判断技术栈
      if (!techStack) {
        if (fs.existsSync(path.join(projectPath, 'package.json'))) {
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'))
            const deps = { ...pkg.dependencies, ...pkg.devDependencies }
            const keys = Object.keys(deps || {})
            if (keys.includes('electron')) techStack = 'Electron'
            else if (keys.includes('vue')) techStack = 'Vue'
            else if (keys.includes('react')) techStack = 'React'
            else if (keys.includes('next')) techStack = 'Next.js'
            else techStack = 'Node.js'
          } catch (_e) { /* silent */ }
        }
        if (!techStack && fs.existsSync(path.join(projectPath, 'pom.xml'))) {
          techStack = 'Java/Maven'
        }
        if (!techStack && fs.existsSync(path.join(projectPath, 'requirements.txt'))) {
          techStack = 'Python'
        }
        if (!techStack && fs.existsSync(path.join(projectPath, 'backend'))) {
          techStack = 'Fullstack'
        }
      }

      // 统计活跃会话
      let sessions = 0
      const encodedPath = encodeClaudePath(projectPath.replace(/\\/g, '/'))
      const sessionDir = path.join(CLAUDE_HOME, 'projects', encodedPath)
      if (fs.existsSync(sessionDir)) {
        try {
          sessions = fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl')).length
        } catch (_e) { /* silent */ }
      }

      // 最近修改时间
      const stat = fs.statSync(projectPath)
      const modifiedAt = stat.mtime.toISOString()

      projects.push({
        name: entry.name,
        path: projectPath,
        description: description || `${techStack || '未知'} 项目`,
        techStack: techStack || '未知',
        sessions,
        modifiedAt,
      })
    }
  } catch (err) {
    console.error('扫描项目失败:', err)
  }

  // 按修改时间降序
  projects.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
  return projects
}

// ── 目录扫描 ────────────────────────────────────────────

function scanDirectory(dirPath: string, maxDepth: number, depth: number = 0): any[] {
  if (depth > maxDepth) return []
  const result: any[] = []
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    // 目录：排除 .git / node_modules / target / dist / __pycache__，保留 .claude .github .vscode 等
    const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', '__pycache__'])
    const dirs = entries.filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name))
    // 文件：包含隐藏文件（.env .gitignore .eslintrc 等）
    const files = entries.filter(e => e.isFile())

    for (const d of dirs) {
      const children = scanDirectory(path.join(dirPath, d.name), maxDepth, depth + 1)
      result.push({ name: d.name, path: path.join(dirPath, d.name), type: 'directory', children })
    }
    for (const f of files) {
      result.push({ name: f.name, path: path.join(dirPath, f.name), type: 'file' })
    }
  } catch (_e) { /* silent */ }
  return result
}

// ── 会话管理 ────────────────────────────────────────────

function listSessions(projectPath?: string): any[] {
  const sessions: any[] = []
  try {
    if (projectPath) {
      const encodedPath = encodeClaudePath(projectPath.replace(/\\/g, '/'))
      const sessionDir = path.join(CLAUDE_HOME, 'projects', encodedPath)
      if (fs.existsSync(sessionDir)) {
        for (const file of fs.readdirSync(sessionDir)) {
          if (!file.endsWith('.jsonl')) continue
          const sessionId = file.replace('.jsonl', '')
          const stat = fs.statSync(path.join(sessionDir, file))
          sessions.push({
            sessionId,
            projectPath,
            modifiedAt: stat.mtime.toISOString(),
            size: stat.size,
          })
        }
      }
    } else {
      // 扫描所有项目会话
      const projectsDir = path.join(CLAUDE_HOME, 'projects')
      if (fs.existsSync(projectsDir)) {
        for (const encoded of fs.readdirSync(projectsDir)) {
          const decoded = decodeClaudePath(encoded)
          const sessionDir = path.join(projectsDir, encoded)
          if (!fs.statSync(sessionDir).isDirectory()) continue
          for (const file of fs.readdirSync(sessionDir)) {
            if (!file.endsWith('.jsonl')) continue
            const sessionId = file.replace('.jsonl', '')
            sessions.push({
              sessionId,
              projectPath: decoded,
              modifiedAt: fs.statSync(path.join(sessionDir, file)).mtime.toISOString(),
            })
          }
        }
      }
    }
  } catch (err) {
    console.error('列出会话失败:', err)
  }

  sessions.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
  return sessions
}

// ── 任务管理 ────────────────────────────────────────────

function loadTasks(): any[] {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'))
    }
  } catch (_e) { /* silent */ }
  return []
}

function saveTasks(tasks: any[]): void {
  enqueueFileWrite(TASKS_FILE, () => {
    const dir = path.dirname(TASKS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    // 先写临时文件，再原子重命名，防止写一半崩溃损坏
    const tmp = TASKS_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf-8')
    fs.renameSync(tmp, TASKS_FILE)
  })
}

// ── 设置管理 ────────────────────────────────────────────

interface ModelConfig {
  id: string; name: string; provider: string; apiKey: string
  baseUrl: string; model: string; apiKeySource: 'env' | 'user'
}
interface AppSettings {
  version: number; activeModelId: string | null; models: ModelConfig[]
  autoApproval?: boolean; defaultGroupChat?: boolean
  sshServers?: SshServerConfig[]
  deployTargets?: DeployTarget[]
  workspaces?: WorkspaceConfig[]
  ides?: IdeConfig[]
}
interface IdeConfig {
  id: string; name: string; executablePath: string
  args?: string; icon?: string
}
const DEFAULT_IDES: IdeConfig[] = [
  { id: 'vscode', name: 'VS Code', executablePath: 'code', args: '{projectPath}', icon: '💻' },
  { id: 'idea', name: 'IntelliJ IDEA', executablePath: 'idea', args: '{projectPath}', icon: '🧩' },
  { id: 'cursor', name: 'Cursor', executablePath: 'cursor', args: '{projectPath}', icon: '🖥️' },
  { id: 'windsurf', name: 'Windsurf', executablePath: 'windsurf', args: '{projectPath}', icon: '🌊' },
]

/** 合并用户 IDE 配置与默认预设：用户配置覆盖同名预设，无同名则追加 */
function mergeIdeConfigs(userIdes: IdeConfig[]): IdeConfig[] {
  const merged = [...DEFAULT_IDES]
  for (const u of userIdes) {
    const idx = merged.findIndex(d => d.id === u.id)
    if (idx >= 0) merged[idx] = u
    else merged.push(u)
  }
  return merged
}
interface ModelConfigSafe {
  id: string; name: string; provider: string; apiKeyHint: string
  baseUrl: string; model: string; apiKeySource: 'env' | 'user'
}
interface SshServerSafe {
  id: string; name: string; host: string; port: number
  username: string; authMethod: string
  passwordHint: string; privateKeyPath: string; privateKeyHint: string
  fingerprint?: string; createdAt: string; updatedAt: string
}
interface AppSettingsSafe {
  version: number; activeModelId: string | null; models: ModelConfigSafe[]
  autoApproval?: boolean; defaultGroupChat?: boolean
  sshServers?: SshServerSafe[]
  deployTargets?: DeployTarget[]
  workspaces?: WorkspaceConfig[]
  ides?: IdeConfig[]
}

function loadSettings(): AppSettings | null {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'))
    }
  } catch (err) { console.error('加载设置失败:', err) }
  return null
}

function saveSettings(settings: AppSettings): void {
  enqueueFileWrite(SETTINGS_FILE, () => {
    const dir = path.dirname(SETTINGS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tmp = SETTINGS_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
    fs.renameSync(tmp, SETTINGS_FILE)
  })
}

// ── IPC 注册 ────────────────────────────────────────────

function registerIPC(): void {
  // Claude 会话控制
  ipcMain.handle('claude:status', async () => {
    return {
      running: claudeProcess?.isRunning || false,
      sessionId: claudeProcess?.sessionId || null,
      error: claudeProcess?.lastError || '',
    }
  })

  // ── 会话池辅助函数 ──
  function getOrCreateSessionProcess(sessionId: string, opts: {
    projectPath?: string; model?: string; apiKey?: string; baseUrl?: string
    permissionMode?: 'auto' | 'manual'
  }): ClaudeProcess {
    const existing = sessionProcesses.get(sessionId)
    if (existing && existing.process.isRunning) return existing.process
    if (existing) { sessionProcesses.delete(sessionId); existing.process.kill() }

    const proc = new ClaudeProcess({
      cwd: opts.projectPath,
      model: opts.model,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      permissionMode: opts.permissionMode || 'auto',
    })

    proc.on('event', (event: ClaudeEvent) => {
      mainWindow?.webContents.send('session:event', { sessionId, ...event })
      // 同时通过 claude:event 通道转发（兼容 ChatPanel / useTaskSync 消费者）
      mainWindow?.webContents.send('claude:event', event)
    })
    proc.on('status', (s: any) => {
      mainWindow?.webContents.send('session:status', { sessionId, ...s })
      mainWindow?.webContents.send('claude:status-update', s)
    })
    proc.on('stderr', (text: string) => {
      mainWindow?.webContents.send('session:stderr', { sessionId, text })
      mainWindow?.webContents.send('claude:stderr', text)
    })
    proc.on('close', (code: number | null) => {
      mainWindow?.webContents.send('session:close', { sessionId, code })
      mainWindow?.webContents.send('claude:close', code)
      if (claudeProcess === proc) claudeProcess = null
      sessionProcesses.delete(sessionId)
    })
    proc.on('permission-prompt', (prompt: { text: string; timestamp: number }) => {
      mainWindow?.webContents.send('session:permission-prompt', { sessionId, ...prompt })
      mainWindow?.webContents.send('claude:permission-prompt', prompt)
    })

    sessionProcesses.set(sessionId, { process: proc, projectPath: opts.projectPath, createdAt: Date.now() })
    return proc
  }

  // ── 会话消息发送 ──
  ipcMain.handle('claude:send', async (_event, opts: {
    content: string; projectPath?: string; sessionId?: string; modelId?: string;
    autoApproval?: boolean;
  }) => {
    // Claude 对话完全由 ~/.claude/settings.json 的 env 段控制，不传入模型配置
    const sid = opts.sessionId || 'default'
    const proc = getOrCreateSessionProcess(sid, {
      projectPath: opts.projectPath,
      permissionMode: opts.autoApproval ? 'auto' : 'manual',
    })

    // Backward compat: track current Claude process reference
    // (event forwarding is handled once in getOrCreateSessionProcess — do NOT re-register here)
    claudeProcess = proc

    console.log('[main] claude:send sessionId:', sid, 'contentLen:', opts.content.length)
    proc.sendPrompt(opts.content)
    return { success: true, sessionId: sid }
  })

  ipcMain.handle('claude:write-stdin', async (_event, data: string) => {
    claudeProcess?.writeStdin(data)
    return { success: true }
  })

  ipcMain.handle('claude:stop', async () => {
    claudeProcess?.kill()
    claudeProcess = null
    return { success: true }
  })

  // ── 多会话管理 IPC ──
  ipcMain.handle('session:stop', async (_event, sessionId: string) => {
    const entry = sessionProcesses.get(sessionId)
    if (entry) {
      entry.process.kill()
      sessionProcesses.delete(sessionId)
      if (claudeProcess === entry.process) claudeProcess = null
    }
    return { success: true }
  })

  ipcMain.handle('session:stop-all', async () => {
    for (const [id, entry] of sessionProcesses) {
      entry.process.kill()
    }
    sessionProcesses.clear()
    claudeProcess = null
    return { success: true }
  })

  ipcMain.handle('session:list-active', async () => {
    return Array.from(sessionProcesses.entries()).map(([id, entry]) => ({
      sessionId: id,
      projectPath: entry.projectPath,
      running: entry.process.isRunning,
      createdAt: entry.createdAt,
    }))
  })

  // 会话名持久化
  ipcMain.handle('session-names:load', async () => {
    try {
      if (fs.existsSync(SESSION_NAMES_FILE)) {
        return JSON.parse(fs.readFileSync(SESSION_NAMES_FILE, 'utf-8'))
      }
    } catch (_e) { /* silent */ }
    return {}
  })

  ipcMain.handle('session-names:save', async (_event, names: Record<string, string>) => {
    try {
      enqueueFileWrite(SESSION_NAMES_FILE, () => {
        const dir = path.dirname(SESSION_NAMES_FILE)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        const tmp = SESSION_NAMES_FILE + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(names, null, 2), 'utf-8')
        fs.renameSync(tmp, SESSION_NAMES_FILE)
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── 多智能体群聊 IPC ─────────────────────────────────

  // Agent pool event forwarding to renderer
  agentPool.on('agent-event', (taggedEvent) => {
    mainWindow?.webContents.send('agent:event', taggedEvent)
  })
  agentPool.on('agent-close', (data) => {
    mainWindow?.webContents.send('agent:close', data)
  })
  agentPool.on('agent-status-update', (data) => {
    mainWindow?.webContents.send('agent:status-update', data)
  })
  agentPool.on('agent-error', (data) => {
    mainWindow?.webContents.send('agent:status-update', { ...data, running: false, connected: false, error: data.error })
  })
  agentPool.on('agent-stderr', (data) => {
    mainWindow?.webContents.send('agent:stderr', data)
  })
  agentPool.on('agent-permission-prompt', (data) => {
    mainWindow?.webContents.send('agent:permission-prompt', data)
  })

  // Send a group message to multiple agents
  ipcMain.handle('agent:send-group', async (_event, opts: {
    groupId: string; content: string
    targets: Array<{ agentId: string; agentType: string; agentName: string; agentIcon?: string; agentColor?: string; modelId?: string }>
    personaContents: Array<{ agentId: string; prompt: string }>
    projectPath?: string; modelId?: string; autoApproval?: boolean
  }) => {
    console.log('[main] agent:send-group groupId:', opts.groupId, 'targets:', opts.targets.length, 'contentLen:', opts.content?.length, 'content:', opts.content?.slice(0, 80))

    // 多智能体群聊：Agent 池需要模型配置（与 Claude 会话分离）
    let apiKey: string | undefined
    let baseUrl: string | undefined
    let model: string | undefined

    const raw = loadSettings()
    const targetModelId = opts.modelId || raw?.activeModelId

    if (targetModelId) {
      const cfg = raw?.models.find(m => m.id === targetModelId)
      if (cfg) {
        apiKey = cfg.apiKey
        baseUrl = cfg.baseUrl
        model = cfg.model
      }
    }

    agentPool.setGlobalOptions({
      cwd: opts.projectPath,
      model,
      apiKey,
      baseUrl,
      permissionMode: opts.autoApproval ? 'auto' : 'manual',
    })

    // Build persona content map
    const personaContents = new Map<string, string>()
    if (opts.personaContents) {
      for (const p of opts.personaContents) {
        personaContents.set(p.agentId, p.prompt)
      }
    }

    agentPool.sendGroup({
      targets: opts.targets,
      content: opts.content,
      personaContents,
    })

    return { success: true, groupId: opts.groupId }
  })

  ipcMain.handle('agent:stop', async (_event, agentId: string) => {
    agentPool.stopAgent(agentId)
    return { success: true }
  })

  ipcMain.handle('agent:stop-all', async () => {
    agentPool.stopAll()
    return { success: true }
  })

  ipcMain.handle('agent:status', async () => {
    return agentPool.getAllStatus()
  })

  // 项目扫描
  ipcMain.handle('project:scan', async (_event, rootPath?: string) => {
    return scanProjects(rootPath)
  })

  ipcMain.handle('project:new', async (_event, name?: string) => {
    // 参数校验：项目名不能为空
    const projectName = (name || '').trim()
    if (!projectName) {
      return { canceled: false, error: '项目名称不能为空' }
    }
    // 校验项目名不包含非法字符
    if (/[<>:"/\\|?*]/.test(projectName)) {
      return { canceled: false, error: '项目名称包含非法字符：< > : " / \\ | ? *' }
    }
    const projectPath = path.join(getActiveWorkspaceRoot(), projectName)
    // 检查目录是否已存在
    if (fs.existsSync(projectPath)) {
      return { canceled: false, error: `项目目录已存在：${projectPath}` }
    }
    try {
      fs.mkdirSync(projectPath, { recursive: true })
      // 生成基础 CLAUDE.md
      const claudeMd = [
        `# ${projectName}`,
        '',
        '## 项目概述',
        '',
        '新建项目',
        '',
        '## 技术栈',
        '',
        '待定',
        '',
        '## 开发命令',
        '',
        '```bash',
        '# TODO: 添加开发命令',
        '```',
        '',
      ].join('\n')
      fs.writeFileSync(path.join(projectPath, 'CLAUDE.md'), claudeMd, 'utf-8')
      return { canceled: false, path: projectPath, name: projectName }
    } catch (err: any) {
      return { canceled: false, error: `创建项目失败：${err.message}` }
    }
  })

  ipcMain.handle('project:open-folder', async (_event, projectPath: string) => {
    shell.openPath(projectPath)
  })

  // ── IDE 打开 ────────────────────────────────────────────
  /** 打开指定 IDE：executablePath 为可执行文件，args 模板替换后作为参数 */
  function openIde(executablePath: string, args: string | undefined, projectPath: string): { success: boolean; error?: string } {
    try {
      const { exec } = require('child_process')
      const argTemplate = args || '{projectPath}'
      const argStr = argTemplate.replace('{projectPath}', `"${projectPath}"`)
      // exec 通过 cmd.exe 运行，自动处理 PATH/PATHEXT 和带空格的路径
      exec(`"${executablePath}" ${argStr}`, { windowsHide: true }, (err) => {
        if (err) console.error(`openIde error: ${err.message}`)
      })
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  ipcMain.handle('project:open-in-vscode', async (_event, projectPath: string) => {
    const settings = loadSettings()
    const ide = settings?.ides?.find(i => i.id === 'vscode') || DEFAULT_IDES.find(i => i.id === 'vscode')
    if (!ide) return { success: false, error: 'VS Code 未配置' }
    return openIde(ide.executablePath, ide.args, projectPath)
  })

  ipcMain.handle('project:open-in-idea', async (_event, projectPath: string) => {
    const settings = loadSettings()
    const ide = settings?.ides?.find(i => i.id === 'idea') || DEFAULT_IDES.find(i => i.id === 'idea')
    if (!ide) return { success: false, error: 'IntelliJ IDEA 未配置' }
    return openIde(ide.executablePath, ide.args, projectPath)
  })

  /** 通用 IDE 打开：按 ideId 查找用户或默认配置 */
  ipcMain.handle('project:open-in-ide', async (_event, opts: { ideId: string; projectPath: string }) => {
    const settings = loadSettings()
    const allIdes = mergeIdeConfigs(settings?.ides || [])
    const ide = allIdes.find(i => i.id === opts.ideId)
    if (!ide) return { success: false, error: `IDE "${opts.ideId}" 未配置` }
    return openIde(ide.executablePath, ide.args, opts.projectPath)
  })

  ipcMain.handle('project:open-in-new-window', async (_event, projectPath: string) => {
    createWindow(projectPath)
    return { success: true }
  })

  ipcMain.handle('project:scan-directory', async (_event, dirPath: string) => {
    return scanDirectory(dirPath, 20)  // 20层深，覆盖绝大多数项目结构
  })

  ipcMain.handle('project:open-terminal', async (_event, projectPath: string) => {
    // 在系统终端中打开，自动启动 claude
    spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', `cd /d "${projectPath}" && claude`], { shell: true, windowsHide: true })
  })

  // ── Claude 原生配置读取与文件监视 ──────────────────────────
  const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

  /** 从 ~/.claude/settings.json 的 env 段提取模型相关配置 */
  function getClaudeEnvConfig() {
    try {
      if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) {
        return { baseUrl: '', authToken: '', defaultModel: '', models: [] }
      }
      const raw = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'))
      const env = raw?.env || {}
      const baseUrl = env.ANTHROPIC_BASE_URL || ''
      const authToken = env.ANTHROPIC_AUTH_TOKEN || ''
      const defaultModel = env.ANTHROPIC_MODEL || ''
      const seenModels = new Map()
      for (const [k, v] of Object.entries(env)) {
        if (typeof v !== 'string') continue
        const tierMatch = k.match(/^ANTHROPIC_DEFAULT_(\w+)(?:_MODEL_NAME)?$/)
        if (tierMatch) {
          const key = v.trim()
          if (key && !seenModels.has(key)) {
            seenModels.set(key, {
              name: key.replace(/\[.*?\]/g, '').trim(),
              model: key,
              fromEnv: k,
            })
          }
        }
        if (k === 'ANTHROPIC_MODEL' && typeof v === 'string' && v.trim()) {
          const val = v.trim()
          if (!seenModels.has(val)) {
            let displayName = val.replace(/\[.*?\]/g, '').trim()
            for (const [nk, nv] of Object.entries(env)) {
              if (nk.endsWith('_MODEL_NAME') && nv === val) {
                displayName = (nv + '').replace(/\[.*?\]/g, '').trim()
                break
              }
            }
            seenModels.set(val, { name: displayName, model: val, fromEnv: 'ANTHROPIC_MODEL' })
          }
        }
      }
      return { baseUrl, authToken, defaultModel, models: Array.from(seenModels.values()) }
    } catch (err) {
      console.warn('[claude-env] 读取 settings.json 失败:', err)
      return { baseUrl: '', authToken: '', defaultModel: '', models: [] }
    }
  }

  /** 读取 claude 原生配置并返回，附带文件修改时间 */
  ipcMain.handle('settings:claude-env-config', async () => {
    const config = getClaudeEnvConfig()
    let mtime = ''
    try { if (fs.existsSync(CLAUDE_SETTINGS_PATH)) mtime = fs.statSync(CLAUDE_SETTINGS_PATH).mtime.toISOString() } catch {}
    return { ...config, mtime }
  })

  /** 将 claude 原生配置同步到 Claude Space 的模型列表 */
  ipcMain.handle('settings:sync-from-claude-env', async () => {
    const claudeConfig = getClaudeEnvConfig()
    if (!claudeConfig.baseUrl || !claudeConfig.authToken) {
      return { success: false, error: 'claude 配置中缺少 baseUrl 或 authToken' }
    }
    const raw = loadSettings() || { version: 1, activeModelId: null, models: [], autoApproval: false, sshServers: [], deployTargets: [], ides: [] }
    const existingIds = new Set(raw.models.map(m => m.id))
    const newModels = []
    for (const m of claudeConfig.models) {
      const suggestedId = 'claude-' + m.model.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().slice(0, 30)
      if (existingIds.has(suggestedId)) continue
      // Claude 专属模型：不设 apiKey，让子进程继承 ~/.claude/settings.json 的 env
      newModels.push({
        id: suggestedId, name: m.name || m.model, provider: 'Custom',
        apiKey: '', baseUrl: '', model: m.model,
        apiKeySource: 'env',
      })
    }
    if (newModels.length === 0) {
      // 没有新模型，但仍检查是否需要迁移 activeModelId
      return { success: true, added: 0, models: [], migrated: migrateActiveModel(raw, claudeConfig) }
    }
    raw.models.push(...newModels)
    // 同步后自动迁移 activeModelId 到匹配的 claude 原生模型
    const migrated = migrateActiveModel(raw, claudeConfig)
    saveSettings(raw)
    return { success: true, added: newModels.length, models: newModels.map(m => ({ id: m.id, name: m.name, model: m.model })), migrated }
  })

/**
 * 自动迁移 activeModelId：从旧模型（env-default/model-mqkrk21t）切换到匹配的 claude 原生模型
 * 返回是否发生了迁移
 */
function migrateActiveModel(raw: AppSettings, claudeConfig?: { defaultModel: string; models: Array<{ name: string; model: string }> }): boolean {
  if (!raw?.activeModelId) return false
  const activeModel = raw.models.find(m => m.id === raw.activeModelId)
  if (!activeModel) return false

  // 如果已经是 claude- 前缀的模型，不需要迁移
  if (activeModel.id.startsWith('claude-')) return false

  // 获取 claude 原生配置
  const cfg = claudeConfig || getClaudeEnvConfig()
  if (!cfg.defaultModel && cfg.models.length === 0) return false

  const defaultModelStr = cfg.defaultModel || cfg.models[0]?.model
  if (!defaultModelStr) return false

  // 在 models 中找匹配的 claude- 模型
  const targetId = 'claude-' + defaultModelStr.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().slice(0, 30)
  const target = raw.models.find(m => m.id === targetId)
  if (!target) return false

  raw.activeModelId = target.id
  saveSettings(raw)
  console.log('[claude-env] 自动迁移 activeModelId:', raw.activeModelId, '→', target.id, target.name)
  return true
}

/** 初始化 claude settings.json 文件监视 */
let _claudeSettingsWatcher: fs.FSWatcher | null = null
function initClaudeSettingsWatcher() {
  const CLAUDE_SETTINGS_PATH_2 = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_PATH_2)) { console.log('[claude-env] settings.json 不存在，跳过文件监视'); return }
    _claudeSettingsWatcher = fs.watch(CLAUDE_SETTINGS_PATH_2, (eventType) => {
      if (eventType === 'change') {
        setTimeout(() => {
          const config = getClaudeEnvConfig()
          let mtime = ''
          try { mtime = fs.statSync(CLAUDE_SETTINGS_PATH_2).mtime.toISOString() } catch {}
          // 后台自动同步：补充缺失的 claude 模型 + 迁移 activeModelId
          try {
            const raw = loadSettings()
            if (raw) {
              const existingIds = new Set(raw.models.map(m => m.id))
              let changed = false
              for (const m of config.models) {
                const sid = 'claude-' + m.model.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().slice(0, 30)
                if (!existingIds.has(sid)) {
                  raw.models.push({ id: sid, name: m.name || m.model, provider: 'Custom', apiKey: '', baseUrl: '', model: m.model, apiKeySource: 'env' })
                  existingIds.add(sid)
                  changed = true
                }
              }
              // 迁移后通知前端刷新
              let migrated = false
              if (changed) { saveSettings(raw); migrated = true }
              if (migrateActiveModel(raw, config)) migrated = true
              if (migrated) {
                // 通知前端重新加载 settings
                const freshSettings = loadSettings()
                for (const w of windows) {
                  try { if (!w.isDestroyed()) w.webContents.send('settings:migrated', freshSettings ? { activeModelId: freshSettings.activeModelId } : null) } catch {}
                }
              }
            }
          } catch (_e) { /* 非关键，不影响前端通知 */ }
          for (const w of windows) {
            try { if (!w.isDestroyed()) w.webContents.send('claude-env:changed', { ...config, mtime }) } catch {}
          }
        }, 500)
      }
    })
  } catch (err) {
    console.warn('[claude-env] 文件监视启动失败:', err)
  }
}

  // 文件操作
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      const buf = fs.readFileSync(filePath)
      const sample = buf.length > 0 ? buf.slice(0, Math.min(buf.length, 8192)) : Buffer.alloc(0)
      const isBinary = sample.includes(0x00) || isBinaryExtension(filePath)
      let content = ''
      if (!isBinary) {
        try { content = buf.toString('utf-8') } catch { content = '' }
      }
      return { success: true, content, size: buf.length, isBinary }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('file:write', async (_event, opts: { filePath: string; content: string }) => {
    try {
      fs.writeFileSync(opts.filePath, opts.content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── 图片临时存储 ──────────────────────────────────────
  ipcMain.handle('image:save-temp', async (_event, opts: {
    projectPath: string; images: Array<{ base64: string; mediaType: string }>
  }) => {
    const saved: string[] = []
    try {
      const tempDir = path.join(opts.projectPath, '.claude-temp-images')
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
      for (const img of opts.images) {
        const ext = img.mediaType === 'image/png' ? '.png' : img.mediaType === 'image/jpeg' ? '.jpg' : img.mediaType === 'image/gif' ? '.gif' : img.mediaType === 'image/webp' ? '.webp' : '.png'
        const fileName = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}${ext}`
        const filePath = path.join(tempDir, fileName)
        fs.writeFileSync(filePath, Buffer.from(img.base64, 'base64'))
        saved.push(filePath)
      }
    } catch (err: any) {
      return { success: false, error: err.message, paths: saved }
    }
    return { success: true, paths: saved }
  })

  ipcMain.handle('file:create', async (_event, opts: { dirPath: string; fileName: string; content?: string }) => {
    try {
      const filePath = path.join(opts.dirPath, opts.fileName)
      // ensure the directory exists
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(filePath, opts.content || '', 'utf-8')
      return { success: true, filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' }
      }
      // Safety: prevent deleting critical system directories
      const normalized = path.normalize(filePath)
      const homedir = path.normalize(os.homedir())
      if (normalized === homedir || normalized === path.normalize(process.cwd())) {
        return { success: false, error: '不允许删除此路径' }
      }
      // Prevent deleting directories (only allow file deletion)
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        return { success: false, error: '不允许删除目录' }
      }
      fs.unlinkSync(filePath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('file:open-in-new-window', async (_event, opts: {
    filePath: string; fileName: string; projectPath?: string
  }) => {
    createFileViewerWindow(opts.filePath, opts.fileName, opts.projectPath)
    return { success: true }
  })

  ipcMain.handle('file:open-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '所有文件', extensions: ['*'] }],
    })
    if (result.canceled) return { canceled: true }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  ipcMain.handle('dialog:open-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (result.canceled) return { canceled: true }
    return { canceled: false, dirPath: result.filePaths[0] }
  })

  // 会话管理
  ipcMain.handle('session:list', async (_event, projectPath?: string) => {
    return listSessions(projectPath)
  })

  ipcMain.handle('session:list-all', async () => {
    return listSessions()
  })

  ipcMain.handle('session:recent', async (_event, projectPath: string) => {
    const sessions = listSessions(projectPath)
    if (sessions.length === 0) return null
    // 取最近一条会话
    const recent = sessions[0]
    try {
      const encodedPath = encodeClaudePath(projectPath.replace(/\\/g, '/'))
      const jsonlFile = path.join(CLAUDE_HOME, 'projects', encodedPath, `${recent.sessionId}.jsonl`)
      if (fs.existsSync(jsonlFile)) {
        const events = readJsonlSafe(jsonlFile)
        const msgs: any[] = []
        for (const ev of events) {
          if (ev.type === 'user' || (ev.type === 'assistant' && ev.message?.content)) {
            msgs.push(ev)
          }
        }
        return {
          sessionId: recent.sessionId,
          modifiedAt: recent.modifiedAt,
          messages: msgs.slice(-10), // 最近10条
        }
      }
    } catch (_e) { /* silent */ }
    return null
  })

  ipcMain.handle('session:transcript', async (_event, sessionId: string) => {
    // 搜索所有项目目录找到对应 session
    const projectsDir = path.join(CLAUDE_HOME, 'projects')
    if (!fs.existsSync(projectsDir)) return { events: [] }

    for (const encoded of fs.readdirSync(projectsDir)) {
      const jsonlFile = path.join(projectsDir, encoded, `${sessionId}.jsonl`)
      if (fs.existsSync(jsonlFile)) {
        const events = readJsonlSafe(jsonlFile)
        return { events }
      }
    }
    return { events: [] }
  })

  // Extract historical tasks from session JSONL files
  ipcMain.handle('session:extract-tasks', async (_event, projectPath: string) => {
    const tasks: any[] = []
    try {
      const encodedPath = encodeClaudePath(projectPath.replace(/\\/g, '/'))
      const sessionDir = path.join(CLAUDE_HOME, 'projects', encodedPath)
      if (!fs.existsSync(sessionDir)) return tasks

      const jsonlFiles = fs.readdirSync(sessionDir)
        .filter(f => f.endsWith('.jsonl'))
        .sort((a, b) => {
          const statA = fs.statSync(path.join(sessionDir, a))
          const statB = fs.statSync(path.join(sessionDir, b))
          return statB.mtime.getTime() - statA.mtime.getTime()
        })

      const seenIds = new Set<string>()
      for (const file of jsonlFiles.slice(0, 5)) { // Last 5 sessions
        const events = readJsonlSafe(path.join(sessionDir, file))
        for (const ev of events) {
          if (ev.type !== 'assistant' || !ev.message?.content) continue
            for (const block of ev.message.content) {
              if (block.type !== 'tool_use') continue
              const toolId = block.id
              if (seenIds.has(toolId)) continue
              seenIds.add(toolId)

              if (block.name === 'TaskCreate') {
                tasks.push({
                  title: block.input?.subject || block.input?.title || '历史任务',
                  description: (block.input?.description || '').slice(0, 200),
                  status: 'done' as const,
                  category: 'task' as const,
                  toolCallId: toolId,
                  agentType: block.input?.agentType,
                  createdAt: new Date(ev.uuid ? Date.now() - 86400000 : Date.now()).toISOString(),
                  updatedAt: new Date().toISOString(),
                })
              }
              if (block.name === 'TaskUpdate') {
                // Find and update existing task
                const targetId = block.input?.taskId
                const existing = tasks.find(t => t.toolCallId === targetId)
                if (existing) {
                  const statusMap: Record<string, string> = {
                    in_progress: 'in_progress', completed: 'done', done: 'done',
                  }
                  existing.status = statusMap[block.input?.status] || existing.status
                  existing.updatedAt = new Date().toISOString()
                }
              }
            }
        }
      }
    } catch (err) { console.error('提取历史任务失败:', err) }
    return tasks.slice(0, 50) // Max 50 historical tasks
  })

  // Team management
  ipcMain.handle('team:load', async () => {
    const file = path.join(os.homedir(), '.claude', 'claude-space-team.json')
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch (_e) { /* silent */ }
    return null
  })
  ipcMain.handle('team:save', async (_event, team: any[]) => {
    const file = path.join(os.homedir(), '.claude', 'claude-space-team.json')
    enqueueFileWrite(file, () => {
      const dir = path.dirname(file)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(team, null, 2), 'utf-8')
      fs.renameSync(tmp, file)
    })
    return { success: true }
  })

  // 设置管理 — 返回脱敏版本
  ipcMain.handle('settings:load', async () => {
    const raw = loadSettings()
    if (!raw) {
      // 首次使用：无持久化配置，生成空占位（不再读环境变量）
      const placeholderModel: ModelConfigSafe = {
        id: 'placeholder',
        name: '未配置 — 请在设置中添加模型',
        provider: 'Custom',
        apiKeyHint: '未设置',
        baseUrl: '',
        model: '',
        apiKeySource: 'user',
      }
      const defaultSettings: AppSettingsSafe = {
        version: 1,
        activeModelId: null,
        models: [placeholderModel],
        autoApproval: false,
        sshServers: [],
        deployTargets: [],
        workspaces: [{
          id: '_default', name: '默认工作空间', path: _workspaceRoot, isActive: true,
          createdAt: new Date().toISOString(),
        }],
      }
      // 同时写入文件
      saveSettings({
        version: 1,
        activeModelId: null,
        models: [{
          id: 'placeholder', name: placeholderModel.name, provider: 'Custom',
          apiKey: '',
          baseUrl: '', model: '',
          apiKeySource: 'user',
        }],
        autoApproval: false,
        sshServers: [],
        deployTargets: [],
        workspaces: [{
          id: '_default', name: '默认工作空间', path: _workspaceRoot, isActive: true,
          createdAt: new Date().toISOString(),
        }],
      })
      // 首次加载：同步默认工作空间到内存
      _workspaces = [{ id: '_default', name: '默认工作空间', path: _workspaceRoot, isActive: true, createdAt: new Date().toISOString() }]
      return defaultSettings
    }
    // 同步工作空间到内存
    syncWorkspaceRootFromSettings(raw)
    // 自动补充 claude 原生模型（确保 claude-* 模型存在）
    try {
      const claudeCfg = getClaudeEnvConfig()
      if (claudeCfg.baseUrl && claudeCfg.models.length > 0) {
        const existingIds = new Set(raw.models.map(m => m.id))
        let modelsAdded = false
        for (const m of claudeCfg.models) {
          const sid = 'claude-' + m.model.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().slice(0, 30)
          if (!existingIds.has(sid)) {
            raw.models.push({ id: sid, name: m.name || m.model, provider: 'Custom', apiKey: '', baseUrl: '', model: m.model, apiKeySource: 'env' as const })
            existingIds.add(sid)
            modelsAdded = true
          }
        }
        if (modelsAdded) saveSettings(raw)
      }
    } catch (_e) { /* 非关键 */ }
    // 自动迁移 activeModelId（将旧模型指向匹配的 claude 原生模型）
    try { migrateActiveModel(raw) } catch (_e) { /* 非关键 */ }
    // 返回脱敏版本
    return {
      version: raw.version || 1,
      activeModelId: raw.activeModelId,
      models: raw.models.map(m => ({
        id: m.id, name: m.name, provider: m.provider,
        apiKeyHint: m.apiKeySource === 'env' ? (m.apiKey ? '来自环境变量' : '来自 ~/.claude/settings.json') : maskApiKey(m.apiKey),
        baseUrl: m.baseUrl, model: m.model,
        apiKeySource: m.apiKeySource || 'user',
      })),
      autoApproval: raw.autoApproval ?? false,
      sshServers: (raw.sshServers || []).map(s => ({
        id: s.id, name: s.name,
        host: (s.host || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim(),
        port: s.port || 22,
        username: s.username, authMethod: s.authMethod,
        passwordHint: s.password ? '****' : '未设置',
        privateKeyPath: s.privateKeyPath || '',
        privateKeyHint: s.privateKeyContent ? '已配置 (内联密钥)' : (s.privateKeyPath ? `已配置 (${path.basename(s.privateKeyPath)})` : '未设置'),
        fingerprint: s.fingerprint,
        createdAt: s.createdAt || new Date().toISOString(),
        updatedAt: s.updatedAt || new Date().toISOString(),
      })),
      deployTargets: raw.deployTargets || [],
      workspaces: raw.workspaces || [],
      // IDE 配置：合并用户配置与默认预设，用户配置覆盖同名预设
      ides: mergeIdeConfigs(raw.ides || []),
    } as AppSettingsSafe
  })

  ipcMain.handle('settings:save', async (_event, settings: AppSettingsSafe) => {
    // 整个读-改-写周期持有文件锁，防止并发保存覆盖
    return withFileLock(SETTINGS_FILE, () => {
      const existing = loadSettings()
      const existingModels = existing?.models || []

      const models: ModelConfig[] = settings.models.map(m => {
        const existingModel = existingModels.find(em => em.id === m.id)
        const apiKey = (m as any).apiKey
          ? (m as any).apiKey
          : (existingModel?.apiKey || '')
        return {
          id: m.id, name: m.name, provider: m.provider as ModelConfig['provider'],
          apiKey, baseUrl: m.baseUrl, model: m.model,
          apiKeySource: (apiKey && apiKey !== existingModel?.apiKey) ? 'user' as const : m.apiKeySource,
        }
      })

      const existingServers = existing?.sshServers || []
      const mergedSshServers: SshServerConfig[] = (settings.sshServers || []).map((s: any) => {
        const existing = existingServers.find((es: any) => es.id === s.id)
        return {
          id: s.id, name: s.name,
          host: (s.host || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim(),
          port: s.port || 22,
          username: s.username, authMethod: s.authMethod,
          password: s.newPassword || existing?.password || '',
          privateKeyPath: s.privateKeyPath || existing?.privateKeyPath || '',
          privateKeyContent: s.newPrivateKeyContent || existing?.privateKeyContent || '',
          fingerprint: s.fingerprint || existing?.fingerprint || undefined,
          createdAt: s.createdAt || existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      })

      saveSettings({
        version: settings.version || 1,
        activeModelId: settings.activeModelId,
        models,
        autoApproval: settings.autoApproval ?? false,
        sshServers: mergedSshServers,
        deployTargets: settings.deployTargets || [],
        // 工作空间由专用 IPC (workspace:add/remove/set-active) 管理并实时持久化
        // settings.workspaces 来自前端 state 可能过时，优先使用文件中的最新值
        workspaces: existing?.workspaces || settings.workspaces || [],
        // IDE 配置直接持久化用户提交的部分
        ides: settings.ides || [],
      })
      return { success: true }
    })
  })

  ipcMain.handle('settings:get-model', async (_event, modelId: string) => {
    const raw = loadSettings()
    if (!raw) return null
    const m = raw.models.find(m => m.id === modelId)
    if (!m) return null
    return {
      id: m.id, name: m.name, provider: m.provider,
      apiKeyHint: m.apiKeySource === 'env' ? (m.apiKey ? '来自环境变量' : '来自 ~/.claude/settings.json') : maskApiKey(m.apiKey),
      baseUrl: m.baseUrl, model: m.model, apiKeySource: m.apiKeySource,
    } as ModelConfigSafe
  })

  // 任务管理
  // ── 任务防抖：高频 tool_use 事件不立即写盘 ──
  let taskSaveTimer: ReturnType<typeof setTimeout> | null = null
  let latestTasks: any[] | null = null

  ipcMain.handle('task:load', async () => loadTasks())
  ipcMain.handle('task:save', async (_event, tasks: any[]) => {
    latestTasks = tasks
    if (taskSaveTimer) return { success: true } // 已有待处理的保存，跳过
    taskSaveTimer = setTimeout(() => {
      taskSaveTimer = null
      if (latestTasks) {
        saveTasks(latestTasks)
        latestTasks = null
      }
    }, 200) // 200ms 窗口内合并多次保存
    return { success: true }
  })

  // ── 连接管理 ────────────────────────────────────────────

  ipcMain.handle('connection:check-cli', async () => {
    return detectCli()
  })

  ipcMain.handle('connection:test-api', async (_event, opts: {
    baseUrl: string; apiKey: string; timeoutMs?: number
  }) => {
    return testApiEndpoint(opts.baseUrl, opts.apiKey, opts.timeoutMs || 10000)
  })

  ipcMain.handle('connection:health-check', async (_event, opts: {
    modelId: string; modelName: string; provider: string;
    apiKey: string; baseUrl: string; model: string;
  }) => {
    const activeSessionId = claudeProcess?.sessionId
    return runHealthCheck(opts, activeSessionId)
  })

  ipcMain.handle('connection:env-config', async () => {
    return getEnvConfig()
  })

  // 审批日志
  const APPROVAL_LOG = path.join(os.homedir(), '.claude', 'claude-space-approval-log.jsonl')
  ipcMain.handle('approval:log', async (_event, entry: {
    timestamp: string; question: string; optionChosen: string; auto: boolean; modelId?: string
  }) => {
    const dir = path.dirname(APPROVAL_LOG)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(APPROVAL_LOG, JSON.stringify(entry) + '\n', 'utf-8')
    return { success: true }
  })
  ipcMain.handle('approval:history', async () => {
    try {
      if (!fs.existsSync(APPROVAL_LOG)) return []
      const lines = fs.readFileSync(APPROVAL_LOG, 'utf-8').split('\n').filter(Boolean)
      return lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).slice(-100)
    } catch (e) {
      console.warn('[approval:history] 读取审批日志失败:', e)
      return []
    }
  })

  // ── Git 操作 ────────────────────────────────────────────

  function runGit(projectPath: string, args: string[], retried?: boolean): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      let out = '', err = ''
      const child = spawn('git', args, { cwd: projectPath, windowsHide: true, timeout: 30000 })
      child.stdout?.on('data', (d: Buffer) => { out += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { err += d.toString() })
      child.on('close', (code) => {
        const output = out.trim()
        const error = err.trim() || undefined
        // 自动清理 index.lock 后重试一次
        if (code !== 0 && error?.includes('index.lock') && !retried) {
          const lockFile = path.join(projectPath, '.git', 'index.lock')
          try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile) } catch { /* ignore */ }
          resolve(runGit(projectPath, args, true))
          return
        }
        resolve({ success: code === 0, output, error })
      })
      child.on('error', (e) => resolve({ success: false, output: '', error: e.message }))
    })
  }

  ipcMain.handle('git:init', async (_e, projectPath: string) => {
    // Check if git repo already exists
    try {
      if (fs.existsSync(path.join(projectPath, '.git'))) return { success: true, output: 'Already a git repository' }
    } catch (_e) { /* silent */ }
    return runGit(projectPath, ['init'])
  })
  ipcMain.handle('git:status', async (_e, projectPath: string) => runGit(projectPath, ['status', '--porcelain', '--branch']))
  ipcMain.handle('git:log', async (_e, projectPath: string) => runGit(projectPath, ['log', '--oneline', '-20']))
  ipcMain.handle('git:branch', async (_e, projectPath: string) => runGit(projectPath, ['branch', '-a']))
  ipcMain.handle('git:pull', async (_e, projectPath: string) => runGit(projectPath, ['pull']))
  ipcMain.handle('git:push', async (_e, projectPath: string) => runGit(projectPath, ['push']))
  ipcMain.handle('git:commit', async (_e, opts: { projectPath: string; message: string }) => runGit(opts.projectPath, ['commit', '-am', opts.message]))
  ipcMain.handle('git:add', async (_e, opts: { projectPath: string; files: string[] }) => runGit(opts.projectPath, ['add', ...opts.files]))
  ipcMain.handle('git:config', async (_e, projectPath: string) => {
    const cfg = await runGit(projectPath, ['config', '--list'])
    if (cfg.success) {
      const parsed: Record<string, string> = {}
      cfg.output.split('\n').forEach(line => {
        const [k, ...v] = line.split('=')
        if (k) parsed[k.trim()] = v.join('=').trim()
      })
      return { success: true, config: parsed }
    }
    return cfg
  })
  ipcMain.handle('git:config-set', async (_e, opts: { projectPath: string; key: string; value: string }) =>
    runGit(opts.projectPath, ['config', opts.key, opts.value]))
  ipcMain.handle('git:remote', async (_e, projectPath: string) => runGit(projectPath, ['remote', '-v']))
  ipcMain.handle('git:remote-set', async (_e, opts: { projectPath: string; name: string; url: string }) =>
    runGit(opts.projectPath, ['remote', 'add', opts.name, opts.url]))
  ipcMain.handle('git:log-detail', async (_e, projectPath: string) =>
    runGit(projectPath, ['log', '--format=%H|%ai|%an|%s', '-50']))
  ipcMain.handle('git:show-commit', async (_e, opts: { projectPath: string; hash: string }) =>
    runGit(opts.projectPath, ['log', '--format=╔HASH╗%H╔AUTHOR╗%an╔DATE╗%ai╔MSG╗%B╔DIFF╗', '-1', '--stat', opts.hash]))
  ipcMain.handle('git:diff', async (_e, opts: { projectPath: string; file?: string }) =>
    runGit(opts.projectPath, opts.file ? ['diff', opts.file] : ['diff', '--stat']))
  ipcMain.handle('git:show', async (_e, opts: { projectPath: string; file: string }) =>
    runGit(opts.projectPath, ['show', 'HEAD:' + opts.file]))
  ipcMain.handle('git:diff-staged', async (_e, projectPath: string) =>
    runGit(projectPath, ['diff', '--staged', '--stat']))
  ipcMain.handle('git:remote-info', async (_e, projectPath: string) => {
    const [remoteV, branchesR] = await Promise.all([
      runGit(projectPath, ['remote', '-v']),
      runGit(projectPath, ['branch', '-r']),
    ])
    return { success: remoteV.success || branchesR.success, output: remoteV.output, branches: branchesR.output, error: remoteV.error || branchesR.error }
  })
  ipcMain.handle('git:remote-log', async (_e, opts: { projectPath: string; remoteBranch?: string }) =>
    runGit(opts.projectPath, ['log', '--oneline', '-15', '--remotes']))
  ipcMain.handle('git:fetch', async (_e, projectPath: string) =>
    runGit(projectPath, ['fetch', '--all', '--quiet']))

  // ── 记忆管理（项目隔离：{projectPath}/.claude/memory/）───

  function getMemoryDir(projectPath: string): string {
    const encoded = encodeClaudePath(projectPath)
    return path.join(CLAUDE_HOME, 'projects', encoded, 'memory')
  }

  ipcMain.handle('memory:list', async (_e, projectPath: string) => {
    try {
      const memDir = getMemoryDir(projectPath)
      const indexPath = path.join(memDir, 'MEMORY.md')
      if (!fs.existsSync(indexPath)) return { success: true, entries: [] }
      const indexContent = fs.readFileSync(indexPath, 'utf-8')
      const entries: { name: string; description: string; fileName: string; type?: string; mtime?: string }[] = []
      const linkRegex = /-\s*\[(.+?)\]\((.+?)\)\s*—\s*(.+)/
      for (const line of indexContent.split('\n')) {
        const m = line.match(linkRegex)
        if (m) {
          const fileName = m[2].trim()
          const description = m[3].trim()
          let type = ''
          let mtime = ''
          try {
            const filePath = path.join(memDir, fileName)
            if (fs.existsSync(filePath)) {
              const stat = fs.statSync(filePath)
              mtime = stat.mtime.toISOString()
              const raw = fs.readFileSync(filePath, 'utf-8')
              const typeMatch = raw.match(/^\s*type:\s*(\S+)/m)
              if (typeMatch) type = typeMatch[1]
            }
          } catch { /* ignore */ }
          entries.push({ name: m[1].trim(), description, fileName, type: type || undefined, mtime: mtime || undefined })
        }
      }
      // Sort by mtime descending (newest first)
      entries.sort((a, b) => {
        if (!a.mtime) return 1
        if (!b.mtime) return -1
        return b.mtime.localeCompare(a.mtime)
      })
      return { success: true, entries }
    } catch (e: any) {
      return { success: false, entries: [], error: e.message }
    }
  })

  ipcMain.handle('memory:read', async (_e, opts: { projectPath: string; fileName: string }) => {
    try {
      const memDir = getMemoryDir(opts.projectPath)
      const filePath = path.join(memDir, opts.fileName)
      if (!fs.existsSync(filePath)) return { success: false, content: '', error: '文件不存在' }
      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, content }
    } catch (e: any) {
      return { success: false, content: '', error: e.message }
    }
  })

  ipcMain.handle('memory:write', async (_e, opts: { projectPath: string; fileName: string; content: string }) => {
    try {
      const memDir = getMemoryDir(opts.projectPath)
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true })
      const filePath = path.join(memDir, opts.fileName)
      fs.writeFileSync(filePath, opts.content, 'utf-8')
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('memory:create', async (_e, opts: {
    projectPath: string; fileName: string; name: string; description: string; type: string; content: string
  }) => {
    try {
      const memDir = getMemoryDir(opts.projectPath)
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true })
      const sessionId = 'manual_' + Date.now().toString(36)
      const slug = opts.name.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
      const fullContent = `---\nname: ${slug}\ndescription: ${opts.description}\nmetadata:\n  type: ${opts.type}\n  originSessionId: ${sessionId}\n---\n\n${opts.content}`
      const filePath = path.join(memDir, opts.fileName)
      fs.writeFileSync(filePath, fullContent, 'utf-8')
      const indexPath = path.join(memDir, 'MEMORY.md')
      let indexContent = ''
      if (fs.existsSync(indexPath)) indexContent = fs.readFileSync(indexPath, 'utf-8')
      const newLine = `- [${opts.name}](${opts.fileName}) — ${opts.description}\n`
      if (indexContent.trim()) {
        const fmEnd = indexContent.indexOf('---\n', 4)
        if (indexContent.startsWith('---') && fmEnd > 0) {
          indexContent = indexContent.slice(0, fmEnd + 4) + '\n' + newLine + indexContent.slice(fmEnd + 4)
        } else { indexContent += '\n' + newLine }
      } else { indexContent = `# 记忆索引\n\n${newLine}` }
      fs.writeFileSync(indexPath, indexContent, 'utf-8')
      return { success: true, filePath }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('memory:auto-create', async (_e, opts: {
    projectPath: string; title: string; content: string; type?: string
  }) => {
    try {
      const memDir = getMemoryDir(opts.projectPath)
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true })
      const timestamp = Date.now()
      const fileName = `auto-${timestamp.toString(36)}.md`
      const slug = opts.title.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'auto-memory'
      const desc = opts.title.length > 60 ? opts.title.slice(0, 60) + '...' : opts.title
      const fullContent = `---\nname: ${slug}\ndescription: ${desc}\nmetadata:\n  type: ${opts.type || 'project'}\n  origin: auto-save\n  originSessionId: auto_${timestamp.toString(36)}\n---\n\n# ${opts.title}\n\n> 自动保存时间：${new Date().toLocaleString('zh-CN')}\n\n${opts.content}`
      fs.writeFileSync(path.join(memDir, fileName), fullContent, 'utf-8')
      // Update MEMORY.md index
      const indexPath = path.join(memDir, 'MEMORY.md')
      let indexContent = ''
      if (fs.existsSync(indexPath)) indexContent = fs.readFileSync(indexPath, 'utf-8')
      const newLine = `- [${opts.title}](${fileName}) — ${desc}\n`
      if (indexContent.trim()) {
        const fmEnd = indexContent.indexOf('---\n', 4)
        if (indexContent.startsWith('---') && fmEnd > 0) {
          indexContent = indexContent.slice(0, fmEnd + 4) + '\n' + newLine + indexContent.slice(fmEnd + 4)
        } else { indexContent += '\n' + newLine }
      } else { indexContent = `# 记忆索引\n\n${newLine}` }
      fs.writeFileSync(indexPath, indexContent, 'utf-8')
      return { success: true, fileName }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('memory:delete', async (_e, opts: { projectPath: string; fileName: string }) => {
    try {
      const memDir = getMemoryDir(opts.projectPath)
      const filePath = path.join(memDir, opts.fileName)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      const indexPath = path.join(memDir, 'MEMORY.md')
      if (fs.existsSync(indexPath)) {
        let indexContent = fs.readFileSync(indexPath, 'utf-8')
        const escaped = opts.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        indexContent = indexContent.replace(new RegExp(`^- \\[.+?\\]\\(${escaped}\\) — .+$`, 'gm'), '').replace(/\n{3,}/g, '\n\n')
        fs.writeFileSync(indexPath, indexContent, 'utf-8')
      }
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  // ── 知识管理（{projectPath}/.claude/knowledge/）───────
  function getKnowledgeDir(projectPath: string): string {
    return path.join(projectPath, '.claude', 'knowledge')
  }

  ipcMain.handle('knowledge:read', async (_e, opts: { projectPath: string; fileName: string }) => {
    try {
      const fp = path.join(getKnowledgeDir(opts.projectPath), opts.fileName)
      if (!fs.existsSync(fp)) return { success: false, content: '', error: '文件不存在' }
      return { success: true, content: fs.readFileSync(fp, 'utf-8') }
    } catch (e: any) { return { success: false, content: '', error: e.message } }
  })

  ipcMain.handle('knowledge:list', async (_e, projectPath: string) => {
    try {
      const knDir = getKnowledgeDir(projectPath)
      const indexPath = path.join(knDir, 'KNOWLEDGE.md')
      if (!fs.existsSync(indexPath)) return { success: true, entries: [] }
      const content = fs.readFileSync(indexPath, 'utf-8')
      const entries: any[] = []
      for (const line of content.split('\n')) {
        const m = line.match(/-\s*\[(.+?)\]\((.+?)\)\s*—\s*(.+)/)
        if (m) {
          const fileName = m[2].trim()
          const filePath = path.join(knDir, fileName)
          let type = 'general', tags = '', status = 'draft', mtime = '', sources = ''
          try {
            if (fs.existsSync(filePath)) {
              const raw = fs.readFileSync(filePath, 'utf-8')
              const st = fs.statSync(filePath); mtime = st.mtime.toISOString()
              const t = raw.match(/^type:\s*(\S+)/m); if (t) type = t[1]
              const tg = raw.match(/^tags:\s*(.+)/m); if (tg) tags = tg[1]
              const s = raw.match(/^status:\s*(\S+)/m); if (s) status = s[1]
              const src = raw.match(/^sources:\s*(.+)/m); if (src) sources = src[1]
            }
          } catch { /* ignore */ }
          entries.push({ name: m[1].trim(), fileName, description: m[3].trim(), type, tags, status, mtime, sources })
        }
      }
      entries.sort((a: any, b: any) => (b.mtime || '').localeCompare(a.mtime || ''))
      return { success: true, entries }
    } catch (e: any) { return { success: false, entries: [], error: e.message } }
  })

  ipcMain.handle('knowledge:create', async (_e, opts: {
    projectPath: string; title: string; content: string; type: string; tags: string; sources?: string
  }) => {
    try {
      const knDir = getKnowledgeDir(opts.projectPath)
      if (!fs.existsSync(knDir)) fs.mkdirSync(knDir, { recursive: true })
      const fileName = opts.title.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) + '.md'
      const now = new Date().toISOString().split('T')[0]
      const fullContent = `---\ntitle: ${opts.title}\ntype: ${opts.type}\ntags: ${opts.tags}\nstatus: draft\ncreated: ${now}\nupdated: ${now}\nsources: ${opts.sources || ''}\n---\n\n${opts.content}`
      fs.writeFileSync(path.join(knDir, fileName), fullContent, 'utf-8')
      const indexPath = path.join(knDir, 'KNOWLEDGE.md')
      let idx = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf-8') : '# 知识索引\n\n'
      idx += `- [${opts.title}](${fileName}) — ${opts.type} | ${opts.tags}\n`
      fs.writeFileSync(indexPath, idx, 'utf-8')
      return { success: true, fileName }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('knowledge:delete', async (_e, opts: { projectPath: string; fileName: string }) => {
    try {
      const fp = path.join(getKnowledgeDir(opts.projectPath), opts.fileName)
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
      const indexPath = path.join(getKnowledgeDir(opts.projectPath), 'KNOWLEDGE.md')
      if (fs.existsSync(indexPath)) {
        let c = fs.readFileSync(indexPath, 'utf-8')
        const esc = opts.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        c = c.replace(new RegExp(`^- \\[.+?\\]\\(${esc}\\) — .+$`, 'gm'), '').replace(/\n{3,}/g, '\n\n')
        fs.writeFileSync(indexPath, c, 'utf-8')
      }
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  
  ipcMain.handle('console:get-log-history', async () => { return { success: true, lines: [...logBuffer] } })


  // ── 技能管理 ────────────────────────────────────────
  const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')

  function getSkillManifest(filePath: string, includeContent?: boolean): any {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const m = raw.match(/^---\n([\s\S]*?)\n---/)
      if (!m) return null
      const fm: Record<string, string> = {}
      for (const line of m[1].split('\n')) {
        const sep = line.indexOf(': ')
        if (sep > 0) fm[line.slice(0, sep).trim()] = line.slice(sep + 2).trim()
      }
      const manifest: any = {
        name: fm.name || '',
        description: fm.description || '',
        version: fm.version || '1.0.0',
        author: fm.author || 'unknown',
        category: fm.category || 'general',
        tags: fm.tags || '',
        icon: fm.icon || '📦',
        level: fm.level || 'global',
        enabled: fm.enabled !== 'false',
        created: fm.created || '',
        updated: fm.updated || '',
        fileName: path.basename(filePath),
        filePath,
      }
      if (includeContent) manifest.content = raw
      return manifest
    } catch { return null }
  }

  ipcMain.handle('skill:list', async () => {
    try {
      if (!fs.existsSync(SKILLS_DIR)) return { success: true, skills: [] }
      const skills: any[] = []
      for (const f of fs.readdirSync(SKILLS_DIR)) {
        if (!f.endsWith('.md')) continue
        const m = getSkillManifest(path.join(SKILLS_DIR, f))
        if (m) skills.push(m)
      }
      skills.sort((a, b) => a.name.localeCompare(b.name))
      return { success: true, skills }
    } catch (e: any) { return { success: false, skills: [], error: e.message } }
  })

  ipcMain.handle('skill:read', async (_e: any, name: string) => {
    try {
      const fp = path.join(SKILLS_DIR, name + '.md')
      if (!fs.existsSync(fp)) return { success: false, content: '', error: 'Skill not found' }
      return { success: true, content: fs.readFileSync(fp, 'utf-8') }
    } catch (e: any) { return { success: false, content: '', error: e.message } }
  })

  ipcMain.handle('skill:install', async (_e: any, opts: { name: string; content: string }) => {
    try {
      if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true })
      fs.writeFileSync(path.join(SKILLS_DIR, opts.name + '.md'), opts.content, 'utf-8')
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:install-batch', async (_e: any, opts: { skills: Array<{ name: string; content: string }> }) => {
    try {
      if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true })
      let count = 0
      const errors: Array<{ name: string; error: string }> = []
      for (const s of opts.skills) {
        try {
          fs.writeFileSync(path.join(SKILLS_DIR, safeSkillName(s.name) + '.md'), s.content, 'utf-8')
          count++
        } catch (e: any) { errors.push({ name: s.name, error: e.message }) }
      }
      return { success: errors.length === 0, count, errors: errors.length > 0 ? errors : undefined }
    } catch (e: any) { return { success: false, count: 0, error: e.message } }
  })

  ipcMain.handle('skill:uninstall', async (_e: any, name: string) => {
    try {
      const fp = path.join(SKILLS_DIR, name + '.md')
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  // ── 内置技能列表（打包在 assets/skills/）───────────────
  const BUILTIN_SKILL_ITEMS = [
    { id: 'code-review', name: '代码审查', description: '全面的代码审查检查清单', version: '1.0.0', author: 'Claude Space', category: 'code-review', icon: '🔍', tags: ['code-review','审查'], downloads: 999, rating: 4.5, source: 'builtin' },
    { id: 'security-audit', name: '安全审计', description: '基于 OWASP Top 10 的安全扫描与审计', version: '1.0.0', author: 'Claude Space', category: 'security', icon: '🛡️', tags: ['security','owasp'], downloads: 998, rating: 4.8, source: 'builtin' },
    { id: 'api-design', name: 'API 设计', description: 'RESTful API 设计与审查标准', version: '1.0.0', author: 'Claude Space', category: 'api-design', icon: '🔌', tags: ['api','rest'], downloads: 997, rating: 4.6, source: 'builtin' },
    { id: 'ts-expert', name: 'TypeScript 专家', description: 'TypeScript 类型安全和最佳实践', version: '1.0.0', author: 'Claude Space', category: 'code-review', icon: '🔷', tags: ['typescript'], downloads: 996, rating: 4.7, source: 'builtin' },
    { id: 'test-writer', name: '测试编写', description: '自动生成单元测试和集成测试', version: '1.0.0', author: 'Claude Space', category: 'testing', icon: '🧪', tags: ['测试'], downloads: 995, rating: 4.4, source: 'builtin' },
    { id: 'git-manager', name: 'Git 工作流', description: 'Git 操作与工作流管理助手', version: '1.0.0', author: 'Claude Space', category: 'git', icon: '📦', tags: ['git'], downloads: 994, rating: 4.3, source: 'builtin' },
    { id: 'doc-generator', name: '文档生成', description: '自动生成项目文档和 API 文档', version: '1.0.0', author: 'Claude Space', category: 'documentation', icon: '📝', tags: ['文档'], downloads: 993, rating: 4.5, source: 'builtin' },
    { id: 'perf-audit', name: '性能审计', description: '代码性能分析与优化建议', version: '1.0.0', author: 'Claude Space', category: 'performance', icon: '⚡', tags: ['性能'], downloads: 992, rating: 4.6, source: 'builtin' },
    { id: 'conventions-check', name: '规范检查', description: '代码风格和项目规范一致性检查', version: '1.0.0', author: 'Claude Space', category: 'conventions', icon: '📏', tags: ['规范'], downloads: 991, rating: 4.2, source: 'builtin' },
    { id: 'db-designer', name: '数据库设计', description: '数据库表结构设计与优化建议', version: '1.0.0', author: 'Claude Space', category: 'api-design', icon: '🗄️', tags: ['数据库'], downloads: 990, rating: 4.4, source: 'builtin' },
  ]

  ipcMain.handle('skill:marketplace-list', async () => {
    try {
      return { success: true, items: BUILTIN_SKILL_ITEMS }
    } catch (e: any) { return { success: false, items: [], error: e.message } }
  })


  // ── 技能市场配置 ──────────────────────────────────
  const MARKET_CONFIG_FILE = path.join(os.homedir(), '.claude', 'skill-market-config.json')

  interface MarketSource {
    name: string; url: string; enabled: boolean; autoScan: boolean
  }

  const DEFAULT_MARKETPLACES: MarketSource[] = [
    { name: 'Claude 官方技能', url: 'https://github.com/anthropics/skills.git', enabled: true, autoScan: true },
    { name: 'Claude 官方插件', url: 'https://github.com/anthropics/claude-plugins-official.git', enabled: true, autoScan: true },
    { name: '社区插件', url: 'https://github.com/anthropics/claude-plugins-community.git', enabled: true, autoScan: true },
  ]

  function loadMarketConfig() {
    try {
      if (fs.existsSync(MARKET_CONFIG_FILE)) {
        const cfg = JSON.parse(fs.readFileSync(MARKET_CONFIG_FILE, 'utf-8'))
        // Migrate legacy format { gitUrl: string } → { marketplaces }
        if (cfg.gitUrl && !cfg.marketplaces) {
          cfg.marketplaces = [
            ...DEFAULT_MARKETPLACES,
            ...(cfg.gitUrl ? [{ name: '自定义市场', url: cfg.gitUrl, enabled: true, autoScan: false }] : []),
          ]
          delete cfg.gitUrl
          saveMarketConfig(cfg)
        }
        return cfg
      }
    } catch {}
    return { marketplaces: [...DEFAULT_MARKETPLACES], localPaths: [] }
  }

  function saveMarketConfig(cfg: { marketplaces?: MarketSource[]; localPaths?: string[]; gitUrl?: string }) { fs.writeFileSync(MARKET_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8') }

  ipcMain.handle('skill:get-market-config', async () => ({ success: true, config: loadMarketConfig() }))

  ipcMain.handle('skill:save-market-config', async (_e, cfg) => {
    try { saveMarketConfig(cfg); return { success: true } } catch (e) { return { success: false, error: e.message } }
  })

  // ── 市场源管理 ──────────────────────────────────
  const MARKET_REPOS_DIR = path.join(os.homedir(), '.claude', 'skill-repos')

  function ensureDir(d: string) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) }

  ipcMain.handle('skill:marketplace-scan', async () => {
    try {
      const cfg = loadMarketConfig()
      const sources = (cfg.marketplaces || []).filter((s: MarketSource) => s.enabled && s.autoScan)
      const allSkills: any[] = []
      ensureDir(MARKET_REPOS_DIR)
      for (const src of sources) {
        const repoHash = Buffer.from(src.url).toString('base64url').slice(0, 32)
        const repoDir = path.join(MARKET_REPOS_DIR, repoHash)
        // Clone or pull
        await new Promise<void>((resolve, reject) => {
          if (fs.existsSync(repoDir)) {
            const p = spawn('git', ['-C', repoDir, 'pull', '--ff-only'], { timeout: 30000 })
            p.on('close', (code) => code === 0 ? resolve() : reject(new Error('git pull failed')))
            p.on('error', reject)
          } else {
            const p = spawn('git', ['clone', '--depth=1', src.url, repoDir], { timeout: 60000 })
            p.on('close', (code) => code === 0 ? resolve() : reject(new Error('git clone failed')))
            p.on('error', reject)
          }
        })
        // Scan for skills
        const scanned = scanDirForSkills(repoDir, src.name)
        for (const s of scanned) { s.sourceName = src.name; s.sourceUrl = src.url }
        allSkills.push(...scanned)
      }
      allSkills.sort((a, b) => a.name.localeCompare(b.name))
      return { success: true, skills: allSkills }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:marketplace-source-add', async (_e, src: MarketSource) => {
    try {
      const cfg = loadMarketConfig()
      if (!cfg.marketplaces) cfg.marketplaces = []
      if (cfg.marketplaces.find((s: MarketSource) => s.url === src.url)) return { success: false, error: '该市场已存在' }
      cfg.marketplaces.push(src)
      saveMarketConfig(cfg)
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:marketplace-source-remove', async (_e, url: string) => {
    try {
      const cfg = loadMarketConfig()
      cfg.marketplaces = (cfg.marketplaces || []).filter((s: MarketSource) => s.url !== url)
      saveMarketConfig(cfg)
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:marketplace-source-update', async (_e, url: string, updates: Partial<MarketSource>) => {
    try {
      const cfg = loadMarketConfig()
      const src = (cfg.marketplaces || []).find((s: MarketSource) => s.url === url)
      if (!src) return { success: false, error: '未找到该市场' }
      Object.assign(src, updates)
      saveMarketConfig(cfg)
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  function scanDirForSkills(dir: string, sourceName: string): any[] {
    const results: any[] = []
    try {
      for (const f of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, f)
        if (fs.statSync(fullPath).isDirectory()) {
          // Check for SKILL.md inside (Claude Code format)
          const skillMd = path.join(fullPath, 'SKILL.md')
          if (fs.existsSync(skillMd)) {
            const m = getSkillManifest(skillMd, true)
            if (m) { m.fileName = f; results.push(m) }
          }
          // Also scan flat .md files
          for (const sf of fs.readdirSync(fullPath)) {
            if (sf.endsWith('.md') && sf !== 'SKILL.md') {
              const m = getSkillManifest(path.join(fullPath, sf), true)
              if (m) results.push(m)
            }
          }
        } else if (f.endsWith('.md')) {
          const m = getSkillManifest(fullPath, true)
          if (m) results.push(m)
        }
      }
    } catch { /* skip dirs with errors */ }
    return results
  }

  // Deeper recursive scan for nested plugin repos (plugins/name/skills/name/SKILL.md)
  function deepScanDirForSkills(dir: string, sourceName: string): any[] {
    const results: any[] = []
    try {
      for (const f of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, f)
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            const skillMd = path.join(fullPath, 'SKILL.md')
            const hasDirectSkill = fs.existsSync(skillMd)
            if (hasDirectSkill) {
              const m = getSkillManifest(skillMd, true)
              if (m) { m.fileName = path.relative(dir, fullPath); results.push(m) }
            }
            // Check flat .md files in this dir
            for (const sf of fs.readdirSync(fullPath)) {
              if (sf.endsWith('.md') && sf !== 'SKILL.md') {
                const m = getSkillManifest(path.join(fullPath, sf), true)
                if (m) results.push(m)
              }
            }
            // Recurse deeper if no SKILL.md found at this level
            if (!hasDirectSkill) {
              const deeper = deepScanDirForSkills(fullPath, sourceName)
              results.push(...deeper)
            }
          }
        } catch { /* skip individual entries */ }
      }
    } catch { /* skip dirs */ }
    return results
  }

  // Use deep scan for marketplace repos, shallow scan for local files
  function scanDirForSkills(dir: string, sourceName: string): any[] {
    const isLocalFile = sourceName === '本地文件'
    return isLocalFile ? shallowScanDirForSkills(dir, sourceName) : deepScanDirForSkills(dir, sourceName)
  }

  function shallowScanDirForSkills(dir: string, sourceName: string): any[] {
    const results: any[] = []
    try {
      for (const f of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, f)
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            const skillMd = path.join(fullPath, 'SKILL.md')
            if (fs.existsSync(skillMd)) {
              const m = getSkillManifest(skillMd, true)
              if (m) { m.fileName = f; results.push(m) }
            }
            for (const sf of fs.readdirSync(fullPath)) {
              if (sf.endsWith('.md') && sf !== 'SKILL.md') {
                const m = getSkillManifest(path.join(fullPath, sf), true)
                if (m) results.push(m)
              }
            }
          } else if (f.endsWith('.md')) {
            const m = getSkillManifest(fullPath, true)
            if (m) results.push(m)
          }
        } catch { /* skip individual entries */ }
      }
    } catch { /* skip dirs */ }
    return results
  }

  
  ipcMain.handle('skill:load-from-local-dir', async (_e, dir: string) => {
    try {
      if (!dir || !fs.existsSync(dir)) return { success: false, error: 'not found' }
      const skills = deepScanDirForSkills(dir, '本地文件')
      skills.sort((a, b) => a.name.localeCompare(b.name))
      return { success: true, skills }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:load-from-local', async () => {
    try {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || !result.filePaths[0]) return { success: false, error: 'cancelled' }
      const dir = result.filePaths[0]
      if (!fs.existsSync(dir)) return { success: false, error: 'not found' }
      // Recursive scan: traverse subdirectories for SKILL.md + .md files
      const skills = deepScanDirForSkills(dir, '本地文件')
      skills.sort((a, b) => a.name.localeCompare(b.name))
      // Still remember the dir for future reloads
      const cfg = loadMarketConfig()
      if (!cfg.localPaths.includes(dir)) cfg.localPaths.push(dir)
      saveMarketConfig(cfg)
      return { success: true, skills }
    } catch (e) { return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:load-from-git', async (_e, gitUrl) => {
    return new Promise((resolve) => {
      try {
        if (!gitUrl) { resolve({ success: false, error: 'no url' }); return }
        const td = path.join(os.homedir(), '.claude', 'skill-repos', Date.now().toString(36))
        const gitProc = spawn('git', ['clone', '--depth=1', gitUrl, td], { timeout: 60000 })
        let stderr = ''
        gitProc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
        gitProc.on('close', (code) => {
          try {
            if (code !== 0) { resolve({ success: false, error: stderr || 'Git clone failed' }); return }
            if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true })
            let count = 0
            for (const f of fs.readdirSync(td)) { if (f.endsWith('.md')) { fs.copyFileSync(path.join(td, f), path.join(SKILLS_DIR, f)); count++ } }
            const cfg = loadMarketConfig()
            cfg.gitUrl = gitUrl
            saveMarketConfig(cfg)
            resolve({ success: true, count })
          } catch (e: any) { resolve({ success: false, error: e.message }) }
        })
        gitProc.on('error', (err) => { resolve({ success: false, error: err.message }) })
      } catch (e: any) { resolve({ success: false, error: e.message }) }
    })
  })

  ipcMain.handle('skill:marketplace-install', async (_e: any, item: { id: string }) => {
    try {
      const skillFile = path.join(__dirname, '..', 'assets', 'skills', item.id + '.md')
      if (!fs.existsSync(skillFile)) return { success: false, error: 'Skill not found in bundle' }
      if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true })
      fs.copyFileSync(skillFile, path.join(SKILLS_DIR, item.id + '.md'))
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })
  // ── 开发进程管理 ────────────────────────────────────
  let devProcess: any = null

  ipcMain.handle('dev:start', async (_e: any, opts: { command: string; name: string }) => {
    if (devProcess) { try { devProcess.kill() } catch {}; devProcess = null }
    try {
      const { spawn } = require('child_process')
      devProcess = spawn(opts.command, [], { shell: true, cwd: process.cwd(), env: { ...process.env } })
      devProcess.stdout?.on('data', (d: Buffer) => { broadcastToAllWindows('dev:output', d.toString()) })
      devProcess.stderr?.on('data', (d: Buffer) => { broadcastToAllWindows('dev:error', d.toString()) })
      devProcess.on('exit', () => { devProcess = null; broadcastToAllWindows('dev:status', { running: false, name: opts.name }) })
      broadcastToAllWindows('dev:status', { running: true, name: opts.name })
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('dev:stop', async () => {
    if (devProcess) { try { devProcess.kill() } catch {}; devProcess = null; return { success: true } }
    return { success: false, error: 'No running process' }
  })

  function broadcastToAllWindows(channel: string, ...args: any[]) {
    for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send(channel, ...args) } catch {} }
  }

  // ── 控制台窗口 ────────────────────────────────────
  ipcMain.handle('console:open-window', async () => {
    try {
      const win = new BrowserWindow({
        width: 1200, height: 700,
        title: '开发者控制台',
        backgroundColor: '#0d0d0d',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
      })
      if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL + '?consoleWindow=1')
      } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { consoleWindow: '1' } })
      }
      win.on('closed', () => { const idx = windows.indexOf(win); if (idx >= 0) windows.splice(idx, 1) })
      windows.push(win)
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  // ── 终端管理（多窗口隔离）───────────────────────────

  // 根据事件来源窗口查找对应终端（h: windowTerminals → terminalProcesses → terminalProcess）
  function findTerminal(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): TerminalProcess | undefined {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const sid = windowTerminals.get(win.id)
      if (sid) {
        const tp = terminalProcesses.get(sid)
        if (tp) return tp
      }
    }
    return terminalProcess ?? undefined
  }

  ipcMain.handle('terminal:start', async (event, opts: {
    cwd?: string; sessionId?: string; cols?: number; rows?: number;
    autoApproval?: boolean;
  }) => {
    // 调试日志写到文件（打包版 GUI 无控制台输出）
    fs.appendFileSync(path.join(os.homedir(), 'claude-space-debug.log'), `[${new Date().toISOString()}] terminal:start called sessionId=${opts.sessionId} cwd=${opts.cwd} autoApproval=${opts.autoApproval}\n`, 'utf-8')
    const win = BrowserWindow.fromWebContents(event.sender)
    const winId = win?.id ?? 0
    const sid = opts.sessionId || 'default'

    // 记录窗口→会话映射（向后兼容）
    if (winId) {
      windowTerminals.set(winId, sid)
      // 注册窗口为终端事件广播目标
      registerTerminalWindow(sid, winId)
    }

    // 检查是否已有该会话的终端进程 → 复用
    const existing = terminalProcesses.get(sid)
    if (existing) {
      terminalProcess = existing
      // 发送当前状态到此窗口（后续事件通过 broadcastTerminalEvent 广播到所有绑定窗口）
      const target = win ?? mainWindow
      target?.webContents.send('terminal:status', {
        running: existing.isRunning,
        shellRunning: existing.isRunning,
        claudeRunning: existing.isClaudeRunning,
        connected: existing.isClaudeRunning,
        sessionId: sid,
        error: '',
      })
      return { success: true }
    }

    // 获取 claude 绝对路径
    const cliInfo = await detectCli()
    const claudePath = cliInfo.found ? cliInfo.path : undefined

    // 校验 session 文件是否存在 — 不存在则放弃 resume，启动全新会话
    const encodedPath = encodeClaudePath((opts.cwd || '').replace(/\\/g, '/'))
    const sessionDir = path.join(CLAUDE_HOME, 'projects', encodedPath)
    let validSessionId: string | undefined = undefined
    if (opts.sessionId) {
      const jsonlFile = path.join(sessionDir, `${opts.sessionId}.jsonl`)
      if (fs.existsSync(jsonlFile)) {
        validSessionId = opts.sessionId
      } else {
        console.log(`[terminal:start] session file not found: ${jsonlFile}, starting fresh session`)
      }
    }

    // 终端模式 Claude 完全由 ~/.claude/settings.json 控制，不传入模型配置
    const proc = new TerminalProcess({
      cwd: opts.cwd,
      sessionId: validSessionId,
      claudePath,
      cols: opts.cols || 120,
      rows: opts.rows || 40,
      permissionMode: opts.autoApproval ? 'auto' : 'manual',
    })

    // 事件广播到所有绑定此终端的窗口（支持多窗口共享终端）
    proc.on('terminal-data', (data: string) => {
      broadcastTerminalEvent(sid, 'terminal:data', data); pushLog(data, 'terminal'); if (devProcess) pushLog(data, 'dev')
    })
    proc.on('event', (event: any) => {
      if (event.type === 'assistant' || event.type === 'user') {
        const boundWins = terminalWindowBindings.get(sid)
        fs.appendFileSync(path.join(os.homedir(), 'claude-space-debug.log'),
          `[${new Date().toISOString()}] main: broadcast event type=${event.type} sid=${sid?.slice(0,8)} boundWindows=${boundWins?.size || 0}\n`, 'utf-8')
      }
      broadcastTerminalEvent(sid, 'claude:event', event)
    })
    proc.on('status', (s: any) => {
      broadcastTerminalEvent(sid, 'claude:status-update', s)
      broadcastTerminalEvent(sid, 'terminal:status', s)
      // 终端错误 → 转发到 Chat stderr 通道展示
      if (s.error) {
        broadcastTerminalEvent(sid, 'claude:stderr', `[终端] ${s.error}`)
      }
    })
    proc.on('permission-prompt', (prompt: { text: string; timestamp: number }) => {
      broadcastTerminalEvent(sid, 'claude:permission-prompt', prompt)
    })

    terminalProcess = proc
    terminalProcesses.set(sid, proc)
    proc.start()
    return { success: true }
  })

  ipcMain.handle('terminal:restart', async (event) => {
    findTerminal(event)?.restart()
    return { success: true }
  })

  ipcMain.on('terminal:input', (event, data: string) => {
    const tp = findTerminal(event)
    if (tp) {
      fs.appendFileSync(path.join(os.homedir(), 'claude-space-debug.log'),
        `[${new Date().toISOString()}] terminal:input write dataLen=${data.length} running=${tp.isRunning}\n`, 'utf-8')
      tp.write(data)
    } else {
      fs.appendFileSync(path.join(os.homedir(), 'claude-space-debug.log'),
        `[${new Date().toISOString()}] terminal:input NO TERMINAL FOUND\n`, 'utf-8')
    }
  })

  ipcMain.on('terminal:resize', (event, opts: { cols: number; rows: number }) => {
    findTerminal(event)?.resize(opts.cols, opts.rows)
  })

  ipcMain.handle('terminal:kill', async (event) => {
    const tp = findTerminal(event)
    if (tp) {
      for (const [id, p] of terminalProcesses) {
        if (p === tp) { terminalProcesses.delete(id); break }
      }
      tp.kill()
      if (terminalProcess === tp) terminalProcess = null
    }
    return { success: true }
  })

  ipcMain.handle('terminal:set-permission-mode', async (event, mode: 'auto' | 'manual') => {
    const tp = findTerminal(event)
    if (tp) {
      tp.updatePermissionMode(mode)
      return { success: true }
    }
    // 也更新所有已注册终端进程
    for (const [, proc] of terminalProcesses) {
      proc.updatePermissionMode(mode)
    }
    return { success: true }
  })

  ipcMain.handle('terminal:status', async (event) => {
    const tp = findTerminal(event)
    return {
      running: tp?.isRunning || false,
      claudeRunning: tp?.isClaudeRunning || false,
      sessionId: tp?.sessionId || null,
      error: tp?.lastError || '',
    }
  })

  // ── SSH 远程管理 ──────────────────────────────────────

  ipcMain.handle('ssh:connect', async (_event, serverId: string) => {
    const raw = loadSettings()
    const cfg = raw?.sshServers?.find(s => s.id === serverId)
    if (!cfg) return { success: false, error: 'SSH 服务器配置未找到' }
    // 清理主机地址：去掉 http:// https:// 和尾部斜杠
    const cleanCfg = { ...cfg, host: cfg.host.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim() }
    return sshService.connect(cleanCfg)
  })

  ipcMain.handle('ssh:disconnect', async (_event, serverId: string) => {
    sshService.disconnect(serverId)
    // 同时关闭该服务器的远程终端
    const term = sshTerminals.get(serverId)
    if (term) { term.kill(); sshTerminals.delete(serverId) }
    if (activeSshTerminal && activeSshTerminal === term) activeSshTerminal = null
    return { success: true }
  })

  ipcMain.handle('ssh:status', async () => {
    if (activeSshTerminal) {
      return {
        serverId: activeSshTerminal['options']?.serverId || null,
        status: activeSshTerminal.isConnected ? 'connected' : 'disconnected',
        error: activeSshTerminal.lastError,
        connectedAt: null,
      }
    }
    return { serverId: null, status: 'disconnected', error: '', connectedAt: null }
  })

  ipcMain.handle('ssh:test-connection', async (_event, config: any) => {
    const testConfig: SshServerConfig = {
      id: 'test-' + Date.now().toString(36),
      name: config.name || 'Test',
      host: (config.host || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim(),
      port: config.port || 22,
      username: config.username,
      authMethod: config.authMethod || 'password',
      password: config.newPassword || config.password || '',
      privateKeyPath: config.privateKeyPath || '',
      privateKeyContent: config.newPrivateKeyContent || '',
      fingerprint: config.fingerprint,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    return sshService.testConnection(testConfig)
  })

  ipcMain.handle('ssh:list-remote-files', async (_event, opts: { serverId: string; remotePath: string; maxDepth?: number }) => {
    try {
      const files = await sshService.listDirectory(opts.serverId, opts.remotePath, opts.maxDepth || 3)
      return files
    } catch (err: any) {
      return []
    }
  })

  ipcMain.handle('ssh:read-remote-file', async (_event, opts: { serverId: string; remotePath: string }) => {
    return sshService.readFile(opts.serverId, opts.remotePath)
  })

  ipcMain.handle('ssh:write-remote-file', async (_event, opts: { serverId: string; remotePath: string; content: string }) => {
    return sshService.writeFile(opts.serverId, opts.remotePath, opts.content)
  })

  ipcMain.handle('ssh:exec-command', async (_event, opts: { serverId: string; command: string; timeoutMs?: number }) => {
    return sshService.execCommand(opts.serverId, opts.command, opts.timeoutMs || 30000)
  })

  // ── 远程终端 ──

  ipcMain.handle('ssh:start-terminal', async (_event, opts: { serverId: string; cols?: number; rows?: number }) => {
    // 先关闭旧终端
    const existing = sshTerminals.get(opts.serverId)
    if (existing) existing.kill()

    console.log('[main] ssh:start-terminal serverId:', opts.serverId)
    const term = new SshTerminalProcess({
      serverId: opts.serverId,
      sshService,
      cols: opts.cols || 120,
      rows: opts.rows || 40,
    })

    // 事件转发
    term.on('terminal-data', (data: string) => {
      if (term === activeSshTerminal) {
        mainWindow?.webContents.send('ssh:terminal-data', data)
      }
    })
    term.on('status', (s: any) => {
      console.log('[main] ssh-terminal status:', JSON.stringify(s))
      if (term === activeSshTerminal) {
        mainWindow?.webContents.send('ssh:terminal-status', s)
      }
    })

    sshTerminals.set(opts.serverId, term)
    activeSshTerminal = term
    term.start()
    return { success: true }
  })

  ipcMain.on('ssh:terminal-input', (_event, data: string) => {
    activeSshTerminal?.write(data)
  })

  ipcMain.on('ssh:terminal-resize', (_event, opts: { cols: number; rows: number }) => {
    activeSshTerminal?.resize(opts.cols, opts.rows)
  })

  ipcMain.handle('ssh:terminal-kill', async () => {
    if (activeSshTerminal) {
      const serverId = (activeSshTerminal as any).options?.serverId
      activeSshTerminal.kill()
      if (serverId) sshTerminals.delete(serverId)
      activeSshTerminal = null
    }
    return { success: true }
  })

  // ── 部署 ──

  ipcMain.handle('ssh:deploy', async (_event, opts: { projectPath: string; deployTargetId: string }) => {
    const raw = loadSettings()
    const target = raw?.deployTargets?.find(t => t.id === opts.deployTargetId)
    if (!target) return { success: false, error: '部署目标配置未找到' }

    // 检查 SSH 连接
    const connStatus = sshService.getStatus(target.sshServerId)
    if (!connStatus.connected) return { success: false, error: `未连接到 SSH 服务器，请先在 SSH 面板连接` }

    // 执行部署前命令
    for (const cmd of target.preDeployCommands) {
      mainWindow?.webContents.send('ssh:deploy-status', { targetId: target.id, phase: 'pre-command', command: cmd })
      try { await sshService.execCommand(target.sshServerId, cmd) } catch (_e) { /* silent */ }
    }

    // 上传文件
    mainWindow?.webContents.send('ssh:deploy-status', { targetId: target.id, phase: 'upload', currentFile: '', progress: 0 })
    const excludes = target.excludePatterns?.length ? target.excludePatterns : ['node_modules', '.git', '.env', 'dist']
    const result = await sshService.uploadDirectory(
      target.sshServerId, opts.projectPath, target.remotePath,
      excludes, (msg: string) => {
        mainWindow?.webContents.send('ssh:deploy-status', { targetId: target.id, phase: 'upload', currentFile: msg, progress: 0 })
      }
    )

    if (!result.success) return { success: false, error: result.error, uploaded: result.uploaded }

    // 执行部署后命令
    for (const cmd of target.postDeployCommands) {
      mainWindow?.webContents.send('ssh:deploy-status', { targetId: target.id, phase: 'post-command', command: cmd })
      try { await sshService.execCommand(target.sshServerId, cmd) } catch (_e) { /* silent */ }
    }

    mainWindow?.webContents.send('ssh:deploy-status', { targetId: target.id, phase: 'completed', uploaded: result.uploaded })
    return { success: true, uploaded: result.uploaded }
  })

  // 窗口控制 — 使用 event.sender 定位正确的窗口
  ipcMain.handle('win:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.handle('win:maximize', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (w?.isMaximized()) w.unmaximize()
    else w?.maximize()
  })
  ipcMain.handle('win:close', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    w?.close()
  })
  ipcMain.handle('win:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
    ipcMain.handle('app:workspace-root', async () => getActiveWorkspaceRoot())

  // ── 项目技能管理 ──────────────────────────────────
  const PROJECT_SKILLS_FILE = '.claude/project-skills.json'

  function getProjectSkillsPath(): string {
    return path.join(getActiveWorkspaceRoot(), PROJECT_SKILLS_FILE)
  }

  function loadProjectSkills(): string[] {
    try {
      const fp = getProjectSkillsPath()
      if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf-8'))
    } catch {}
    return []
  }

  function saveProjectSkills(skills: string[]) {
    const fp = getProjectSkillsPath()
    const dir = path.dirname(fp)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(fp, JSON.stringify(skills, null, 2), 'utf-8')
  }

  ipcMain.handle('skill:list-project', async () => {
    try { return { success: true, skills: loadProjectSkills() } } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:install-to-project', async (_e, skillName: string) => {
    try {
      const list = loadProjectSkills()
      if (!list.includes(skillName)) { list.push(skillName); saveProjectSkills(list) }
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:remove-from-project', async (_e, skillName: string) => {
    try {
      const list = loadProjectSkills()
      const idx = list.indexOf(skillName)
      if (idx >= 0) { list.splice(idx, 1); saveProjectSkills(list) }
      return { success: true }
    } catch (e: any) { return { success: false, error: e.message } }
  })

  ipcMain.handle('skill:clear-project', async () => {
    try { saveProjectSkills([]); return { success: true } } catch (e: any) { return { success: false, error: e.message } }
  })

  // ── 自动化工坊：循环任务 ────────────────────────────
  const LOOPS_FILE = path.join(os.homedir(), '.claude', 'loops.json')
  function loadLoops(): any[] { try { if (fs.existsSync(LOOPS_FILE)) return JSON.parse(fs.readFileSync(LOOPS_FILE, 'utf-8')) } catch {} return [] }
  function saveLoops(loops: any[]) { const dir = path.dirname(LOOPS_FILE); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(LOOPS_FILE, JSON.stringify(loops, null, 2), 'utf-8') }
  ipcMain.handle('loop:list', async () => { try { return { success: true, loops: loadLoops() } } catch (e: any) { return { success: false, error: e.message } } })
  ipcMain.handle('loop:create', async (_e, opts: { name: string; prompt: string; interval: string }) => { try { const loops = loadLoops(); const loop = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: opts.name, prompt: opts.prompt, interval: opts.interval || '10m', status: 'idle', lastRun: null, createdAt: new Date().toISOString() }; loops.push(loop); saveLoops(loops); return { success: true, loop } } catch (e: any) { return { success: false, error: e.message } } })
  ipcMain.handle('loop:delete', async (_e, id: string) => { try { const loops = loadLoops(); saveLoops(loops.filter((l: any) => l.id !== id)); return { success: true } } catch (e: any) { return { success: false, error: e.message } } })
  ipcMain.handle('loop:run-now', async (_e, id: string) => { try { const loops = loadLoops(); const loop = loops.find((l: any) => l.id === id); if (!loop) return { success: false, error: 'not found' }; loop.status = 'running'; loop.lastRun = new Date().toISOString(); saveLoops(loops); return { success: true } } catch (e: any) { return { success: false, error: e.message } } })

  // ── 工作流执行 ────────────────────────────────────
  const WFRUNS_FILE = path.join(os.homedir(), '.claude', 'workflow-runs.json')
  function loadRuns(): any[] { try { if (fs.existsSync(WFRUNS_FILE)) return JSON.parse(fs.readFileSync(WFRUNS_FILE, 'utf-8')) } catch {} return [] }
  function saveRuns(runs: any[]) { const dir = path.dirname(WFRUNS_FILE); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(WFRUNS_FILE, JSON.stringify(runs, null, 2), 'utf-8') }
  ipcMain.handle('workflow:list-runs', async () => { try { return { success: true, runs: loadRuns() } } catch (e: any) { return { success: false, error: e.message } } })
  ipcMain.handle('workflow:run', async (_e, opts: { templateId: string; name: string }) => { try { const run = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), templateId: opts.templateId, name: opts.name, status: 'queued', startedAt: new Date().toISOString(), completedAt: null, result: null }; const runs = loadRuns(); runs.push(run); saveRuns(runs); return { success: true, run } } catch (e: any) { return { success: false, error: e.message } } })

  // ── 工作空间管理 IPC ──────────────────────────────
  ipcMain.handle('workspace:list', async () => {
    // 首次调用且 _workspaces 为空时，自动创建默认空间并同步到内存
    if (_workspaces.length === 0) {
      _workspaces = [{
        id: '_default', name: '默认工作空间', path: _workspaceRoot, isActive: true,
        createdAt: new Date().toISOString(),
      }]
      // 持久化默认空间，确保后续 settings:load 也能加载到
      const existing = loadSettings()
      if (!existing?.workspaces?.length) {
        saveSettings({ ...(existing || {} as any), workspaces: _workspaces, version: existing?.version || 1 })
      }
    }
    return _workspaces
  })

  ipcMain.handle('workspace:add', async (_event, opts: { name: string; path: string }) => {
    const id = 'ws_' + Date.now().toString(36)
    const ws: WorkspaceConfig = { id, name: opts.name, path: opts.path, isActive: false, createdAt: new Date().toISOString() }
    _workspaces.push(ws)
    // 持久化到 settings
    const existing = loadSettings()
    saveSettings({ ...(existing || {} as any), workspaces: _workspaces, version: existing?.version || 1 })
    return { success: true, workspace: ws }
  })

  ipcMain.handle('workspace:remove', async (_event, workspaceId: string) => {
    const idx = _workspaces.findIndex(w => w.id === workspaceId)
    if (idx < 0) return { success: false, error: '工作空间不存在' }
    const wasActive = _workspaces[idx].isActive
    _workspaces.splice(idx, 1)
    if (wasActive && _workspaces.length > 0) {
      _workspaces[0].isActive = true
      _workspaceRoot = _workspaces[0].path
    } else if (_workspaces.length === 0) {
      _workspaceRoot = getWorkspaceRoot()
    }
    const existing = loadSettings()
    saveSettings({ ...(existing || {} as any), workspaces: _workspaces, version: existing?.version || 1 })
    return { success: true }
  })

  ipcMain.handle('workspace:set-active', async (_event, workspaceId: string) => {
    let found = false
    _workspaces = _workspaces.map(w => {
      if (w.id === workspaceId) { found = true; _workspaceRoot = w.path; return { ...w, isActive: true } }
      return { ...w, isActive: false }
    })
    if (!found) return { success: false, error: '工作空间不存在' }
    const existing = loadSettings()
    saveSettings({ ...(existing || {} as any), workspaces: _workspaces, version: existing?.version || 1 })
    return { success: true, path: _workspaceRoot }
  })
}

// ── 应用生命周期 ────────────────────────────────────────

app.whenReady().then(() => {
  // 启动日志
  const logFile = path.join(os.homedir(), 'claude-space-debug.log')
  fs.writeFileSync(logFile, `[${new Date().toISOString()}] APP STARTED v1.1.5 platform=${process.platform} electron=${process.versions.electron}\n`, 'utf-8')

  // 先显示启动画面，再初始化应用
  splashWindow = createSplashWindow()

  applyMenu()
  registerIPC()
  createWindow()
  // 等窗口就绪后再启动 claude settings.json 监视
  setTimeout(() => {
    try { initClaudeSettingsWatcher() } catch (e) { console.warn('initClaudeSettingsWatcher failed:', e) }
  }, 3000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  claudeProcess?.kill()
  for (const [, entry] of sessionProcesses) entry.process.kill()
  sessionProcesses.clear()
  for (const [, tp] of terminalProcesses) tp.kill()
  terminalProcesses.clear()
  agentPool.stopAll()
  for (const [, term] of sshTerminals) term.kill()
  sshTerminals.clear()
  sshService.disconnectAll()
  app.quit()
})

app.on('before-quit', () => {
  claudeProcess?.kill()
  for (const [, entry] of sessionProcesses) entry.process.kill()
  sessionProcesses.clear()
  for (const [, tp] of terminalProcesses) tp.kill()
  terminalProcesses.clear()
  agentPool.stopAll()
  for (const [, term] of sshTerminals) term.kill()
  sshTerminals.clear()
  activeSshTerminal = null
  sshService.disconnectAll()
  for (const w of [...windows]) {
    try { if (!w.isDestroyed()) w.destroy() } catch (_e) { /* silent */ }
  }
  windows.length = 0
})