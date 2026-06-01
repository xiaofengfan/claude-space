import type { AppSettingsSafe, ModelConfigSafe } from './settings'
import type { ConnectionHealth, CliDetectionResult, ApiTestResult } from './connection'

export interface ElectronAPI {
  // Claude session
  claudeStatus: () => Promise<{ running: boolean; sessionId?: string; error?: string }>
  claudeSend: (opts: { content: string; projectPath?: string; sessionId?: string; modelId?: string }) => Promise<{ success: boolean }>
  stopClaude: () => Promise<{ success: boolean }>
  onClaudeEvent: (callback: (event: any) => void) => () => void
  onClaudeStderr: (callback: (text: string) => void) => () => void
  onClaudeClose: (callback: (code: number | null) => void) => () => void
  onClaudeStatusUpdate: (callback: (status: { running: boolean; connected: boolean; error: string; sessionId?: string }) => void) => () => void

  // Project management
  scanProjects: (rootPath?: string) => Promise<any[]>
  newProject: (name?: string) => Promise<{ canceled: boolean; path?: string; name?: string; error?: string }>
  openProjectFolder: (projectPath: string) => Promise<void>
  openProjectInNewWindow: (projectPath: string) => Promise<{ success: boolean }>
  scanDirectory: (dirPath: string) => Promise<any[]>
  scanProjectFiles: (dirPath: string) => Promise<any[]>
  openInTerminal: (projectPath: string) => Promise<void>

  // File operations
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>
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

  // Terminal management
  terminalStart: (opts: { cwd?: string; sessionId?: string; cols?: number; rows?: number }) => Promise<{ success: boolean }>
  terminalRestart: () => Promise<{ success: boolean }>
  terminalInput: (data: string) => void
  terminalResize: (opts: { cols: number; rows: number }) => void
  terminalKill: () => Promise<{ success: boolean }>
  terminalStatus: () => Promise<{ running: boolean; claudeRunning: boolean; sessionId: string | null; error: string }>
  onTerminalData: (callback: (data: string) => void) => () => void
  onTerminalStatus: (callback: (status: any) => void) => () => void

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
