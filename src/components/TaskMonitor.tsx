import { useEffect, useState } from 'react'

interface MonitorEvent {
  id: string
  type: 'task_create' | 'task_update' | 'agent_start' | 'agent_done' | 'tool_use' | 'workflow' | 'approval'
  title: string
  detail: string
  status: 'running' | 'completed' | 'error' | 'pending'
  timestamp: number
}

export function TaskMonitor({
  embedded,
  events: externalEvents,
}: {
  visible?: boolean
  onClose?: () => void
  embedded?: boolean
  events?: MonitorEvent[]
}) {
  const [monitorEvents, setMonitorEvents] = useState<MonitorEvent[]>([])
  const [stats, setStats] = useState({ total: 0, completed: 0, running: 0 })

  // 通过 props 接收事件，不使用独立订阅（避免重复监听）
  useEffect(() => {
    if (externalEvents && externalEvents.length > 0) {
      setMonitorEvents(prev => {
        const next = [...externalEvents, ...prev].slice(0, 50)
        setStats({
          total: next.length,
          completed: next.filter(e => e.status === 'completed').length,
          running: next.filter(e => e.status === 'running').length,
        })
        return next
      })
    }
  }, [externalEvents])

  // Fallback: 如果没有外部事件源，保持独立监听（兼容旧调用）
  useEffect(() => {
    if (externalEvents !== undefined) return // Already handled above
    const unsub = window.electronAPI.onClaudeEvent((event: any) => {
      if (event.type === 'assistant' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type !== 'tool_use') continue

          const toolName = block.name || 'unknown'
          const toolId = block.id || Date.now().toString()

          let evt: MonitorEvent | null = null

          switch (toolName) {
            case 'TaskCreate':
              evt = {
                id: toolId, type: 'task_create',
                title: `📋 ${block.input?.subject || block.input?.title || '新任务'}`,
                detail: (block.input?.description || '').slice(0, 80),
                status: 'running', timestamp: Date.now(),
              }
              break
            case 'TaskUpdate':
              evt = {
                id: toolId, type: 'task_update',
                title: `📌 更新任务`,
                detail: `→ ${block.input?.status || '更新'}`,
                status: 'completed', timestamp: Date.now(),
              }
              break
            case 'AskUserQuestion':
              evt = {
                id: toolId, type: 'approval',
                title: `🔔 需要审批`,
                detail: block.input?.questions?.[0]?.question?.slice(0, 60) || '请选择',
                status: 'pending', timestamp: Date.now(),
              }
              break
            case 'Bash':
              evt = {
                id: toolId, type: 'tool_use',
                title: `💻 执行命令`,
                detail: (block.input?.command || '').slice(0, 80),
                status: 'running', timestamp: Date.now(),
              }
              break
            case 'Write':
            case 'Edit':
              evt = {
                id: toolId, type: 'tool_use',
                title: `${toolName === 'Write' ? '📝' : '✏️'} ${toolName}`,
                detail: block.input?.file_path || '',
                status: 'completed', timestamp: Date.now(),
              }
              break
            case 'Workflow':
              evt = {
                id: toolId, type: 'workflow',
                title: `⚙️ Workflow`,
                detail: block.input?.description?.slice(0, 60) || '多智能体编排',
                status: 'running', timestamp: Date.now(),
              }
              break
            case 'Agent':
              evt = {
                id: toolId, type: 'agent_start',
                title: `🤖 Agent`,
                detail: `${block.input?.subagent_type || 'general-purpose'}: ${(block.input?.description || '').slice(0, 40)}`,
                status: 'running', timestamp: Date.now(),
              }
              break
          }

          if (evt) {
            setMonitorEvents(prev => {
              const next = [evt!, ...prev].slice(0, 50)
              // Update stats
              setStats({
                total: next.length,
                completed: next.filter(e => e.status === 'completed').length,
                running: next.filter(e => e.status === 'running').length,
              })
              return next
            })
          }
        }
      }

      // tool_result — mark running events as completed
      if (event.type === 'user' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_result') {
            const toolUseId = block.tool_use_id
            if (toolUseId) {
              setMonitorEvents(prev => {
                const next = prev.map(e =>
                  e.id === toolUseId ? { ...e, status: 'completed' as const } : e
                )
                setStats({
                  total: next.length,
                  completed: next.filter(e => e.status === 'completed').length,
                  running: next.filter(e => e.status === 'running').length,
                })
                return next
              })
            }
          }
        }
      }
    })

    return () => unsub()
  }, []) // Always listen, no dependency on visible

  return (
    <div className="task-monitor embedded">
      {/* Stats bar */}
      <div className="monitor-stats-bar">
        <span className="monitor-stat-item">📡 {stats.total} 事件</span>
        <span className="monitor-stat-item">✅ {stats.completed}</span>
        <span className="monitor-stat-item running">{stats.running > 0 ? `🔄 ${stats.running}` : ''}</span>
        <button
          className="icon-btn"
          onClick={() => { setMonitorEvents([]); setStats({ total: 0, completed: 0, running: 0 }) }}
          title="清空"
          style={{ marginLeft: 'auto', fontSize: 10 }}
        >
          🗑
        </button>
      </div>

      {/* Event list */}
      <div className="monitor-body">
        {monitorEvents.length === 0 ? (
          <div className="monitor-empty">
            <p style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: '20px 12px', lineHeight: 1.8 }}>
              💡 当 Claude 开始执行工具时<br/>
              这里会实时显示活动事件<br/>
              <span style={{ color: '#666', fontSize: 11 }}>发送消息启动 Claude 即可</span>
            </p>
          </div>
        ) : (
          monitorEvents.slice(0, 15).map((evt) => (
            <div key={evt.id} className={`monitor-event ${evt.status}`}>
              <div className="monitor-event-icon">
                {evt.status === 'running' && <span className="monitor-spinner" />}
                {evt.status === 'completed' && '✅'}
                {evt.status === 'pending' && '🔔'}
                {evt.status === 'error' && '❌'}
              </div>
              <div className="monitor-event-content">
                <div className="monitor-event-title">{evt.title}</div>
                {evt.detail && (
                  <div className="monitor-event-detail" title={evt.detail}>{evt.detail}</div>
                )}
              </div>
              <div className="monitor-event-time">
                {new Date(evt.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
