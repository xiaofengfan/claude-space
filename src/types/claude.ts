/** Claude stream-json 事件类型 */

export interface ClaudeInitEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  cwd: string
  model: string
  permissionMode: string
  tools: string[]
  mcp_servers: any[]
  slash_commands: string[]
  apiKeySource: string
  claude_code_version: string
}

export interface ClaudeMessageContent {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result'
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, any>
  content?: any
}

export interface ClaudeAssistantMessage {
  id: string
  type: 'message'
  role: 'assistant'
  content: ClaudeMessageContent[]
  model: string
  stop_reason: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export interface ClaudeAssistantEvent {
  type: 'assistant'
  message: ClaudeAssistantMessage
  session_id: string
  uuid: string
}

export interface ClaudeResultEvent {
  type: 'result'
  subtype: 'success' | 'error'
  result?: string
  session_id: string
  total_cost_usd: number
  duration_ms: number
  num_turns: number
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  permission_denials: any[]
}

export type ClaudeStreamEvent = ClaudeInitEvent | ClaudeAssistantEvent | ClaudeResultEvent | { type: string; [key: string]: any }

/** 展示用的消息模型 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  toolCalls?: ToolCall[]
  timestamp: number
  isStreaming?: boolean
  agentIcon?: string
  agentName?: string
  // ── 多智能体群聊扩展 ──
  agentType?: string      // Coordinator | Architect | Implementer | SecurityReviewer | CodeExplorer
  agentId?: string        // 智能体实例ID (e.g., 'arch', 'dev1')
  agentColor?: string     // CSS 颜色用于消息边框
  groupId?: string        // 群聊会话ID
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
  result?: string
  isComplete: boolean
}
