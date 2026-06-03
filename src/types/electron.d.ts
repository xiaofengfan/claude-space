import type { AppSettingsSafe, ModelConfigSafe } from './settings'
import type { ConnectionHealth, CliDetectionResult, ApiTestResult } from './connection'

export interface ElectronAPI {
  // Claude session
  claudeStatus: () => Promise<{ running: boolean; sessionId?: string; error?: string }>
  claudeSend: (opts: { content: string; projectPath?: string; sessionId?: string; modelId?: string; autoApproval?: boolean }) => Promise<{ success: boolean }>
  stopClaude: () => Promise<{ success: boolean }>
  claudeWriteStdin: (data: string) => Promise<{ success: boolean }>
  onClaudeEvent: (callback: (event: any) => void) => () => void
  onClaudeStderr: (callback: (text: string) => void) => () => void
  onClaudeClose: (callback: (code: number | null) => void) => () => void
  onClaudeStatusUpdate: (callback: (status: { running: boolean; connected: boolean; error: string; sessionId?: string }) => void) => () => void
  onClaudePermissionPrompt: (callback: (prompt: { text: string; timestamp: number }) => void) => () => void

  // ── Multi-session management ──────────────────────────
  sessionStop: (sessionId: string) => Promise<{ success: boolean }>
  sessionStopAll: () => Promise<{ success: boolean }>
  sessionList: () => Promise<Array<{ sessionId: string; projectPath?: string; running: boolean; createdAt: number }>>
  loadSessionNames: () => Promise<Record<string, string>>
  saveSessionNames: (names: Record<string, string>) => Promise<{ success: boolean; error?: string }>
  onSessionEvent: (callback: (event: any) => void) => () => void
  onSessionClose: (callback: (data: { sessionId: string; code: number | null }) => void) => () => void
  onSessionStatus: (callback: (data: any) => void) => () => void

  // ── Multi-agent group chat ────────────────────────────
  agentSendGroup: (opts: {
    groupId: string; content: string
    targets: Array<{ agentId: string; agentType: string; agentName: string; agentIcon?: string; agentColor?: string; modelId?: string }>
    personaContents: Array<{ agentId: string; prompt: string }>
    projectPath?: string; modelId?: string; autoApproval?: boolean
  }) => Promise<{ success: boolean; groupId?: string }>
  agentStop: (agentId: string) => Promise<{ success: boolean }>
  agentStopAll: () => Promise<{ success: boolean }>
  agentStatus: () => Promise<Array<{ agentId: string; agentType: string; agentName: string; status: string; sessionId?: string }>>
  onAgentEvent: (callback: (event: any) => void) => () => void
  onAgentClose: (callback: (data: { agentId: string; code: number | null }) => void) => () => void
  onAgentStatusUpdate: (callback: (data: any) => void) => () => void
  onAgentStderr: (callback: (data: { agentId: string; agentName: string; text: string }) => void) => () => void

  // Project management
  scanProjects: (rootPath?: string) => Promise<any[]>
  newProject: (name?: string) => Promise<{ canceled: boolean; path?: string; name?: string; error?: string }>
  openProjectFolder: (projectPath: string) => Promise<void>
  openProjectInNewWindow: (projectPath: string) => Promise<{ success: boolean }>
  scanDirectory: (dirPath: string) => Promise<any[]>
  scanProjectFiles: (dirPath: string) => Promise<any[]>
  openInTerminal: (projectPath: string) => Promise<void>

