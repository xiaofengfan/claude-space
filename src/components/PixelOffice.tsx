import { useState, useEffect } from 'react'

interface Employee {
  id: string; name: string; role: string; icon: string
  skills: string; agentType: string; status: 'working' | 'idle' | 'busy' | 'away'
  color: string
}

function DeskCard({ emp, onEdit, taskTitle }: { emp: Employee; onEdit: () => void; taskTitle?: string }) {
  const isActive = emp.status === 'working' || emp.status === 'busy'
  const [showBubble, setShowBubble] = useState(false)
  const [progress, setProgress] = useState(0)
  const [lookSide, setLookSide] = useState(false)

  useEffect(() => {
    if (emp.status !== 'idle') { setShowBubble(false); return }
    const t = setInterval(() => { setShowBubble(true); setTimeout(() => setShowBubble(false), 2000) }, 3000)
    return () => clearInterval(t)
  }, [emp.status])

  useEffect(() => {
    if (!isActive) { setProgress(0); return }
    const t = setInterval(() => { setProgress(p => (p >= 100 ? 0 : p + Math.random() * 8)) }, 500)
    return () => clearInterval(t)
  }, [isActive, emp.status])

  function handleClick() {
    setLookSide(true)
    setTimeout(() => setLookSide(false), 1500)
    onEdit()
  }

  const darkColor = emp.color.replace('4','3').replace('7','5').replace('e','c').replace('8','6').replace('b','8').replace('3','2').replace('9','7').replace('d','a')

  return (
    <div className="flat-desk" onClick={handleClick}>
      <div className="flat-name-label">{emp.name} · {emp.role}</div>

      <div className="flat-cubicle">
        <div className="flat-wall-back" />
        <div className="flat-wall-left" />
        <div className="flat-wall-right" />

        {/* Monitor — sits ON desk, lower position */}
        <div className={`flat-monitor ${isActive ? 'active' : ''}`}>
          <div className="flat-monitor-frame">
            <div className="flat-monitor-screen">
              {isActive && (
                <div className="flat-monitor-content">
                  {emp.status === 'busy' ? (
                    <div className="monitor-code">
                      <div className="monitor-code-line" /><div className="monitor-code-line short" /><div className="monitor-code-line" />
                    </div>
                  ) : (
                    <div className="monitor-progress">
                      <div className="monitor-progress-bar" style={{ width: `${Math.min(progress, 100)}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flat-monitor-stand" />
          <div className="flat-monitor-base" />
        </div>

        {/* Desk surface — thin */}
        <div className="flat-desk-surface">
          <div className="flat-keyboard" />
          <div className="flat-mouse" />
        </div>

        {/* Chair back */}
        <div className="flat-chair-back" />

        {/* Person — bigger, side-turn animation on click */}
        <div className={`flat-person ${emp.status} ${lookSide ? 'look-side' : ''}`}>
          <svg viewBox="0 0 52 56" width="52" height="56">
            {/* Hair — covers entire back of head */}
            <ellipse cx="26" cy="10" rx="13" ry="12" fill={isActive ? '#3d2314' : '#ccc'} />
            {/* Head back — skin at sides/neck only */}
            <ellipse cx="26" cy="8" rx="10" ry="9" fill={isActive ? '#ffe0bd' : '#e8e8e8'} />
            {/* Hair fills most of head from back */}
            <ellipse cx="26" cy="9" rx="12" ry="10" fill={isActive ? '#3d2314' : '#ccc'} />
            {/* Ears — visible from back */}
            <ellipse cx="14" cy="9" rx="4" ry="5" fill={isActive ? '#f0c090' : '#ddd'} />
            <ellipse cx="38" cy="9" rx="4" ry="5" fill={isActive ? '#f0c090' : '#ddd'} />
            {/* Neck back */}
            <rect x="22" y="15" width="8" height="4" rx="2" fill={isActive ? '#f0c090' : '#ddd'} />
            {/* Shirt back — solid color */}
            <rect x="13" y="18" width="26" height="22" rx="6" fill={isActive ? emp.color : '#e0e0e0'} />
            {/* Back collar line */}
            <rect x="20" y="17" width="12" height="4" rx="2" fill={isActive ? darkColor : '#ccc'} />
            {/* Arms from behind */}
            <rect x="2" y="22" width="11" height="5" rx="2.5" fill={isActive ? emp.color : '#e0e0e0'} />
            <rect x="39" y="22" width="11" height="5" rx="2.5" fill={isActive ? emp.color : '#e0e0e0'} />
            {/* Hands resting at sides */}
            <circle cx="7" cy="24.5" r="4" fill={isActive ? '#ffe0bd' : '#e8e8e8'} />
            <circle cx="45" cy="24.5" r="4" fill={isActive ? '#ffe0bd' : '#e8e8e8'} />
          </svg>
        </div>

        <div className="flat-desk-shadow" />

        {showBubble && emp.status === 'idle' && (
          <div className="flat-idle-bubble">💤 空闲中...</div>
        )}

        {/* Task indicator inside cubicle bottom */}
        <div className="flat-task-line">
          {taskTitle || (isActive
            ? `📋 ${emp.role}任务进行中`
            : (emp.status === 'idle' ? '💤 等待任务分配' : '—'))
          }
        </div>
      </div>

      <span className={`flat-status ${emp.status}`} />
    </div>
  )
}

export function PixelOffice({ activeProject, tasks, team, onTeamChange }: {
  activeProject: { name: string; path: string } | null; tasks?: any[]; team: Employee[]; onTeamChange: (team: Employee[]) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Employee | null>(null)
  function startEdit(emp: Employee) { setEditingId(emp.id); setEditForm({ ...emp }) }
  function saveEdit() {
    if (editForm) {
      const updated = team.map(e => e.id === editForm.id ? editForm : e)
      onTeamChange(updated)
    }
    setEditingId(null); setEditForm(null)
  }

  const rows: Employee[][] = []
  for (let i = 0; i < team.length; i += 2) rows.push(team.slice(i, i + 2))

  // Map tasks to employees by agent type
  function getTaskForAgent(agentType: string): string | undefined {
    if (!tasks?.length) return undefined
    const inProgress = tasks.filter((t: any) => t.status === 'in_progress')
    // Match by agent type mapping
    const agentRoles: Record<string, string[]> = {
      Coordinator: ['项目经理', '产品经理'],
      Architect: ['架构师'],
      Implementer: ['高级工程师', '开发工程师'],
      SecurityReviewer: ['测试工程师', '代码审查'],
      PerformanceReviewer: ['部署发布'],
    }
    const roles = agentRoles[agentType] || []
    const match = inProgress.find((t: any) => roles.some(r => t.title?.includes(r) || t.description?.includes(r)))
    return match?.title || match?.description || undefined
  }

  return (
    <div className="flat-office">
      <div className="flat-office-header">
        <span>🏢 {activeProject?.name || '办公室'}</span>
        <div className="flat-office-header-right">
          <span className="flat-office-count">{team.length} 人</span>
          <button className="icon-btn" onClick={() => {
            const newEmp: Employee = {
              id: 'emp_' + Date.now().toString(36),
              name: '新员工', role: '开发工程师', icon: '👤',
              skills: '', agentType: 'Implementer',
              status: 'idle', color: '#6c8cff',
            }
            const updated = [...team, newEmp]
            onTeamChange(updated)
            startEdit(newEmp)
          }} title="新增员工">+</button>
        </div>
      </div>
      <div className="flat-office-grid">
        <div className="flat-door">🚪</div>
        {rows.map((row, ri) => (
          <div key={ri} className="flat-row">
            {row.map(emp => <DeskCard key={emp.id} emp={emp} onEdit={() => startEdit(emp)} taskTitle={getTaskForAgent(emp.agentType)} />)}
            {row.length < 2 && <div className="flat-desk empty" />}
          </div>
        ))}
      </div>

      {editingId && editForm && (
        <div className="dialog-overlay" onClick={() => setEditingId(null)}>
          <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 400 }}>
            <div className="dialog-header"><h2>✏️ {editForm.name}</h2><button onClick={() => setEditingId(null)} className="dialog-close">✕</button></div>
            <div className="dialog-body">
              <label>姓名</label><input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="cozy-input" />
              <label>角色</label><input value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} className="cozy-input" />
              <label>关联智能体</label>
              <select value={editForm.agentType} onChange={e => setEditForm({ ...editForm, agentType: e.target.value })} className="cozy-input">
                <option value="CodeExplorer">CodeExplorer</option><option value="Architect">Architect</option>
                <option value="SecurityReviewer">SecurityReviewer</option><option value="PerformanceReviewer">PerformanceReviewer</option>
                <option value="Implementer">Implementer</option><option value="Coordinator">Coordinator</option>
              </select>
              <label>技能</label><textarea value={editForm.skills} onChange={e => setEditForm({ ...editForm, skills: e.target.value })} className="cozy-input" rows={2} />
              <label>状态</label>
              <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value as Employee['status'] })} className="cozy-input">
                <option value="working">🟢 工作中</option><option value="busy">🟡 忙碌</option>
                <option value="idle">⚪ 空闲</option><option value="away">🔴 离开</option>
              </select>
            </div>
            <div className="dialog-footer">
              <button onClick={() => {
                if (confirm(`确认辞退 ${editForm.name}？`)) {
                  const updated = team.filter(e => e.id !== editForm.id)
                  onTeamChange(updated)
                  setEditingId(null)
                  setEditForm(null)
                }
              }} className="btn-danger" style={{ marginRight: 'auto' }}>🗑 辞退</button>
              <button onClick={() => setEditingId(null)} className="btn-cancel">取消</button>
              <button onClick={saveEdit} className="btn-primary">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
