/**
 * Preload script — 通过 contextBridge 暴露安全 API 给渲染进程。
 */
import { contextBridge, ipcRenderer } from 'electron'

const listenerMap = new Map<string, Map<(...args: any[]) => void, (...args: any[]) => void>>()

const electronAPI = {
  // ── Claude 会话 ────────────────────────────────────

  /** Claude 状态 */
  claudeStatus: () => ipcRenderer.invoke('claude:status'),

  /** 发送消息到 Claude (自动启动进程) */
  claudeSend: (opts: { content: string; projectPath?: string; sessionId?: string; modelId?: string; autoApproval?: boolean }) =>
    ipcRenderer.invoke('claude:send', opts),

  /** 停止 Claude 进程 */
  stopClaude: () => ipcRenderer.invoke('claude:stop'),

  /** 发送原始数据到 Claude stdin（权限响应） */
  claudeWriteStdin: (data: string) => ipcRenderer.invoke('claude:write-stdin', data),

  /** 监听 Claude 事件 */
  onClaudeEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('claude:event', handler)
    return () => ipcRenderer.removeListener('claude:event', handler)
  },

  /** 监听 Claude 权限提示 */
  onClaudePermissionPrompt: (callback: (prompt: { text: string; timestamp: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('claude:permission-prompt', handler)
    return () => ipcRenderer.removeListener('claude:permission-prompt', handler)
  },

  onClaudeStderr: (callback: (text: string) => void) => {
    const handler = (_event: any, data: string) => callback(data)
    ipcRenderer.on('claude:stderr', handler)
    return () => ipcRenderer.removeListener('claude:stderr', handler)
  },

  onClaudeClose: (callback: (code: number | null) => void) => {
    const handler = (_event: any, code: number | null) => callback(code)
    ipcRenderer.on('claude:close', handler)
    return () => ipcRenderer.removeListener('claude:close', handler)
  },

  onClaudeStatusUpdate: (callback: (status: { running: boolean; connected: boolean; error: string; sessionId?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('claude:status-update', handler)
    return () => ipcRenderer.removeListener('claude:status-update', handler)
  },

  // ── 多智能体群聊 ──────────────────────────────────────

  agentSendGroup: (opts: {
    groupId: string; content: string
    targets: Array<{ agentId: string; agentType: string; agentName: string; agentIcon?: string; agentColor?: string }>
    personaContents: Array<{ agentId: string; prompt: string }>
    projectPath?: string; modelId?: string; autoApproval?: boolean
  }) => ipcRenderer.invoke('agent:send-group', opts),

  agentStop: (agentId: string) => ipcRenderer.invoke('agent:stop', agentId),
  agentStopAll: () => ipcRenderer.invoke('agent:stop-all'),
  agentStatus: () => ipcRenderer.invoke('agent:status'),

  onAgentEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  },
  onAgentClose: (callback: (data: { agentId: string; code: number | null }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('agent:close', handler)
    return () => ipcRenderer.removeListener('agent:close', handler)
  },
  onAgentStatusUpdate: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('agent:status-update', handler)
    return () => ipcRenderer.removeListener('agent:status-update', handler)
  },
  onAgentStderr: (callback: (data: { agentId: string; agentName: string; text: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('agent:stderr', handler)
    return () => ipcRenderer.removeListener('agent:stderr', handler)
  },

  // ── 多会话管理 ──────────────────────────────────────

  sessionStop: (sessionId: string) => ipcRenderer.invoke('session:stop', sessionId),
  sessionStopAll: () => ipcRenderer.invoke('session:stop-all'),
  sessionListActive: () => ipcRenderer.invoke('session:list-active'),
  loadSessionNames: () => ipcRenderer.invoke('session-names:load'),
  saveSessionNames: (names: Record<string, string>) => ipcRenderer.invoke('session-names:save', names),

  onSessionEvent: (callback: (event: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('session:event', handler)
    return () => ipcRenderer.removeListener('session:event', handler)
  },
  onSessionClose: (callback: (data: { sessionId: string; code: number | null }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('session:close', handler)
    return () => ipcRenderer.removeListener('session:close', handler)
  },
  onSessionStatus: (callback: (data: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('session:status', handler)
    return () => ipcRenderer.removeListener('session:status', handler)
  },

  // ── 项目管理 ────────────────────────────────────────

  scanProjects: (rootPath?: string) => ipcRenderer.invoke('project:scan', rootPath),

  newProject: (name?: string) => ipcRenderer.invoke('project:new', name),

  openProjectFolder: (projectPath: string) => ipcRenderer.invoke('project:open-folder', projectPath),

  openProjectInNewWindow: (projectPath: string) => ipcRenderer.invoke('project:open-in-new-window', projectPath),

  scanDirectory: (dirPath: string) => ipcRenderer.invoke('project:scan-directory', dirPath),

  openInTerminal: (projectPath: string) => ipcRenderer.invoke('project:open-terminal', projectPath),

  // ── 文件操作 ────────────────────────────────────────

  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),

  writeFile: (opts: { filePath: string; content: string }) => ipcRenderer.invoke('file:write', opts),

  createFile: (opts: { dirPath: string; fileName: string; content?: string }) => ipcRenderer.invoke('file:create', opts),

  openFileInNewWindow: (opts: { filePath: string; fileName: string; projectPath?: string }) =>
    ipcRenderer.invoke('file:open-in-new-window', opts),

  openFileDialog: () => ipcRenderer.invoke('file:open-dialog'),

  // ── 会话管理 ────────────────────────────────────────

  listSessions: (projectPath?: string) => ipcRenderer.invoke('session:list', projectPath),

  getSessionTranscript: (sessionId: string) =>
    ipcRenderer.invoke('session:transcript', sessionId),

  // ── 会话管理 (扩展) ────────────────────────────────

  /** 列出所有 Claude Code 项目（跨所有工作区） */
  listAllSessions: () => ipcRenderer.invoke('session:list-all'),

  /** 获取项目最近的会话内容 */
  getRecentSession: (projectPath: string) => ipcRenderer.invoke('session:recent', projectPath),

  /** 从会话 JSONL 历史中提取任务事件 */
  extractTasksFromSessions: (projectPath: string) => ipcRenderer.invoke('session:extract-tasks', projectPath),

  // ── 团队管理 ────────────────────────────────────────
  loadTeam: () => ipcRenderer.invoke('team:load'),
  saveTeam: (team: any[]) => ipcRenderer.invoke('team:save', team),

  // ── 设置管理 ────────────────────────────────────────
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),

  // ── 任务管理 ────────────────────────────────────────

  loadTasks: () => ipcRenderer.invoke('task:load'),

  saveTasks: (tasks: any[]) => ipcRenderer.invoke('task:save', tasks),

  // ── 连接管理 ────────────────────────────────────────

  connectionCheckCli: () => ipcRenderer.invoke('connection:check-cli'),
  connectionTestApi: (opts: { baseUrl: string; apiKey: string; timeoutMs?: number }) =>
    ipcRenderer.invoke('connection:test-api', opts),
  connectionHealthCheck: (opts: { modelId: string; modelName: string; provider: string; apiKey: string; baseUrl: string; model: string }) =>
    ipcRenderer.invoke('connection:health-check', opts),
  connectionGetEnvConfig: () => ipcRenderer.invoke('connection:env-config'),

  // 审批日志
  approvalLog: (entry: any) => ipcRenderer.invoke('approval:log', entry),
  approvalHistory: () => ipcRenderer.invoke('approval:history'),

  // ── Git 操作 ────────────────────────────────────────
  gitInit: (projectPath: string) => ipcRenderer.invoke('git:init', projectPath),
  gitStatus: (projectPath: string) => ipcRenderer.invoke('git:status', projectPath),
  gitLog: (projectPath: string) => ipcRenderer.invoke('git:log', projectPath),
  gitBranch: (projectPath: string) => ipcRenderer.invoke('git:branch', projectPath),
  gitPull: (projectPath: string) => ipcRenderer.invoke('git:pull', projectPath),
  gitPush: (projectPath: string) => ipcRenderer.invoke('git:push', projectPath),
  gitCommit: (opts: { projectPath: string; message: string }) => ipcRenderer.invoke('git:commit', opts),
  gitAdd: (opts: { projectPath: string; files: string[] }) => ipcRenderer.invoke('git:add', opts),
  gitConfig: (projectPath: string) => ipcRenderer.invoke('git:config', projectPath),
  gitConfigSet: (opts: { projectPath: string; key: string; value: string }) => ipcRenderer.invoke('git:config-set', opts),
  gitRemote: (projectPath: string) => ipcRenderer.invoke('git:remote', projectPath),
  gitRemoteSet: (opts: { projectPath: string; name: string; url: string }) => ipcRenderer.invoke('git:remote-set', opts),
  gitDiff: (opts: { projectPath: string; file?: string }) => ipcRenderer.invoke('git:diff', opts),
  gitShow: (opts: { projectPath: string; file: string }) => ipcRenderer.invoke('git:show', opts),
  gitDiffStaged: (projectPath: string) => ipcRenderer.invoke('git:diff-staged', projectPath),

  // ── 终端管理 ────────────────────────────────────────

  terminalStart: (opts: { cwd?: string; sessionId?: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke('terminal:start', opts),
  terminalRestart: () => ipcRenderer.invoke('terminal:restart'),
  terminalInput: (data: string) => ipcRenderer.send('terminal:input', data),
  terminalResize: (opts: { cols: number; rows: number }) =>
    ipcRenderer.send('terminal:resize', opts),
  terminalKill: () => ipcRenderer.invoke('terminal:kill'),
  terminalStatus: () => ipcRenderer.invoke('terminal:status'),
  onTerminalData: (callback: (data: string) => void) => {
    const handler = (_event: any, data: string) => callback(data)
    ipcRenderer.on('terminal:data', handler)
    return () => ipcRenderer.removeListener('terminal:data', handler)
  },
  onTerminalStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('terminal:status', handler)
    return () => ipcRenderer.removeListener('terminal:status', handler)
  },

  // ── SSH 远程 ──────────────────────────────────────────

  sshConnect: (serverId: string) => ipcRenderer.invoke('ssh:connect', serverId),
  sshDisconnect: (serverId: string) => ipcRenderer.invoke('ssh:disconnect', serverId),
  sshStatus: () => ipcRenderer.invoke('ssh:status'),
  sshTestConnection: (config: any) => ipcRenderer.invoke('ssh:test-connection', config),
  sshListRemoteFiles: (opts: { serverId: string; remotePath: string; maxDepth?: number }) =>
    ipcRenderer.invoke('ssh:list-remote-files', opts),
  sshReadRemoteFile: (opts: { serverId: string; remotePath: string }) =>
    ipcRenderer.invoke('ssh:read-remote-file', opts),
  sshWriteRemoteFile: (opts: { serverId: string; remotePath: string; content: string }) =>
    ipcRenderer.invoke('ssh:write-remote-file', opts),
  sshStartTerminal: (opts: { serverId: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke('ssh:start-terminal', opts),
  sshTerminalInput: (data: string) => ipcRenderer.send('ssh:terminal-input', data),
  sshTerminalResize: (opts: { cols: number; rows: number }) =>
    ipcRenderer.send('ssh:terminal-resize', opts),
  sshTerminalKill: () => ipcRenderer.invoke('ssh:terminal-kill'),
  onSshTerminalData: (callback: (data: string) => void) => {
    const handler = (_event: any, data: string) => callback(data)
    ipcRenderer.on('ssh:terminal-data', handler)
    return () => ipcRenderer.removeListener('ssh:terminal-data', handler)
  },
  onSshTerminalStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('ssh:terminal-status', handler)
    return () => ipcRenderer.removeListener('ssh:terminal-status', handler)
  },
  onSshDeployStatus: (callback: (status: any) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('ssh:deploy-status', handler)
    return () => ipcRenderer.removeListener('ssh:deploy-status', handler)
  },
  sshDeploy: (opts: { projectPath: string; deployTargetId: string }) =>
    ipcRenderer.invoke('ssh:deploy', opts),
  sshExecCommand: (opts: { serverId: string; command: string; timeoutMs?: number }) =>
    ipcRenderer.invoke('ssh:exec-command', opts),

  // ── 窗口控制 ────────────────────────────────────────

  minimizeWindow: () => ipcRenderer.invoke('win:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('win:maximize'),
  closeWindow: () => ipcRenderer.invoke('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),

  // ── 通用 IPC ────────────────────────────────────────

  on: (channel: string, callback: (...args: any[]) => void) => {
    if (!listenerMap.has(channel)) {
      listenerMap.set(channel, new Map())
    }
    const wrapper = (_event: any, ...args: any[]) => callback(...args)
    listenerMap.get(channel)!.set(callback, wrapper)
    ipcRenderer.on(channel, wrapper)
  },

  off: (channel: string, callback: (...args: any[]) => void) => {
    const map = listenerMap.get(channel)
    if (map?.has(callback)) {
      const wrapper = map.get(callback)!
      ipcRenderer.removeListener(channel, wrapper)
      map.delete(callback)
    }
  },

  platform: process.platform,
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
