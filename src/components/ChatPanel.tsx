import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react'
import { ChatMessage, ClaudeAssistantEvent, ClaudeResultEvent, ToolCall } from '../types/claude'
import type { ImageAttachment } from '../types/claude'
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
  // ── 群聊扩展 ──
  groupChatMode,
  onGroupChatModeChange,
  team,
  onAgentSendGroup,
  // ── 会话管理 ──
  sessionName,
  onMessageSent,
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
  // ── 群聊扩展 ──
  groupChatMode?: boolean
  onGroupChatModeChange?: (v: boolean) => void
  team?: Array<{ agentId: string; name: string; role: string; agentType: string; icon: string; color: string }>
  onAgentSendGroup?: (content: string, targets: string[]) => void
  // ── 会话管理 ──
  sessionName?: string
  onMessageSent?: (sessionId: string, content: string) => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [pendingTools, setPendingTools] = useState<Map<string, ToolCall>>(new Map())
  const assistantMessageRef = useRef<ChatMessage | null>(null)
  const thinkingRef = useRef('')
  const streamingTextRef = useRef(streamingText)
  const userHasSentRef = useRef(false)  // 用户至少发过一条消息后置 true，防止终端历史回放污染 Chat
  const [isRunning, setIsRunning] = useState(false)
  const [connectionError, setConnectionError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected')

  // ── 多智能体流式状态 ──
  const [agentStreams, setAgentStreams] = useState<Map<string, { text: string; thinking: string }>>(new Map())
  const agentStreamsRef = useRef(agentStreams)
  agentStreamsRef.current = agentStreams
  // Refs for group chat — avoid stale closure in handleSend callback
  const groupChatModeRef = useRef(groupChatMode)
  groupChatModeRef.current = groupChatMode
  const onAgentSendGroupRef = useRef(onAgentSendGroup)
  onAgentSendGroupRef.current = onAgentSendGroup
  // 追踪是否使用终端路由（终端 Claude 交互模式不会退出，result 事件后不应设 isRunning=false）
  const useTerminalRouteRef = useRef(false)

  // 会话名由 App.tsx 管理，这里只读

  // Keep refs in sync for event handlers to avoid stale closure
  streamingTextRef.current = streamingText
  const onMessagesChangeRef = useRef(onMessagesChange)
  onMessagesChangeRef.current = onMessagesChange
  const onStreamingTextRef = useRef(onStreamingText)
  onStreamingTextRef.current = onStreamingText
  const onClaudeRunningRef = useRef(onClaudeRunning)
  onClaudeRunningRef.current = onClaudeRunning
  const onClaudeConnectedRef = useRef(onClaudeConnected)
  onClaudeConnectedRef.current = onClaudeConnected
  const onStatusInfoRef = useRef(onStatusInfo)
  onStatusInfoRef.current = onStatusInfo
  const onTerminalSendRef = useRef(onTerminalSend)
  onTerminalSendRef.current = onTerminalSend
  const terminalClaudeRunningRef = useRef(terminalClaudeRunning)
  terminalClaudeRunningRef.current = terminalClaudeRunning
  const finalizingRef = useRef(false)

  // 滚动到底部
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingText])

  // 监听 Claude 事件 — 通过 ref 避免闭包过期
  useEffect(() => {
    const unsubEvent = window.electronAPI.onClaudeEvent((event) => {
      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') {
            window.electronAPI.approvalLog?.({ timestamp: new Date().toISOString(), question: `ChatPanel: system/init model=${event.model || '?'} session=${event.session_id?.slice(0,8) || '?'}`, optionChosen: '', auto: true })
            onClaudeConnectedRef.current(true)
            onStatusInfoRef.current({
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
      onClaudeRunningRef.current(false)
      onClaudeConnectedRef.current(false)
      setConnectionStatus('disconnected')
      if (code) setConnectionError(`进程退出 (exit code ${code})`)
      // 只在还有 streaming 消息时 finalize
      if (assistantMessageRef.current) {
        finalizeAssistantMessage()
      }
    })

    const unsubStatus = window.electronAPI.onClaudeStatusUpdate?.((status) => {
      setIsRunning(status.running)
      if (status.connected) {
        setConnectionStatus('connected')
        onClaudeConnectedRef.current(true)
        setConnectionError('')
      } else if (status.running) {
        setConnectionStatus('connecting')
      } else {
        setConnectionStatus('disconnected')
      }
      // 终端路由下：Claude 退出（claudeRunning=false）时应停止 isRunning 并 finalize
      if (useTerminalRouteRef.current && status.claudeRunning === false && status.running === true) {
        setIsRunning(false)
        if (assistantMessageRef.current) {
          finalizeAssistantMessage()
        }
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

    // ── 多智能体事件监听 ──
    const unsubAgentEvent = window.electronAPI.onAgentEvent?.((taggedEvent) => {
      const { agentId, agentType, agentName, type, subtype, message: evtMsg } = taggedEvent
      console.log('[ChatPanel] agentEvent:', agentId, agentName, type, subtype || '')

      switch (type) {
        case 'system':
          if (subtype === 'init') {
            console.log('[ChatPanel] agent init:', agentId, agentName)
            setIsRunning(true)
            onClaudeConnectedRef.current(true)
          }
          break
        case 'assistant':
          if (evtMsg?.content) {
            for (const block of evtMsg.content) {
              if (block.type === 'text' && block.text) {
                setAgentStreams(prev => {
                  const next = new Map(prev)
                  const cur = next.get(agentId) || { text: '', thinking: '' }
                  next.set(agentId, { ...cur, text: cur.text + block.text })
                  return next
                })
              }
              if (block.type === 'thinking' && block.thinking) {
                setAgentStreams(prev => {
                  const next = new Map(prev)
                  const cur = next.get(agentId) || { text: '', thinking: '' }
                  next.set(agentId, { ...cur, thinking: cur.thinking + block.thinking })
                  return next
                })
              }
            }
          }
          break
        case 'result':
          // Agent completed — finalize will be handled by agent:close
          break
      }
    })

    const unsubAgentClose = window.electronAPI.onAgentClose?.((data) => {
      const { agentId } = data
      console.log('[ChatPanel] agentClose:', agentId)
      // Finalize the agent's message — move streaming text to content
      const streamState = agentStreamsRef.current.get(agentId)
      if (streamState?.text) {
        onMessagesChangeRef.current(prev => prev.map(m => {
          if (m.agentId === agentId && m.isStreaming) {
            return {
              ...m,
              content: streamState.text,
              thinking: streamState.thinking || m.thinking,
              isStreaming: false,
            }
          }
          return m
        }))
      } else {
        // No text received — mark as done with error info if available
        const agentMsg = messages.find(m => m.agentId === agentId && m.isStreaming)
        const errorHint = agentStreamsRef.current.get(agentId)?.thinking || ''
        onMessagesChangeRef.current(prev => prev.map(m => {
          if (m.agentId === agentId && m.isStreaming) {
            return { ...m, content: m.content || `(无响应${errorHint ? ': ' + errorHint.slice(0, 100) : ''})`, isStreaming: false }
          }
          return m
        }))
      }
      // Clean up stream state
      setAgentStreams(prev => {
        const next = new Map(prev)
        next.delete(agentId)
        return next
      })
      // Check if all agents done
      const remainingStreams = [...agentStreamsRef.current.keys()].filter(k => k !== agentId)
      if (remainingStreams.length === 0) {
        setIsRunning(false)
        onClaudeRunningRef.current(false)
      }
    })

    // ── Agent stderr → show as agent error messages ──
    const unsubAgentStderr = window.electronAPI.onAgentStderr?.((data) => {
      setAgentStreams(prev => {
        const next = new Map(prev)
        const cur = next.get(data.agentId) || { text: '', thinking: '' }
        next.set(data.agentId, { ...cur, thinking: cur.thinking + '\n[stderr] ' + data.text })
        return next
      })
    })

    return () => {
      // 组件卸载前：封存正在流式输出的消息
      try {
        if (assistantMessageRef.current?.isStreaming) {
          const savedContent = (assistantMessageRef.current.content || '') + (streamingTextRef.current || '')
          onMessagesChangeRef.current(prev => prev.map(m => {
            if (m.id === assistantMessageRef.current?.id) {
              return { ...m, content: savedContent || '(中断)', isStreaming: false }
            }
            return m
          }))
          assistantMessageRef.current = null
        }
      } catch (e) {
        console.warn('[ChatPanel] cleanup error:', e)
      }
      unsubEvent()
      unsubClose()
      unsubStatus?.()
      unsubStderr()
      unsubAgentEvent?.()
      unsubAgentClose?.()
      unsubAgentStderr?.()
    }
  }, [])

  function handleAssistantEvent(event: ClaudeAssistantEvent) {
    const { message } = event
    if (!message?.content) {
      window.electronAPI.approvalLog?.({ timestamp: new Date().toISOString(), question: `ChatPanel: assistant no content`, optionChosen: '', auto: true })
      return
    }

    onClaudeConnectedRef.current(true)
    thinkingRef.current = ''

    // 用户尚未发送消息 → 跳过，防止终端启动时的 JSONL 历史回放污染 Chat 消息
    // 消息历史由 App.tsx 的 switchToSession / handleSelectProject 通过 getSessionTranscript 加载
    if (!userHasSentRef.current) {
      window.electronAPI.approvalLog?.({ timestamp: new Date().toISOString(), question: `ChatPanel: assistant BLOCKED (userHasSent=false) hasMsg=${!!assistantMessageRef.current}`, optionChosen: '', auto: true })
      return
    }

    // 诊断：统计收到的 text/thinking/tool_use 块
    let textBlocks = 0, thinkBlocks = 0, toolBlocks = 0
    for (const block of message.content) {
      if (block.type === 'text') textBlocks++
      else if (block.type === 'thinking') thinkBlocks++
      else if (block.type === 'tool_use') toolBlocks++
    }
    window.electronAPI.approvalLog?.({ timestamp: new Date().toISOString(), question: `ChatPanel: assistant processing text=${textBlocks} think=${thinkBlocks} tool=${toolBlocks} hasMsg=${!!assistantMessageRef.current}`, optionChosen: '', auto: true })

    // 如果终端发来事件但 chat 没有活跃 assistant 消息 → 自动创建（终端↔Chat 同步）
    if (!assistantMessageRef.current) {
      const autoMsg: ChatMessage = {
        id: 'a_' + Date.now(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        agentIcon: '🖥️',
        agentName: '终端 Claude',
      }
      assistantMessageRef.current = autoMsg
      onMessagesChangeRef.current(prev => [...prev, autoMsg])
    }

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
        // 关键修复：立即更新 ref，防止快速事件间覆盖
        const newText = streamingTextRef.current + text
        streamingTextRef.current = newText
        onStreamingTextRef.current(newText)
      }
    }

    // 更新状态栏 token 信息
    if (message.usage) {
      onStatusInfoRef.current({
        model: message.model || '',
        tokens: message.usage.input_tokens + message.usage.output_tokens,
        cost: 0,
      })
    }
  }

  function handleResultEvent(event: ClaudeResultEvent) {
    window.electronAPI.approvalLog?.({ timestamp: new Date().toISOString(), question: `ChatPanel: result hasMsg=${!!assistantMessageRef.current} finalizing=${finalizingRef.current}`, optionChosen: '', auto: true })
    onClaudeRunningRef.current(false)
    finalizeAssistantMessage()

    if (event.usage) {
      onStatusInfoRef.current({
        model: '',
        tokens: event.usage.input_tokens + event.usage.output_tokens,
        cost: event.total_cost_usd || 0,
      })
    }
  }

  function finalizeAssistantMessage() {
    // 防止 result 和 close 事件重复触发
    if (finalizingRef.current) return
    // 如果 assistantMessageRef 已被清空，说明已由前一次调用完成
    if (!assistantMessageRef.current) return
    finalizingRef.current = true

    const finalContent = (assistantMessageRef.current?.content || '') + (streamingTextRef.current || '')
    const finalTools = Array.from(pendingTools.values())
    // 保存消息 ID，防止在异步更新期间被清空
    const targetMsgId = assistantMessageRef.current.id

    if (finalContent || finalTools.length > 0) {
      onMessagesChangeRef.current(prev => {
        // 按 ID 精确查找流式消息（而非依赖数组末尾位置）
        // 修复：onTaskComplete 等回调可能在流式期间插入消息，lastIndex 不可靠
        const idx = prev.findIndex(m => m.id === targetMsgId)
        if (idx < 0) return prev
        const updated = [...prev]
        updated[idx] = {
          ...updated[idx],
          content: finalContent,
          thinking: thinkingRef.current,
          toolCalls: finalTools.length > 0 ? finalTools : undefined,
          isStreaming: false,
        }
        return updated
      })
    }

    onStreamingTextRef.current('')
    setPendingTools(new Map())
    assistantMessageRef.current = null
    thinkingRef.current = ''
    finalizingRef.current = false
  }

  // 发送消息 — Chat 模式：spawn claude -p；终端模式：写入 PTY
  const handleSend = useCallback(async (content: string, images?: ImageAttachment[]) => {
    if (!activeProject) {
      setConnectionError('请先选择一个项目')
      return
    }

    userHasSentRef.current = true

    if (!window.electronAPI) return

    // 关键修复：如果上一次助手回复还在流式输出中，先将其封存
    // 防止新的 handleSend 清空 streamingTextRef 导致之前的回复内容丢失
    if (assistantMessageRef.current && assistantMessageRef.current.isStreaming) {
      const savedContent = (assistantMessageRef.current.content || '') + (streamingTextRef.current || '')
      const savedTools = Array.from(pendingTools.values())
      const savedThinking = thinkingRef.current
      onMessagesChangeRef.current(prev => prev.map(m => {
        if (m.id === assistantMessageRef.current!.id) {
          return {
            ...m,
            content: savedContent || '(被新消息中断)',
            thinking: savedThinking,
            toolCalls: savedTools.length > 0 ? savedTools : undefined,
            isStreaming: false,
          }
        }
        return m
      }))
    }

    const isCmd = content.startsWith('/cmd ')
    const actualContent = isCmd ? content.slice(5) : content
    const mentionRegex = /@(\S+)/g
    const mentions = [...actualContent.matchAll(mentionRegex)].map(m => m[1])

    // ── 群聊模式：@mention 路由到多智能体 ──
    if (groupChatModeRef.current && mentions.length > 0 && onAgentSendGroupRef.current) {
      // 同步写入终端 PTY（如果终端在运行）
      const cleanForTerminal = actualContent.replace(/@\S+/g, '').trim()
      if (cleanForTerminal && onTerminalSend) {
        onTerminalSend(`[群聊] ${cleanForTerminal}\r`).catch(() => {})
      }
      onAgentSendGroupRef.current(content, mentions)
      return
    }

    // 通知 App 创建/命名会话
    if (sessionId) onMessageSent?.(sessionId, actualContent)

    // 通知办公室：@角色 → 实时更新员工状态
    mentions.forEach(name => onMentionAgent?.(name, content))

    // ── 图片处理：保存到项目临时目录，生成 @ 引用 ──
    let imageRefs = ''
    if (images && images.length > 0 && activeProject) {
      try {
        const result = await window.electronAPI.saveTempImages({
          projectPath: activeProject.path,
          images: images.map(img => ({ base64: img.base64, mediaType: img.mediaType })),
        })
        if (result.success && result.paths.length > 0) {
          imageRefs = result.paths.map(p => `@${p}`).join(' ') + ' '
        }
      } catch (_e) { /* 保存失败也继续发文本 */ }
    }

    // 移除 @mention 防止混淆 Claude（非群聊模式）
    const cleanContent = actualContent.replace(/@\S+/g, '').trim()
    const contentForClaude = imageRefs + (isCmd ? cleanContent : (mentions.length > 0 ? cleanContent : actualContent))

    // ── 主路径：claude:send spawn 路由（稳定可靠）──
    // 同时将消息回显到终端 PTY，使终端视图也能看到 Chat 活动
    useTerminalRouteRef.current = false
    try {

      const result = await window.electronAPI.claudeSend({
        content: contentForClaude,
        projectPath: activeProject.path,
        sessionId: sessionId,
        modelId: activeModelId || undefined,
        autoApproval: autoApproval ?? false,
      })
      if (!result?.success) {
        setConnectionError('Claude 发送失败')
        return
      }

      // 消息回显到终端 PTY（仅显示，终端 Claude 有自己的独立会话）
      if (terminalClaudeRunningRef.current && onTerminalSendRef.current) {
        try {
          // 使用 ANSI 标记+注释格式避免终端 Claude 误执行
          // \x1b[90m = 暗色文字，\x1b[0m = 重置，# 前缀 = 注释语义
          const echoLine = `\r\n\x1b[90m# [Chat] ${contentForClaude.replace(/\r?\n/g, ' ')}\x1b[0m\r\n`
          onTerminalSendRef.current(echoLine)
        } catch { /* 回显失败不影响 Chat 主流程 */ }
      }

      setIsRunning(true)
      setConnectionStatus('connecting')
      setConnectionError('')
      onClaudeRunning(true)
      onClaudeConnected(false)

      onStreamingText('')
      streamingTextRef.current = ''  // 同步重置 ref，防止首事件读到旧值
      setPendingTools(new Map())
      thinkingRef.current = ''
      finalizingRef.current = false

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
          content: isCmd ? `⚡ 命令: ${actualContent}` : (content || (images?.length ? '[图片消息]' : '')),
          timestamp: Date.now(),
          agentIcon: '👑',
          agentName: '控制人',
          images: images,
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
    onClaudeRunningRef.current(false)
    onClaudeConnectedRef.current(false)
    setConnectionStatus('disconnected')
    setConnectionError('')
    finalizeAssistantMessage()
  }, [])

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-project-name">
          {activeProject ? `📂 ${activeProject.name}` : '选择一个项目开始对话'}
        </span>
        {sessionName && <span className="chat-session-name" title={sessionName}>💬 {sessionName}</span>}
        {groupChatMode && <span className="chat-mode-badge">👥 群聊模式</span>}
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
              <button className="icon-btn" onClick={() => { onMessagesChange(() => []); onStreamingText(''); onSessionIdChange?.('session_' + Date.now().toString(36)) }} title="新建会话">+</button>
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

        {/* 流式 thinking — 实时展示 Claude 的思考过程 */}
        {thinkingRef.current && assistantMessageRef.current?.isStreaming && (
          <details className="streaming-thinking" open>
            <summary className="streaming-thinking-summary">💭 思考中...</summary>
            <div className="streaming-thinking-content">
              {thinkingRef.current}
              <span className="cursor-blink">▌</span>
            </div>
          </details>
        )}

        {/* 流式文本 */}
        {(streamingText || (assistantMessageRef.current?.isStreaming && !streamingText && !thinkingRef.current)) && (
          <div className="streaming-text">
            {streamingText || '思考中...'}
            <span className="cursor-blink">▌</span>
          </div>
        )}

        {/* 流式工具调用 */}
        {pendingTools.size > 0 && assistantMessageRef.current?.isStreaming && (
          <div className="streaming-tools">
            {Array.from(pendingTools.values()).map(tool => (
              <div key={tool.id} className="streaming-tool-card">
                <span className="streaming-tool-icon">🔧</span>
                <span className="streaming-tool-name">{tool.name}</span>
                {tool.isComplete ? <span className="streaming-tool-done">✅</span> : <span className="streaming-tool-spinner">⏳</span>}
              </div>
            ))}
          </div>
        )}

        {/* 多智能体流式文本 */}
        {Array.from(agentStreams.entries()).map(([agentId, state]) => {
          const agentMsg = messages.find(m => m.agentId === agentId && m.isStreaming)
          const agentColor = agentMsg?.agentColor || '#6c8cff'
          const agentIcon = agentMsg?.agentIcon || '🤖'
          const agentName = agentMsg?.agentName || agentId
          const hasError = state.thinking?.includes('[stderr]')
          return (
            <div key={agentId} className={`streaming-agent-block${hasError ? ' agent-error' : ''}`} style={{ borderLeftColor: hasError ? '#e05555' : agentColor }}>
              <span className="streaming-agent-label">{agentIcon} {agentName}</span>
              <div className="streaming-agent-text">
                {state.text || (hasError ? `⚠️ ${state.thinking.replace(/\[stderr\]/g, '').trim().slice(0, 200)}` : '思考中...')}
                {!hasError && <span className="cursor-blink">▌</span>}
              </div>
            </div>
          )
        })}

        <div ref={bottomRef} />
      </div>

      <InputBox
        onSend={handleSend}
        onStop={handleStop}
        disabled={!activeProject}
        isRunning={isRunning}
        team={team}
        groupChatMode={groupChatMode}
        onGroupChatModeChange={onGroupChatModeChange}
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
