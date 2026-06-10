import { useState, useEffect } from 'react'
import { ProjectInfo } from '../types/project'

export function ProjectNav({
  project,
  leftView,
  onLeftViewChange,
  onGitClick,
  onWorkspaceChange,
}: {
  project: ProjectInfo | null
  leftView: string
  onLeftViewChange: (view: string) => void
  onGitClick?: () => void
  onWorkspaceChange?: (workspaceId: string) => void  // 通知父组件切换空间+软重启
}) {
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; path: string; isActive: boolean }>>([])
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false)

  useEffect(() => {
    window.electronAPI.workspaceList().then(list => { if (list?.length) setWorkspaces(list) }).catch(() => {})
  }, [])

  const activeWs = workspaces.find(w => w.isActive)

  async function handleSwitchWorkspace(id: string) {
    const res = await window.electronAPI.workspaceSetActive(id)
    if (res.success) {
      setWorkspaces(prev => prev.map(w => ({ ...w, isActive: w.id === id })))
      setWsDropdownOpen(false)
      onWorkspaceChange?.(id)
    }
  }

  if (!project) return null

  return (
    <div className="project-nav">
      <div className="project-nav-left">
        <span className="project-nav-icon">📂</span>
        <div className="project-nav-info">
          <span className="project-nav-name">{project.name}</span>
          {project.techStack && (
            <span className="project-nav-tech">{project.techStack}</span>
          )}
          <span className="project-nav-path" title={project.path}>
            {project.path.length > 40
              ? '...' + project.path.slice(-37)
              : project.path}
          </span>
        </div>
      </div>
      <div className="project-nav-actions">
        {/* 工作空间切换 */}
        {workspaces.length > 1 && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button
              className="nav-action-btn"
              onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
              title={`当前工作空间: ${activeWs?.name || '默认'}`}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              📁 {activeWs?.name || '默认'}
              <span style={{ fontSize: 8 }}>▼</span>
            </button>
            {wsDropdownOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, zIndex: 100,
                background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 6,
                minWidth: 180, padding: '4px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}>
                {workspaces.map(ws => (
                  <div
                    key={ws.id}
                    onClick={() => handleSwitchWorkspace(ws.id)}
                    style={{
                      padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                      color: ws.isActive ? '#6c8cff' : '#ccc',
                      background: ws.isActive ? '#1a1a3e' : 'transparent',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                  >
                    <span>{ws.isActive ? '✅ ' : '  '}{ws.name}</span>
                    <span style={{ fontSize: 9, color: '#666', marginLeft: 8, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ws.path.split(/[/\\]/).pop()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <button className="nav-action-btn" onClick={onGitClick} title="Git 版本管理">⎇ Git</button>
        <button className="nav-action-btn" disabled title="即将推出">▶ 运行</button>
        <button className="nav-action-btn" disabled title="即将推出">🐛 调试</button>
      </div>
      {/* 点击外部关闭下拉 */}
      {wsDropdownOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99 }}
          onClick={() => setWsDropdownOpen(false)}
        />
      )}
    </div>
  )
}
