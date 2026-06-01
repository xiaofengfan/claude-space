/** 大模型配置类型 */

export type ModelProvider = 'Claude' | 'DeepSeek' | 'OpenAI' | 'Custom'

/** 完整模型配置（存储到 JSON，apiKey 为明文） */
export interface ModelConfig {
  id: string           // unique, e.g. "deepseek-v3", "claude-sonnet"
  name: string         // display name, e.g. "DeepSeek V3"
  provider: ModelProvider
  apiKey: string       // full key — stored in JSON, never sent to renderer unmasked
  baseUrl: string      // e.g. "https://api.deepseek.com"
  model: string        // model identifier, e.g. "deepseek-chat"
  apiKeySource: 'env' | 'user'  // 'env' = from env var, 'user' = manually entered
}

/** 脱敏后的模型配置（发送到渲染进程，apiKey 已脱敏） */
export interface ModelConfigSafe {
  id: string
  name: string
  provider: ModelProvider
  apiKeyHint: string   // e.g. "sk-****abcd" or "来自环境变量"
  baseUrl: string
  model: string
  apiKeySource: 'env' | 'user'
}

/** 完整应用设置（存储在 JSON 文件中） */
export interface AppSettings {
  version: number
  activeModelId: string | null
  models: ModelConfig[]
  autoApproval: boolean      // 自动化审批：true=自动通过不弹窗
}

/** 脱敏后的应用设置（发送到渲染进程） */
export interface AppSettingsSafe {
  version: number
  activeModelId: string | null
  models: ModelConfigSafe[]
  autoApproval: boolean
}
