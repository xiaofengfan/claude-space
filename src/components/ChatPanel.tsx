import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { ChatMessage, ClaudeAssistantEvent, ClaudeResultEvent, ToolCall } from '../types/claude'
import type { ModelConfigSafe } from '../types/settings'
import { MessageBubble } from './MessageBubble'
import { InputBox } from './InputBox'

export const ChatPanel = forwardRef(function ChatPanel({
  messages,
  streamingText,
  activeProject,
  onMessagesChange,
  onStreamingText,
  onClaudeRunning,
  onClaudeConnected,
  onStatusInfo,
  sessions,
  models,
  activeModelId,
  onModelChange,
  sessionId,
  onSessionIdChange,
  onSelectSession,
  terminalMode,
  onTerminalSend,
  terminalClaudeRunning,
  onLaunchClaudeForChat,
  autoApproval,
  onAutoApprovalChange,
  onMentionAgent,
}: {
  messages: ChatMessage[]
  streamingText: string
  activeProject: { name: string; path: string } | null
  onMessagesChange: (cb: (prev: ChatMessage[]) => ChatMessage[]) => void
  onStreamingText: (text: string) => void
  onClaudeRunning: (v: boolean) => void
  onClaudeConnected: (v: boolean) => void
  onStatusInfo: (info: { model: string; tokens: number; cost: number }) => void
  sessions?: { sessionId: string; modifiedAt: string }[]
  models?: ModelConfigSafe[]
  activeModelId?: string | null
  onModelChange?: (modelId: string) => void
  sessionId?: string
  onSessionIdChange?: (sessionId: string | undefined) => void
  onSelectSession?: (sessionId: string) => void
  terminalMode?: boolean
  onTerminalSend?: (content: string) => Promise<void>
  terminalClaudeRunning?: boolean
  onLaunchClaudeForChat?: () => Promise<void>
  autoApproval?: boolean
  onAutoApprovalChange?: (v: boolean) => void
  onMentionAgent?: (agentName: string, content: string) => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [pendingTools, setPendingTools] = useState<Map<string, ToolCall>>(new Map())
  const assistantMessageRef = useRef<ChatMessage | null>(null)
  const thinkingRef = useRef('')
  const streamingTextRef = useRef(streamingText)
  const [isRunning, setIsRunning] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')

  // Keep refs in sync with props for event handlers (avoid stale closure)
  streamingTextRef.current = streamingText

  // 滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  // 监听 Claude 事件
  useEffect(() => {
    const unsubEvent = window.electronAPI.onClaudeEvent((event) => {
      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') {
            onClaudeConnected(true)
            onStatusInfo({
              model: event.model || '',
              tokens: 0,
              cost: 0,
            })
          }
          break

        case 'assistant':
          handleAssistantEvent(event as ClaudeAssistantEvent)
          break

        case 'result':
          handleResultEvent(event as ClaudeResultEvent)
          break

        case 'user':
          // replay-user-messages 回显
          break
      }
    })

    const unsubClose = window.electronAPI.onClaudeClose((code) => {
      setIsRunning(false)
      onClaudeRunning(false)
      onClaudeConnected(false)
      setConnectionStatus('disconnected')
      if (code) setConnectionError(`进程退出 (exit code ${code})`)
      if (assistantMessageRef.current) {
        finalizeAssistantMessage()
      }
    })

    const unsubStatus = window.electronAPI.onClaudeStatusUpdate?.((status) => {
      setIsRunning(status.running)
      if (status.connected) {
        setConnectionStatus('connected')
        onClaudeConnected(true)
        setConnectionError('')
      } else if (status.running) {
        setConnectionStatus('connecting')
      } else {
        setConnectionStatus('disconnected')
      }
      if (status.error) {
        setConnectionError(status.error)
        if (!status.connected) setConnectionStatus('error')
      }
    })

    const unsubStderr = window.electronAPI.onClaudeStderr((text) => {
      setConnectionError(prev => prev ? prev + '\n' + text : text)
      setConnectionStatus('error')
    })

    return () => {
      unsubEvent()
      unsubClose()
      unsubStatus?.()
      unsubStderr()
    }
  }, [])

  function handleAssistantEvent(event: ClaudeAssistantEvent) {
    const { message } = event
    if (!message?.content) return

    onClaudeConnected(true)
    thinkingRef.current = ''

    for (const block of message.content) {
      if (block.type === 'thinking') {
        thinkingRef.current += (block.thinking || '')
        continue
      }

      if (block.type === 'tool_use') {
        const tool: ToolCall = {
          id: block.id || Date.now().toString(),
          name: block.name || 'unknown',
          input: block.input || {},
          isComplete: false,
        }
        setPendingTools(prev => new Map(prev).set(tool.id, tool))
        continue
      }

      if (block.type === 'tool_result') {
        // tool_use 的 id 在 result 的 tool_use_id 里
        const toolUseId = (block as any).tool_use_id
        if (toolUseId) {
          setPendingTools(prev => {
            const next = new Map(prev)
            const existing = next.get(toolUseId)
            if (existing) {
              next.set(toolUseId, {
                ...existing,
                result: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
                isComplete: true,
              })
            }
            return next
          })
        }
        continue
      }

      if (block.type === 'text') {
        const text = block.text || ''
        onStreamingText(prev => prev + text)
      }
    }

    // 更新状态栏 token 信息
    if (message.usage) {
      onStatusInfo({
        model: message.model || '',
        tokens: message.usage.input_tokens + message.usage.output_tokens,
        cost: 0,
      })
    }
  }

  function handleResultEvent(event: ClaudeResultEvent) {
    onClaudeRunning(false)
    finalizeAssistantMessage()

    if (event.usage) {
      onStatusInfo({
        model: '',
        tokens: event.usage.input_tokens + event.usage.output_tokens,
        cost: event.total_cost_usd || 0,
      })
    }
  }

  function finalizeAssistantMessage() {
    const finalContent = (assistantMessageRef.current?.content || '') + (streamingTextRef.current || '')
    const finalTools = Array.from(pendingTools.values())

    if (finalContent || finalTools.length > 0) {
      onMessagesChange(prev => {
        const updated = [...prev]
        const lastMsg = updated[updated.length - 1]
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
          updated[updated.length - 1] = {
            ...lastMsg,
            content: finalContent,
            thinking: thinkingRef.current,
            toolCalls: finalTools,
            isStreaming: false,
          }
          return updated
        }
        return prev
      })
    }

    onStreamingText('')
    setPendingTools(new Map())
    assistantMessageRef.current = null
    thinkingRef.current = ''
  }

  // 发送消息 — Chat 模式：spawn claude -p；终端模式：写入 PTY
  const handleSend = useCallback(async (content: string) => {
    if (!activeProject) {
      setConnectionError('请先选择一个项目')
      return
    }

    if (!window.electronAPI) return

    const isCmd = content.startsWith('/cmd ')
    const actualContent = isCmd ? content.slice(5) : content
    const mentionRegex = /@(\S+)/g
    const mentions = [...actualContent.matchAll(mentionRegex)].map(m => m[1])
    // 通知办公室：@角色 → 实时更新员工状态
    mentions.forEach(name => onMentionAgent?.(name, content))

    // ── 终端模式：写入 PTY，不 spawn 新进程 ──
    if (terminalMode && onTerminalSend) {
      try {
        // 如果 Claude 还没启动，先自动启动
        if (!terminalClaudeRunning && onLaunchClaudeForChat) {
          await onLaunchClaudeForChat()
          // 给 Claude 一点启动时间
          await new Promise(r => setTimeout(r, 1500))
        }

        // 写入 PTY（等同于在终端里打字回车）
        await onTerminalSend(actualContent + '\n')

        // Chat 面板的 UI 状态由 terminal status / claude:event 事件驱动
        // 先创建用户消息 + 占位 assistant 消息
        onStreamingText('')
        setPendingTools(new Map())
        thinkingRef.current = ''

        const assistantMsg: ChatMessage = {
          id: 'a_' + Date.now(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
          agentIcon: mentions.length > 0 ? '👤' : '🤖',
          agentName: mentions.length > 0 ? mentions.join(', ') : 'Claude',
        }
        assistantMessageRef.current = assistantMsg

        onMessagesChange(prev => [
          ...prev,
          {
            id: 'u_' + Date.now(),
            role: 'user',
            content: isCmd ? `⚡ 命令: ${actualContent}` : content,
            timestamp: Date.now(),
            agentIcon: '👑',
            agentName: '控制人',
          },
          assistantMsg,
        ])
        return
      } catch (err: any) {
        setConnectionError('终端发送失败: ' + (err.message || '未知错误'))
        return
      }
    }

    // ── Chat 模式：spawn claude -p ──
    try {
      const result = await window.electronAPI.claudeSend({
        content: actualContent,
        projectPath: activeProject.path,
        sessionId: sessionId,
        modelId: activeModelId || undefined,
        autoApproval: autoApproval ?? false,
      })
      if (!result?.success) {
        setConnectionError('Claude 发送失败')
        return
      }
      setIsRunning(true)
      setConnectionStatus('connecting')
      setConnectionError('')
      onClaudeRunning(true)
      onClaudeConnected(false)

      onStreamingText('')
      setPendingTools(new Map())
      thinkingRef.current = ''

      const assistantMsg: ChatMessage = {
        id: 'a_' + Date.now(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        agentIcon: mentions.length > 0 ? '👤' : '🤖',
        agentName: mentions.length > 0 ? mentions.join(', ') : 'Claude',
      }
      assistantMessageRef.current = assistantMsg

      onMessagesChange(prev => [
        ...prev,
        {
          id: 'u_' + Date.now(),
          role: 'user',
          content: isCmd ? `⚡ 命令: ${actualContent}` : content,
          timestamp: Date.now(),
          agentIcon: '👑',
          agentName: '控制人',
        },
        assistantMsg,
      ])

    } catch (err: any) {
      setIsRunning(false)
      onClaudeRunning(false)
      setConnectionStatus('error')
      setConnectionError('启动 Claude 失败: ' + (err.message || '未知错误'))
    }
  }, [activeProject, activeModelId, sessionId, terminalMode, terminalClaudeRunning, onTerminalSend, onLaunchClaudeForChat, onClaudeRunning, onClaudeConnected, onMessagesChange, onStreamingText, autoApproval])

  const handleStop = useCallback(async () => {
    await window.electronAPI.stopClaude()
    setIsRunning(false)
    onClaudeRunning(false)
    onClaudeConnected(false)
    setConnectionStatus('disconnected')
    setConnectionError('')
    finalizeAssistantMessage()
  }, [pendingTools])

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-project-name">
          {activeProject ? `📂 ${activeProject.name}` : '选择一个项目开始对话'}
        </span>
        {connectionStatus === 'connecting' && !connectionError && (
          <div className="chat-connection-connecting">
            <span className="dot-pulse" /> 连接中...
          </div>
        )}
        {connectionStatus === 'connected' && (
          <div className="chat-connection-connected">🟢 已连接</div>
        )}
        {connectionError && (
          <div className="chat-connection-error">
            <span className="chat-error-text" onClick={() => setConnectionError('')}>
              ⚠️ {connectionError.length > 100 ? connectionError.slice(0, 100) + '...' : connectionError}
            </span>
            <button className="chat-error-action" onClick={async () => {
              await window.electronAPI.openInTerminal?.(activeProject?.path || '')
            }} title="在系统终端中启动 Claude">
              🖥️ 终端启动
            </button>
            <span className="chat-error-dismiss" onClick={() => setConnectionError('')}>✕</span>
          </div>
        )}
        <div className="chat-header-right">
          {activeProject && models && models.length > 0 && (
            <div className="chat-model-selector">
              <span className="chat-session-label">🤖 模型:</span>
              <select
                className="chat-model-select"
                value={activeModelId || ''}
                onChange={(e) => onModelChange?.(e.target.value)}
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.provider} · {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {activeProject && sessions && (
            <div className="chat-session-selector">
              <span className="chat-session-label">💬 会话:</span>
              <select
                className="chat-session-select"
                onChange={(e) => {
                  const sid = e.target.value
                  onSelectSession?.(sid)
                  onSessionIdChange?.(sid)
                }}
                defaultValue=""
              >
                <option value="" disabled>选择历史会话...</option>
                {sessions.map(s => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {s.sessionId.slice(0, 8)}... ({new Date(s.modifiedAt).toLocaleDateString('zh-CN')})
                  </option>
                ))}
              </select>
              <button className="icon-btn" onClick={() => { onMessagesChange(() => []); onStreamingText(''); onSessionIdChange?.(undefined) }} title="新建会话">+</button>
            </div>
          )}
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && !activeProject && (
          <div className="chat-welcome">
            <h2>👋 欢迎使用 Claude Space</h2>
            <p>从左侧选择一个项目，然后开始与 Claude Code 对话。</p>
            <p>Claude 将会以该项目作为工作目录，可以：</p>
            <ul>
              <li>🔍 浏览和分析代码</li>
              <li>✏️ 编辑和重构文件</li>
              <li>🚀 执行命令和运行测试</li>
              <li>🤖 使用多智能体工作流</li>
            </ul>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* 流式文本 */}
        {streamingText && (
          <div className="streaming-text">
            {streamingText}
            <span className="cursor-blink">▌</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <InputBox
        onSend={handleSend}
        onStop={handleStop}
        disabled={!activeProject}
        isRunning={isRunning}
        team={undefined}
      />

      {/* 快捷审批开关 */}
      {activeProject && onAutoApprovalChange && (
        <div className="chat-auto-approval">
          <label className="chat-auto-approval-label">
            <input
              type="checkbox"
              checked={autoApproval ?? false}
              onChange={(e) => onAutoApprovalChange(e.target.checked)}
            />
            <span>自动审批</span>
          </label>
          <span className="chat-auto-approval-hint">
            {autoApproval ? '审批自动通过，不弹窗' : '审批时弹窗确认'}
          </span>
        </div>
      )}
    </div>
  )
})
