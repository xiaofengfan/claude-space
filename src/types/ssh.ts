// ── SSH 远程协作类型定义 ──────────────────────────────

export type SshAuthMethod = 'password' | 'key'

/** 完整 SSH 服务器配置（存储到 JSON，包含明文密码/密钥 — 永不出主进程） */
export interface SshServerConfig {
  id: string                    // e.g. "ssh-<timestamp-base36>"
  name: string                  // display name, e.g. "Production Server"
  host: string
  port: number                  // default 22
  username: string
  authMethod: SshAuthMethod
  password: string              // plain text (authMethod='password'), never sent to renderer
  privateKeyPath: string        // local path to SSH private key (authMethod='key')
  privateKeyContent: string     // inline key content (never sent to renderer)
  fingerprint?: string          // server host key fingerprint (TOFU trust-on-first-use)
  createdAt: string             // ISO timestamp
  updatedAt: string             // ISO timestamp
}

/** 脱敏后的 SSH 服务器配置（发送到渲染进程） */
export interface SshServerConfigSafe {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: SshAuthMethod
  passwordHint: string          // "****" or "未设置"
  privateKeyPath: string
  privateKeyHint: string        // "已配置 (内联密钥)" / "已配置 (key.pem)" / "未设置"
  fingerprint?: string
  createdAt: string
  updatedAt: string
}

// ── SSH 连接状态 ────────────────────────────────────────

export type SshConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface SshConnectionState {
  serverId: string | null
  status: SshConnectionStatus
  error: string
  connectedAt: string | null
}

// ── 远程文件节点 ────────────────────────────────────────

export interface RemoteFileNode {
  name: string
  path: string                    // full remote path
  type: 'file' | 'directory' | 'symlink'
  size?: number
  modifiedAt?: string
  permissions?: string            // e.g. "-rw-r--r--"
  children?: RemoteFileNode[]
}

// ── 部署配置 ────────────────────────────────────────────

export interface DeployTarget {
  id: string
  name: string                    // display name, e.g. "生产环境"
  sshServerId: string             // which SSH server to deploy to
  remotePath: string              // target directory, e.g. "/var/www/app"
  preDeployCommands: string[]     // e.g. ["pm2 stop app"]
  postDeployCommands: string[]    // e.g. ["npm install --production", "pm2 start app"]
  excludePatterns: string[]       // glob patterns to skip
  autoDeploy: boolean             // deploy on file save?
  createdAt: string
  updatedAt: string
}

export const DEFAULT_DEPLOY_EXCLUDES = [
  '.git', 'node_modules', '.env', '.env.local', '.env.production',
  '*.log', 'dist', '.cache', '__pycache__', '*.pyc',
]

// ── SSH 健康检查 ────────────────────────────────────────

export interface SshCheckItem {
  type: 'ssh-reachability' | 'ssh-auth' | 'sftp-ready' | 'remote-env'
  label: string
  status: 'ok' | 'warning' | 'error' | 'idle'
  message: string
  detail?: string
  checkedAt?: string
  latencyMs?: number
}

export interface SshHealth {
  overall: 'healthy' | 'degraded' | 'disconnected' | 'unknown'
  items: SshCheckItem[]
  lastChecked: string | null
}

// ── 部署状态 ────────────────────────────────────────────

export type DeployStatus = 'idle' | 'connecting' | 'uploading' | 'running-commands' | 'completed' | 'failed'

export interface DeployProgress {
  deployId: string
  targetId: string
  targetName: string
  status: DeployStatus
  totalFiles: number
  uploadedFiles: number
  currentFile: string
  bytesTransferred: number
  totalBytes: number
  errors: string[]
  startedAt: string
  completedAt?: string
}

// ── 远程命令执行结果 ────────────────────────────────────

export interface RemoteCommandResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
}