  // File operations
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; size?: number; isBinary?: boolean; error?: string }>
  writeFile: (opts: { filePath: string; content: string }) => Promise<{ success: boolean; error?: string }>
  createFile: (opts: { dirPath: string; fileName: string; content?: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  openFileInNewWindow: (opts: { filePath: string; fileName: string; projectPath?: string }) => Promise<{ success: boolean }>
  openFileDialog: () => Promise<{ canceled: boolean; filePath?: string }>

  // Session management
  listSessions: (projectPath?: string) => Promise<any[]>
  listAllSessions: () => Promise<any[]>
  getRecentSession: (projectPath: string) => Promise<{ sessionId: string; modifiedAt: string; messages: any[] } | null>
  getSessionTranscript: (sessionId: string) => Promise<{ events: any[] }>

  // Settings
  loadSettings: () => Promise<AppSettingsSafe>
  saveSettings: (settings: AppSettingsSafe) => Promise<{ success: boolean }>

  // Team management
  loadTeam: () => Promise<any[] | null>
  saveTeam: (team: any[]) => Promise<{ success: boolean }>

  // Task management
  loadTasks: () => Promise<any[]>
  saveTasks: (tasks: any[]) => Promise<{ success: boolean }>

  // Window controls
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isMaximized: () => Promise<boolean>

  // Connection management
  connectionCheckCli: () => Promise<CliDetectionResult>
  connectionTestApi: (opts: { baseUrl: string; apiKey: string; timeoutMs?: number }) => Promise<ApiTestResult>
  connectionHealthCheck: (opts: { modelId: string; modelName: string; provider: string; apiKey: string; baseUrl: string; model: string }) => Promise<ConnectionHealth>
  connectionGetEnvConfig: () => Promise<{ hasApiKey: boolean; baseUrl: string; model: string; claudeCodeNoColor: boolean; platform: string; nodeVersion: string; homeDir: string }>

  // Approval
  approvalLog: (entry: any) => Promise<{ success: boolean }>
  approvalHistory: () => Promise<any[]>

  // Git operations
  gitStatus: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>
  gitLog: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>
  gitBranch: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>
  gitPull: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>
  gitPush: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>
  gitCommit: (opts: { projectPath: string; message: string }) => Promise<{ success: boolean; output: string; error?: string }>
  gitAdd: (opts: { projectPath: string; files: string[] }) => Promise<{ success: boolean; output: string; error?: string }>
  gitConfig: (projectPath: string) => Promise<{ success: boolean; config?: Record<string, string>; error?: string }>
  gitInit: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>
  gitRemote: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>
  gitRemoteSet: (opts: { projectPath: string; name: string; url: string }) => Promise<{ success: boolean; output: string; error?: string }>
  gitConfigSet: (opts: { projectPath: string; key: string; value: string }) => Promise<{ success: boolean; output: string; error?: string }>
  gitDiff: (opts: { projectPath: string; file?: string }) => Promise<{ success: boolean; output: string; error?: string }>
  gitShow: (opts: { projectPath: string; file: string }) => Promise<{ success: boolean; output: string; error?: string }>
  gitDiffStaged: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>

  // Terminal management
  terminalStart: (opts: { cwd?: string; sessionId?: string; cols?: number; rows?: number }) => Promise<{ success: boolean }>
  terminalRestart: () => Promise<{ success: boolean }>
  terminalInput: (data: string) => void
  terminalResize: (opts: { cols: number; rows: number }) => void
  terminalKill: () => Promise<{ success: boolean }>
  terminalStatus: () => Promise<{ running: boolean; claudeRunning: boolean; sessionId: string | null; error: string }>
  onTerminalData: (callback: (data: string) => void) => () => void
  onTerminalStatus: (callback: (status: any) => void) => () => void

  // ── SSH Remote ──────────────────────────────────────────
  sshConnect: (serverId: string) => Promise<{ success: boolean; error?: string }>
  sshDisconnect: (serverId: string) => Promise<{ success: boolean }>
  sshStatus: () => Promise<{ serverId: string | null; status: string; error: string; connectedAt: string | null }>
  sshTestConnection: (config: any) => Promise<any>
  sshListRemoteFiles: (opts: { serverId: string; remotePath: string; maxDepth?: number }) => Promise<any[]>
  sshReadRemoteFile: (opts: { serverId: string; remotePath: string }) => Promise<{ success: boolean; content?: string; size?: number; isBinary?: boolean; error?: string }>
  sshWriteRemoteFile: (opts: { serverId: string; remotePath: string; content: string }) => Promise<{ success: boolean; error?: string }>
  sshStartTerminal: (opts: { serverId: string; cols?: number; rows?: number }) => Promise<{ success: boolean; error?: string }>
  sshTerminalInput: (data: string) => void
  sshTerminalResize: (opts: { cols: number; rows: number }) => void
  sshTerminalKill: () => Promise<{ success: boolean }>
  onSshTerminalData: (callback: (data: string) => void) => () => void
  onSshTerminalStatus: (callback: (status: any) => void) => () => void
  onSshDeployStatus: (callback: (status: any) => void) => () => void
  sshDeploy: (opts: { projectPath: string; deployTargetId: string }) => Promise<{ success: boolean; deployId?: string; error?: string }>
  sshExecCommand: (opts: { serverId: string; command: string; timeoutMs?: number }) => Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }>

  // Generic
  on: (channel: string, callback: (...args: any[]) => void) => void
  off: (channel: string, callback: (...args: any[]) => void) => void
  platform: string
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
