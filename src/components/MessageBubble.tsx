import { ChatMessage } from '../types/claude'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolUseBlock } from './ToolUseBlock'

const AGENT_ICONS: Record<string, string> = {
  Coordinator: '👔', Architect: '🏗️', Implementer: '💻',
  SecurityReviewer: '🔍', PerformanceReviewer: '🚀', CodeExplorer: '🔎',
}

const AGENT_COLORS: Record<string, string> = {
  Coordinator: '#4a7cf7', Architect: '#e05555', Implementer: '#3d8b5e',
  SecurityReviewer: '#d07040', CodeExplorer: '#d97706',
}

const AGENT_LABELS: Record<string, string> = {
  Coordinator: '协调者', Architect: '架构师', Implementer: '开发者',
  SecurityReviewer: '审查员', CodeExplorer: '探索者',
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const avatar = isUser ? '👑' : (message.agentIcon || '🤖')
  const senderName = isUser ? '控制人' : (message.agentName || 'Claude')
  const agentColor = message.agentColor || (message.agentType ? AGENT_COLORS[message.agentType] : undefined)
  const agentLabel = message.agentType ? AGENT_LABELS[message.agentType] : undefined

  return (
    <div
      className={`message-bubble ${message.role}${message.agentType ? ' agent-msg' : ''}`}
      style={agentColor && !isUser ? { borderLeft: `3px solid ${agentColor}`, paddingLeft: 12 } : undefined}
    >
      {!isUser && <div className="message-avatar" title={senderName}>{avatar}</div>}
      <div className="message-body">
        <div className="message-sender" style={isUser ? { textAlign: 'right' } : undefined}>
          {isUser ? `控制人 👑` : `${avatar} ${senderName}`}
          {agentLabel && !isUser && (
            <span className="agent-type-badge" style={{
              backgroundColor: agentColor ? agentColor + '22' : '#2a2a4a',
              color: agentColor || '#888',
              border: agentColor ? `1px solid ${agentColor}44` : '1px solid #3a3a5a',
            }}>{agentLabel}</span>
          )}
        </div>
        <div className="message-content">
          {message.thinking && <ThinkingBlock thinking={message.thinking} />}
          {message.toolCalls?.map(tool => <ToolUseBlock key={tool.id} tool={tool} />)}
          {/* 图片附件（用户消息） */}
          {message.images && message.images.length > 0 && (
            <div className="message-images">
              {message.images.map((img, i) => (
                <img key={i} src={img.dataUrl} alt={`截图 ${i + 1}`} className="message-image-thumb" />
              ))}
            </div>
          )}
          {message.content && <div className="message-text">{message.content}</div>}
          {message.isStreaming && !message.content && !message.toolCalls?.length && (
            <div className="message-loading"><span className="dot-pulse" /></div>
          )}
        </div>
      </div>
      {isUser && <div className="message-avatar" title={senderName}>{avatar}</div>}
    </div>
  )
}
