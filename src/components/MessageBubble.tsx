import { ChatMessage } from '../types/claude'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolUseBlock } from './ToolUseBlock'

const AGENT_ICONS: Record<string, string> = {
  Coordinator: '👔', Architect: '🏗️', Implementer: '💻',
  SecurityReviewer: '🔍', PerformanceReviewer: '🚀', CodeExplorer: '🔎',
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const avatar = isUser ? '👑' : (message.agentIcon || '🤖')
  const senderName = isUser ? '控制人' : (message.agentName || 'Claude')

  return (
    <div className={`message-bubble ${message.role}`}>
      <div className="message-avatar" title={senderName}>{avatar}</div>
      <div className="message-body">
        <div className="message-sender">{senderName}</div>
        <div className="message-content">
          {message.thinking && <ThinkingBlock thinking={message.thinking} />}
          {message.toolCalls?.map(tool => <ToolUseBlock key={tool.id} tool={tool} />)}
          {message.content && <div className="message-text">{message.content}</div>}
          {message.isStreaming && !message.content && !message.toolCalls?.length && (
            <div className="message-loading"><span className="dot-pulse" /></div>
          )}
        </div>
      </div>
    </div>
  )
}
