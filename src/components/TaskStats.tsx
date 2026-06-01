import { TaskItem } from '../types/project'

export function TaskStats({ tasks }: { tasks: TaskItem[] }) {
  const total = tasks.length
  const done = tasks.filter(t => t.status === 'done').length
  const inProgress = tasks.filter(t => t.status === 'in_progress').length
  const todo = tasks.filter(t => t.status === 'todo').length
  const approvals = tasks.filter(t => t.category === 'approval' && t.status !== 'done').length
  const error = tasks.filter(t => (t as any).error).length

  // Recent tasks (last 10, sorted by updatedAt)
  const recent = [...tasks]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)

  const bars = [
    { label: '待处理', count: todo - approvals, color: '#9e9e9e', icon: '⚪' },
    { label: '审批中', count: approvals, color: '#e67e22', icon: '🔔' },
    { label: '进行中', count: inProgress, color: '#ff9800', icon: '🔵' },
    { label: '已完成', count: done, color: '#4caf50', icon: '✅' },
  ].filter(b => b.count > 0 || b.label === '待处理') // Always show pending even if 0

  const maxCount = Math.max(...bars.map(b => b.count), 1)

  return (
    <div className="task-stats">
      <div className="task-stats-header">
        <span>📊 任务总览</span>
        <span className="task-stats-total">共 {total} 项</span>
      </div>

      {/* Progress bars */}
      <div className="task-stats-bars">
        {bars.map(b => (
          <div key={b.label} className="task-stat-row">
            <span className="task-stat-label">{b.icon} {b.label}</span>
            <span className="task-stat-count">{b.count}</span>
            <div className="task-stat-bar-bg">
              <div
                className="task-stat-bar-fill"
                style={{
                  width: `${(b.count / maxCount) * 100}%`,
                  background: b.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Completion rate */}
      {total > 0 && (
        <div className="task-completion-rate">
          <div className="task-rate-bar">
            <div
              className="task-rate-fill"
              style={{ width: `${Math.round((done / total) * 100)}%` }}
            />
          </div>
          <span className="task-rate-text">
            完成率 {Math.round((done / total) * 100)}% ({done}/{total})
          </span>
        </div>
      )}

      {/* Recent activity */}
      {recent.length > 0 && (
        <div className="task-recent">
          <div className="task-recent-header">🕐 最近活动</div>
          {recent.map(t => (
            <div key={t.id} className="task-recent-item">
              <span className={`task-recent-dot ${t.status}`} />
              <span className="task-recent-title">{t.title.slice(0, 30)}</span>
              <span className="task-recent-time">
                {formatTimeAgo(new Date(t.updatedAt))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}
