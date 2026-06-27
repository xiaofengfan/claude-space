import { useState, useRef, useEffect, useCallback } from 'react'
import { ChatMessage, ClaudeAssistantEvent, ClaudeResultEvent, ToolCall, ImageAttachment } from '../types/claude'
import type { ModelConfigSafe } from '../types/settings'
import { MessageBubble } from './MessageBubble'

// ── Claude Code 全部命令 ──
const CLAUDE_COMMANDS = [
  { label: '/help', desc: '显示帮助信息', prompt: '请输出 Claude Code CLI 的完整帮助信息，列出所有可用命令及其用途' },
  { label: '/clear', desc: '清除当前会话', prompt: '请执行 /clear 清除当前会话的所有历史记录，重新开始' },
  { label: '/compact', desc: '压缩上下文节省 Tokens', prompt: '请执行 /compact 压缩对话上下文以释放 Tokens 空间' },
  { label: '/config', desc: '查看或修改配置', prompt: '请显示当前 Claude Code 配置信息，包括 settings.json 内容' },
  { label: '/review', desc: '审查代码变更', prompt: '请审查当前分支的代码变更，检查潜在问题' },
  { label: '/init', desc: '初始化 CLAUDE.md', prompt: '请执行 /init 初始化项目的 CLAUDE.md 配置文件' },
  { label: '/plan', desc: '进入计划模式', prompt: '请切换为计划模式（Plan Mode），先设计方案再实施' },
  { label: '/loop', desc: '循环执行任务', prompt: '请设置/loop 循环执行模式，持续监控和运行任务' },
  { label: '/summary', desc: '总结当前会话', prompt: '请总结当前会话的关键内容和已完成的各项工作' },
  { label: '/cost', desc: '查看 Token 消耗', prompt: '请显示当前会话的 Token 消耗统计和费用信息' },
  { label: '/doctor', desc: '诊断问题', prompt: '请运行 /doctor 诊断 Claude Code 环境配置和健康状态' },
  { label: '/memory', desc: '管理 AI 记忆', prompt: '请查看和管理 AI 记忆系统，列出当前所有记忆条目' },
]

const DOC_ANALYSIS = [
  { id: 'req-extract', label: '📋 提炼需求', desc: '从文档中提取结构化需求', prompt: '请分析以下文档内容，提炼出结构化的功能需求列表，按 P0/P1/P2 优先级排列：' },
  { id: 'md-gen', label: '📝 生成 MD', desc: '整理为 Markdown 文档', prompt: '请将以下内容整理为规范的 Markdown 文档，包含目录、表格、代码块：' },
  { id: 'summary', label: '📄 文档摘要', desc: '提取核心要点', prompt: '请对以下文档内容进行摘要总结，200 字以内提炼核心要点：' },
  { id: 'upload', label: '📎 上传文件', desc: '选择本地文件分析', prompt: '' },
]

const MEMORY_ACTIONS = [
  { id: 'extract', label: '提炼', desc: '提取关键信息和核心观点', prompt: '请分析以下 AI 记忆内容，提炼出关键信息和核心观点：' },
  { id: 'summarize', label: '总结', desc: '概括主要内容', prompt: '请对以下 AI 记忆内容进行总结，用简洁的语言概括核心内容：' },
  { id: 'deposit', label: '沉淀', desc: '形成可复用知识', prompt: '请基于以下 AI 记忆内容，沉淀出可复用的经验教训和最佳实践：' },
  { id: 'relate', label: '关联', desc: '建立知识网络', prompt: '请分析以下 AI 记忆内容，找出关联知识点，形成知识网络：' },
]

interface Props {
  theme: 'dark' | 'light'
  models?: ModelConfigSafe[]
  activeModelId?: string | null
  activeProjectPath?: string
  autoApproval?: boolean
}

