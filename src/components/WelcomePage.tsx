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
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; path: string; isActive: boolean }>>([])
  const [showWsDropdown, setShowWsDropdown] = useState(false)

  useEffect(() => { loadRecent(); loadWorkspaceInfo() }, [])

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

  async function loadWorkspaceInfo() {
    try {
      const root = await window.electronAPI.getWorkspaceRoot()
      setWorkspaceRoot(root || '')
      const list = await window.electronAPI.workspaceList()
      if (list?.length) setWorkspaces(list)
    } catch { /* silent */ }
  }

  async function handleBrowseAndSwitch() {
    try {
      const result = await window.electronAPI.openDirectoryDialog?.()
      if (result && !result.canceled && result.dirPath) {
        await switchToPath(result.dirPath)
      }
    } catch { /* 非关键 */ }
  }

  async function switchToPath(dirPath: string) {
    // 检查是否已有该路径对应的工作空间
    const existing = workspaces.find(w => {
      const wNorm = w.path.replace(/\\/g, '/').toLowerCase()
      const dNorm = dirPath.replace(/\\/g, '/').toLowerCase()
      return wNorm === dNorm
    })
    if (existing) {
      // 已有 → 直接切换
      await window.electronAPI.workspaceSetActive(existing.id)
    } else {
      // 新路径 → 添加为新工作空间
      const name = dirPath.split(/[/\\]/).pop() || dirPath
      await window.electronAPI.workspaceAdd({ name, path: dirPath })
    }
    // 重新加载
    setWorkspaceRoot(dirPath)
    setLoading(true)
    try {
      const projects = await window.electronAPI.scanProjects?.() || []
      setRecentProjects(projects.slice(0, 6).map((p: any) => ({
        name: p.name, path: p.path, techStack: p.techStack || ''
      })))
    } catch (_e) { /* silent */ } finally { setLoading(false) }
    // 刷新工作空间列表
    const list = await window.electronAPI.workspaceList()
    if (list?.length) setWorkspaces(list)
  }

  async function handleSwitchWorkspace(id: string) {
    await window.electronAPI.workspaceSetActive(id)
    const list = await window.electronAPI.workspaceList()
    if (list?.length) setWorkspaces(list)
    const active = list?.find((w: any) => w.isActive)
    if (active) setWorkspaceRoot(active.path)
    setShowWsDropdown(false)
    // 重新扫描项目
    setLoading(true)
    try {
      const projects = await window.electronAPI.scanProjects?.() || []
      setRecentProjects(projects.slice(0, 6).map((p: any) => ({
        name: p.name, path: p.path, techStack: p.techStack || ''
      })))
    } catch (_e) { /* silent */ } finally { setLoading(false) }
  }

  const activeWs = workspaces.find(w => w.isActive)

  return (
    <div className="welcome-page">
      <div className="welcome-center">
        {/* ── 工作空间状态栏 ── */}
        <div className="welcome-workspace-bar">
          <div className="welcome-workspace-info">
            <span className="welcome-workspace-icon">📁</span>
            <div className="welcome-workspace-detail">
              <span className="welcome-workspace-name">
                {activeWs?.name || '默认工作空间'}
              </span>
              <span className="welcome-workspace-path" title={workspaceRoot}>
                {workspaceRoot ? (workspaceRoot.length > 50 ? '...' + workspaceRoot.slice(-47) : workspaceRoot) : '加载中...'}
              </span>
            </div>
          </div>
          <div className="welcome-workspace-actions">
            {/* 多空间时显示切换下拉 */}
            {workspaces.length > 1 && (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <button
                  className="welcome-workspace-btn"
                  onClick={() => setShowWsDropdown(!showWsDropdown)}
                  title="切换工作空间"
                >
                  🔄 切换
                  <span style={{ fontSize: 8, marginLeft: 2 }}>▼</span>
                </button>
                {showWsDropdown && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowWsDropdown(false)} />
                    <div className="welcome-ws-dropdown">
                      {workspaces.map(ws => (
                        <div
                          key={ws.id}
                          className={`welcome-ws-item ${ws.isActive ? 'active' : ''}`}
                          onClick={() => handleSwitchWorkspace(ws.id)}
                        >
                          <span>{ws.isActive ? '📍' : '📁'}</span>
                          <div>
                            <div className="welcome-ws-item-name">{ws.name}</div>
                            <div className="welcome-ws-item-path">{ws.path}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {/* 浏览并添加新空间 */}
            <button
              className="welcome-workspace-btn primary"
              onClick={handleBrowseAndSwitch}
              title="选择文件夹作为新工作空间"
            >
              📂 打开目录
            </button>
          </div>
        </div>

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
