import { useState, useEffect } from 'react'

export function WelcomePage({
  onSelectProject, onNewProject, onQuickOpen,
}: {
  onSelectProject: () => void
  onNewProject: () => void
  onQuickOpen: (project: { name: string; path: string }) => void
}) {
  const [recentProjects, setRecentProjects] = useState<{ name: string; path: string; techStack: string }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadRecent() }, [])

  async function loadRecent() {
    setLoading(true)
    try {
      const projects = await window.electronAPI.scanProjects?.() || []
      const top = projects.slice(0, 6).map((p: any) => ({
        name: p.name, path: p.path, techStack: p.techStack || ''
      }))
      setRecentProjects(top)
    } catch (_e) { /* silent */ } finally { setLoading(false) }
  }

  return (
    <div className="welcome-page">
      <div className="welcome-center">
        <div className="welcome-logo">
          <span className="welcome-icon">🤖</span>
          <h1>Claude Space</h1>
          <p className="welcome-subtitle">AI 驱动的项目开发工作台</p>
        </div>
        <div className="welcome-actions">
          <button className="welcome-btn primary" onClick={onSelectProject}>
            📁 选择项目
            <span className="welcome-btn-hint">浏览工作区项目</span>
          </button>
          <button className="welcome-btn secondary" onClick={onNewProject}>
            ✨ 新建项目
            <span className="welcome-btn-hint">在工作区创建新项目</span>
          </button>
        </div>
        <div className="welcome-recent">
          <h3>🕐 工作区项目 {loading && '(加载中...)'}</h3>
          <div className="recent-grid">
            {recentProjects.map(p => (
              <div key={p.path} className="recent-card" onClick={() => onQuickOpen({ name: p.name, path: p.path })}>
                <div className="recent-card-icon">📂</div>
                <div className="recent-card-info">
                  <div className="recent-card-name">{p.name}</div>
                  <div className="recent-card-path">{p.path}</div>
                  {p.techStack && <div className="recent-card-meta">{p.techStack}</div>}
                </div>
              </div>
            ))}
            {!loading && recentProjects.length === 0 && (
              <div className="empty-hint" style={{ gridColumn: '1/-1' }}>工作区暂无项目</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
