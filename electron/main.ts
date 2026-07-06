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
import { encodeClaudePath, decodeClaudePath, maskApiKey, readJsonlSafe, enqueueFileWrite, getWorkspaceRoot, withFileLock, resolveClaudePath } from './utils'
import { LoopScheduler } from './loopScheduler'
import { WorkflowEngine } from './workflowEngine'

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
  if (!winIds || winIds.size === 0) {
    // 安全兜底：未注册 → 广播到所有窗口
    for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send(channel, ...args) } catch {} }
    return
  }
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

// ── Loop / Workflow 引擎 ────────────────────────────────
const broadcast = (channel: string, ...args: any[]) => {
  for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send(channel, ...args) } catch {} }
}
const loopScheduler = new LoopScheduler(broadcast, () => getActiveWorkspaceRoot())
const workflowEngine = new WorkflowEngine(broadcast, () => getActiveWorkspaceRoot())

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

  // ── 工作空间管理 ───────────────────────────────────────
  /** workspace:list 工作空间列表 */
  ipcMain.handle('workspace:list', async () => _workspaces)

  /** workspace:add 添加工作空间 */
  ipcMain.handle('workspace:add', async (_event, opts: { name: string; path: string }) => {
    if (_workspaces.find(w => w.path === opts.path)) {
      return { success: false, error: '工作空间路径已存在' }
    }
    const ws: WorkspaceConfig = {
      id: 'ws_' + Date.now().toString(36),
      name: opts.name,
      path: opts.path,
      isActive: _workspaces.length === 0,
      createdAt: new Date().toISOString(),
    }
    _workspaces.push(ws)
    const settings = loadSettings() || { version: 1, activeModelId: null, models: [], autoApproval: false, sshServers: [], deployTargets: [], ides: [] }
    settings.workspaces = _workspaces
    saveSettings(settings)
    return { success: true, workspace: ws }
  })

  /** workspace:remove 移除工作空间 */
  ipcMain.handle('workspace:remove', async (_event, workspaceId: string) => {
    _workspaces = _workspaces.filter(w => w.id !== workspaceId)
    const settings = loadSettings() || { version: 1, activeModelId: null, models: [], autoApproval: false, sshServers: [], deployTargets: [], ides: [] }
    settings.workspaces = _workspaces
    saveSettings(settings)
    return { success: true }
  })

  /** workspace:set-active 设置活跃工作空间 */
  ipcMain.handle('workspace:set-active', async (_event, workspaceId: string) => {
    _workspaces = _workspaces.map(w => ({ ...w, isActive: w.id === workspaceId }))
    const active = _workspaces.find(w => w.isActive)
    if (active) _workspaceRoot = active.path
    const settings = loadSettings() || { version: 1, activeModelId: null, models: [], autoApproval: false, sshServers: [], deployTargets: [], ides: [] }
    settings.workspaces = _workspaces
    saveSettings(settings)
    return { success: true }
  })

  // ── 应用基础 ─────────────────────────────────────────
  /** app:workspace-root 获取活跃工作空间根目录 */
  ipcMain.handle('app:workspace-root', async () => getActiveWorkspaceRoot())

  // ── 设置管理 ─────────────────────────────────────────
  /** settings:load 加载设置 */
  ipcMain.handle('settings:load', async () => loadSettings())

  /** settings:save 保存设置 */
  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => {
    syncWorkspaceRootFromSettings(settings)
    saveSettings(settings)
    return { success: true }
  })

  // ── 任务管理 ─────────────────────────────────────────
  /** task:load 加载任务 */
  ipcMain.handle('task:load', async () => loadTasks())

  /** task:save 保存任务 */
  ipcMain.handle('task:save', async (_event, tasks: any[]) => {
    saveTasks(tasks)
    return { success: true }
  })

  // ── 团队管理 ─────────────────────────────────────────
  const TEAM_FILE = path.join(os.homedir(), '.claude', 'claude-space-team.json')

  ipcMain.handle('team:load', async () => {
    try {
      if (fs.existsSync(TEAM_FILE)) {
        return JSON.parse(fs.readFileSync(TEAM_FILE, 'utf-8'))
      }
    } catch (_e) { /* silent */ }
    return []
  })

  ipcMain.handle('team:save', async (_event, team: any[]) => {
    try {
      const dir = path.dirname(TEAM_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = TEAM_FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(team, null, 2), 'utf-8')
      fs.renameSync(tmp, TEAM_FILE)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── 会话管理（扩展） ───────────────────────────────────
  /** session:list 列出项目会话 */
  ipcMain.handle('session:list', async (_event, projectPath?: string) => listSessions(projectPath))

  /** session:list-all 列出所有会话 */
  ipcMain.handle('session:list-all', async () => listSessions())

  /** session:transcript 读取会话 JSONL 历史 */
  ipcMain.handle('session:transcript', async (_event, sessionId: string) => {
    try {
      // 扫描所有项目目录查找匹配 sessionId 的 JSONL
      const projectsDir = path.join(CLAUDE_HOME, 'projects')
      if (!fs.existsSync(projectsDir)) return { events: [] }
      for (const encoded of fs.readdirSync(projectsDir)) {
        const sessionDir = path.join(projectsDir, encoded)
        if (!fs.statSync(sessionDir).isDirectory()) continue
        const sessionFile = path.join(sessionDir, sessionId + '.jsonl')
        if (fs.existsSync(sessionFile)) {
          const content = fs.readFileSync(sessionFile, 'utf-8')
          const events = content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
          return { sessionId, events, projectPath: decodeClaudePath(encoded) }
        }
      }
    } catch (_e) { /* silent */ }
    return { events: [] }
  })

  /** session:recent 获取项目最近会话 */
  ipcMain.handle('session:recent', async (_event, projectPath: string) => {
    try {
      const sessions = listSessions(projectPath)
      if (sessions.length === 0) return null
      const recent = sessions[0]
      // 读取 JSONL 前 200 条消息
      const encodedPath = encodeClaudePath(projectPath.replace(/\\/g, '/'))
      const sessionFile = path.join(CLAUDE_HOME, 'projects', encodedPath, recent.sessionId + '.jsonl')
      if (fs.existsSync(sessionFile)) {
        const content = fs.readFileSync(sessionFile, 'utf-8')
        const allEvents = content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
        return { sessionId: recent.sessionId, messages: allEvents.slice(-200) }
      }
    } catch (_e) { /* silent */ }
    return null
  })

  /** session:extract-tasks 从会话 JSONL 提取任务事件 */
  ipcMain.handle('session:extract-tasks', async (_event, projectPath: string) => {
    const tasks: any[] = []
    try {
      const sessions = listSessions(projectPath)
      for (const s of sessions.slice(0, 20)) { // 最多扫描最近 20 个会话
        const encodedPath = encodeClaudePath(projectPath.replace(/\\/g, '/'))
        const sessionFile = path.join(CLAUDE_HOME, 'projects', encodedPath, s.sessionId + '.jsonl')
        if (!fs.existsSync(sessionFile)) continue
        const content = fs.readFileSync(sessionFile, 'utf-8')
        const lines = content.split('\n').filter(l => l.trim())
        for (const line of lines) {
          try {
            const evt = JSON.parse(line)
            if (evt.type === 'tool_use' && evt.name === 'TaskCreate' && evt.input?.subject) {
              tasks.push({ sessionId: s.sessionId, ...evt.input, timestamp: evt.timestamp || s.modifiedAt })
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch (_e) { /* silent */ }
    return tasks
  })

  // ── 文件操作 ───────────────────────────────────────────
  /** file:read 读取文件 */
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      const stat = fs.statSync(filePath)
      if (isBinaryExtension(filePath)) {
        return { success: false, error: '二进制文件无法预览', isBinary: true, size: stat.size }
      }
      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, content, size: stat.size, isBinary: false }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  /** file:write 写入文件 */
  ipcMain.handle('file:write', async (_event, opts: { filePath: string; content: string }) => {
    try {
      const dir = path.dirname(opts.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(opts.filePath, opts.content, 'utf-8')
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  /** file:create 创建文件 */
  ipcMain.handle('file:create', async (_event, opts: { dirPath: string; fileName: string; content?: string }) => {
    try {
      if (!fs.existsSync(opts.dirPath)) fs.mkdirSync(opts.dirPath, { recursive: true })
      const filePath = path.join(opts.dirPath, opts.fileName)
      fs.writeFileSync(filePath, opts.content || '', 'utf-8')
      return { success: true, path: filePath }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  /** file:delete 删除文件 */
  ipcMain.handle('file:delete', async (_event, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true })
        } else {
          fs.unlinkSync(filePath)
        }
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  /** file:open-in-new-window 在独立窗口中打开文件 */
  ipcMain.handle('file:open-in-new-window', async (_event, opts: { filePath: string; fileName: string; projectPath?: string }) => {
    createFileViewerWindow(opts.filePath, opts.fileName, opts.projectPath)
    return { success: true }
  })

  /** file:open-dialog 打开文件选择对话框 */
  ipcMain.handle('file:open-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: '所有文件', extensions: ['*'] },
        { name: '代码文件', extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'rs', 'go', 'rb', 'php'] },
        { name: 'Markdown', extensions: ['md', 'mdx'] },
        { name: '配置文件', extensions: ['json', 'yaml', 'yml', 'toml', 'ini', 'env'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  /** dialog:open-directory 选择目录对话框 */
  ipcMain.handle('dialog:open-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    return { canceled: false, dirPath: result.filePaths[0] }
  })

  /** image:save-temp 保存图片到项目临时目录 */
  ipcMain.handle('image:save-temp', async (_event, opts: { projectPath: string; images: Array<{ base64: string; mediaType: string }> }) => {
    const paths: string[] = []
    try {
      const tempDir = path.join(opts.projectPath, '.claude-space', 'temp-images')
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
      for (const img of opts.images) {
        const ext = img.mediaType === 'image/png' ? '.png' : img.mediaType === 'image/jpeg' ? '.jpg' : img.mediaType === 'image/gif' ? '.gif' : '.png'
        const fileName = `paste_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
        fs.writeFileSync(path.join(tempDir, fileName), Buffer.from(img.base64, 'base64'))
        paths.push(path.join(tempDir, fileName))
      }
    } catch (err: any) {
      return { success: false, error: err.message, paths }
    }
    return { success: true, paths }
  })

  // ── 窗口控制 ───────────────────────────────────────────
  /** win:minimize 最小化窗口 */
  ipcMain.handle('win:minimize', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  /** win:maximize 最大化/还原窗口 */
  ipcMain.handle('win:maximize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  /** win:close 关闭窗口 */
  ipcMain.handle('win:close', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  /** win:is-maximized 判断窗口是否最大化 */
  ipcMain.handle('win:is-maximized', async (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false
  })

  // ── 连接管理 ─────────────────────────────────────────
  /** connection:check-cli 检测 Claude CLI */
  ipcMain.handle('connection:check-cli', async () => detectCli())

  /** connection:test-api 测试 API 端点 */
  ipcMain.handle('connection:test-api', async (_event, opts: { baseUrl: string; apiKey: string; timeoutMs?: number }) => {
    return testApiEndpoint(opts.baseUrl, opts.apiKey, opts.timeoutMs || 10000)
  })

  /** connection:health-check 综合健康检查 */
  ipcMain.handle('connection:health-check', async (_event, opts: { modelId: string; modelName: string; provider: string; apiKey: string; baseUrl: string; model: string }) => {
    return runHealthCheck({
      id: opts.modelId, name: opts.modelName, provider: opts.provider,
      apiKey: opts.apiKey, baseUrl: opts.baseUrl, model: opts.model,
    }, claudeProcess?.sessionId)
  })

  /** connection:env-config 环境变量信息 */
  ipcMain.handle('connection:env-config', async () => getEnvConfig())

  // ── 审批日志 ─────────────────────────────────────────
  const APPROVAL_LOG_FILE = path.join(os.homedir(), '.claude', 'claude-space-approvals.jsonl')

  ipcMain.handle('approval:log', async (_event, entry: any) => {
    try {
      const dir = path.dirname(APPROVAL_LOG_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.appendFileSync(APPROVAL_LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8')
      return { success: true }
    } catch (_e) { return { success: false } }
  })

  ipcMain.handle('approval:history', async () => {
    try {
      if (!fs.existsSync(APPROVAL_LOG_FILE)) return []
      const content = fs.readFileSync(APPROVAL_LOG_FILE, 'utf-8')
      return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).reverse().slice(0, 200)
    } catch (_e) { return [] }
  })

  // ── Git 操作 ─────────────────────────────────────────
  function execGit(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd, shell: true, windowsHide: true, timeout: 30000 })
      let stdout = '', stderr = ''
      child.stdout.on('data', (d: Buffer) => stdout += d.toString())
      child.stderr.on('data', (d: Buffer) => stderr += d.toString())
      child.on('close', (code) => {
        if (code === 0) resolve(stdout.trim())
        else reject(new Error(stderr.trim() || `git exit code ${code}`))
      })
      child.on('error', (e) => reject(e))
    })
  }

  ipcMain.handle('git:init', async (_event, projectPath: string) => {
    try { return { success: true, output: await execGit(projectPath, ['init']) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:status', async (_event, projectPath: string) => {
    try { return { success: true, output: await execGit(projectPath, ['status', '--porcelain']) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:log', async (_event, projectPath: string) => {
    try { return { success: true, output: await execGit(projectPath, ['log', '--oneline', '-30']) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:branch', async (_event, projectPath: string) => {
    try {
      const branches = await execGit(projectPath, ['branch', '-a'])
      const current = await execGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')
      return { success: true, output: branches, current }
    } catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:pull', async (_event, projectPath: string) => {
    try { return { success: true, output: await execGit(projectPath, ['pull']) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:push', async (_event, projectPath: string) => {
    try { return { success: true, output: await execGit(projectPath, ['push']) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:commit', async (_event, opts: { projectPath: string; message: string }) => {
    try {
      await execGit(opts.projectPath, ['add', '-A'])
      const data = await execGit(opts.projectPath, ['commit', '-m', opts.message])
      return { success: true, output: data }
    } catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:add', async (_event, opts: { projectPath: string; files: string[] }) => {
    try { return { success: true, output: await execGit(opts.projectPath, ['add', ...opts.files]) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:config', async (_event, projectPath: string) => {
    try {
      const raw = await execGit(projectPath, ['config', '--list'])
      const config: Record<string, string> = {}
      for (const line of raw.split('\n')) {
        const eq = line.indexOf('=')
        if (eq > 0) config[line.slice(0, eq)] = line.slice(eq + 1)
      }
      return { success: true, config }
    } catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:config-set', async (_event, opts: { projectPath: string; key: string; value: string }) => {
    try { return { success: true, output: await execGit(opts.projectPath, ['config', opts.key, opts.value]) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:remote', async (_event, projectPath: string) => {
    try { return { success: true, output: await execGit(projectPath, ['remote', '-v']) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:remote-set', async (_event, opts: { projectPath: string; name: string; url: string }) => {
    try { return { success: true, output: await execGit(opts.projectPath, ['remote', 'add', opts.name, opts.url]) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:fetch', async (_event, projectPath: string) => {
    try { return { success: true, output: await execGit(projectPath, ['fetch', '--all']) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:log-detail', async (_event, projectPath: string) => {
    try {
      const log = await execGit(projectPath, ['log', '--oneline', '--graph', '-30', '--all'])
      return { success: true, output: log }
    } catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:show-commit', async (_event, opts: { projectPath: string; hash: string }) => {
    try {
      const data = await execGit(opts.projectPath, ['show', '--stat', '--format=fuller', opts.hash])
      return { success: true, output: data }
    } catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:diff', async (_event, opts: { projectPath: string; file?: string }) => {
    try {
      const args = ['diff', '--no-color']
      if (opts.file) args.push('--', opts.file)
      return { success: true, output: await execGit(opts.projectPath, args) }
    } catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:show', async (_event, opts: { projectPath: string; file: string }) => {
    try { return { success: true, output: await execGit(opts.projectPath, ['show', 'HEAD:' + opts.file]) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:diff-staged', async (_event, projectPath: string) => {
    try { return { success: true, output: await execGit(projectPath, ['diff', '--cached', '--no-color']) } }
    catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:remote-info', async (_event, projectPath: string) => {
    try {
      const output = await execGit(projectPath, ['remote', 'show', 'origin']).catch(() => '无远程仓库')
      let branches = ''
      try { branches = await execGit(projectPath, ['branch', '-r']) } catch {}
      return { success: true, output, branches }
    } catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('git:remote-log', async (_event, opts: { projectPath: string; remoteBranch?: string }) => {
    try {
      const ref = opts.remoteBranch || 'origin/main'
      const data = await execGit(opts.projectPath, ['log', '--oneline', '-20', ref]).catch(() => '无法获取远程日志')
      return { success: true, output: data }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  // ── 终端管理 ─────────────────────────────────────────
  /** terminal:start 启动终端 */
  ipcMain.handle('terminal:start', async (event, opts: { cwd?: string; sessionId?: string; cols?: number; rows?: number; autoApproval?: boolean }) => {
    try {
      const sessionId = opts.sessionId || 'default'

      // 注册调用窗口——确保终端事件能广播到正确的渲染进程
      const senderWin = BrowserWindow.fromWebContents(event.sender)
      if (senderWin) registerTerminalWindow(sessionId, senderWin.id)

      let tp = terminalProcesses.get(sessionId)
      // 如果终端的 cwd 变了，先 kill 再重建
      if (tp && opts.cwd && (tp as any).cwd !== opts.cwd) {
        tp.kill()
        terminalProcesses.delete(sessionId)
        tp = null
      }
      if (!tp) {
        tp = new TerminalProcess({
          cwd: opts.cwd,
          sessionId: opts.sessionId,
          cols: opts.cols || 120,
          rows: opts.rows || 40,
          permissionMode: opts.autoApproval ? 'auto' : 'manual',
        })
        terminalProcesses.set(sessionId, tp)
        // Forward events
        tp.on('terminal-data', (data: string) => {
          broadcastTerminalEvent(sessionId, 'terminal:data', data)
        })
        tp.on('status', (status: any) => {
          broadcastTerminalEvent(sessionId, 'terminal:status', status)
        })
        if (sessionId === 'default' || sessionId === (claudeProcess?.sessionId || '')) {
          terminalProcess = tp
        }
      }
      if (!tp.isRunning) tp.start()
      return { success: true, sessionId }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  /** terminal:restart 重启终端 Claude */
  ipcMain.handle('terminal:restart', async (_event, sessionId?: string) => {
    const sid = sessionId || 'default'
    const tp = terminalProcesses.get(sid)
    if (tp) {
      tp.kill()
      // 延迟启动让进程完全退出
      await new Promise(r => setTimeout(r, 500))
      tp.start()
    }
    return { success: !!tp }
  })

  /** terminal:kill 终止终端 */
  ipcMain.handle('terminal:kill', async (_event, sessionId?: string) => {
    const sid = sessionId || 'default'
    const tp = terminalProcesses.get(sid)
    if (tp) {
      tp.kill()
      terminalProcesses.delete(sid)
    }
    if (sessionId === undefined || sessionId === 'default') {
      terminalProcess = null
    }
    return { success: true }
  })

  /** terminal:status 获取终端状态 */
  ipcMain.handle('terminal:status', async (_event, sessionId?: string) => {
    const sid = sessionId || 'default'
    const tp = terminalProcesses.get(sid)
    if (!tp) return { running: false, claudeRunning: false, sessionId: sid }
    return {
      running: tp.isRunning,
      claudeRunning: tp.isClaudeRunning,
      sessionId: tp.sessionId || sid,
      error: tp.lastError || '',
    }
  })

  /** terminal:set-permission-mode 设置终端权限模式 */
  ipcMain.handle('terminal:set-permission-mode', async (_event, mode: 'auto' | 'manual') => {
    // 应用到所有终端
    for (const [, tp] of terminalProcesses) {
      (tp as any).options = { ...(tp as any).options, permissionMode: mode }
    }
    return { success: true }
  })

  // terminal:input / terminal:resize — 使用 ipcMain.on（fire-and-forget）
  ipcMain.on('terminal:input', (_event, data: string) => {
    const tp = terminalProcess || terminalProcesses.get('default')
    if (tp && tp.isRunning && typeof (tp as any).write === 'function') {
      (tp as any).write(data)
    }
  })

  ipcMain.on('terminal:resize', (_event, opts: { cols: number; rows: number }) => {
    const tp = terminalProcess || terminalProcesses.get('default')
    if (tp && typeof (tp as any).resize === 'function') {
      (tp as any).resize(opts.cols, opts.rows)
    }
  })

  // ── SSH 操作 ─────────────────────────────────────────

  ipcMain.handle('ssh:connect', async (_event, serverId: string) => {
    const settings = loadSettings()
    const config = settings?.sshServers?.find(s => s.id === serverId)
    if (!config) return { success: false, error: 'SSH 服务器配置未找到' }
    return sshService.connect(config)
  })

  ipcMain.handle('ssh:disconnect', async (_event, serverId: string) => {
    sshService.disconnect(serverId)
    return { success: true }
  })

  ipcMain.handle('ssh:status', async () => sshService.getStatus())

  ipcMain.handle('ssh:test-connection', async (_event, config: any) => {
    try {
      const result = await sshService.connect(config)
      if (result.success) sshService.disconnect(config.id)
      return result
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh:list-remote-files', async (_event, opts: { serverId: string; remotePath: string; maxDepth?: number }) => {
    return sshService.listRemoteFiles(opts.serverId, opts.remotePath, opts.maxDepth || 1)
  })

  ipcMain.handle('ssh:read-remote-file', async (_event, opts: { serverId: string; remotePath: string }) => {
    return sshService.readRemoteFile(opts.serverId, opts.remotePath)
  })

  ipcMain.handle('ssh:write-remote-file', async (_event, opts: { serverId: string; remotePath: string; content: string }) => {
    return sshService.writeRemoteFile(opts.serverId, opts.remotePath, opts.content)
  })

  ipcMain.handle('ssh:start-terminal', async (_event, opts: { serverId: string; cols?: number; rows?: number }) => {
    try {
      const existing = sshTerminals.get(opts.serverId)
      if (existing) {
        existing.kill()
        sshTerminals.delete(opts.serverId)
      }
      const term = new SshTerminalProcess(opts.serverId, sshService)
      sshTerminals.set(opts.serverId, term)
      activeSshTerminal = term
      term.on('data', (data: string) => {
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
        win?.webContents.send('ssh:terminal-data', data)
      })
      term.on('status', (status: any) => {
        for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send('ssh:terminal-status', status) } catch {} }
      })
      term.start(opts.cols || 120, opts.rows || 40)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  /** ssh:terminal-kill 终止远程终端 */
  ipcMain.handle('ssh:terminal-kill', async () => {
    for (const [, term] of sshTerminals) term.kill()
    sshTerminals.clear()
    activeSshTerminal = null
    return { success: true }
  })

  /** ssh:exec-command 在远程执行命令 */
  ipcMain.handle('ssh:exec-command', async (_event, opts: { serverId: string; command: string; timeoutMs?: number }) => {
    return sshService.execCommand(opts.serverId, opts.command, opts.timeoutMs)
  })

  /** ssh:deploy 部署项目 */
  ipcMain.handle('ssh:deploy', async (_event, opts: { projectPath: string; deployTargetId: string }) => {
    const settings = loadSettings()
    const target = settings?.deployTargets?.find(d => d.id === opts.deployTargetId)
    if (!target) return { success: false, error: '部署目标未找到' }
    return sshService.deploy(opts.projectPath, target, (msg) => {
      for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send('ssh:deploy-status', msg) } catch {} }
    })
  })

  // ── 记忆管理（项目隔离）────────────────────────────────
  function getMemoryDir(projectPath: string): string {
    const encoded = encodeClaudePath(projectPath.replace(/\\/g, '/'))
    return path.join(CLAUDE_HOME, 'projects', encoded, 'memory')
  }

  ipcMain.handle('memory:list', async (_event, projectPath: string) => {
    try {
      const dir = getMemoryDir(projectPath)
      if (!fs.existsSync(dir)) return { success: true, entries: [] }
      const entries = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
        const stat = fs.statSync(path.join(dir, f))
        const entry: any = { fileName: f, name: f.replace(/\.md$/, ''), description: '', mtime: stat.mtime.toISOString() }
        // 解析 frontmatter 获取 name/description/type
        try {
          const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
          const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
          if (fmMatch) {
            for (const line of fmMatch[1].split('\n')) {
              const m = line.match(/^(\w+):\s*(.+)/)
              if (m) { entry[m[1]] = m[2].trim() }
            }
          }
        } catch {}
        return entry
      })
      return { success: true, entries }
    } catch (err: any) { return { success: false, error: err.message, entries: [] } }
  })

  ipcMain.handle('memory:read', async (_event, opts: { projectPath: string; fileName: string }) => {
    try {
      const filePath = path.join(getMemoryDir(opts.projectPath), opts.fileName)
      if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' }
      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, content }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('memory:write', async (_event, opts: { projectPath: string; fileName: string; content: string }) => {
    try {
      const dir = getMemoryDir(opts.projectPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, opts.fileName), opts.content, 'utf-8')
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('memory:create', async (_event, opts: { projectPath: string; fileName: string; name: string; description: string; type: string; content: string }) => {
    try {
      const dir = getMemoryDir(opts.projectPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const frontmatter = [
        '---',
        `name: ${opts.name}`,
        `description: ${opts.description}`,
        `type: ${opts.type}`,
        '---',
        '',
      ].join('\n')
      fs.writeFileSync(path.join(dir, opts.fileName), frontmatter + opts.content, 'utf-8')
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('memory:delete', async (_event, opts: { projectPath: string; fileName: string }) => {
    try {
      const filePath = path.join(getMemoryDir(opts.projectPath), opts.fileName)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('memory:auto-create', async (_event, opts: { projectPath: string; title: string; content: string; type?: string }) => {
    try {
      const dir = getMemoryDir(opts.projectPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const slug = title.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'memory'
      const fileName = slug + '.md'
      if (fs.existsSync(path.join(dir, fileName))) return { success: true, fileName } // 不覆盖
      const frontmatter = [
        '---',
        `name: ${slug}`,
        `description: ${title.slice(0, 80)}`,
        `type: ${opts.type || 'auto'}`,
        '---',
        '',
      ].join('\n')
      fs.writeFileSync(path.join(dir, fileName), frontmatter + opts.content, 'utf-8')
      return { success: true, fileName }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  // ── 知识管理 ─────────────────────────────────────────
  function getKnowledgeDir(projectPath: string): string {
    const encoded = encodeClaudePath(projectPath.replace(/\\/g, '/'))
    return path.join(CLAUDE_HOME, 'projects', encoded, 'knowledge')
  }

  ipcMain.handle('knowledge:list', async (_event, projectPath: string) => {
    try {
      const dir = getKnowledgeDir(projectPath)
      if (!fs.existsSync(dir)) return { success: true, entries: [] }
      const entries = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
        const stat = fs.statSync(path.join(dir, f))
        const entry: any = { fileName: f, name: f.replace(/\.md$/, ''), description: '', type: '', tags: '', status: 'active', mtime: stat.mtime.toISOString(), sources: '' }
        // 解析 frontmatter
        try {
          const raw = fs.readFileSync(path.join(dir, f), 'utf-8')
          const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/)
          if (fmMatch) {
            for (const line of fmMatch[1].split('\n')) {
              const m = line.match(/^(\w+):\s*(.+)/)
              if (m) { entry[m[1]] = m[2].trim() }
            }
          }
        } catch {}
        return entry
      })
      return { success: true, entries }
    } catch (err: any) { return { success: false, error: err.message, entries: [] } }
  })

  ipcMain.handle('knowledge:read', async (_event, opts: { projectPath: string; fileName: string }) => {
    try {
      const filePath = path.join(getKnowledgeDir(opts.projectPath), opts.fileName)
      if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' }
      return { success: true, content: fs.readFileSync(filePath, 'utf-8') }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('knowledge:create', async (_event, opts: { projectPath: string; title: string; content: string; type: string; tags: string; sources?: string }) => {
    try {
      const dir = getKnowledgeDir(opts.projectPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const slug = title.toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'knowledge'
      const fileName = slug + '.md'
      const frontmatter = [
        '---',
        `title: ${title}`,
        `type: ${opts.type}`,
        `tags: ${opts.tags}`,
        opts.sources ? `sources: ${opts.sources}` : '',
        '---',
        '',
      ].join('\n')
      fs.writeFileSync(path.join(dir, fileName), frontmatter + opts.content, 'utf-8')
      return { success: true, fileName }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('knowledge:delete', async (_event, opts: { projectPath: string; fileName: string }) => {
    try {
      const filePath = path.join(getKnowledgeDir(opts.projectPath), opts.fileName)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  // ── 技能管理 ─────────────────────────────────────────
  const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')
  const SKILLS_META_FILE = path.join(os.homedir(), '.claude', 'claude-space-skills.json')

  function getInstalledSkills(): any[] {
    try {
      if (fs.existsSync(SKILLS_META_FILE)) {
        return JSON.parse(fs.readFileSync(SKILLS_META_FILE, 'utf-8'))
      }
      // fallback: scan skills directory
      if (fs.existsSync(SKILLS_DIR)) {
        return fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md')).map(f => ({
          name: f.replace(/\.md$/, ''), installedAt: fs.statSync(path.join(SKILLS_DIR, f)).mtime.toISOString(),
        }))
      }
    } catch (_e) { /* silent */ }
    return []
  }

  function saveInstalledSkills(skills: any[]): void {
    try {
      const dir = path.dirname(SKILLS_META_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = SKILLS_META_FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(skills, null, 2), 'utf-8')
      fs.renameSync(tmp, SKILLS_META_FILE)
    } catch { /* silent */ }
  }

  ipcMain.handle('skill:list', async () => ({ success: true, skills: getInstalledSkills() }))

  ipcMain.handle('skill:read', async (_event, name: string) => {
    try {
      const filePath = path.join(SKILLS_DIR, name + '.md')
      if (!fs.existsSync(filePath)) return { success: false, error: '技能未找到' }
      return { success: true, content: fs.readFileSync(filePath, 'utf-8') }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('skill:install', async (_event, opts: { name: string; content: string }) => {
    try {
      if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true })
      fs.writeFileSync(path.join(SKILLS_DIR, opts.name + '.md'), opts.content, 'utf-8')
      const skills = getInstalledSkills()
      skills.push({ name: opts.name, installedAt: new Date().toISOString() })
      saveInstalledSkills(skills)
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('skill:install-batch', async (_event, opts: { skills: Array<{ name: string; content: string }> }) => {
    try {
      if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true })
      const installed = []
      for (const s of opts.skills) {
        fs.writeFileSync(path.join(SKILLS_DIR, s.name + '.md'), s.content, 'utf-8')
        installed.push({ name: s.name, installedAt: new Date().toISOString() })
      }
      const skills = getInstalledSkills()
      skills.push(...installed)
      saveInstalledSkills(skills)
      return { success: true, count: installed.length }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('skill:uninstall', async (_event, name: string) => {
    try {
      const filePath = path.join(SKILLS_DIR, name + '.md')
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      const skills = getInstalledSkills().filter((s: any) => s.name !== name)
      saveInstalledSkills(skills)
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('skill:marketplace-list', async () => {
    return { success: true, items: [
      { id: 'codes-review', name: 'Code Review', description: 'AI 代码审查', category: 'development', rating: 4.5 },
      { id: 'deep-research', name: 'Deep Research', description: '深度研究分析', category: 'research', rating: 4.8 },
      { id: 'security-review', name: 'Security Review', description: '安全审查', category: 'security', rating: 4.3 },
    ]}
  })

  ipcMain.handle('skill:marketplace-install', async (_event, item: { id: string }) => {
    return { success: false, error: '请从技能源安装' }
  })

  let _marketConfig = { sources: [], autoScan: false }
  ipcMain.handle('skill:get-market-config', async () => _marketConfig)
  ipcMain.handle('skill:save-market-config', async (_event, cfg: any) => {
    _marketConfig = cfg
    return { success: true }
  })
  ipcMain.handle('skill:load-from-local', async () => {
    try {
      if (fs.existsSync(SKILLS_DIR)) {
        const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'))
        return { success: true, skills: files.map(f => ({ name: f.replace(/\.md$/, ''), content: fs.readFileSync(path.join(SKILLS_DIR, f), 'utf-8') })) }
      }
    } catch (_e) { /* silent */ }
    return { success: true, skills: [] }
  })
  ipcMain.handle('skill:load-from-local-dir', async (_event, dir: string) => {
    try {
      if (fs.existsSync(dir)) {
        return { success: true, skills: fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => ({
          name: f.replace(/\.md$/, ''), content: fs.readFileSync(path.join(dir, f), 'utf-8'),
        })) }
      }
    } catch (_e) { /* silent */ }
    return { success: true, skills: [] }
  })
  ipcMain.handle('skill:load-from-git', async (_event, gitUrl: string) => {
    return { success: false, error: 'Git 加载尚未实现' }
  })
  ipcMain.handle('skill:marketplace-scan', async () => ({ success: true, skills: [] }))
  ipcMain.handle('skill:marketplace-source-add', async (_event, src: any) => {
    _marketConfig.sources.push(src)
    return { success: true }
  })
  ipcMain.handle('skill:marketplace-source-remove', async (_event, url: string) => {
    _marketConfig.sources = _marketConfig.sources.filter((s: any) => s.url !== url)
    return { success: true }
  })
  ipcMain.handle('skill:marketplace-source-update', async (_event, url: string, updates: any) => {
    _marketConfig.sources = _marketConfig.sources.map((s: any) => s.url === url ? { ...s, ...updates } : s)
    return { success: true }
  })

  // ── 项目技能 ─────────────────────────────────────────
  const PROJECT_SKILLS_FILE = path.join(os.homedir(), '.claude', 'claude-space-project-skills.json')

  ipcMain.handle('skill:list-project', async () => {
    try {
      if (fs.existsSync(PROJECT_SKILLS_FILE)) {
        return { success: true, skills: JSON.parse(fs.readFileSync(PROJECT_SKILLS_FILE, 'utf-8')) }
      }
    } catch (_e) { /* silent */ }
    return { success: true, skills: [] }
  })
  ipcMain.handle('skill:install-to-project', async (_event, skillName: string) => {
    try {
      const list: string[] = JSON.parse(
        fs.existsSync(PROJECT_SKILLS_FILE) ? fs.readFileSync(PROJECT_SKILLS_FILE, 'utf-8') : '[]'
      )
      if (!list.includes(skillName)) list.push(skillName)
      fs.writeFileSync(PROJECT_SKILLS_FILE, JSON.stringify(list, null, 2), 'utf-8')
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('skill:remove-from-project', async (_event, skillName: string) => {
    try {
      const list: string[] = fs.existsSync(PROJECT_SKILLS_FILE)
        ? JSON.parse(fs.readFileSync(PROJECT_SKILLS_FILE, 'utf-8')) : []
      const next = list.filter((n: string) => n !== skillName)
      fs.writeFileSync(PROJECT_SKILLS_FILE, JSON.stringify(next, null, 2), 'utf-8')
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })
  ipcMain.handle('skill:clear-project', async () => {
    try {
      fs.writeFileSync(PROJECT_SKILLS_FILE, '[]', 'utf-8')
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  // ── 循环/自动化（Loop）─────────────────────────────────
  // 引擎实例已在模块顶部创建：loopScheduler / workflowEngine
  // 存储路径由引擎内部管理
  ipcMain.handle('loop:list', async () => ({ success: true, loops: loopScheduler.loadLoops() }))
  ipcMain.handle('loop:create', async (_event, opts: { name: string; prompt: string; interval: string }) => {
    const loops = loopScheduler.loadLoops()
    const loop: LoopConfig = { id: 'loop_' + Date.now().toString(36), ...opts, createdAt: new Date().toISOString(), enabled: true, lastRun: null }
    loops.push(loop)
    loopScheduler.saveLoops(loops)
    // 自动调度
    loopScheduler.schedule(loop)
    return { success: true, loop }
  })
  ipcMain.handle('loop:delete', async (_event, id: string) => {
    loopScheduler.unschedule(id)
    const loops = loopScheduler.loadLoops().filter((l: any) => l.id !== id)
    loopScheduler.saveLoops(loops)
    return { success: true }
  })
  ipcMain.handle('loop:run-now', async (_event, id: string) => {
    // 异步执行，不阻塞 UI
    loopScheduler.runNow(id).catch(e => console.error('loop:run-now error:', e))
    return { success: true }
  })
  ipcMain.handle('loop:update', async (_event, opts: { id: string; name?: string; prompt?: string; interval?: string; enabled?: boolean }) => {
    const loops = loopScheduler.loadLoops().map((l: any) => l.id === opts.id ? { ...l, ...opts } : l)
    loopScheduler.saveLoops(loops)
    // 根据 enabled 状态管理调度
    const updated = loops.find((l: any) => l.id === opts.id)
    if (updated) {
      if (updated.enabled !== false) {
        loopScheduler.schedule(updated)
      } else {
        loopScheduler.unschedule(opts.id)
      }
    }
    return { success: true }
  })
  ipcMain.handle('loop:pause', async (_event, id: string) => {
    loopScheduler.pause(id)
    const loops = loopScheduler.loadLoops().map((l: any) => l.id === id ? { ...l, enabled: false } : l)
    loopScheduler.saveLoops(loops)
    return { success: true }
  })
  ipcMain.handle('loop:resume', async (_event, id: string) => {
    const loops = loopScheduler.loadLoops()
    const loop = loops.find((l: any) => l.id === id)
    if (loop) {
      loop.enabled = true
      loopScheduler.saveLoops(loops)
      loopScheduler.schedule(loop)
    }
    return { success: true }
  })
  ipcMain.handle('loop:history', async (_event, loopId?: string) => {
    const history = loopScheduler.loadHistory()
    const filtered = loopId ? history.filter((r: any) => r.loopId === loopId) : history
    return { success: true, runs: filtered }
  })

  // ── 工作流（Workflow）─────────────────────────────────
  ipcMain.handle('workflow:list-runs', async () => {
    return { success: true, runs: workflowEngine.loadRuns() }
  })
  ipcMain.handle('workflow:run', async (_event, opts: { templateId: string; name: string; phases: Array<{ name: string; type: string; prompt: string; model: string }> }) => {
    try {
      const run = await workflowEngine.execute({
        templateId: opts.templateId,
        name: opts.name,
        phases: opts.phases,
      })
      return { success: true, run }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── 控制台 ───────────────────────────────────────────
  ipcMain.handle('console:open-window', async () => {
    const win = new BrowserWindow({
      width: 900, height: 600, title: 'Claude Space — 控制台', frame: false, titleBarStyle: 'hidden',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') },
      show: false, backgroundColor: '#0d0d0d',
    })
    win.on('ready-to-show', () => win.show())
    win.on('closed', () => {
      const idx = windows.indexOf(win)
      if (idx >= 0) windows.splice(idx, 1)
    })
    windows.push(win)
    const url = isDev ? (process.env.VITE_DEV_SERVER_URL || 'http://localhost:55173') : `file://${path.join(__dirname, '../dist/index.html')}`
    win.loadURL(url + '?consoleWindow=1')
    return { success: true }
  })

  ipcMain.handle('console:get-log-history', async () => {
    return { success: true, lines: [...logBuffer] }
  })

  // ── 开发服务器（Dev） ─────────────────────────────────
  let _devProcess: any = null

  ipcMain.handle('dev:start', async (_event, opts: { command: string; name: string }) => {
    try {
      if (_devProcess) { _devProcess.kill(); _devProcess = null }
      _devProcess = spawn('cmd.exe', ['/c', opts.command], {
        shell: true, windowsHide: true, cwd: getActiveWorkspaceRoot(),
      })
      _devProcess.stdout?.on('data', (d: Buffer) => {
        for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send('dev:output', d.toString()) } catch {} }
      })
      _devProcess.stderr?.on('data', (d: Buffer) => {
        for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send('dev:error', d.toString()) } catch {} }
      })
      _devProcess.on('close', () => {
        _devProcess = null
        for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send('dev:status', { running: false, name: opts.name }) } catch {} }
      })
      for (const w of windows) { try { if (!w.isDestroyed()) w.webContents.send('dev:status', { running: true, name: opts.name }) } catch {} }
      return { success: true }
    } catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('dev:stop', async () => {
    if (_devProcess) { _devProcess.kill(); _devProcess = null }
    return { success: true }
  })
}

/** 初始化 claude settings.json 文件监视（模块级，供 app.whenReady 调用） */
let _claudeSettingsWatcher: fs.FSWatcher | null = null
function initClaudeEnvWatch() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    if (!fs.existsSync(settingsPath)) { console.log('[claude-env] settings.json 不存在，跳过文件监视'); return }
    _claudeSettingsWatcher = fs.watch(settingsPath, (eventType) => {
      if (eventType === 'change') {
        setTimeout(() => {
          const config = getClaudeEnvConfig()
          for (const w of windows) {
            try { if (!w.isDestroyed()) w.webContents.send('claude-env:changed', { ...config, mtime: fs.statSync(settingsPath).mtime.toISOString() }) } catch {}
          }
        }, 500)
      }
    })
  } catch (err) {
    console.warn('[claude-env] 文件监视启动失败:', err)
  }
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
  // 恢复所有已启用的 loop 调度
  setTimeout(() => {
    try { loopScheduler.resumeAll() } catch (e) { console.warn('loopScheduler.resumeAll failed:', e) }
    try { initClaudeEnvWatch() } catch (e) { console.warn('initClaudeEnvWatch failed:', e) }
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
  loopScheduler.stopAll()
  for (const [, term] of sshTerminals) term.kill()
  sshTerminals.clear()
  activeSshTerminal = null
  sshService.disconnectAll()
  for (const w of [...windows]) {
    try { if (!w.isDestroyed()) w.destroy() } catch (_e) { /* silent */ }
  }
  windows.length = 0
})