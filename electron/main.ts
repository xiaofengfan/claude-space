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
    let apiKey: string | undefined = process.env.ANTHROPIC_API_KEY
    let baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL
    let model: string | undefined = process.env.ANTHROPIC_MODEL
    if (opts.modelId) {
      const raw = loadSettings()
      const cfg = raw?.models.find(m => m.id === opts.modelId)
      if (cfg) { apiKey = cfg.apiKey || apiKey; baseUrl = cfg.baseUrl || baseUrl; model = cfg.model || model }
    }

    const sid = opts.sessionId || 'default'
    const proc = getOrCreateSessionProcess(sid, {
      projectPath: opts.projectPath, model, apiKey, baseUrl,
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

    // Resolve model config
    let apiKey: string | undefined = process.env.ANTHROPIC_API_KEY
    let baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL
    let model: string | undefined = process.env.ANTHROPIC_MODEL

    if (opts.modelId) {
      const raw = loadSettings()
      const cfg = raw?.models.find(m => m.id === opts.modelId)
      if (cfg) {
        apiKey = cfg.apiKey || apiKey
        baseUrl = cfg.baseUrl || baseUrl
        model = cfg.model || model
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
      fs.writeFileSync(filePath, opts.content || '', 'utf-8')
      return { success: true, filePath }
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
      // 首次使用：从环境变量生成默认配置
      const envModel: ModelConfigSafe = {
        id: 'env-default',
        name: process.env.ANTHROPIC_MODEL || '默认模型',
        provider: 'Claude',
        apiKeyHint: process.env.ANTHROPIC_API_KEY ? '来自环境变量' : '未设置',
        baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        apiKeySource: 'env',
      }
      const defaultSettings: AppSettingsSafe = {
        version: 1,
        activeModelId: 'env-default',
        models: [envModel],
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
        activeModelId: 'env-default',
        models: [{
          id: 'env-default', name: envModel.name, provider: 'Claude',
          apiKey: process.env.ANTHROPIC_API_KEY || '',
          baseUrl: envModel.baseUrl, model: envModel.model,
          apiKeySource: 'env',
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
    // 返回脱敏版本
    return {
      version: raw.version || 1,
      activeModelId: raw.activeModelId,
      models: raw.models.map(m => ({
        id: m.id, name: m.name, provider: m.provider,
        apiKeyHint: m.apiKeySource === 'env' ? '来自环境变量' : maskApiKey(m.apiKey),
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
      apiKeyHint: m.apiKeySource === 'env' ? '来自环境变量' : maskApiKey(m.apiKey),
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

  // ── 记忆文件读取（版本详情右侧面板）─────────────────
  const MEMORY_DIR = path.join(os.homedir(), '.claude', 'projects', 'E--claudespace', 'memory')

  ipcMain.handle('memory:list', async () => {
    try {
      const indexPath = path.join(MEMORY_DIR, 'MEMORY.md')
      if (!fs.existsSync(indexPath)) return { success: true, entries: [] }
      const indexContent = fs.readFileSync(indexPath, 'utf-8')
      const entries: { name: string; description: string; fileName: string; type?: string }[] = []
      const linkRegex = /-\s*\[(.+?)\]\((.+?)\)\s*—\s*(.+)/
      for (const line of indexContent.split('\n')) {
        const m = line.match(linkRegex)
        if (m) {
          const fileName = m[2].trim()
          const description = m[3].trim()
          // 读取 frontmatter 获取 type
          let type = ''
          try {
            const filePath = path.join(MEMORY_DIR, fileName)
            if (fs.existsSync(filePath)) {
              const raw = fs.readFileSync(filePath, 'utf-8')
              const typeMatch = raw.match(/^\s*type:\s*(\S+)/m)
              if (typeMatch) type = typeMatch[1]
            }
          } catch { /* ignore */ }
          entries.push({ name: m[1].trim(), description, fileName, type: type || undefined })
        }
      }
      return { success: true, entries }
    } catch (e: any) {
      return { success: false, entries: [], error: e.message }
    }
  })

  ipcMain.handle('memory:read', async (_e, fileName: string) => {
    try {
      const filePath = path.join(MEMORY_DIR, fileName)
      if (!fs.existsSync(filePath)) return { success: false, content: '', error: '文件不存在' }
      const content = fs.readFileSync(filePath, 'utf-8')
      return { success: true, content }
    } catch (e: any) {
      return { success: false, content: '', error: e.message }
    }
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

    // 读取模型配置
    let apiKey: string | undefined = process.env.ANTHROPIC_API_KEY
    let baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL
    let model: string | undefined = process.env.ANTHROPIC_MODEL

    const raw = loadSettings()
    if (raw?.activeModelId) {
      const cfg = raw.models.find(m => m.id === raw.activeModelId)
      if (cfg) {
        apiKey = cfg.apiKey || apiKey
        baseUrl = cfg.baseUrl || baseUrl
        model = cfg.model || model
      }
    }

    const proc = new TerminalProcess({
      cwd: opts.cwd,
      sessionId: validSessionId,
      claudePath,
      model, apiKey, baseUrl,
      cols: opts.cols || 120,
      rows: opts.rows || 40,
      permissionMode: opts.autoApproval ? 'auto' : 'manual',
    })

    // 事件广播到所有绑定此终端的窗口（支持多窗口共享终端）
    proc.on('terminal-data', (data: string) => {
      broadcastTerminalEvent(sid, 'terminal:data', data)
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
