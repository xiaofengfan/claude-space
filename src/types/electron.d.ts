import type { AppSettingsSafe, ModelConfigSafe } from './settings'
import type { ConnectionHealth, CliDetectionResult, ApiTestResult } from './connection'
import type { SkillScanResult, MarketSource } from './skill'

export interface ElectronAPI {
  // Claude session
  claudeStatus: () => Promise<{ running: boolean; sessionId?: string; error?: string }>
  claudeSend: (opts: { content: string; projectPath?: string; sessionId?: string; modelId?: string; autoApproval?: boolean }) => Promise<{ success: boolean }>
  stopClaude: () => Promise<{ success: boolean }>
  claudeWriteStdin: (data: string) => Promise<{ success: boolean }>
  onClaudeEvent: (callback: (event: any) => void) => () => void
  onClaudeStderr: (callback: (text: string) => void) => () => void
  onClaudeClose: (callback: (code: number | null) => void) => () => void
  onClaudeStatusUpdate: (callback: (status: { running: boolean; connected: boolean; error: string; sessionId?: string; claudeRunning?: boolean }) => void) => () => void
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
  openInVscode: (projectPath: string) => Promise<{ success: boolean; error?: string }>
  openInIdea: (projectPath: string) => Promise<{ success: boolean; error?: string }>
  openInIde: (opts: { ideId: string; projectPath: string }) => Promise<{ success: boolean; error?: string }>
  openProjectInNewWindow: (projectPath: string) => Promise<{ success: boolean }>
  scanDirectory: (dirPath: string) => Promise<any[]>
  scanProjectFiles: (dirPath: string) => Promise<any[]>
  openInTerminal: (projectPath: string) => Promise<void>

