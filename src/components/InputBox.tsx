import { useState, useRef, KeyboardEvent, useMemo, useEffect, ClipboardEvent } from 'react'
import type { ImageAttachment } from '../types/claude'

// ── Claude Code 斜杠命令 ──────────────────────────────
interface SlashCommand {
  cmd: string; desc: string; icon: string; category: string
}
const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/help',         desc: '查看帮助',              icon: '❓', category: '通用' },
  { cmd: '/clear',        desc: '清空对话',              icon: '🧹', category: '通用' },
  { cmd: '/compact',      desc: '压缩上下文',             icon: '📦', category: '通用' },
  { cmd: '/config',       desc: '配置设置',              icon: '⚙️', category: '通用' },
  { cmd: '/context',      desc: '查看当前上下文',         icon: '📊', category: '通用' },
  { cmd: '/cost',         desc: '查看 Token 费用',       icon: '💰', category: '通用' },
  { cmd: '/doctor',       desc: '系统健康检查',           icon: '🩺', category: '通用' },
  { cmd: '/statusline',   desc: '状态栏配置',            icon: '📌', category: '通用' },
  { cmd: '/theme',        desc: '主题设置',              icon: '🎨', category: '通用' },
  { cmd: '/output-style', desc: '输出样式',              icon: '📝', category: '通用' },
  { cmd: '/permissions',  desc: '权限设置',              icon: '🔐', category: '通用' },
  { cmd: '/memory',       desc: '记忆管理',              icon: '🧠', category: '通用' },
  { cmd: '/add-dir',      desc: '添加工作目录',           icon: '📁', category: '通用' },
  { cmd: '/update',       desc: '更新 CLI',              icon: '⬆️', category: '通用' },
  { cmd: '/ide',          desc: 'IDE 集成',              icon: '🖥️', category: '通用' },
  // 项目 & 代码
  { cmd: '/init',         desc: '初始化 CLAUDE.md',      icon: '📄', category: '项目' },
  { cmd: '/review',       desc: '审查 PR',               icon: '👀', category: '项目' },
  { cmd: '/code-review',  desc: '代码审查',               icon: '🔍', category: '项目' },
  { cmd: '/security-review', desc: '安全审查',            icon: '🛡️', category: '项目' },
  { cmd: '/simplify',     desc: '代码简化',               icon: '✨', category: '项目' },
  { cmd: '/verify',       desc: '验证改动',               icon: '✅', category: '项目' },
  { cmd: '/deep-research', desc: '深度调研',              icon: '🔬', category: '项目' },
  // 任务 & 工作流
  { cmd: '/tasks',        desc: '任务列表',              icon: '📋', category: '任务' },
  { cmd: '/todos',        desc: '待办事项',              icon: '☑️', category: '任务' },
  { cmd: '/workflows',    desc: '工作流管理',             icon: '⚡', category: '任务' },
  { cmd: '/loop',         desc: '循环执行',              icon: '🔄', category: '任务' },
  // 运行 & 终端
  { cmd: '/run',          desc: '启动应用',              icon: '🚀', category: '运行' },
  { cmd: '/bashes',       desc: 'Bash 历史',             icon: '💻', category: '运行' },
  { cmd: '/terminal-setup', desc: '终端配置',             icon: '🖥️', category: '运行' },
  // 智能体 & 工具
  { cmd: '/agents',       desc: '智能体管理',             icon: '🤖', category: '智能体' },
  { cmd: '/mcp',          desc: 'MCP 服务器',            icon: '🔌', category: '智能体' },
  { cmd: '/hooks',        desc: 'Hook 管理',             icon: '🪝', category: '智能体' },
  { cmd: '/claude-api',   desc: 'API 开发',              icon: '📡', category: '智能体' },
  { cmd: '/resume',       desc: '恢复会话',              icon: '▶️', category: '通用' },
  { cmd: '/keybindings-help', desc: '快捷键帮助',          icon: '⌨️', category: '通用' },
  { cmd: '/fewer-permission-prompts', desc: '减少权限提示', icon: '🔓', category: '通用' },
]

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
  groupChatMode, onGroupChatModeChange,
}: {
  onSend: (content: string, images?: ImageAttachment[]) => void; onStop: () => void; disabled: boolean; isRunning: boolean
  team?: Array<{ agentId: string; name: string; role: string; agentType: string; icon: string; color: string }>
  groupChatMode?: boolean
  onGroupChatModeChange?: (v: boolean) => void
}) {
  // Normalize team to AGENTS format (name, role, agentType, icon)
  const AGENTS = (team?.length ? team.map((t: any) => ({
    name: t.name, role: t.role, agentType: t.agentType, icon: t.icon || '👤',
  })) : [
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
  const [showCommands, setShowCommands] = useState(false)
  const [commandFilter, setCommandFilter] = useState('')
  const [selectedCmdIdx, setSelectedCmdIdx] = useState(0)
  const [pastedImages, setPastedImages] = useState<ImageAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭下拉框
  useEffect(() => {
    if (!showCommands && !showMentions) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (textareaRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setShowCommands(false)
      setShowMentions(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showCommands, showMentions])

  const filteredCommands = useMemo(() => {
    if (!commandFilter) return SLASH_COMMANDS
    const q = commandFilter.toLowerCase()
    return SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().includes(q) || c.desc.includes(q) || c.category.includes(q))
  }, [commandFilter])

  // 当 / 或 @ 被 Backspace 删除时自动关闭下拉框
  useEffect(() => {
    if (showCommands) {
      const cursorPos = textareaRef.current?.selectionStart ?? input.length
      const beforeCursor = input.slice(0, cursorPos)
      const lastSlash = beforeCursor.lastIndexOf('/')
      if (lastSlash < 0) { setShowCommands(false); return }
      const charBefore = lastSlash > 0 ? input[lastSlash - 1] : ' '
      const afterSlash = beforeCursor.slice(lastSlash + 1)
      if (afterSlash.includes(' ') || (lastSlash > 0 && input[lastSlash - 2] === ':' && input[lastSlash - 1] === '/')) {
        setShowCommands(false)
      }
    }
    if (showMentions) {
      const cursorPos = textareaRef.current?.selectionStart ?? input.length
      const beforeCursor = input.slice(0, cursorPos)
      const lastAt = beforeCursor.lastIndexOf('@')
      if (lastAt < 0) { setShowMentions(false); return }
      const charBefore = lastAt > 0 ? input[lastAt - 1] : ' '
      const afterAt = beforeCursor.slice(lastAt + 1)
      if (afterAt.includes(' ') || (charBefore !== ' ' && charBefore !== '\n' && lastAt !== 0)) {
        setShowMentions(false)
      }
    }
  }, [input])

  function handleSend() {
    const text = input.trim()
    if ((!text && pastedImages.length === 0) || disabled) return
    const final = cmdMode ? `/cmd ${text}` : text
    setInput(''); setShowMentions(false); setShowCommands(false)
    const imgs = pastedImages.length > 0 ? [...pastedImages] : undefined
    setPastedImages([])
    onSend(final || '描述这张图片', imgs)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (showCommands) {
      if (e.key === 'Escape') { e.stopPropagation(); setShowCommands(false); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedCmdIdx(i => Math.min(i + 1, filteredCommands.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedCmdIdx(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (filteredCommands[selectedCmdIdx]) {
          insertCommand(filteredCommands[selectedCmdIdx].cmd)
        }
        return
      }
    }
    if (showMentions) {
      if (e.key === 'Escape') { e.stopPropagation(); setShowMentions(false); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); return }
      if (e.key === 'Enter') { e.preventDefault(); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ── 剪贴板图片粘贴 ──────────────────────────────
  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()  // 阻止把图片二进制当文本粘贴
        const blob = item.getAsFile()
        if (!blob) continue
        const mediaType = item.type  // 'image/png', 'image/jpeg', etc.
        // 读取为 base64
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let j = 0; j < bytes.length; j++) {
          binary += String.fromCharCode(bytes[j])
        }
        const base64 = btoa(binary)
        const dataUrl = `data:${mediaType};base64,${base64}`
        setPastedImages(prev => [...prev, { base64, mediaType, dataUrl }])
        break  // 只处理第一张图片
      }
    }
  }

  function removeImage(index: number) {
    setPastedImages(prev => prev.filter((_, i) => i !== index))
  }

  function handleInput(val: string) {
    setInput(val)
    const cursorPos = textareaRef.current?.selectionStart || val.length
    const beforeCursor = val.slice(0, cursorPos)

    // 检查 / 命令触发
    const lastSlash = beforeCursor.lastIndexOf('/')
    if (lastSlash >= 0) {
      const charBefore = lastSlash > 0 ? val[lastSlash - 1] : ' '
      const isCmdStart = charBefore === ' ' || charBefore === '\n' || lastSlash === 0
      const afterSlash = beforeCursor.slice(lastSlash + 1)
      // 排除 URL 中的 / (如 http://)
      const isUrl = lastSlash > 0 && (val[lastSlash - 2] === ':' && val[lastSlash - 1] === '/' || val[lastSlash - 3] === ':' && val[lastSlash - 2] === '/' && val[lastSlash - 1] === '/')
      if (isCmdStart && !isUrl && !afterSlash.includes(' ') && !afterSlash.includes('\n')) {
        setCommandFilter(afterSlash.toLowerCase())
        setSelectedCmdIdx(0)
        setShowCommands(true)
        setShowMentions(false)
        return
      }
    }

    // 检查 @mention 触发
    const lastAt = beforeCursor.lastIndexOf('@')
    if (lastAt >= 0) {
      const charBefore = lastAt > 0 ? val[lastAt - 1] : ' '
      if (charBefore === ' ' || charBefore === '\n' || lastAt === 0) {
        const afterAt = beforeCursor.slice(lastAt + 1)
        if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
          setMentionFilter(afterAt.toLowerCase())
          setShowMentions(true)
          setShowCommands(false)
          return
        }
      }
    }

    setShowMentions(false)
    setShowCommands(false)
  }

  function insertCommand(cmd: string) {
    const cursorPos = textareaRef.current?.selectionStart || input.length
    const beforeCursor = input.slice(0, cursorPos)
    const lastSlash = beforeCursor.lastIndexOf('/')
    const before = input.slice(0, lastSlash)
    const after = input.slice(cursorPos)
    setInput(`${before}${cmd} ${after}`)
    setShowCommands(false)
    textareaRef.current?.focus()
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

  // 按分类分组命令
  const groupedCommands = useMemo(() => {
    const cats: Record<string, SlashCommand[]> = {}
    for (const c of filteredCommands) {
      if (!cats[c.category]) cats[c.category] = []
      cats[c.category].push(c)
    }
    return cats
  }, [filteredCommands])

  const categoryLabels: Record<string, string> = {
    '通用': '📌 通用',
    '项目': '📁 项目 & 代码',
    '任务': '📋 任务 & 工作流',
    '运行': '🚀 运行 & 终端',
    '智能体': '🤖 智能体 & 工具',
  }

  return (
    <div className="input-box" style={{ position: 'relative' }}>
      {/* 命令下拉 */}
      {showCommands && (
        <div className="mention-dropdown command-dropdown" ref={dropdownRef}>
          {filteredCommands.length > 0 ? (
            Object.entries(groupedCommands).map(([cat, cmds]) => (
              <div key={cat}>
                <div className="command-category-label">{categoryLabels[cat] || cat}</div>
                {cmds.map((c, i) => {
                  const globalIdx = filteredCommands.indexOf(c)
                  return (
                    <div
                      key={c.cmd}
                      className={`mention-item command-item ${globalIdx === selectedCmdIdx ? 'selected' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); insertCommand(c.cmd) }}
                    >
                      <span className="mention-icon">{c.icon}</span>
                      <span className="mention-name">{c.cmd}</span>
                      <span className="mention-role">{c.desc}</span>
                    </div>
                  )
                })}
              </div>
            ))
          ) : (
            <div className="mention-item" style={{ color: '#888' }}>无匹配命令</div>
          )}
        </div>
      )}

      {/* @mention 下拉 */}
      {showMentions && (
        <div className="mention-dropdown" ref={dropdownRef}>
          {/* @all 快捷选项 — 始终在第一项 */}
          {(!mentionFilter || 'all'.includes(mentionFilter) || '全员'.includes(mentionFilter)) && (
            <div className="mention-item mention-item-all" onMouseDown={(e) => { e.preventDefault(); insertMention('all') }}>
              <span className="mention-icon">📢</span>
              <span className="mention-name">@all</span>
              <span className="mention-role">通知全员</span>
            </div>
          )}
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
        onPaste={handlePaste}
        placeholder={cmdMode ? '输入 CLI 命令...' : disabled ? '请先选择一个项目...' : '/ 命令 @角色 安排任务，Ctrl+V 贴图，Enter 发送...'}
        rows={2}
        disabled={disabled && !cmdMode}
      />

      {/* 图片预览 */}
      {pastedImages.length > 0 && (
        <div className="image-preview-bar">
          {pastedImages.map((img, i) => (
            <div key={i} className="image-preview-item">
              <img src={img.dataUrl} alt={`截图 ${i + 1}`} className="image-preview-thumb" />
              <button className="image-preview-remove" onClick={() => removeImage(i)} title="移除图片">✕</button>
            </div>
          ))}
        </div>
      )}

      <div className="input-actions">
        <button className={`btn-mode ${cmdMode ? 'active' : ''}`} onClick={() => setCmdMode(!cmdMode)}>
          {cmdMode ? '💬 Chat' : '⚡ /cmd'}
        </button>
        {onGroupChatModeChange && (
          <button
            className={`btn-mode btn-group-chat ${groupChatMode ? 'active' : ''}`}
            onClick={() => onGroupChatModeChange(!groupChatMode)}
            title={groupChatMode ? '群聊模式：@多个智能体会依次回复' : '单聊模式：普通Claude对话'}
          >
            {groupChatMode ? '👥 群聊中' : '👤 单聊'}
          </button>
        )}
        {isRunning && <button className="btn-stop" onClick={onStop}>⏹ 停止</button>}
        <button className="btn-send" onClick={handleSend} disabled={(disabled && !cmdMode) || (!input.trim() && pastedImages.length === 0)}>发送 →</button>
      </div>
    </div>
  )
}
