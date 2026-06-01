import { SessionInfo } from '../types/project'

export function SessionList({
  sessions,
  activeProject,
  onSelectSession,
  onNewSession,
}: {
  sessions: SessionInfo[]
  activeProject: { name: string; path: string } | null
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
}) {
  function formatTime(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN')
  }

  return (
    <div className="session-list">
      <div className="session-list-header">
        <span>
          {activeProject ? `${activeProject.name} 的会话` : '会话历史'}
        </span>
        <button onClick={onNewSession} className="icon-btn" title="新建会话">
          ＋
        </button>
      </div>

      <div className="session-items">
        {sessions.map((s) => (
          <div
            key={s.sessionId}
            className="session-item"
            onClick={() => onSelectSession(s.sessionId)}
          >
            <div className="session-id">{s.sessionId.slice(0, 8)}...</div>
            <div className="session-time">{formatTime(s.modifiedAt)}</div>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="empty-hint">
            {activeProject ? '暂无会话' : '选择一个项目查看会话'}
          </div>
        )}
      </div>
    </div>
  )
}
