import { useState, useEffect, useRef } from 'react'

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

  // Staggered bubble with proper cleanup
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const hash = emp.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0)
    const offset = (hash % 2800) + 200 // 200-3000ms offset per employee

    const startDelay = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        setShowBubble(true)
        if (hideRef.current) clearTimeout(hideRef.current)
        hideRef.current = setTimeout(() => setShowBubble(false), 1800)
      }, 3000)
      // Fire first immediately after delay
      setShowBubble(true)
      hideRef.current = setTimeout(() => setShowBubble(false), 1800)
    }, offset)

    return () => {
      clearTimeout(startDelay)
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (hideRef.current) clearTimeout(hideRef.current)
    }
  }, [emp.id])

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

  const darkColor = (emp.color || '#6c8cff').replace('4','3').replace('7','5').replace('e','c').replace('8','6').replace('b','8').replace('3','2').replace('9','7').replace('d','a')

  return (
    <div className="flat-desk" onClick={handleClick}>
      {/* 上方：名字 + 角色 */}
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
            <ellipse cx="26" cy="10" rx="13" ry="12" fill={isActive ? '#3d2314' : '#5a4a3a'} />
            <ellipse cx="26" cy="8" rx="10" ry="9" fill={isActive ? '#ffe0bd' : '#f5deb3'} />
            <ellipse cx="26" cy="9" rx="12" ry="10" fill={isActive ? '#3d2314' : '#5a4a3a'} />
            <ellipse cx="14" cy="9" rx="4" ry="5" fill={isActive ? '#f0c090' : '#deb887'} />
            <ellipse cx="38" cy="9" rx="4" ry="5" fill={isActive ? '#f0c090' : '#deb887'} />
            <rect x="22" y="15" width="8" height="4" rx="2" fill={isActive ? '#f0c090' : '#deb887'} />
            <rect x="13" y="18" width="26" height="22" rx="6" fill={emp.color || '#6c8cff'} />
            <rect x="20" y="17" width="12" height="4" rx="2" fill={isActive ? darkColor : '#5a6a8a'} />
            <rect x="2" y="22" width="11" height="5" rx="2.5" fill={emp.color || '#6c8cff'} />
            <rect x="39" y="22" width="11" height="5" rx="2.5" fill={emp.color || '#6c8cff'} />
            <circle cx="7" cy="24.5" r="4" fill={isActive ? '#ffe0bd' : '#f5deb3'} />
            <circle cx="45" cy="24.5" r="4" fill={isActive ? '#ffe0bd' : '#f5deb3'} />
          </svg>
        </div>

        <div className="flat-desk-shadow" />

        {emp.status === 'idle' && (
          <div className="flat-standby-bubble">🔵 待命中</div>
        )}
        {emp.status === 'busy' && (
          <div className="flat-busy-bubble">🔥 {taskTitle || '忙碌中'}</div>
        )}
        {emp.status === 'working' && taskTitle && (
          <div className="flat-working-bubble">📋 {taskTitle?.slice(0, 20)}</div>
        )}

        {/* 工位下方：状态 + 任务内容 */}
        <div className="flat-task-line">
          <span className={`flat-status-badge status-${emp.status}`}>
            {emp.status === 'busy' ? '🔥忙碌' : emp.status === 'working' ? '📋工作中' : '🔵待命'}
          </span>
          {taskTitle && <span className="flat-task-content">{taskTitle}</span>}
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

  // ── 任务-员工匹配 + 状态计算 ──────────────────────
  // 核心思路：每个任务通过 agentType 映射到对应角色的员工

  /** 获取分配给某员工的所有活跃任务 */
  function getAgentTasks(emp: Employee): any[] {
    if (!tasks?.length) return []

    return tasks.filter((t: any) => {
      if (t.status === 'done') return false

      // 1) 直接 agentType 匹配（最准确）
      if (t.agentType && t.agentType === emp.agentType) return true

      // 2) 按员工名字匹配（@mention 创建的任务）
      if (t.title?.includes(emp.name)) return true
      if (t.description?.includes(emp.name)) return true

      // 3) 按 category + agentType 交叉匹配
      //    tool 类任务通常归 Implementer/CodeExplorer
      //    approval 类任务归 Coordinator/Architect
      if (t.category === 'tool' && emp.agentType === 'Implementer' && !t.agentType) return true
      if (t.category === 'approval' && emp.agentType === 'Coordinator' && !t.agentType) return true

      // 4) 按角色关键词模糊匹配（最后手段）
      const roleKeywords: Record<string, string[]> = {
        Coordinator: ['经理', '产品', '管理', '协调', '审批', '计划', '规划'],
        Architect: ['架构', '设计', '系统', '重构', '模式', '接口'],
        Implementer: ['开发', '前端', '后端', '实现', '编码', '修复', '重构', '编辑', '写入', '构建', '测试'],
        SecurityReviewer: ['测试', '审查', '安全', '审计', 'qa', 'review', '检查'],
        CodeExplorer: ['分析', '搜索', '查找', '读取', '探索', '浏览'],
      }
      const keywords = roleKeywords[emp.agentType] || []
      const searchText = `${t.title || ''} ${t.description || ''} ${t.category || ''}`.toLowerCase()
      return keywords.some(kw => searchText.includes(kw.toLowerCase()))
    })
  }

  /** 根据任务状态计算员工真实状态 */
  function getAgentStatus(emp: Employee): Employee['status'] {
    const agentTasks = getAgentTasks(emp)
    if (agentTasks.length === 0) return 'idle'

    // 有 in_progress 任务 → 忙碌
    const inProgress = agentTasks.filter(t => t.status === 'in_progress')
    if (inProgress.length > 0) return 'busy'

    // 有 todo 任务 → 工作中
    const todos = agentTasks.filter(t => t.status === 'todo')
    if (todos.length > 0) return 'working'

    return 'idle'
  }

  /** 获取员工当前任务摘要（显示在气泡/状态栏） */
  function getAgentTaskTitle(emp: Employee): string | undefined {
    const agentTasks = getAgentTasks(emp)
    if (agentTasks.length === 0) return undefined

    // 优先显示 in_progress 任务
    const active = agentTasks.filter(t => t.status === 'in_progress')
    const display = active.length > 0 ? active : agentTasks

    return display
      .slice(0, 2)
      .map(t => t.title?.replace(/^[🔔✅💻📝✏️📖🔍🔎⚙️🤖🌐]\s*/, '').slice(0, 18))
      .join(' · ')
  }

  // 统计各 agentType 的活跃任务数
  const agentTypeStats: Record<string, number> = {}
  if (tasks?.length) {
    tasks.filter((t: any) => t.status !== 'done').forEach((t: any) => {
      if (t.agentType) {
        agentTypeStats[t.agentType] = (agentTypeStats[t.agentType] || 0) + 1
      }
    })
  }

  return (
    <div className="flat-office">
      <div className="flat-office-header">
        <span>🏢 {activeProject?.name || '办公室'}</span>
        <div className="flat-office-header-right">
          {/* 实时角色任务统计 */}
          <span className="flat-office-stats">
            {Object.entries(agentTypeStats).length > 0
              ? Object.entries(agentTypeStats).map(([type, count]) => (
                  <span key={type} className="flat-office-stat-chip" title={`${type}: ${count} 个任务`}>
                    {type === 'Implementer' ? '🔧' : type === 'CodeExplorer' ? '🔍' : type === 'Coordinator' ? '📋' : type === 'Architect' ? '🏗️' : type === 'SecurityReviewer' ? '🛡️' : '📌'}
                    {count}
                  </span>
                ))
              : <span className="flat-office-stat-chip idle">—</span>
            }
          </span>
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
            {row.map(emp => {
              const realStatus = getAgentStatus(emp)
              const realTask = getAgentTaskTitle(emp)
              return <DeskCard key={emp.id} emp={{ ...emp, status: realStatus }} onEdit={() => startEdit(emp)} taskTitle={realTask} />
            })}
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
