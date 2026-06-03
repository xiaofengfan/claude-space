import { useState, useRef, useEffect, useCallback } from 'react'
import { ChatMessage, ClaudeAssistantEvent, ClaudeResultEvent, ToolCall } from '../types/claude'
import type { ModelConfigSafe } from '../types/settings'
import { MessageBubble } from './MessageBubble'

// ── 快捷操作预设 ──────────────────────────────────────────
const QUICK_ACTIONS = {
  commands: {
    label: '📖 命令指南',
    prompt: '请列出 Claude Code CLI 的常用命令和完整使用方法，按类别组织：斜杠命令（/help /clear /compact /config 等）、快捷键、配置选项（settings.json）、Hook 系统。每个命令简要说明用途和示例。',
  },
  docAnalysis: { label: '📄 文档分析', prompt: '' },
}

const DOC_ACTIONS = [
  { id: 'req-extract', label: '📋 提炼需求', prompt: '请分析以下项目文档，提炼出结构化的功能需求列表。对每个需求注明：功能点描述、优先级（P0/P1/P2）、验收标准、关联模块。输出格式为 Markdown 表格。' },
  { id: 'md-gen', label: '📝 MD生成', prompt: '请将以下内容整理成结构规范的 Markdown 文档。要求：合理的标题层级（h1-h4）、使用列表和表格组织信息、代码块标注语言类型、添加目录索引。' },
  { id: 'project-doc', label: '📂 项目文档', prompt: '请分析当前项目的文档结构。先使用 Glob 查找所有 .md 文件（CLAUDE.md、README.md 等），然后 Read 关键文件，总结：项目定位、技术架构、核心模块、开发规范。' },
  { id: 'upload', label: '📎 上传文档', prompt: '' },
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
  const [quickAction, setQuickAction] = useState<string>('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Refs to avoid stale closures
  const streamingTextRef = useRef('')
  const assistantMsgRef = useRef<ChatMessage | null>(null)
  const pendingToolsRef = useRef<Map<string, ToolCall>>(new Map())
  const thinkingRef = useRef('')

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  // Claude event listeners
  useEffect(() => {
    const unsubEvent = window.electronAPI?.onClaudeEvent?.((event) => {
      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') { setIsConnected(true); setError('') }
          break
        case 'assistant': handleAssistantEvent(event as ClaudeAssistantEvent); break
        case 'result': handleResultEvent(event as ClaudeResultEvent); break
      }
    })
    const unsubClose = window.electronAPI?.onClaudeClose?.((code) => {
      setIsRunning(false); setIsConnected(false)
      if (assistantMsgRef.current) finalizeMessage()
      if (code) setError(`进程退出 (exit ${code})`)
    })
    const unsubStatus = window.electronAPI?.onClaudeStatusUpdate?.((s) => {
      if (s.running) setIsRunning(true)
      if (s.connected) { setIsConnected(true); setError('') }
      if (s.error) setError(s.error)
    })
    const unsubStderr = window.electronAPI?.onClaudeStderr?.((t) => {
      setError(prev => prev ? prev + '\n' + t : t)
    })
    return () => { unsubEvent?.(); unsubClose?.(); unsubStatus?.(); unsubStderr?.() }
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

  // ── 公共发送逻辑 ──
  const doSend = useCallback(async (text: string) => {
    if (!text || isRunning) return
    setInput(''); setError(''); setQuickAction('')
    const userMsg: ChatMessage = { id: 'u_' + Date.now().toString(36), role: 'user', content: text, timestamp: Date.now(), agentIcon: '👑', agentName: '控制人' }
    const assistantMsg: ChatMessage = { id: 'a_' + Date.now().toString(36), role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true, agentIcon: '🤖', agentName: '助手' }
    assistantMsgRef.current = assistantMsg
    streamingTextRef.current = ''; pendingToolsRef.current = new Map(); thinkingRef.current = ''
    setMessages(prev => [...prev, userMsg, assistantMsg]); setStreamingText('')
    try {
      const result = await window.electronAPI?.claudeSend?.({ content: text, modelId: selectedModelId || undefined, projectPath: activeProjectPath, autoApproval: autoApproval ?? true })
      if (!result?.success) setError('发送失败')
    } catch (err: any) {
      setIsRunning(false); setError('错误: ' + (err.message || '未知'))
    }
  }, [isRunning, selectedModelId, autoApproval, activeProjectPath])

  // ── 快捷操作 ──
  const handleQuickAction = useCallback((actionId: string, presetPrompt: string) => {
    if (actionId === 'upload') {
      // 打开文件选择器
      window.electronAPI?.openFileDialog?.().then(async (result: any) => {
        if (result?.filePath) {
          const fileName = result.filePath.split(/[/\\]/).pop() || '文件'
          setInput(`请分析以下文件内容：\n\n[文件: ${fileName}]\n`)
          inputRef.current?.focus()
        }
      })
      setQuickAction('')
      return
    }
    if (presetPrompt) {
      setInput(presetPrompt)
      setQuickAction(actionId)
      inputRef.current?.focus()
    } else {
      setQuickAction(prev => prev === actionId ? '' : actionId)
    }
  }, [])

  // ── 快捷发送（直接发 preset prompt，不经过输入框） ──
  const handleQuickSend = useCallback((actionId: string, presetPrompt: string) => {
    doSend(presetPrompt)
    setQuickAction('')
  }, [doSend])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isRunning) return
    doSend(text)
  }, [input, isRunning, doSend])

  const handleStop = useCallback(async () => {
    await window.electronAPI?.stopClaude?.()
    setIsRunning(false); setIsConnected(false); finalizeMessage()
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }, [handleSend])

  return (
    <div className="assistant-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
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

      {/* Quick Actions */}
      <div className="assistant-actions">
        {Object.entries(QUICK_ACTIONS).map(([id, action]) => (
          <button
            key={id}
            className={`assistant-action-btn ${quickAction === id ? 'active' : ''}`}
            onClick={() => handleQuickAction(id, action.prompt)}
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* Doc Analysis Sub-menu */}
      {quickAction === 'doc-analysis' && (
        <div className="assistant-submenu">
          <span className="assistant-submenu-label">文档分析：</span>
          {DOC_ACTIONS.map(a => (
            <button
              key={a.id}
              className="assistant-submenu-btn"
              onClick={() => a.prompt ? handleQuickSend(a.id, a.prompt) : handleQuickAction(a.id, '')}
              title={a.prompt ? '直接发送预设指令' : '选择文件上传'}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="assistant-messages">
        {messages.length === 0 && !error && !streamingText && (
          <div className="assistant-welcome">
            <p>👋 我是 AI 助手，可以帮你处理文档和回答问题。</p>
            <p>使用上方快捷操作快速开始，或直接输入问题。</p>
            <div className="assistant-welcome-hints">
              <span>📖 命令指南 — 了解 Claude Code CLI</span>
              <span>📄 文档分析 — 提炼需求 / 生成 MD / 分析项目</span>
            </div>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
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

      {/* Input */}
      <div className="assistant-input-area">
        <textarea
          ref={inputRef}
          className="assistant-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={quickAction === 'doc-analysis' ? '选择上方文档分析操作，或输入文档内容...' : '输入问题或使用快捷操作...'}
          rows={2}
          disabled={isRunning}
        />
        <div className="assistant-input-actions">
          {isRunning ? (
            <button className="assistant-btn assistant-btn-stop" onClick={handleStop}>⏹ 停止</button>
          ) : (
            <button className="assistant-btn assistant-btn-send" onClick={handleSend} disabled={!input.trim()}>发送 →</button>
          )}
        </div>
      </div>
    </div>
  )
}
