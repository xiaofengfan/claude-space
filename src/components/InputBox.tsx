import { useState, useRef, KeyboardEvent } from 'react'

function getIcon(role: string): string {
  if (role.includes('经理') || role.includes('项目')) return '👔'
  if (role.includes('产品')) return '📋'
  if (role.includes('架构')) return '🏗️'
  if (role.includes('高级')) return '👨‍💻'
  if (role.includes('开发')) return '💻'
  if (role.includes('测试')) return '🧪'
  if (role.includes('审查') || role.includes('审计')) return '🔍'
  if (role.includes('运维') || role.includes('部署')) return '🚀'
  return '👤'
}

export function InputBox({
  onSend, onStop, disabled, isRunning, team,
}: {
  onSend: (content: string) => void; onStop: () => void; disabled: boolean; isRunning: boolean; team?: any[]
}) {
  const AGENTS = (team?.length ? team : [
    { name: '王经理', role: '项目经理', agentType: 'Coordinator', icon: '👔' },
    { name: '李产品', role: '产品经理', agentType: 'Coordinator', icon: '📋' },
    { name: '张架构', role: '架构师', agentType: 'Architect', icon: '🏗️' },
    { name: '赵工', role: '高级工程师', agentType: 'Implementer', icon: '👨‍💻' },
    { name: '钱开发', role: '开发工程师', agentType: 'Implementer', icon: '💻' },
    { name: '孙开发', role: '开发工程师', agentType: 'Implementer', icon: '💻' },
    { name: '周测试', role: '测试工程师', agentType: 'SecurityReviewer', icon: '🧪' },
    { name: '吴审查', role: '代码审查', agentType: 'SecurityReviewer', icon: '🔍' },
  ]).map(a => ({ ...a, icon: getIcon(a.role) }))
  const [input, setInput] = useState('')
  const [cmdMode, setCmdMode] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSend() {
    const text = input.trim()
    if (!text || disabled) return
    const final = cmdMode ? `/cmd ${text}` : text
    setInput(''); setShowMentions(false)
    onSend(final)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (showMentions) {
      if (e.key === 'Escape') { e.stopPropagation(); setShowMentions(false); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); return }
      if (e.key === 'Enter') { e.preventDefault(); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  function handleInput(val: string) {
    setInput(val)
    const cursorPos = textareaRef.current?.selectionStart || val.length
    const beforeCursor = val.slice(0, cursorPos)
    const lastAt = beforeCursor.lastIndexOf('@')

    if (lastAt >= 0) {
      // Check if @ is at a word boundary or start of input
      const charBefore = lastAt > 0 ? val[lastAt - 1] : ' '
      if (charBefore === ' ' || charBefore === '\n' || lastAt === 0) {
        const afterAt = beforeCursor.slice(lastAt + 1)
        // Only show if we're still typing the name (no space after @)
        if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
          setMentionFilter(afterAt.toLowerCase())
          setShowMentions(true)
          return
        }
      }
    }
    setShowMentions(false)
  }

  function insertMention(name: string) {
    const cursorPos = textareaRef.current?.selectionStart || input.length
    const beforeCursor = input.slice(0, cursorPos)
    const lastAt = beforeCursor.lastIndexOf('@')
    const before = input.slice(0, lastAt)
    const after = input.slice(cursorPos)
    setInput(`${before}@${name} ${after}`)
    setShowMentions(false)
    textareaRef.current?.focus()
  }

  const filtered = AGENTS.filter(a =>
    !mentionFilter || a.name.toLowerCase().includes(mentionFilter) || a.role.includes(mentionFilter)
  )

  return (
    <div className="input-box" style={{ position: 'relative' }}>
      {showMentions && (
        <div className="mention-dropdown">
          {filtered.length > 0 ? filtered.map(a => (
            <div key={a.name} className="mention-item" onMouseDown={(e) => { e.preventDefault(); insertMention(a.name) }}>
              <span className="mention-icon">{a.icon}</span>
              <span className="mention-name">{a.name}</span>
              <span className="mention-role">{a.role}</span>
            </div>
          )) : (
            <div className="mention-item" style={{ color: '#888' }}>无匹配角色</div>
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        className="input-textarea"
        value={input}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={cmdMode ? '输入 CLI 命令...' : disabled ? '请先选择一个项目...' : '@角色 安排任务，Enter 发送...'}
        rows={2}
        disabled={disabled && !cmdMode}
      />
      <div className="input-actions">
        <button className={`btn-mode ${cmdMode ? 'active' : ''}`} onClick={() => setCmdMode(!cmdMode)}>
          {cmdMode ? '💬 Chat' : '⚡ /cmd'}
        </button>
        {isRunning && <button className="btn-stop" onClick={onStop}>⏹ 停止</button>}
        <button className="btn-send" onClick={handleSend} disabled={(disabled && !cmdMode) || !input.trim()}>发送 →</button>
      </div>
    </div>
  )
}
