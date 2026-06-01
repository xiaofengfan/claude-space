import { ProjectInfo } from '../types'

export function ProjectSwitchDialog({
  currentProject,
  newProject,
  onLoadInCurrent,
  onOpenInNew,
  onCancel,
}: {
  currentProject: ProjectInfo
  newProject: { name: string; path: string }
  onLoadInCurrent: () => void
  onOpenInNew: () => void
  onCancel: () => void
}) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 440 }}>
        <div className="dialog-header">
          <h2>📂 切换项目</h2>
          <button onClick={onCancel} className="dialog-close">✕</button>
        </div>
        <div className="dialog-body">
          <p style={{ fontSize: 14, color: '#ccc', marginBottom: 16 }}>
            当前已加载项目 <strong>{currentProject.name}</strong>，要将新项目加载到哪里？
          </p>
          <div style={{ background: '#141428', borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>新项目</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{newProject.name}</div>
            <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace', marginTop: 2 }}>{newProject.path}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn-switch-current" onClick={onLoadInCurrent}>
              <span style={{ fontSize: 16 }}>📌</span>
              <div>
                <div style={{ fontWeight: 600 }}>在当前窗口加载</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>替换当前项目，关闭当前会话</div>
              </div>
            </button>
            <button className="btn-switch-new" onClick={onOpenInNew}>
              <span style={{ fontSize: 16 }}>🪟</span>
              <div>
                <div style={{ fontWeight: 600 }}>在新窗口打开</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>保留当前项目，启动新窗口</div>
              </div>
            </button>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="btn-cancel" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  )
}
