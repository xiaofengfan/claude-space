import { ChatMessage } from '../types/claude'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolUseBlock } from './ToolUseBlock'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
          {message.content && (
            <div className="message-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent, #6c8cff)', textDecoration: 'underline' }}>
                    {children}
                  </a>
                ),
                code: ({ className, children, ...props }: any) => {
                  const isInline = !className
                  if (isInline) {
                    return <code style={{
                      background: 'rgba(100,100,130,0.2)',
                      padding: '1px 5px',
                      borderRadius: 3,
                      fontSize: '0.9em',
                      fontFamily: '"Cascadia Code","Fira Code",Consolas,monospace',
                      color: '#e0e0e0',
                    }} {...props}>{children}</code>
                  }
                  return <pre style={{
                    background: '#0d1117',
                    border: '1px solid #2a2a2a',
                    borderRadius: 6,
                    padding: 12,
                    overflow: 'auto',
                    fontSize: 12,
                    lineHeight: 1.5,
                    fontFamily: '"Cascadia Code","Fira Code",Consolas,monospace',
                  }}><code className={className} {...props}>{children}</code></pre>
                },
                table: ({ children }) => (
                  <div style={{ overflow: 'auto', margin: '8px 0' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>{children}</table>
                  </div>
                ),
                th: ({ children }) => <th style={{ border: '1px solid #333', padding: '6px 10px', background: '#1a1a1a', fontWeight: 600 }}>{children}</th>,
                td: ({ children }) => <td style={{ border: '1px solid #333', padding: '6px 10px' }}>{children}</td>,
                ul: ({ children }) => <ul style={{ paddingLeft: 20, margin: '6px 0' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ paddingLeft: 20, margin: '6px 0' }}>{children}</ol>,
                li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
                blockquote: ({ children }) => (
                  <blockquote style={{
                    borderLeft: '3px solid var(--accent, #6c8cff)',
                    margin: '8px 0',
                    padding: '4px 12px',
                    color: '#888',
                    background: 'rgba(100,100,130,0.08)',
                    borderRadius: '0 4px 4px 0',
                  }}>{children}</blockquote>
                ),
                hr: () => <hr style={{ border: 'none', borderTop: '1px solid #2a2a2a', margin: '12px 0' }} />,
                h1: ({ children }) => <h1 style={{ fontSize: 18, fontWeight: 700, margin: '12px 0 6px' }}>{children}</h1>,
                h2: ({ children }) => <h2 style={{ fontSize: 16, fontWeight: 700, margin: '10px 0 5px' }}>{children}</h2>,
                h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 600, margin: '8px 0 4px' }}>{children}</h3>,
                p: ({ children }) => <p style={{ margin: '6px 0', lineHeight: 1.7 }}>{children}</p>,
              }}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          {message.isStreaming && !message.content && !message.toolCalls?.length && (
            <div className="message-loading"><span className="dot-pulse" /></div>
          )}
        </div>
      </div>
      {isUser && <div className="message-avatar" title={senderName}>{avatar}</div>}
    </div>
  )
}
