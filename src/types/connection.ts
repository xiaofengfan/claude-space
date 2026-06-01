/** 连接管理与健康检测类型 */

/** 连接项类型 */
export type ConnectionType = 'claude-cli' | 'api-endpoint' | 'auth' | 'session'

/** 单条连接检测结果 */
export interface ConnectionCheckItem {
  type: ConnectionType
  label: string            // 显示名，如 "Claude CLI", "API 端点", "认证状态"
  status: 'ok' | 'warning' | 'error' | 'idle'
  message: string          // 状态描述
  detail?: string          // 详细信息
  checkedAt?: string       // ISO 时间
  latencyMs?: number       // 延迟毫秒
}

/** 整体连接健康状态 */
export interface ConnectionHealth {
  overall: 'healthy' | 'degraded' | 'disconnected' | 'unknown'
  items: ConnectionCheckItem[]
  lastChecked: string | null
}

/** 模型连接配置 */
export interface ModelConnectionConfig {
  modelId: string
  modelName: string
  provider: string
  baseUrl: string
  apiKeyHint: string
  timeoutMs: number        // 请求超时
  retryCount: number       // 重试次数
}

/** CLI 检测结果 */
export interface CliDetectionResult {
  found: boolean
  version?: string
  path?: string
  installCommand?: string
}

/** API 测试结果 */
export interface ApiTestResult {
  reachable: boolean
  statusCode?: number
  latencyMs: number
  error?: string
  models?: string[]        // 可用模型列表
}

/** 模型连接状态（每个模型独立） */
export interface ModelConnectionStatus {
  modelId: string
  modelName: string
  provider: string
  cliAvailable: boolean     // CLI 是否可用
  apiReachable: boolean     // API 是否可达
  authValid: boolean        // 认证是否有效
  lastChecked: string | null
  latencyMs: number | null
  errorMessage?: string
}