  // File operations
  readFile: (filePath: string) => Promise<{ success: boolean; content?: string; size?: number; isBinary?: boolean; error?: string }>
  writeFile: (opts: { filePath: string; content: string }) => Promise<{ success: boolean; error?: string }>
  createFile: (opts: { dirPath: string; fileName: string; content?: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  openFileInNewWindow: (opts: { filePath: string; fileName: string; projectPath?: string }) => Promise<{ success: boolean }>
  openFileDialog: () => Promise<{ canceled: boolean; filePath?: string }>
  openDirectoryDialog: () => Promise<{ canceled: boolean; dirPath?: string }>
  saveTempImages: (opts: { projectPath: string; images: Array<{ base64: string; mediaType: string }> }) => Promise<{ success: boolean; paths: string[]; error?: string }>

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
  gitLogDetail: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>
  gitShowCommit: (opts: { projectPath: string; hash: string }) => Promise<{ success: boolean; output: string; error?: string }>
  gitDiff: (opts: { projectPath: string; file?: string }) => Promise<{ success: boolean; output: string; error?: string }>
  gitShow: (opts: { projectPath: string; file: string }) => Promise<{ success: boolean; output: string; error?: string }>
  gitDiffStaged: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>
  gitRemoteInfo: (projectPath: string) => Promise<{ success: boolean; output: string; branches: string; error?: string }>
  gitRemoteLog: (opts: { projectPath: string; remoteBranch?: string }) => Promise<{ success: boolean; output: string; error?: string }>
  gitFetch: (projectPath: string) => Promise<{ success: boolean; output: string; error?: string }>

  // Memory operations (project isolation via projectPath)
  memoryList: (projectPath: string) => Promise<{ success: boolean; entries: { name: string; description: string; fileName: string; type?: string; mtime?: string }[]; error?: string }>
  memoryRead: (opts: { projectPath: string; fileName: string }) => Promise<{ success: boolean; content: string; error?: string }>
  memoryWrite: (opts: { projectPath: string; fileName: string; content: string }) => Promise<{ success: boolean; error?: string }>
  memoryCreate: (opts: { projectPath: string; fileName: string; name: string; description: string; type: string; content: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>
  memoryDelete: (opts: { projectPath: string; fileName: string }) => Promise<{ success: boolean; error?: string }>
  memoryAutoCreate: (opts: { projectPath: string; title: string; content: string; type?: string }) => Promise<{ success: boolean; fileName?: string; error?: string }>

  // Knowledge management
  knowledgeList: (projectPath: string) => Promise<{ success: boolean; entries: { name: string; fileName: string; description: string; type: string; tags: string; status: string; mtime: string; sources: string }[]; error?: string }>
  knowledgeRead: (opts: { projectPath: string; fileName: string }) => Promise<{ success: boolean; content: string; error?: string }>
  knowledgeCreate: (opts: { projectPath: string; title: string; content: string; type: string; tags: string; sources?: string }) => Promise<{ success: boolean; fileName?: string; error?: string }>
  knowledgeDelete: (opts: { projectPath: string; fileName: string }) => Promise<{ success: boolean; error?: string }>

  // Console window
  openConsoleWindow: () => Promise<void>
  devStart: (opts: { command: string; name: string }) => Promise<{ success: boolean; error?: string }>
  devStop: () => Promise<{ success: boolean; error?: string }>
  onDevOutput: (callback: (data: string) => void) => () => void
  onDevError: (callback: (data: string) => void) => () => void
  onDevStatus: (callback: (status: { running: boolean; name: string }) => void) => () => void
  onConsoleLogLine: (callback: (line: string) => void) => () => void
  getConsoleLogHistory: () => Promise<{ success: boolean; lines: string[]; error?: string }>

  // Skill management
  skillList: () => Promise<{ success: boolean; skills: any[]; error?: string }>
  skillRead: (name: string) => Promise<{ success: boolean; content: string; error?: string }>
  skillInstall: (opts: { name: string; content: string }) => Promise<{ success: boolean; error?: string }>
  skillUninstall: (name: string) => Promise<{ success: boolean; error?: string }>
  skillMarketplaceList: () => Promise<{ success: boolean; items: any[]; error?: string }>
  skillGetMarketConfig: () => Promise<{ success: boolean; config: { marketplaces?: MarketSource[]; localPaths?: string[] } }>
  skillSaveMarketConfig: (cfg: any) => Promise<{ success: boolean; error?: string }>
  skillLoadFromLocal: () => Promise<{ success: boolean; skills?: SkillScanResult[]; error?: string }>
  skillLoadFromLocalDir: (dir: string) => Promise<{ success: boolean; skills?: SkillScanResult[]; error?: string }>
  skillLoadFromGit: (gitUrl: string) => Promise<{ success: boolean; count?: number; error?: string }>
  skillInstallBatch: (opts: { skills: Array<{ name: string; content: string }> }) => Promise<{ success: boolean; count?: number; errors?: Array<{ name: string; error: string }>; error?: string }>
  skillMarketplaceScan: () => Promise<{ success: boolean; skills?: SkillScanResult[]; error?: string }>
  skillMarketplaceSourceAdd: (src: MarketSource) => Promise<{ success: boolean; error?: string }>
  skillMarketplaceSourceRemove: (url: string) => Promise<{ success: boolean; error?: string }>
  skillMarketplaceSourceUpdate: (url: string, updates: Partial<MarketSource>) => Promise<{ success: boolean; error?: string }>

    skillMarketplaceInstall: (item: { id: string }) => Promise<{ success: boolean; error?: string }>

  // Project skills
  skillListProject: () => Promise<{ success: boolean; skills?: string[]; error?: string }>
  skillInstallToProject: (skillName: string) => Promise<{ success: boolean; error?: string }>
  skillRemoveFromProject: (skillName: string) => Promise<{ success: boolean; error?: string }>
  skillClearProject: () => Promise<{ success: boolean; error?: string }>

  // Automation workshop
  loopList: () => Promise<{ success: boolean; loops?: any[]; error?: string }>
  loopCreate: (opts: { name: string; prompt: string; interval: string }) => Promise<{ success: boolean; loop?: any; error?: string }>
  loopDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  loopRunNow: (id: string) => Promise<{ success: boolean; error?: string }>
  workflowListRuns: () => Promise<{ success: boolean; runs?: any[]; error?: string }>
  workflowRun: (opts: { templateId: string; name: string }) => Promise<{ success: boolean; run?: any; error?: string }>
  onLoopStatus: (callback: (data: any) => void) => () => void
  onWorkflowLog: (callback: (data: any) => void) => () => void
  onWorkflowStatus: (callback: (data: any) => void) => () => void

  // Terminal management
  terminalStart: (opts: { cwd?: string; sessionId?: string; cols?: number; rows?: number; autoApproval?: boolean }) => Promise<{ success: boolean }>
  terminalRestart: () => Promise<{ success: boolean }>
  terminalInput: (data: string) => void
  terminalResize: (opts: { cols: number; rows: number }) => void
  terminalKill: () => Promise<{ success: boolean }>
  terminalStatus: () => Promise<{ running: boolean; claudeRunning: boolean; sessionId: string | null; error: string }>
  terminalSetPermissionMode: (mode: 'auto' | 'manual') => Promise<{ success: boolean }>
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
  getWorkspaceRoot: () => Promise<string>

  // ── Workspace management ────────────────────────────────
  workspaceList: () => Promise<Array<{ id: string; name: string; path: string; isActive: boolean; createdAt: string }>>
  workspaceAdd: (opts: { name: string; path: string }) => Promise<{ success: boolean; workspace?: { id: string; name: string; path: string; isActive: boolean; createdAt: string }; error?: string }>
  workspaceRemove: (workspaceId: string) => Promise<{ success: boolean; error?: string }>
  workspaceSetActive: (workspaceId: string) => Promise<{ success: boolean; path?: string; error?: string }>

  // ── Claude native env config ──────────────────────────────
  claudeEnvConfig: () => Promise<{ baseUrl: string; authToken: string; defaultModel: string; models: Array<{ name: string; model: string; fromEnv: string }>; mtime: string }>
  syncFromClaudeEnv: () => Promise<{ success: boolean; added?: number; models?: Array<{ id: string; name: string; model: string }>; error?: string }>
  onClaudeEnvChanged: (callback: (config: { baseUrl: string; authToken: string; defaultModel: string; models: Array<{ name: string; model: string; fromEnv: string }>; mtime: string }) => void) => () => void
  onSettingsMigrated: (callback: (data: { activeModelId: string | null }) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
