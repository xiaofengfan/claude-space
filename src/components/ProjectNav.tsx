import { useState, useEffect } from 'react'
import { ProjectInfo } from '../types/project'
import type { IdeConfig } from '../types/settings'
import { UnifiedTemplateManagerDialog } from './UnifiedTemplateManagerDialog'

export function ProjectNav({
  project, leftView, onLeftViewChange, onGitClick, onConnectionClick, onSshClick, onConsoleClick, onWorkspaceChange, theme, onOpenSettings,
}: {
  project: ProjectInfo | null; leftView: string; onLeftViewChange: (view: string) => void
  onGitClick?: () => void; onConnectionClick?: () => void; onSshClick?: () => void; onConsoleClick?: () => void
  onWorkspaceChange?: (workspaceId: string) => void; theme: 'dark' | 'light'
  onOpenSettings?: (tab?: string) => void
}) {
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; path: string; isActive: boolean }>>([])
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false)
  const [ideDropdownOpen, setIdeDropdownOpen] = useState(false)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [ides, setIdes] = useState<IdeConfig[]>([])

  useEffect(() => {
    window.electronAPI.workspaceList().then(list => { if (list?.length) setWorkspaces(list) }).catch(() => {})
    loadIdes()
  }, [])

  async function loadIdes() {
    try {
      const s = await window.electronAPI.loadSettings()
      if (s?.ides) setIdes(s.ides)
    } catch {}
  }

  async function handleIdeDropdownToggle(open: boolean) {
    if (open) await loadIdes()  // 每次打开时重新加载，确保与设置同步
    setIdeDropdownOpen(open)
  }

  const activeWs = workspaces.find(w => w.isActive)

  async function handleSwitchWorkspace(id: string) {
    const res = await window.electronAPI.workspaceSetActive(id)
    if (res.success) { setWorkspaces(prev => prev.map(w => ({ ...w, isActive: w.id === id }))); setWsDropdownOpen(false); onWorkspaceChange?.(id) }
  }

  async function openInIde(ide: IdeConfig) {
    if (!project) return
    setIdeDropdownOpen(false)
    const r = await window.electronAPI.openInIde({ ideId: ide.id, projectPath: project.path })
    if (!r?.success) alert(r?.error || `打开 ${ide.name} 失败`)
  }

  function openInExplorer() {
    if (!project) return; window.electronAPI.openProjectFolder(project.path); setIdeDropdownOpen(false)
  }

  if (!project) return null

  const DROPDOWN_STYLE: React.CSSProperties = {
    position: 'absolute', top: '100%', right: 0, zIndex: 100,
    background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 6,
    minWidth: 180, padding: '4px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  }

  return (
    <div className="project-nav">
      <div className="project-nav-left">
        <span className="project-nav-icon">📂</span>
        <div className="project-nav-info">
          <span className="project-nav-name">{project.name}</span>
          {project.techStack && <span className="project-nav-tech">{project.techStack}</span>}
          <span className="project-nav-path" title={project.path}>
            {project.path.length > 40 ? '...' + project.path.slice(-37) : project.path}
          </span>
        </div>
      </div>
      <div className="project-nav-actions">
        {workspaces.length > 1 && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <button className="nav-action-btn" onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
              title={`当前工作空间: ${activeWs?.name || '默认'}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              📁 {activeWs?.name || '默认'}<span style={{ fontSize: 8 }}>▼</span>
            </button>
            {wsDropdownOpen && (
              <div style={{ ...DROPDOWN_STYLE, right: 0 }}>
                {workspaces.map(ws => (
                  <div key={ws.id} onClick={() => handleSwitchWorkspace(ws.id)} style={{
                    padding: '6px 12px', cursor: 'pointer', fontSize: 12,
                    color: ws.isActive ? '#6c8cff' : '#ccc', background: ws.isActive ? '#1a1a3e' : 'transparent',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
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
        <button className="nav-action-btn" onClick={onConnectionClick} title="连接状态">🔗 连接</button>
        <button className="nav-action-btn" onClick={onSshClick} title="SSH 远程访问">🔌 SSH</button>
        <button className="nav-action-btn" onClick={onGitClick} title="Git 版本管理">⎇ Git</button>
        <button className="nav-action-btn" onClick={onConsoleClick} title="开发者控制台">🖥️ 控制台</button>
        <button className="nav-action-btn" onClick={() => setShowTemplateManager(true)} title="工作流模板">📋 模板</button>

        {/* ── IDE 工具下拉 ──────────────────────────── */}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <button className="nav-action-btn" onClick={() => handleIdeDropdownToggle(!ideDropdownOpen)}
            title="使用外部工具打开项目" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            🛠️ IDE<span style={{ fontSize: 8 }}>▼</span>
          </button>
          {ideDropdownOpen && (
            <div style={{ ...DROPDOWN_STYLE, right: 0 }}>
              {ides.map(ide => (
                <div key={ide.id} onClick={() => openInIde(ide)} style={{
                  padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: '#ccc',
                  display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #2a2a4a',
                }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#2a2a4a')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 16 }}>{ide.icon || '🛠️'}</span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{ide.name}</div>
                    <div style={{ fontSize: 9, color: '#666' }}>{ide.executablePath}</div>
                  </div>
                </div>
              ))}
              <div onClick={openInExplorer} style={{
                padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: '#ccc',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
                onMouseEnter={e => (e.currentTarget.style.background = '#2a2a4a')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 16 }}>📁</span>
                <div><div style={{ fontWeight: 600 }}>文件夹</div><div style={{ fontSize: 9, color: '#666' }}>打开所在目录</div></div>
              </div>
              {ides.length > 0 && <div className="menubar-divider" />}
              <div onClick={() => { setIdeDropdownOpen(false); onOpenSettings?.('ides') }} style={{
                padding: '8px 14px', cursor: 'pointer', fontSize: 11, color: '#888',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
                onMouseEnter={e => (e.currentTarget.style.background = '#2a2a4a')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 13 }}>⚙️</span>
                <span>管理 IDE 配置</span>
              </div>
            </div>
          )}
        </div>

        <button
          className="nav-action-btn"
          title="打开 AI 编排工坊"
          onClick={() => { if (onLeftViewChange) onLeftViewChange('orchestrator'); }}
        >▶ 运行</button>
        <button className="nav-action-btn" disabled title="即将推出">🐛 调试</button>
      </div>
      {wsDropdownOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setWsDropdownOpen(false)} />}
      {ideDropdownOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setIdeDropdownOpen(false)} />}
      {showTemplateManager && (
        <UnifiedTemplateManagerDialog theme={theme} activeProjectPath={project?.path} onClose={() => setShowTemplateManager(false)} onOrchestrationCreated={() => { if (onLeftViewChange) onLeftViewChange('orchestrator'); }} />
      )}
    </div>
  )
}
