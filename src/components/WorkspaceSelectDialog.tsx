import { useState, useEffect } from 'react'

interface WorkspaceInfo {
  id: string; name: string; path: string; isActive: boolean; createdAt: string
}

export function WorkspaceSelectDialog({
  onSelect,
}: {
  onSelect: (workspaceId: string) => void
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const list = await window.electronAPI.workspaceList()
        if (list?.length) {
          setWorkspaces(list)
          // 默认选中当前活跃空间，否则第一个
          const active = list.find(w => w.isActive)
          setSelectedId(active?.id || list[0].id)
        }
      } catch { /* silent */ }
      setLoading(false)
    }
    load()
  }, [])

  function handleConfirm() {
    if (selectedId) onSelect(selectedId)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleConfirm()
    if (e.key === 'Escape' && selectedId) handleConfirm() // Esc 使用默认选择
  }

  // 只有一个空间或没有空间 → 通过 effect 跳过选择（避免在 render 期间调用 setState）
  useEffect(() => {
    if (!loading && workspaces.length <= 1) {
      onSelect(workspaces[0]?.id || '_default')
    }
  }, [loading, workspaces])

  if (loading || workspaces.length <= 1) {
    return (
      <div className="dialog-overlay">
        <div className="dialog" style={{ width: 480, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🚀</div>
          <div style={{ fontSize: 14, color: '#888' }}>正在初始化工作空间...</div>
        </div>
      </div>
    )
  }

  const activeWs = workspaces.find(w => w.isActive)

  return (
    <div className="dialog-overlay" onKeyDown={handleKeyDown}>
      <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 520 }}>
        <div className="dialog-header">
          <h2>🚀 选择工作空间</h2>
        </div>
        <div className="dialog-body">
          <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
            检测到多个工作空间配置，请选择本次要使用的工作空间。
          </p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {workspaces.map(ws => (
              <div
                key={ws.id}
                className={selectedId === ws.id ? 'workspace-card selected' : 'workspace-card'}
                onClick={() => setSelectedId(ws.id)}
                onDoubleClick={handleConfirm}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 16px', marginBottom: 8,
                  background: selectedId === ws.id ? '#1a1a3e' : '#0d0d1a',
                  border: selectedId === ws.id ? '2px solid #4a7cf7' : '1px solid #2a2a4a',
                  borderRadius: 8, cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: 24 }}>{ws.isActive ? '📍' : '📁'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: selectedId === ws.id ? '#6c8cff' : '#ccc' }}>
                    {ws.name}
                    {ws.isActive && <span style={{ fontSize: 10, color: '#6c8cff', marginLeft: 6 }}>上次使用</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {ws.path}
                  </div>
                </div>
                {selectedId === ws.id && (
                  <span style={{ fontSize: 18, color: '#4a7cf7' }}>✅</span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="dialog-footer">
          <span style={{ fontSize: 11, color: '#555', flex: 1 }}>
            {activeWs ? `上次使用: ${activeWs.name}` : ''}
          </span>
          <button
            className="btn-primary"
            onClick={handleConfirm}
            style={{ padding: '10px 32px', fontSize: 14 }}
          >
            进入工作空间 →
          </button>
        </div>
      </div>
    </div>
  )
}
