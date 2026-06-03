import { SessionInfo } from '../types/project'

export interface ActiveSession {
  id: string
  name: string
  running?: boolean
  connected?: boolean
}

export function SessionList({
  sessions,
  activeProject,
  activeSessionId,
  activeSessions,
  sessionNames,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}: {
  sessions: SessionInfo[]
  activeProject: { name: string; path: string } | null
  activeSessionId?: string
  activeSessions?: ActiveSession[]
  sessionNames?: Record<string, string>
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onDeleteSession?: (sessionId: string) => void
}) {
  function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN')
  }

  // Merge active sessions with historical sessions for display
  const activeMap = new Map((activeSessions || []).map(s => [s.id, s]))

  return (
    <div className="session-list">
      <div className="session-list-header">
        <span>{activeProject ? `${activeProject.name}` : '会话'}</span>
        <button onClick={onNewSession} className="icon-btn" title="新建会话">＋</button>
      </div>

      <div className="session-items">
        {/* Active sessions first */}
        {(activeSessions || []).map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelectSession(s.id)}
          >
            <div className="session-item-left">
              <span className="session-status-dot" style={{ color: s.connected ? '#4caf50' : s.running ? '#e67e22' : '#666' }}>●</span>
              <div className="session-name" title={s.name}>{s.name || s.id.slice(0, 8)}</div>
            </div>
            <div className="session-item-right">
              <span className="session-id-tag">{s.id.slice(0, 8)}</span>
              {onDeleteSession && (
                <span className="session-delete" onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id) }}>×</span>
              )}
            </div>
          </div>
        ))}

        {/* Historical sessions */}
        {sessions.filter(h => !activeMap.has(h.sessionId)).map((s) => {
          const name = sessionNames?.[s.sessionId]
          return (
            <div
              key={s.sessionId}
              className="session-item historical"
              onClick={() => onSelectSession(s.sessionId)}
            >
              <div className="session-item-left">
                <span className="session-name">{name || s.sessionId.slice(0, 12) + '...'}</span>
              </div>
              <div className="session-item-right">
                <span className="session-time">{formatTime(s.modifiedAt)}</span>
              </div>
            </div>
          )
        })}

        {sessions.length === 0 && (activeSessions || []).length === 0 && (
          <div className="empty-hint">
            {activeProject ? '暂无会话，点击 ＋ 新建' : '选择一个项目查看会话'}
          </div>
        )}
      </div>
    </div>
  )
}
