import { useState, useEffect } from 'react'

interface ClaudeProject { path: string; name: string; techStack: string; sessions: number }

export function ProjectManagerDialog({
  onClose, onSelectProject,
}: {
  onClose: () => void
  onSelectProject: (path: string) => void
}) {
  const [allProjects, setAllProjects] = useState<ClaudeProject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadProjects() }, [])

  async function loadProjects() {
    setLoading(true)
    try {
      // Scan actual filesystem directories in workspace
      const projects = await window.electronAPI.scanProjects?.() || []
      setAllProjects(projects.map((p: any) => ({
        path: p.path, name: p.name, techStack: p.techStack || '', sessions: p.sessions || 0
      })))
    } catch (_e) { /* silent */ } finally { setLoading(false) }
  }

  function handleSelect(project: ClaudeProject) {
    onSelectProject(project.path)
    onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog project-manager-dialog" onClick={e => e.stopPropagation()} style={{ width: 560 }}>
        <div className="dialog-header">
          <h2>📁 选择项目</h2>
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>
        <div className="dialog-body">
          {loading ? <div className="empty-hint">加载中...</div> : (
            <div className="pm-list">
              {allProjects.map(p => (
                <div key={p.path} className="pm-item" onClick={() => handleSelect(p)}>
                  <div>
                    <div className="pm-item-name">📂 {p.name}</div>
                    <div className="pm-item-path">{p.path}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {p.techStack}{p.sessions > 0 ? ` · ${p.sessions} 会话` : ''}
                    </div>
                  </div>
                </div>
              ))}
              {allProjects.length === 0 && <div className="empty-hint">工作区暂无项目</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
