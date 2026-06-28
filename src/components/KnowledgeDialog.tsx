import { useState, useEffect, useMemo, useRef } from 'react'

interface KnowledgeEntry {
  name: string; fileName: string; description: string
  type: string; tags: string; status: string; mtime: string; sources: string
}
interface MemoryEntry { name: string; description: string; fileName: string; type?: string; mtime?: string }
interface SessionItem { sessionId: string; projectPath?: string; modifiedAt: string; size?: number }

interface Props {
  theme: 'dark' | 'light'
  projectPath: string
  onClose: () => void
}

const KNOWLEDGE_TYPES = [
  { id: 'architecture', label: '架构设计', icon: '🏗️' },
  { id: 'decision', label: '决策记录', icon: '📋' },
  { id: 'pattern', label: '设计模式', icon: '🧩' },
  { id: 'guide', label: '操作指南', icon: '📖' },
  { id: 'reference', label: '参考文档', icon: '🔗' },
  { id: 'lesson', label: '经验教训', icon: '🎯' },
]

// ── Helpers ────────────────────────────────
function getTypeIcon(t?: string) { const f = KNOWLEDGE_TYPES.find(x => x.id === t); return f ? f.icon : '📄' }

export function KnowledgeDialog({ theme, projectPath, onClose }: Props) {
  // Shared data
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'sediment' | 'calendar' | 'browse' | 'stats' | 'workflow'>('sediment')
  const isDark = theme === 'dark'
  const [maximized, setMaximized] = useState(false)
  const [winSize, setWinSize] = useState({ w: 920, h: 650 })

  useEffect(() => {
    function u() {
      setWinSize(maximized
        ? { w: Math.max(700, window.innerWidth), h: Math.max(500, window.innerHeight) }
        : { w: Math.max(700, Math.floor(window.innerWidth * 0.78)), h: Math.max(500, Math.floor(window.innerHeight * 0.7)) })
    }
    u(); window.addEventListener('resize', u); return () => window.removeEventListener('resize', u)
  }, [maximized])

  function toggleMaximize() { setMaximized(!maximized) }

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [kr, mr, sr] = await Promise.all([
        window.electronAPI.knowledgeList(projectPath),
        window.electronAPI.memoryList(projectPath),
        window.electronAPI.listSessions(projectPath).catch(() => []),
      ])
      if (kr?.success) setEntries(kr.entries)
      if (mr?.success) setMemories(mr.entries)
      if (Array.isArray(sr)) setSessions(sr)
    } catch { /* ignore */ }
    setLoading(false)
  }

  // ── SEDIMENT: built-in independent memory/session browser ──
  const [sedimentSource, setSedimentSource] = useState<'memory' | 'session'>('memory')
  const [selectedSrc, setSelectedSrc] = useState<Set<string>>(new Set())
  const [resultContent, setResultContent] = useState('')
  const [resultTitle, setResultTitle] = useState('')
  const [resultType, setResultType] = useState('architecture')
  const [resultTags, setResultTags] = useState('')
  const [step, setStep] = useState<'pick' | 'edit'>('pick')
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)

  // Independent memory/session content cache
  const [memContent, setMemContent] = useState<Record<string, string>>({})
  const [sessContent, setSessContent] = useState<Record<string, string>>({})

  function toggleSrc(id: string) { setSelectedSrc(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  async function doExtract() {
    if (selectedSrc.size === 0) { setError('请选择来源'); return }
    setExtracting(true); setError(null)
    const parts: string[] = []; const names: string[] = []

    if (sedimentSource === 'memory') {
      for (const fn of selectedSrc) {
        const mem = memories.find(m => m.fileName === fn)
        if (!mem) continue
        names.push(mem.name)
        let body = memContent[fn]
        if (!body) {
          try {
            const r = await window.electronAPI.memoryRead({ projectPath, fileName: fn })
            body = r?.success ? (r.content.replace(/^---[\s\S]*?---\n*/m, '').trim()) : '(空)'
            setMemContent(p => ({ ...p, [fn]: body || '' }))
          } catch { body = '(读取失败)' }
        }
        if (body) parts.push(`## ${mem.name}\n\n类型: ${mem.type || '未分类'}\n\n${body.slice(0, 3000)}`)
      }
    } else {
      for (const sid of selectedSrc) {
        names.push(`会话 ${sid.slice(0, 8)}`)
        let text = sessContent[sid]
        if (!text) {
          try {
            const r = await window.electronAPI.getSessionTranscript(sid)
            if (r?.events) {
              const msgs: string[] = []
              for (const ev of r.events) {
                if (ev.type === 'user') {
                  const t = typeof ev.content === 'string' ? ev.content : ev.content?.find((c: any) => c.type === 'text')?.text || ''
                  if (t.trim()) msgs.push(`**用户:** ${t.trim().slice(0, 600)}`)
                } else if (ev.type === 'assistant' && ev.message?.content) {
                  const t = ev.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
                  if (t.trim()) msgs.push(`**AI:** ${t.trim().slice(0, 400)}`)
                }
              }
              text = msgs.join('\n\n')
              setSessContent(p => ({ ...p, [sid]: text || '' }))
            }
          } catch { text = '' }
        }
        if (text?.trim()) parts.push(`## 会话 ${sid.slice(0, 8)}\n\n${text.slice(0, 4000)}`)
      }
    }

    if (parts.length === 0) { setError('未提取到有效内容'); setExtracting(false); return }
    setResultContent(parts.join('\n\n---\n\n'))
    setResultTitle(names.join('、').slice(0, 80))
    setResultTags('')
    setStep('edit')
    setExtracting(false)
  }

  async function saveKnowledge() {
    if (!resultTitle.trim() || !resultContent.trim()) { setError('标题和内容不能为空'); return }
    setSaving(true); setError(null)
    try {
      const r = await window.electronAPI.knowledgeCreate({
        projectPath, title: resultTitle.trim(), content: resultContent,
        type: resultType, tags: resultTags, sources: [...selectedSrc].join(', '),
      })
      if (r?.success) { resetSediment(); loadAll(); showHint('✅ 知识已保存') }
      else setError(r?.error || '保存失败')
    } catch (e: any) { setError(e?.message || '保存失败') }
    setSaving(false)
  }

  function resetSediment() { setStep('pick'); setSelectedSrc(new Set()); setResultContent(''); setResultTitle(''); setError(null) }

  // ── Calendar ──────────────────────────────
  const [calDate, setCalDate] = useState(() => new Date())
  const calYear = calDate.getFullYear()
  const calMonth = calDate.getMonth()

  const calData = useMemo(() => {
    const map: Record<string, { m: number; k: number; s: number; items: string[] }> = {}
    function add(d: string, type: 'm' | 'k' | 's', name: string) {
      if (!map[d]) map[d] = { m: 0, k: 0, s: 0, items: [] }
      map[d][type]++; map[d].items.push(name)
    }
    memories.forEach(m => { if (m.mtime) add(m.mtime.split('T')[0], 'm', m.name) })
    entries.forEach(e => { if (e.mtime) add(e.mtime.split('T')[0], 'k', e.name) })
    sessions.forEach(s => { add(s.modifiedAt.split('T')[0], 's', `会话 ${s.sessionId.slice(0, 8)}`) })
    return map
  }, [memories, entries, sessions])

  const calGrid = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1).getDay()
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()
    const today = new Date().toISOString().split('T')[0]
    const weeks: { day: number; date: string; isToday: boolean; data?: typeof calData[string] }[][] = []
    let week: typeof weeks[0] = []
    for (let i = 0; i < firstDay; i++) week.push({ day: 0, date: '', isToday: false })
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      week.push({ day: d, date: ds, isToday: ds === today, data: calData[ds] })
      if (week.length === 7) { weeks.push(week); week = [] }
    }
    if (week.length > 0) weeks.push(week)
    return weeks
  }, [calYear, calMonth, calData])

  const calMax = useMemo(() => Math.max(1, ...Object.values(calData).map(d => d.m + d.k + d.s)), [calData])

  // ── AI workflow ──────────────────────────
  const [workflowTasks, setWorkflowTasks] = useState<{ id: string; name: string; type: string; prompt: string; schedule: string; lastRun?: string }[]>([])
  const [showNewTask, setShowNewTask] = useState(false)
  const [taskName, setTaskName] = useState('')
  const [taskType, setTaskType] = useState('memory')
  const [taskPrompt, setTaskPrompt] = useState('')
  const [taskSchedule, setTaskSchedule] = useState('manual')
  const hintRef = useRef<HTMLDivElement>(null)

  function showHint(msg: string) { if (hintRef.current) { hintRef.current.textContent = msg; hintRef.current.style.opacity = '1'; setTimeout(() => { if (hintRef.current) hintRef.current.style.opacity = '0' }, 2500) } }

  function addTask() {
    if (!taskName.trim()) return
    setWorkflowTasks(p => [...p, { id: Date.now().toString(36), name: taskName.trim(), type: taskType, prompt: taskPrompt, schedule: taskSchedule, lastRun: undefined }])
    setShowNewTask(false); setTaskName(''); setTaskPrompt('')
  }

  async function runTask(task: typeof workflowTasks[0]) {
    const sources = taskType === 'memory' ? memories : sessions
    const text = `## AI 知识提取任务: ${task.name}\n\n请根据以下内容，提取关键知识，按主题归类整理：\n\n${task.prompt || '提取有价值的技术决策、架构设计和经验教训'}\n\n---\n\n${sources.slice(0, 10).map(s => {
      const n = 'name' in s ? (s as any).name : `会话 ${s.sessionId.slice(0, 8)}`
      return `- ${n}: ${(s as any).description || (s as any).modifiedAt || ''}`
    }).join('\n')}`
    try {
      await navigator.clipboard.writeText(text)
      showHint('📋 AI 任务 prompt 已复制到剪贴板，请粘贴到 Chat 中执行')
    } catch { showHint('❌ 复制失败') }
    setWorkflowTasks(p => p.map(t => t.id === task.id ? { ...t, lastRun: new Date().toISOString() } : t))
  }

  // ── Browse ────────────────────────────────
  const [filterType, setFilterType] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<KnowledgeEntry | null>(null)
  const [entryContent, setEntryContent] = useState('')

  const filtered = useMemo(() => {
    let list = entries
    if (filterType !== 'all') list = list.filter(e => e.type === filterType)
    if (search) { const q = search.toLowerCase(); list = list.filter(e => e.name.toLowerCase().includes(q) || e.tags.toLowerCase().includes(q)) }
    return list
  }, [entries, filterType, search])

  async function viewEntry(e: KnowledgeEntry) {
    setSelectedEntry(e)
    try { const r = await window.electronAPI.knowledgeRead({ projectPath, fileName: e.fileName }); setEntryContent(r?.success ? r.content : '') } catch { setEntryContent('') }
  }

  const stats = useMemo(() => {
    const byType: Record<string, number> = {}; const bySrc: Record<string, number> = {}
    for (const e of entries) { byType[e.type] = (byType[e.type] || 0) + 1; e.sources ? bySrc['有来源'] = (bySrc['有来源'] || 0) + 1 : bySrc['无来源'] = (bySrc['无来源'] || 0) + 1 }
    return { total: entries.length, byType, bySrc }
  }, [entries])

  const STATUS_COLORS: Record<string, string> = { draft: '#f0a040', reviewed: '#4a5cf7', published: '#4caf50' }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className={`dialog${maximized ? ' maximized' : ''}`} onClick={e => e.stopPropagation()}
        style={{ width: winSize.w, height: winSize.h, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div className="dialog-header">
          <h2>📚 知识管理</h2>
          <span ref={hintRef} style={{ fontSize: 11, opacity: 0, transition: 'opacity .3s', color: '#4caf50', marginRight: 8 }} />
          <div style={{ flex: 1 }} />
          <button onClick={toggleMaximize} className="dialog-close" title={maximized ? '还原' : '最大化'} style={{ fontSize: 14 }}>{maximized ? '❐' : '□'}</button>
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>

        {/* Tabs */}
        <div className="kn-tabs">
          <button className={`kn-tab${tab === 'sediment' ? ' active' : ''}`} onClick={() => { resetSediment(); setTab('sediment') }}>🌊 知识沉淀</button>
          <button className={`kn-tab${tab === 'calendar' ? ' active' : ''}`} onClick={() => setTab('calendar')}>📅 日历</button>
          <button className={`kn-tab${tab === 'browse' ? ' active' : ''}`} onClick={() => setTab('browse')}>📂 知识库</button>
          <button className={`kn-tab${tab === 'stats' ? ' active' : ''}`} onClick={() => setTab('stats')}>📊 统计</button>
          <button className={`kn-tab${tab === 'workflow' ? ' active' : ''}`} onClick={() => setTab('workflow')}>⚙️ 工作流</button>
        </div>

        <div className="kn-body">
          {/* ═══════ SEDIMENT ═══════ */}
          {tab === 'sediment' && (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Independent source browser - left panel */}
              <div style={{ width: 260, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
                  <button className={`kn-src-tab${sedimentSource === 'memory' ? ' active' : ''}`} onClick={() => { setSedimentSource('memory'); setSelectedSrc(new Set()) }}>🧠 记忆</button>
                  <button className={`kn-src-tab${sedimentSource === 'session' ? ' active' : ''}`} onClick={() => { setSedimentSource('session'); setSelectedSrc(new Set()) }}>💬 会话</button>
                </div>
                {/* Independent memory list */}
                <div className="kn-scroll" style={{ padding: 0 }}>
                  {sedimentSource === 'memory' && memories.map(m => (
                    <div key={m.fileName} className={`kn-src-item${selectedSrc.has(m.fileName) ? ' selected' : ''}`} onClick={() => toggleSrc(m.fileName)}>
                      <input type="checkbox" checked={selectedSrc.has(m.fileName)} readOnly className="ses-checkbox" />
                      <div className="kn-src-text">
                        <div className="kn-src-name">{m.name}</div>
                        <div className="kn-src-meta">{m.type || '未分类'} {m.mtime ? `· ${new Date(m.mtime).toLocaleDateString()}` : ''}</div>
                      </div>
                    </div>
                  ))}
                  {sedimentSource === 'session' && sessions.map(s => (
                    <div key={s.sessionId} className={`kn-src-item${selectedSrc.has(s.sessionId) ? ' selected' : ''}`} onClick={() => toggleSrc(s.sessionId)}>
                      <input type="checkbox" checked={selectedSrc.has(s.sessionId)} readOnly className="ses-checkbox" />
                      <div className="kn-src-text">
                        <div className="kn-src-name">会话 {s.sessionId.slice(0, 10)}</div>
                        <div className="kn-src-meta">{new Date(s.modifiedAt).toLocaleDateString()} {s.size ? `· ${(s.size / 1024).toFixed(0)}KB` : ''}</div>
                      </div>
                    </div>
                  ))}
                  {((sedimentSource === 'memory' && memories.length === 0) || (sedimentSource === 'session' && sessions.length === 0)) && (
                    <div className="empty-hint" style={{ padding: 24 }}>暂无数据</div>
                  )}
                </div>
              </div>

              {/* Right: extract / edit */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {step === 'pick' ? (
                  <div className="kn-scroll" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%' }}>
                    <div style={{ fontSize: 36, opacity: 0.25 }}>🌊</div>
                    <div style={{ fontSize: 14, color: isDark ? '#ccc' : '#444' }}>从独立记忆/会话浏览器选择来源</div>
                    <div style={{ fontSize: 11, color: isDark ? '#666' : '#999', textAlign: 'center', lineHeight: 1.8 }}>
                      左侧面板独立展示所有记忆/会话<br />
                      不与原左侧栏共用数据状态<br />
                      勾选后点击下方按钮提取
                    </div>
                    <button className="btn btn-primary" onClick={doExtract} disabled={selectedSrc.size === 0 || extracting}
                      style={{ padding: '8px 28px', fontSize: 13 }}>
                      {extracting ? '提取中...' : `🚀 提取 ${selectedSrc.size} 个来源`}
                    </button>
                    {error && <div style={{ color: '#ff5050', fontSize: 11 }}>{error}</div>}
                  </div>
                ) : (
                  <div className="kn-scroll" style={{ padding: 12 }}>
                    <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
                      <input type="text" value={resultTitle} onChange={e => setResultTitle(e.target.value)} placeholder="知识标题 *"
                        style={{ flex: 1, padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <select value={resultType} onChange={e => setResultType(e.target.value)}
                        style={{ padding: '4px 8px', fontSize: 11, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }}>
                        {KNOWLEDGE_TYPES.map(t => <option key={t.id} value={t.id}>{t.icon} {t.label}</option>)}
                      </select>
                      <input type="text" value={resultTags} onChange={e => setResultTags(e.target.value)} placeholder="标签（逗号分隔）"
                        style={{ flex: 1, padding: '4px 8px', fontSize: 11, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }} />
                      <button className="btn btn-sm" onClick={resetSediment}>← 返回</button>
                    </div>
                    <textarea value={resultContent} onChange={e => setResultContent(e.target.value)}
                      style={{ width: '100%', minHeight: 180, padding: '8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', resize: 'vertical', fontFamily: 'Consolas, monospace', lineHeight: 1.6, boxSizing: 'border-box' }} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: isDark ? '#666' : '#999' }}>来源: {[...selectedSrc].slice(0, 3).join(', ')}{selectedSrc.size > 3 ? `...等${selectedSrc.size}个` : ''}</span>
                      <div style={{ flex: 1 }} />
                      <button className="btn btn-sm" onClick={resetSediment}>重置</button>
                      <button className="btn btn-primary" onClick={saveKnowledge} disabled={saving || !resultTitle.trim() || !resultContent.trim()} style={{ padding: '6px 16px' }}>
                        {saving ? '保存中...' : '💾 保存为知识'}
                      </button>
                    </div>
                    {error && <div style={{ color: '#ff5050', fontSize: 11, marginTop: 4 }}>{error}</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════ WORKFLOW ═══════ */}
          {tab === 'workflow' && (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              {/* Left: task list */}
              <div style={{ width: 260, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#ccc' : '#333' }}>⚙️ 任务列表</span>
                  <button className="btn btn-sm" onClick={() => setShowNewTask(true)}>+ 新建</button>
                </div>
                <div className="kn-scroll" style={{ padding: 0 }}>
                  {workflowTasks.length === 0 ? (
                    <div className="empty-hint" style={{ padding: 24, textAlign: 'center' }}>
                      <div style={{ fontSize: 24, opacity: 0.3, marginBottom: 8 }}>⚙️</div>
                      暂无任务
                      <div style={{ fontSize: 10, marginTop: 8, color: isDark ? '#666' : '#999' }}>点击「+ 新建」创建提取工作流</div>
                    </div>
                  ) : (
                    workflowTasks.map(task => (
                      <div key={task.id} className={`kn-wf-item${task.lastRun ? ' ran' : ''}`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="kn-wf-status-dot" style={{ background: task.lastRun ? '#4caf50' : '#888' }} />
                          <span style={{ fontSize: 13 }}>{task.type === 'memory' ? '🧠' : '💬'}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isDark ? '#e0e0e0' : '#333' }}>{task.name}</div>
                            <div style={{ fontSize: 9, color: isDark ? '#666' : '#999' }}>
                              {task.type === 'memory' ? '记忆' : '会话'} · {task.schedule === 'auto' ? '🔄 自动' : '🖐️ 手动'}
                            </div>
                          </div>
                        </div>
                        {task.lastRun && (
                          <div style={{ fontSize: 9, color: isDark ? '#555' : '#bbb', padding: '2px 0' }}>
                            上次执行: {new Date(task.lastRun).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
              {/* Right: flow visualization + monitor */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {showNewTask ? (
                  <div className="kn-scroll" style={{ padding: 16 }}>
                    <div className="kn-section-title">🆕 新建提取任务</div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>任务名称</label>
                      <input type="text" value={taskName} onChange={e => setTaskName(e.target.value)} placeholder="例: 每周知识沉淀"
                        style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>来源类型</label>
                      <select value={taskType} onChange={e => setTaskType(e.target.value)}
                        style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }}>
                        <option value="memory">🧠 记忆</option>
                        <option value="session">💬 会话</option>
                      </select>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>AI 提取指令</label>
                      <textarea value={taskPrompt} onChange={e => setTaskPrompt(e.target.value)} placeholder="告诉 AI 提取什么类型的信息..."
                        rows={3} style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>执行计划</label>
                      <select value={taskSchedule} onChange={e => setTaskSchedule(e.target.value)}
                        style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }}>
                        <option value="manual">🖐️ 手动执行</option>
                        <option value="auto">🔄 自动（每次对话后）</option>
                      </select>
                    </div>
                    {/* Buttons at the bottom */}
                    <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 8 }}>
                      <button className="btn" onClick={() => setShowNewTask(false)}>取消</button>
                      <div style={{ flex: 1 }} />
                      <button className="btn btn-primary" onClick={addTask} disabled={!taskName.trim()}>创建任务</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {/* Flow visualization */}
                    <div className="kn-wf-flow">
                      <div className="kn-wf-step"><div className="kn-wf-step-icon">📂</div><div className="kn-wf-step-label">选择来源</div></div>
                      <div className="kn-wf-arrow">→</div>
                      <div className="kn-wf-step"><div className="kn-wf-step-icon">🤖</div><div className="kn-wf-step-label">AI 提取</div></div>
                      <div className="kn-wf-arrow">→</div>
                      <div className="kn-wf-step"><div className="kn-wf-step-icon">📝</div><div className="kn-wf-step-label">审核编辑</div></div>
                      <div className="kn-wf-arrow">→</div>
                      <div className="kn-wf-step"><div className="kn-wf-step-icon">💾</div><div className="kn-wf-step-label">保存知识</div></div>
                    </div>
                    {/* Monitor panel */}
                    <div className="kn-wf-monitor">
                      <div className="kn-wf-monitor-header">📊 执行监控</div>
                      <div className="kn-wf-monitor-body">
                        {workflowTasks.length === 0 ? (
                          <div style={{ textAlign: 'center', padding: 24, fontSize: 11, color: isDark ? '#666' : '#999' }}>
                            暂无任务，点击左侧「+ 新建」创建
                          </div>
                        ) : (
                          workflowTasks.map(task => (
                            <div key={task.id} className="kn-wf-monitor-item">
                              <div className="kn-wf-monitor-row">
                                <span className="kn-wf-status-dot" style={{ background: task.lastRun ? '#4caf50' : '#888' }} />
                                <span style={{ fontSize: 12, fontWeight: 600, flex: 1, color: isDark ? '#e0e0e0' : '#333' }}>{task.name}</span>
                                <span style={{ fontSize: 10, color: isDark ? '#666' : '#999' }}>
                                  {task.type === 'memory' ? '🧠 记忆' : '💬 会话'} · {task.schedule === 'auto' ? '自动' : '手动'}
                                </span>
                              </div>
                              <div className="kn-wf-monitor-row" style={{ marginTop: 4 }}>
                                <div style={{ flex: 1, fontSize: 10, color: isDark ? '#555' : '#bbb' }}>
                                  {task.lastRun ? `上次执行: ${new Date(task.lastRun).toLocaleString()}` : '尚未执行'}
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button className="btn btn-sm" onClick={() => runTask(task)}>▶ 运行</button>
                                  <button className="btn btn-sm" onClick={() => {
                                    const prompt = `## AI 知识提取任务: ${task.name}\n\n任务说明：${task.prompt || '提取有价值的技术决策和架构设计'}\n\n请基于当前项目状态进行分析。`
                                    navigator.clipboard.writeText(prompt).then(() => showHint('📋 AI 指令已复制')).catch(() => {})
                                  }}>📋 复制指令</button>
                                </div>
                              </div>
                              {task.lastRun && (
                                <div className="kn-wf-monitor-progress">
                                  <div className="kn-wf-monitor-bar" style={{ width: '100%' }} />
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    {/* Bottom actions */}
                    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button className="btn btn-sm" onClick={() => setShowNewTask(true)}>+ 新建任务</button>
                      <button className="btn btn-sm" onClick={async () => {
                        const all = workflowTasks.map(t => `- ${t.name} [${t.type}] ${t.lastRun ? `上次: ${new Date(t.lastRun).toLocaleDateString()}` : '未执行'}`).join('\n')
                        const text = `## 工作流执行报告\n\n共 ${workflowTasks.length} 个任务\n\n${all || '(无任务)'}`
                        await navigator.clipboard.writeText(text)
                        showHint('📋 报告已复制')
                      }} disabled={workflowTasks.length === 0}>📋 导出报告</button>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: isDark ? '#555' : '#bbb', alignSelf: 'center' }}>
                        {workflowTasks.filter(t => t.lastRun).length}/{workflowTasks.length} 已执行
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═══════ CALENDAR ═══════ */}
          {tab === 'calendar' && (
            <div className="kn-scroll">
              <div className="cal-nav">
                <button className="btn btn-sm" onClick={() => setCalDate(new Date(calYear, calMonth - 1))}>◀</button>
                <span className="cal-nav-title">{calYear} 年 {calMonth + 1} 月</span>
                <button className="btn btn-sm" onClick={() => setCalDate(new Date(calYear, calMonth + 1))}>▶</button>
                <button className="btn btn-sm" onClick={() => setCalDate(new Date())} style={{ marginLeft: 8 }}>今天</button>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: isDark ? '#666' : '#999' }}>
                  🧠{Object.values(calData).reduce((s, d) => s + d.m, 0)} 📚{Object.values(calData).reduce((s, d) => s + d.k, 0)} 💬{Object.values(calData).reduce((s, d) => s + d.s, 0)}
                </span>
              </div>
              <table className="cal-table">
                <thead><tr>{['日','一','二','三','四','五','六'].map(d => <th key={d} className="cal-th">{d}</th>)}</tr></thead>
                <tbody>{calGrid.map((week, wi) => (
                  <tr key={wi}>{week.map((cell, ci) => (
                    <td key={ci} className={`cal-td${cell.isToday ? ' today' : ''}${!cell.day ? ' empty' : ''}`}>
                      {cell.day > 0 && <div className="cal-cell">
                        <div className="cal-day">{cell.day}</div>
                        {cell.data && <div className="cal-dots">
                          {cell.data.m > 0 && <span className="cal-dot" style={{ background: '#4a5cf7' }} title={`${cell.data.m} 记忆`} />}
                          {cell.data.k > 0 && <span className="cal-dot" style={{ background: '#4caf50' }} title={`${cell.data.k} 知识`} />}
                          {cell.data.s > 0 && <span className="cal-dot" style={{ background: '#f0a040' }} title={`${cell.data.s} 会话`} />}
                        </div>}
                        {cell.data && <div className="cal-bar-track"><div className="cal-bar-fill" style={{ width: `${Math.min(100, ((cell.data.m + cell.data.k + cell.data.s) / calMax) * 100)}%` }} /></div>}
                      </div>}
                    </td>
                  ))}</tr>
                ))}</tbody>
              </table>
              <div className="cal-legend">
                <span className="cal-legend-dot" style={{ background: '#4a5cf7' }} /> 记忆
                <span className="cal-legend-dot" style={{ background: '#4caf50', marginLeft: 12 }} /> 知识
                <span className="cal-legend-dot" style={{ background: '#f0a040', marginLeft: 12 }} /> 会话
              </div>
            </div>
          )}

          {/* ═══════ BROWSE ═══════ */}
          {tab === 'browse' && (
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
              <div style={{ width: 260, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-light)' }}>
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索..."
                    style={{ width: '100%', padding: '4px 8px', fontSize: 11, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '4px 8px', borderBottom: '1px solid var(--border-light)' }}>
                  <button className={`kn-filter-btn${filterType === 'all' ? ' active' : ''}`} onClick={() => setFilterType('all')}>全部</button>
                  {KNOWLEDGE_TYPES.map(t => (
                    <button key={t.id} className={`kn-filter-btn${filterType === t.id ? ' active' : ''}`} onClick={() => setFilterType(t.id)} title={t.label}>{t.icon}</button>
                  ))}
                </div>
                <div className="kn-scroll" style={{ padding: 0 }}>
                  {filtered.map(e => (
                    <div key={e.fileName} className={`kn-list-item${selectedEntry?.fileName === e.fileName ? ' active' : ''}`} onClick={() => viewEntry(e)}>
                      <span className="kn-list-item-icon">{getTypeIcon(e.type)}</span>
                      <div className="kn-list-item-content">
                        <div className="kn-list-item-name">{e.name}</div>
                        <div className="kn-list-item-meta">{e.tags || '无标签'}</div>
                      </div>
                      <span className="kn-list-item-status" style={{ background: STATUS_COLORS[e.status] || '#888' }}>{e.status}</span>
                    </div>
                  ))}
                  {filtered.length === 0 && <div className="empty-hint" style={{ padding: 24 }}>暂无知识</div>}
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {selectedEntry ? (
                  <>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 18 }}>{getTypeIcon(selectedEntry.type)}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#e0e0e0' : '#333' }}>{selectedEntry.name}</div>
                        <div style={{ fontSize: 10, color: isDark ? '#666' : '#999' }}>{selectedEntry.type} · {selectedEntry.tags || '无标签'}</div>
                      </div>
                      <button className="btn btn-sm" onClick={async () => {
                        if (!confirm(`删除 "${selectedEntry.name}"？`)) return
                        const r = await window.electronAPI.knowledgeDelete({ projectPath, fileName: selectedEntry.fileName })
                        if (r?.success) { setSelectedEntry(null); loadAll() }
                      }} style={{ color: '#ff5050' }}>🗑️</button>
                    </div>
                    <div className="kn-scroll">
                      <div className="kn-detail-section"><span className="kn-detail-label">来源</span><span className="kn-detail-value">{selectedEntry.sources || '无'}</span></div>
                      <div style={{ padding: 12, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: isDark ? '#ccc' : '#333' }}>
                        {entryContent.replace(/^---[\s\S]*?---\n*/m, '').trim() || '(无内容)'}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="empty-hint" style={{ padding: 40 }}>选择知识查看详情</div>
                )}
              </div>
            </div>
          )}

          {/* ═══════ STATS ═══════ */}
          {tab === 'stats' && (
            <div className="kn-scroll">
              <div className="kn-stats-cards">
                <div className="kn-stat-card"><span className="kn-stat-num">{stats.total}</span><span className="kn-stat-label">知识总数</span></div>
                <div className="kn-stat-card"><span className="kn-stat-num">{memories.length}</span><span className="kn-stat-label">记忆来源</span></div>
                <div className="kn-stat-card"><span className="kn-stat-num">{sessions.length}</span><span className="kn-stat-label">会话来源</span></div>
                <div className="kn-stat-card"><span className="kn-stat-num">{(stats.bySrc['有来源'] || 0)}</span><span className="kn-stat-label">已链接知识</span></div>
              </div>
              {Object.keys(stats.byType).length > 0 && (
                <div className="kn-section">
                  <div className="kn-section-title">📂 类型分布</div>
                  {Object.entries(stats.byType).sort(([, a], [, b]) => b - a).map(([type, count]) => (
                    <div key={type} className="kn-bar-row">
                      <span className="kn-bar-label">{getTypeIcon(type)} {type}</span>
                      <div className="kn-bar-track"><div className="kn-bar-fill" style={{ width: `${(count / Math.max(...Object.values(stats.byType), 1)) * 100}%`, background: '#4a5cf7' }} /></div>
                      <span className="kn-bar-count">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
