import { useState, useEffect, useCallback } from 'react'
import type { ApprovalRequest } from '../hooks/useTaskSync'

interface Props {
  approval: ApprovalRequest | null
  onApprove: (approvalId: string, optionIndex: number) => void
  onDismiss: (approvalId: string) => void
}

/** Map tool names to human-readable descriptions */
function getToolDescription(name?: string): string {
  const m: Record<string, string> = {
    Bash: '执行终端命令',
    Write: '写入/创建文件',
    Edit: '编辑文件内容',
    Read: '读取文件',
    Glob: '搜索文件',
    Grep: '搜索文件内容',
    WebFetch: '获取网页内容',
    WebSearch: '搜索互联网',
    Agent: '启动子智能体',
    AskUserQuestion: '向用户提问',
    Workflow: '执行工作流',
    PermissionPrompt: '终端权限请求',
  }
  return m[name || ''] || '执行操作'
}

function getToolEmoji(name?: string): string {
  const m: Record<string, string> = {
    Bash: '💻', Write: '📝', Edit: '✏️', Read: '📖',
    Glob: '🔍', Grep: '🔎', Workflow: '⚙️', Agent: '🤖',
    WebFetch: '🌐', WebSearch: '🔍', AskUserQuestion: '❓',
    PermissionPrompt: '🔔',
  }
  return m[name || ''] || '🔧'
}

export function ApprovalDialog({ approval, onApprove, onDismiss }: Props) {
  const [countdown, setCountdown] = useState(30)

  useEffect(() => {
    if (!approval) { setCountdown(30); return }
    setCountdown(30)
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(timer); onDismiss(approval.id); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [approval?.id])

  const handleSelect = useCallback((index: number) => {
    if (!approval) return
    onApprove(approval.id, index)
  }, [approval, onApprove])

  const handleAlwaysAllow = useCallback(() => {
    if (!approval) return
    onApprove(approval.id, 1) // option index 1 = "always allow"
  }, [approval, onApprove])

  if (!approval) return null

  const hasToolInfo = !!approval.toolName
  const isStderrPrompt = approval.toolName === 'PermissionPrompt'
  const toolDesc = getToolDescription(approval.toolName)
  const toolEmoji = getToolEmoji(approval.toolName)

  return (
    <div className="dialog-overlay" onClick={() => onDismiss(approval.id)}>
      <div className="dialog approval-dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>{hasToolInfo ? `${toolEmoji} 需要审批` : '🔔 需要审批'}</h2>
          <span className="approval-countdown">{countdown > 0 ? `${countdown}s` : '超时'}</span>
          <button onClick={() => onDismiss(approval.id)} className="dialog-close">✕</button>
        </div>
        <div className="dialog-body">
          {/* Tool info banner */}
          {hasToolInfo && (
            <div className="approval-tool-info">
              <span className="approval-tool-badge">{approval.toolName}</span>
              <span className="approval-tool-desc">{toolDesc}</span>
            </div>
          )}

          {/* Tool input detail */}
          {approval.toolInput && (
            <div className="approval-tool-detail">
              <code>{approval.toolInput}</code>
            </div>
          )}

          {/* Question */}
          <p className="approval-question">{approval.question}</p>

          {/* Options */}
          <div className="approval-options">
            {approval.options.map((opt, i) => (
              <button
                key={i}
                className={`approval-option-btn ${i === 0 ? 'approval-option-allow' : ''} ${i === approval.options.length - 1 ? 'approval-option-deny' : ''}`}
                onClick={() => handleSelect(i)}
              >
                <span className="approval-option-label">{opt.label}</span>
                {opt.description && (
                  <span className="approval-option-desc">{opt.description}</span>
                )}
              </button>
            ))}
          </div>

          {/* For stderr prompts: quick y/n buttons */}
          {isStderrPrompt && (
            <div className="approval-quick-actions">
              <button className="approval-quick-btn allow" onClick={() => handleSelect(0)}>
                ✅ 允许 (y)
              </button>
              <button className="approval-quick-btn deny" onClick={() => handleSelect(1)}>
                ❌ 拒绝 (n)
              </button>
            </div>
          )}
        </div>
        <div className="dialog-footer">
          {hasToolInfo && !isStderrPrompt && (
            <button className="btn-allow-always" onClick={handleAlwaysAllow}>
              🔄 始终允许此类操作
            </button>
          )}
          <button className="btn-cancel" onClick={() => onDismiss(approval.id)}>
            {countdown > 0 ? `忽略 (${countdown}s)` : '关闭'}
          </button>
        </div>
      </div>
    </div>
  )
}
