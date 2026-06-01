import { useState } from 'react'

export function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="thinking-block">
      <div className="thinking-header" onClick={() => setExpanded(!expanded)}>
        <span>💭 {expanded ? '收起' : '展开'} 思考过程</span>
        <span className="thinking-toggle">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="thinking-body">{thinking}</div>
      )}
    </div>
  )
}
