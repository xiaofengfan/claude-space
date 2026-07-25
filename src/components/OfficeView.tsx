import { useEffect, useState } from 'react'
import './OfficeView.css'

interface DeskAgent {
  projectName: string
  projectPath: string
  status: 'active' | 'idle' | 'done' | 'new' | 'paused'
  agents: number
  tasks: number
}

export function OfficeView({
  projects,
  activeAgents,
  onSelectDesk,
  embedded,
}: {
  projects: { name: string; path: string; techStack: string; sessions: number }[]
  activeAgents: Map<string, { name: string; status: string }>
  onSelectDesk: (project: { name: string; path: string }) => void
  embedded?: boolean
}) {
  const [time, setTime] = useState(new Date())
  const [desks, setDesks] = useState<DeskAgent[]>([])

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const deskList: DeskAgent[] = projects.slice(0, 10).map((p, i) => {
      const hasActiveAgent = activeAgents.size > 0
      const isActive = hasActiveAgent && i < activeAgents.size
      const hasSessions = p.sessions > 0

      let status: DeskAgent['status'] = 'idle'
      if (isActive) status = 'active'
      else if (hasSessions) status = 'done'
      else status = 'new'

      return {
        projectName: p.name,
        projectPath: p.path,
        status,
        agents: isActive ? 1 : 0,
        tasks: p.sessions,
      }
    })
    setDesks(deskList)
  }, [projects, activeAgents])

  const timeStr = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  const cls = embedded ? 'office-view embedded' : 'office-view'

  return (
    <div className={cls}>
      {/* 天空/窗外 */}
      <div className="office-sky">
        <div className="office-sun">☀️</div>
        <div className="office-cloud c1">☁️</div>
        <div className="office-cloud c2">☁️</div>
      </div>

      {/* 办公室房间 */}
      <div className="office-room">
        {/* 装饰 */}
        <div className="office-plant left">🪴</div>
        <div className="office-clock">🕐 {timeStr}</div>
        <div className="office-plant right">🌿</div>

        {/* 办公桌排列 */}
        <div className="office-floor">
          <div className="office-grid">
            {desks.map((desk, i) => (
              <div
                key={desk.projectPath}
                className={`office-desk desk-${desk.status}`}
                style={{ animationDelay: `${i * 0.15}s` }}
                onClick={() => onSelectDesk({ name: desk.projectName, path: desk.projectPath })}
                title={`${desk.projectName} - 点击切换到项目`}
              >
                {/* 字体图标桌面 */}
                <div className="desk-top">
                  {/* 显示器图标 */}
                  <div className="desk-monitor">
                    {desk.status === 'active' ? '💻' : '🖥️'}
                  </div>

                  {/* 状态标签 */}
                  <div className={`desk-status-badge ${desk.status}`}>
                    {desk.status === 'active' && '⚡ 运行中'}
                    {desk.status === 'idle' && '💤 空闲'}
                    {desk.status === 'done' && '✅ 完成'}
                    {desk.status === 'new' && '🆕 新'}
                    {desk.status === 'paused' && '⏸ 暂停'}
                  </div>
                </div>

                {/* 桌面标签 */}
                <div className="desk-label">
                  <span className="desk-name">{desk.projectName}</span>
                  {desk.tasks > 0 && (
                    <span className="desk-task-count">{desk.tasks}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 地板 */}
        <div className="office-ground" />
      </div>
    </div>
  )
}
