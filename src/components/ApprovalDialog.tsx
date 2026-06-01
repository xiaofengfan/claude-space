import { useState, useEffect, useCallback } from 'react'
import type { ApprovalRequest } from '../hooks/useTaskSync'

interface Props {
  approval: ApprovalRequest | null
  onApprove: (approvalId: string, optionIndex: number) => void
  onDismiss: (approvalId: string) => void
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

  if (!approval) return null

  return (
    <div className="dialog-overlay" onClick={() => onDismiss(approval.id)}>
      <div className="dialog approval-dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>🔔 需要审批</h2>
          <span className="approval-countdown">{countdown > 0 ? `${countdown}s` : '超时'}</span>
          <button onClick={() => onDismiss(approval.id)} className="dialog-close">✕</button>
        </div>
        <div className="dialog-body">
          <p className="approval-question">{approval.question}</p>
          <div className="approval-options">
            {approval.options.map((opt, i) => (
              <button
                key={i}
                className="approval-option-btn"
                onClick={() => handleSelect(i)}
              >
                <span className="approval-option-label">{opt.label}</span>
                {opt.description && (
                  <span className="approval-option-desc">{opt.description}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn-cancel" onClick={() => onDismiss(approval.id)}>
            {countdown > 0 ? `忽略 (${countdown}s)` : '关闭'}
          </button>
        </div>
      </div>
    </div>
  )
}