export function AssistantPanel({ theme, models, activeModelId, activeProjectPath, autoApproval }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [input, setInput] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState('')
  const [selectedModelId, setSelectedModelId] = useState<string | null>(activeModelId || null)
  const [pastedImages, setPastedImages] = useState<ImageAttachment[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── 快捷操作状态 ──
  const [category, setCategory] = useState<'commands' | 'docs' | 'memory' | ''>('')
  const [memoryEntries, setMemoryEntries] = useState<{ name: string; description: string; fileName: string; type?: string }[]>([])
  const [selectedAction, setSelectedAction] = useState<string>('')
  const [selectedMemory, setSelectedMemory] = useState<string>('')
  const [previewText, setPreviewText] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  // Refs
  const streamingTextRef = useRef('')
  const assistantMsgRef = useRef<ChatMessage | null>(null)
  const pendingToolsRef = useRef<Map<string, ToolCall>>(new Map())
  const thinkingRef = useRef('')

  const ASSISTANT_SESSION = 'assistant'

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingText])

  // ── 独立会话事件监听 ──
  useEffect(() => {
    const unsubEvent = window.electronAPI?.onSessionEvent?.((data) => {
      if (data.sessionId !== ASSISTANT_SESSION) return
      const event = data
      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') { setIsConnected(true); setError('') }
          break
        case 'assistant': handleAssistantEvent(event as ClaudeAssistantEvent); break
        case 'result': handleResultEvent(event as ClaudeResultEvent); break
      }
    })
    const unsubClose = window.electronAPI?.onSessionClose?.((data) => {
      if (data.sessionId !== ASSISTANT_SESSION) return
      setIsRunning(false); setIsConnected(false)
      if (assistantMsgRef.current) finalizeMessage()
      if (data.code) setError(`进程退出 (exit ${data.code})`)
    })
    const unsubStatus = window.electronAPI?.onSessionStatus?.((s) => {
      if (s.sessionId !== ASSISTANT_SESSION) return
      if (s.running) setIsRunning(true)
      if (s.connected) { setIsConnected(true); setError('') }
      if (s.error) setError(s.error)
    })
    return () => { unsubEvent?.(); unsubClose?.(); unsubStatus?.() }
  }, [])

  useEffect(() => {
    window.electronAPI.memoryList().then(r => { if (r?.success) setMemoryEntries(r.entries) }).catch(() => {})
  }, [])

  function handleAssistantEvent(event: ClaudeAssistantEvent) {
    const { message } = event
    if (!message?.content) return
    setIsConnected(true)
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        streamingTextRef.current += block.text
        setStreamingText(streamingTextRef.current)
      }
      if (block.type === 'thinking' && block.thinking) thinkingRef.current += block.thinking
      if (block.type === 'tool_use') {
        pendingToolsRef.current.set(block.id!, { id: block.id!, name: block.name!, input: block.input || {}, isComplete: false })
      }
      if (block.type === 'tool_result' && block.id) {
        const t = pendingToolsRef.current.get(block.id)
        if (t) { t.isComplete = true; t.result = typeof block.content === 'string' ? block.content : JSON.stringify(block.content) }
      }
    }
  }

  function handleResultEvent(event: ClaudeResultEvent) {
    if (event.subtype === 'success') finalizeMessage()
  }

  function finalizeMessage() {
    const msg = assistantMsgRef.current
    if (!msg) return
    const content = (msg.content || '') + streamingTextRef.current
    const tools = Array.from(pendingToolsRef.current.values())
    const thinking = thinkingRef.current
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, content, thinking, toolCalls: tools.length ? tools : undefined, isStreaming: false } : m))
    streamingTextRef.current = ''; pendingToolsRef.current = new Map(); thinkingRef.current = ''
    assistantMsgRef.current = null; setStreamingText('')
  }

  // ── 发送 ──
  const doSend = useCallback(async (text: string) => {
    if (!text || isRunning) return
    setInput(''); setError(''); setShowPreview(false)
    const userMsg: ChatMessage = { id: 'u_' + Date.now().toString(36), role: 'user', content: text, timestamp: Date.now(), agentIcon: '👑', agentName: '控制人' }
    const assistantMsg: ChatMessage = { id: 'a_' + Date.now().toString(36), role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true, agentIcon: '🤖', agentName: '助手' }
    assistantMsgRef.current = assistantMsg
    streamingTextRef.current = ''; pendingToolsRef.current = new Map(); thinkingRef.current = ''

    // 图片处理：保存到项目临时目录
    let finalContent = text
    if (pastedImages.length > 0 && activeProjectPath) {
      try {
        const result = await window.electronAPI.saveTempImages({
          projectPath: activeProjectPath,
          images: pastedImages.map(img => ({ base64: img.base64, mediaType: img.mediaType })),
        })
        if (result.success && result.paths.length > 0) {
          const refs = result.paths.map(p => `@${p}`).join(' ')
          finalContent = text ? `${refs} ${text}` : refs
        }
      } catch { /* 继续 */ }
    }
    setPastedImages([])

    setMessages(prev => [...prev, userMsg, assistantMsg]); setStreamingText('')
    try {
      const result = await window.electronAPI?.claudeSend?.({ content: finalContent, sessionId: ASSISTANT_SESSION, modelId: selectedModelId || undefined, projectPath: activeProjectPath, autoApproval: autoApproval ?? true })
      if (!result?.success) setError('发送失败')
    } catch (err: any) {
      setIsRunning(false); setError('错误: ' + (err.message || '未知'))
    }
  }, [isRunning, selectedModelId, autoApproval, activeProjectPath, pastedImages])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if ((!text && pastedImages.length === 0) || isRunning) return
    doSend(text || '[图片消息]')
  }, [input, isRunning, doSend, pastedImages])

  const handleStop = useCallback(async () => {
    await window.electronAPI?.stopClaude?.()
    setIsRunning(false); setIsConnected(false); finalizeMessage()
  }, [])

  // ── 图片粘贴 ──
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue
        const mediaType = item.type
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j])
        const base64 = btoa(binary)
        const dataUrl = `data:${mediaType};base64,${base64}`
        setPastedImages(prev => [...prev, { base64, mediaType, dataUrl }])
        break
      }
    }
  }, [])

  function removeImage(index: number) {
    setPastedImages(prev => prev.filter((_, i) => i !== index))
  }

  // ── 文件上传 ──
  const handleFileUpload = useCallback(async () => {
    try {
      const result = await window.electronAPI.openFileDialog?.()
      if (result?.filePath) {
        const r = await window.electronAPI.readFile(result.filePath)
        const fileName = result.filePath.split(/[/\\]/).pop() || '文件'
        if (r?.success && r.content) {
          setInput(`请分析文件：${fileName}\n\n${r.content.slice(0, 6000)}${r.content.length > 6000 ? '\n...(内容过长已截断)' : ''}`)
        } else {
          setInput(`请分析文件：${fileName}\n\n(文件内容无法读取，可能是二进制文件)`)
        }
        inputRef.current?.focus()
      }
    } catch {}
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  // ── 快捷操作逻辑 ──
  function stripFrontmatter(content: string): string {
    return content.replace(/^---[\s\S]*?---\n*/m, '').trim()
  }

  function handleCategoryChange(val: string) {
    setCategory(val as 'commands' | 'docs' | 'memory' | '')
    setSelectedAction(''); setSelectedMemory(''); setPreviewText(''); setShowPreview(false)
  }

  async function handleSelectAction(actionId: string) {
    setSelectedAction(actionId); setPreviewText(''); setShowPreview(false)
    if (category === 'commands') {
      const cmd = CLAUDE_COMMANDS.find(c => c.label === actionId)
      if (cmd) { setPreviewText(cmd.prompt); setShowPreview(true) }
    } else if (category === 'docs') {
      if (actionId === 'upload') {
        try {
          const result = await window.electronAPI.openFileDialog?.()
          if (result?.filePath) {
            const fileName = result.filePath.split(/[/\\]/).pop() || '文件'
            const r = await window.electronAPI.readFile(result.filePath)
            const content = r?.success && r.content ? r.content.slice(0, 6000) : '(无法读取文件内容)'
            setPreviewText(`文件: ${fileName}\n\n${content}`); setShowPreview(true)
          }
        } catch {}
        return
      }
      const doc = DOC_ANALYSIS.find(a => a.id === actionId)
      if (doc) { setPreviewText(`${doc.prompt}\n\n[请在下方粘贴文档内容]`); setShowPreview(true) }
    } else if (category === 'memory') {}
  }

  function handleSelectMemory(fileName: string) {
    setSelectedMemory(fileName); setPreviewText(''); setShowPreview(false); setSelectedAction('')
  }

  async function handleSelectMemoryAction(actionId: string) {
    setSelectedAction(actionId)
    if (!selectedMemory) return
    try {
      const r = await window.electronAPI.memoryRead(selectedMemory)
      if (r?.success) {
        const memoryName = memoryEntries.find(e => e.fileName === selectedMemory)?.name || selectedMemory
        const act = MEMORY_ACTIONS.find(a => a.id === actionId)
        const c = stripFrontmatter(r.content).slice(0, 3000)
        setPreviewText(`${act?.prompt || '分析记忆'}\n\n记忆：${memoryName}\n\n${c}`); setShowPreview(true)
      }
    } catch {}
  }

  function handleApply() {
    if (!previewText) return
    const firstLine = previewText.split('\n').filter(l => l.trim())[0] || previewText
    setInput(firstLine.length > 180 ? firstLine.slice(0, 180) + '…' : firstLine)
    setShowPreview(false)
    inputRef.current?.focus()
  }

  function renderOptions() {
    if (category === 'commands') {
      return CLAUDE_COMMANDS.map(cmd => (
        <div key={cmd.label} className={`assistant-opt-item ${selectedAction === cmd.label ? 'selected' : ''}`} onClick={() => handleSelectAction(cmd.label)}>
          <span className="assistant-opt-label">{cmd.label}</span>
          <span className="assistant-opt-desc">{cmd.desc}</span>
        </div>
      ))
    }
    if (category === 'docs') {
      return DOC_ANALYSIS.map(doc => (
        <div key={doc.id} className={`assistant-opt-item ${selectedAction === doc.id ? 'selected' : ''}`} onClick={() => handleSelectAction(doc.id)}>
          <span className="assistant-opt-label">{doc.label}</span>
          <span className="assistant-opt-desc">{doc.desc}</span>
        </div>
      ))
    }
    if (category === 'memory') {
      if (memoryEntries.length === 0) return <p className="empty-hint" style={{ padding: 8 }}>暂无记忆记录</p>
      return (
        <>
          {!selectedMemory && memoryEntries.map(entry => (
            <div key={entry.fileName} className={`assistant-opt-item ${selectedMemory === entry.fileName ? 'selected' : ''}`} onClick={() => handleSelectMemory(entry.fileName)}>
              <span className="assistant-opt-label">{entry.type === 'project' ? '📁' : '📄'} {entry.name}</span>
              <span className="assistant-opt-desc">{entry.description}</span>
            </div>
          ))}
          {selectedMemory && (
            <>
              <div className="assistant-opt-back" onClick={() => { setSelectedMemory(''); setSelectedAction(''); setPreviewText(''); setShowPreview(false) }}>← 返回记忆列表</div>
              {MEMORY_ACTIONS.map(act => (
                <div key={act.id} className={`assistant-opt-item ${selectedAction === act.id ? 'selected' : ''}`} onClick={() => handleSelectMemoryAction(act.id)}>
                  <span className="assistant-opt-label">{act.label}</span>
                  <span className="assistant-opt-desc">{act.desc}</span>
                </div>
              ))}
            </>
          )}
        </>
      )
    }
    return null
  }

  return (
    <div className="assistant-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="assistant-header">
        <span className="assistant-title">🤖 AI 助手</span>
        {models && models.length > 0 && (
          <select className="assistant-model-select" value={selectedModelId || ''} onChange={e => setSelectedModelId(e.target.value || null)}>
            <option value="">跟随全局</option>
            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        <span className="assistant-status">{isRunning ? (isConnected ? '🟢' : '🟡') : '⚪'}</span>
      </div>

      <div className="assistant-messages">
        {messages.length === 0 && !error && !streamingText && (
          <div className="assistant-welcome">
            <p>👋 我是 AI 助手，支持粘贴截图、上传文件、分析记忆。</p>
            <div className="assistant-welcome-hints">
              <span>🖼️ 粘贴图片 — 截图直接粘贴到输入框</span>
              <span>📎 上传文件 — 点击输入框旁的 📂 选择文件</span>
              <span>⌨️ 快捷操作 — 选择底部下拉快速开始</span>
            </div>
          </div>
        )}
        {messages.map(msg => (<MessageBubble key={msg.id} message={msg} />))}
        {streamingText && (
          <div className="streaming-text" style={{ fontSize: 12, padding: '4px 8px' }}>
            {streamingText}<span className="cursor-blink">▌</span>
          </div>
        )}
        {error && (
          <div className="assistant-error">{error}
            <button onClick={() => setError('')} className="assistant-error-dismiss">✕</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── 底部快捷操作 ── */}
      <div className="assistant-quick-bar">
        {showPreview && previewText && (
          <div className="assistant-quick-preview">
            <pre className="assistant-quick-preview-text">{previewText.slice(0, 500)}{previewText.length > 500 ? '…' : ''}</pre>
            <div className="assistant-quick-preview-actions">
              <button className="assistant-btn assistant-btn-apply" onClick={handleApply}>✓ 应用到输入框</button>
              <button className="assistant-btn assistant-btn-cancel-quick" onClick={() => setShowPreview(false)}>取消</button>
            </div>
          </div>
        )}
        {category && (
          <div className="assistant-quick-options">{renderOptions()}</div>
        )}
        <div className="assistant-quick-select-row">
          <select className="assistant-quick-select" value={category} onChange={e => handleCategoryChange(e.target.value)}>
            <option value="">-- 选择快捷操作 --</option>
            <option value="commands">⌨️ Claude 命令</option>
            <option value="docs">📄 文档分析</option>
            <option value="memory">🧠 AI 记忆库</option>
          </select>
        </div>
      </div>

      {/* ── 输入区（支持图片粘贴和文件上传） ── */}
      <div className="assistant-input-area">
        {pastedImages.length > 0 && (
          <div className="image-preview-bar" style={{ paddingBottom: 4 }}>
            {pastedImages.map((img, i) => (
              <div key={i} className="image-preview-item">
                <img src={img.dataUrl} alt={`粘贴 ${i + 1}`} className="image-preview-thumb" />
                <button className="image-preview-remove" onClick={() => removeImage(i)}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
          <button className="assistant-file-btn" onClick={handleFileUpload} title="上传文件">📂</button>
          <textarea
            ref={inputRef}
            className="assistant-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder="输入问题，粘贴图片，或选择底部快捷操作..."
            rows={2}
            disabled={isRunning}
          />
        </div>
        <div className="assistant-input-actions">
          {isRunning ? (
            <button className="assistant-btn assistant-btn-stop" onClick={handleStop}>⏹ 停止</button>
          ) : (
            <button className="assistant-btn assistant-btn-send" onClick={handleSend} disabled={!input.trim() && pastedImages.length === 0}>发送 →</button>
          )}
        </div>
      </div>
    </div>
  )
}
