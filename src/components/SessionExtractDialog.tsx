import { useState, useEffect, useMemo, useRef } from 'react'

interface SessionItem {
  sessionId: string; projectPath?: string; modifiedAt: string; size?: number
}

interface Props {
  theme: 'dark' | 'light'
  projectPath: string
  onSave: (title: string, content: string) => Promise<void>
  onClose: () => void
  onApplyToChat?: (text: string) => void
}

export function SessionExtractDialog({ theme, projectPath, onSave, onClose, onApplyToChat }: Props) {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  // Extraction
  const [extracted, setExtracted] = useState('')
  const [title, setTitle] = useState('')
  const [keyword, setKeyword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Window state: 80% ↔ fullscreen
  const [maximized, setMaximized] = useState(false)
  const [winSize, setWinSize] = useState({ w: 1000, h: 700 })

  // Smart check
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  // Time range
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const isDark = theme === 'dark'

  // ── Window size (80% vs 100%) ──────────────
  function updateSize(full: boolean) {
    const w = full ? window.innerWidth : Math.floor(window.innerWidth * 0.8)
    const h = full ? window.innerHeight : Math.floor(window.innerHeight * 0.8)
    setWinSize({ w: Math.max(700, w), h: Math.max(500, h) })
  }

  useEffect(() => {
    updateSize(maximized)
    const onResize = () => {
      const w = maximized ? window.innerWidth : Math.floor(window.innerWidth * 0.8)
      const h = maximized ? window.innerHeight : Math.floor(window.innerHeight * 0.8)
      setWinSize({ w: Math.max(700, w), h: Math.max(500, h) })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [maximized])

  function toggleMaximize() {
    const next = !maximized
    setMaximized(next)
    updateSize(next)
  }

  useEffect(() => { loadSessions() }, [])

  // ── Filtered sessions ─────────────────────────
  const filtered = useMemo(() => {
    let list = sessions
    if (dateFrom) { const from = new Date(dateFrom).getTime(); list = list.filter(s => new Date(s.modifiedAt).getTime() >= from) }
    if (dateTo) { const to = new Date(dateTo).getTime() + 86400000; list = list.filter(s => new Date(s.modifiedAt).getTime() <= to) }
    return list
  }, [sessions, dateFrom, dateTo])

  function setQuickDate(days: number) {
    const to = new Date(); const from = new Date()
    if (days > 0) from.setDate(from.getDate() - days)
    setDateFrom(from.toISOString().split('T')[0]); setDateTo(to.toISOString().split('T')[0])
  }
  function setToday() { const d = new Date().toISOString().split('T')[0]; setDateFrom(d); setDateTo(d) }
  function toggleSelectAll() {
    selectedIds.size === filtered.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(filtered.map(s => s.sessionId)))
  }

  async function loadSessions() {
    setLoading(true)
    try { const list = await window.electronAPI.listSessions(projectPath); if (Array.isArray(list)) setSessions(list) } catch { /* ignore */ }
    setLoading(false)
  }

  // ── Preview ──────────────────────────────────
  async function handlePreview(sessionId: string) {
    setPreviewId(sessionId); setPreviewLoading(true); setPreviewContent('')
    try {
      const r = await window.electronAPI.getSessionTranscript(sessionId)
      if (r?.events) {
        const parts: string[] = []
        for (const ev of r.events) {
          if (ev.type === 'user') {
            const text = typeof ev.content === 'string' ? ev.content : ev.content?.find((c: any) => c.type === 'text')?.text || ''
            if (text.trim()) parts.push(`**用户:** ${text.trim().slice(0, 500)}`)
          } else if (ev.type === 'assistant') {
            const text = ev.message?.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') || ''
            if (text.trim()) parts.push(`**AI:** ${text.trim().slice(0, 300)}`)
          }
        }
        setPreviewContent(parts.join('\n\n---\n\n') || '(空)')
      }
    } catch { setPreviewContent('(无法读取)') }
    setPreviewLoading(false)
  }

  function toggleSelect(sessionId: string) {
    setSelectedIds(prev => { const next = new Set(prev); next.has(sessionId) ? next.delete(sessionId) : next.add(sessionId); return next })
  }

  // ── Extract ──────────────────────────────────
  async function handleExtract() {
    if (selectedIds.size === 0) { setError('请先选择会话'); return }
    setError(null); setExtracted(''); setCheckResult(null); setLoading(true)
    const allParts: string[] = []; let firstTitle = ''
    for (const sid of selectedIds) {
      try {
        const r = await window.electronAPI.getSessionTranscript(sid)
        if (!r?.events) continue
        const sessionParts: string[] = []
        for (const ev of r.events) {
          if (ev.type === 'user') {
            const text = typeof ev.content === 'string' ? ev.content : ev.content?.find((c: any) => c.type === 'text')?.text || ''
            if (text.trim() && (!keyword || text.toLowerCase().includes(keyword.toLowerCase()))) {
              sessionParts.push(`## 用户\n\n${text.trim()}`)
              if (!firstTitle) firstTitle = text.trim().slice(0, 60).replace(/[\n\r]/g, ' ').trim()
            }
          } else if (ev.type === 'assistant' && ev.message?.content) {
            const text = ev.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            if (text.trim() && (!keyword || text.toLowerCase().includes(keyword.toLowerCase()))) { sessionParts.push(`## AI\n\n${text.trim()}`) }
          }
        }
        if (sessionParts.length > 0) allParts.push(`# 会话 ${sid.slice(0, 8)}\n${sessionParts.join('\n\n---\n\n')}`)
      } catch { /* skip */ }
    }
    if (allParts.length === 0) setError(keyword ? '未找到包含关键词的内容' : '未提取到有效内容')
    else { setExtracted(allParts.join('\n\n---\n\n')); setTitle(firstTitle || `批量提取 ${selectedIds.size} 个会话`) }
    setLoading(false)
  }

  async function handleSave() {
    if (!title.trim() || !extracted.trim()) return
    setSaving(true); setError(null)
    try { await onSave(title.trim(), extracted); onClose() } catch (e: any) { setError(e?.message || '保存失败') }
    setSaving(false)
  }

  // ── Smart check via Claude evaluation prompt ─
  async function handleSmartCheck() {
    if (!extracted.trim()) return
    setChecking(true); setCheckResult(null)
    const prompt = `你是一个记忆质量评估专家。请评估以下内容作为项目记忆的价值，从三个方面评价：

1. **有用性**（1-10分）：这段信息对后续项目工作是否有参考价值？
2. **准确性**（1-10分）：内容是否准确、无错误？
3. **完整性**（1-10分）：信息是否完整，是否需要补充？

请按以下格式回复：
\`\`\`
有用性: X/10 简短理由
准确性: X/10 简短理由
完整性: X/10 简短理由
总评: 一句话结论
\`\`\`

评价内容：
${extracted.slice(0, 4000)}`

    try {
      // Copy prompt to chat and notify user
      onApplyToChat?.(prompt)
      setCheckResult('评估请求已发送到 Chat，请查看 AI 回复')
    } catch { setCheckResult('发送失败') }
    setChecking(false)
  }

  function formatDateShort(iso: string): string {
    try { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}` } catch { return '' }
  }

  const CAL_ICON = 'M3 3h1V1h1v2h6V1h1v2h1v10H2V3h1zm0 1v2h10V4H3zm0 3v5h10V7H3z'

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className={`dialog${maximized ? ' maximized' : ''}`} onClick={e => e.stopPropagation()}
        style={{ width: winSize.w, height: winSize.h, display: 'flex', flexDirection: 'column', padding: 0 }}>
        {/* ── Header ─────────────────────────── */}
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <h2>📤 AI 会话一键提取</h2>
          <span style={{ fontSize: 11, color: isDark ? '#666' : '#999', marginLeft: 8 }}>
            已选 {selectedIds.size} 个会话
          </span>
          <div style={{ flex: 1 }} />
          {checkResult && (
            <span style={{ fontSize: 10, color: '#4caf50', marginRight: 8 }}>{checkResult}</span>
          )}
          <button onClick={toggleMaximize} className="dialog-close" title={maximized ? '还原' : '最大化'} style={{ fontSize: 14 }}>
            {maximized ? '❐' : '□'}
          </button>
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>

        {/* ── Top bar ────────────────────────── */}
        <div className="ses-topbar">
          {/* Quick date */}
          <div className="ses-topbar-group">
            <button className={`ses-date-btn${!dateFrom && !dateTo ? ' active' : ''}`} onClick={() => { setDateFrom(''); setDateTo('') }}>全部</button>
            <button className="ses-date-btn" onClick={setToday}>今天</button>
            <button className="ses-date-btn" onClick={() => setQuickDate(7)}>7天</button>
            <button className="ses-date-btn" onClick={() => setQuickDate(15)}>15天</button>
            <button className="ses-date-btn" onClick={() => setQuickDate(30)}>30天</button>
          </div>
          {/* Date pickers */}
          <div className="ses-topbar-group">
            <span className="ses-date-icon-wrap">
              <svg width="12" height="12" viewBox="0 0 16 16" fill={isDark ? '#aaa' : '#666'}><path d={CAL_ICON} /></svg>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="ses-date-input" title="开始日期" />
            </span>
            <span style={{ fontSize: 9, color: isDark ? '#555' : '#bbb' }}>至</span>
            <span className="ses-date-icon-wrap">
              <svg width="12" height="12" viewBox="0 0 16 16" fill={isDark ? '#aaa' : '#666'}><path d={CAL_ICON} /></svg>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="ses-date-input" title="结束日期" />
            </span>
          </div>
          {/* Keyword */}
          <div className="ses-topbar-group">
            <span style={{ fontSize: 11, color: isDark ? '#888' : '#999' }}>🔍</span>
            <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
              placeholder="关键词" className="ses-keyword-input"
              onKeyDown={e => { if (e.key === 'Enter') handleExtract() }} />
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={handleExtract} disabled={selectedIds.size === 0 || loading}>
            {loading ? '提取中...' : '🚀 提取'}
          </button>
        </div>

        {/* ── Body ───────────────────────────── */}
        <div className="ses-body">
          {/* Left: Session list */}
          <div className="ses-panel ses-panel-left">
            <div className="ses-panel-header" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={filtered.length > 0 && selectedIds.size === filtered.length}
                onChange={toggleSelectAll} className="ses-checkbox" title="全选/取消" />
              <span>会话 ({filtered.length})</span>
              {selectedIds.size > 0 && <span style={{ fontSize: 9, opacity: 0.6 }}>已选{selectedIds.size}</span>}
            </div>
            <div className="ses-panel-scroll">
              {loading && sessions.length === 0 ? <div className="empty-hint" style={{ padding: 16 }}>加载中...</div>
                : filtered.length === 0 ? <div className="empty-hint" style={{ padding: 16 }}>暂无会话</div>
                : filtered.map(s => (
                    <div key={s.sessionId} className={`ses-session-item${selectedIds.has(s.sessionId) ? ' selected' : ''}${previewId === s.sessionId ? ' preview' : ''}`}>
                      <input type="checkbox" checked={selectedIds.has(s.sessionId)}
                        onChange={() => toggleSelect(s.sessionId)} className="ses-checkbox" />
                      <div className="ses-session-info" onClick={() => handlePreview(s.sessionId)}>
                        <div className="ses-session-name" style={{ fontWeight: previewId === s.sessionId ? 700 : 400 }}>
                          会话 {s.sessionId.slice(0, 8)}
                        </div>
                        <div className="ses-session-meta">{formatDateShort(s.modifiedAt)}{s.size ? ` · ${(s.size / 1024).toFixed(0)}KB` : ''}</div>
                      </div>
                    </div>
                  ))
              }
            </div>
          </div>

          {/* Center: Preview */}
          <div className="ses-panel ses-panel-center">
            <div className="ses-panel-header">会话预览</div>
            <div className="ses-panel-scroll" style={{ padding: 10 }}>
              {previewLoading ? <div className="empty-hint">加载中...</div>
                : previewContent ? <div style={{ fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: isDark ? '#ccc' : '#333' }}>{previewContent}</div>
                : <div className="empty-hint">点击左侧会话预览内容</div>}
            </div>
          </div>

          {/* Right: Extraction result */}
          <div className="ses-panel ses-panel-right">
            <div className="ses-panel-header">
              提取结果
              {extracted && <span style={{ fontSize: 10, color: isDark ? '#666' : '#999', marginLeft: 8 }}>{extracted.length} 字符</span>}
            </div>
            <div className="ses-panel-scroll" style={{ padding: 8, display: 'flex', flexDirection: 'column' }}>
              {extracted ? (
                <>
                  <div style={{ marginBottom: 6, flexShrink: 0 }}>
                    <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                      placeholder="记忆标题"
                      style={{ width: '100%', padding: '4px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <textarea value={extracted} onChange={e => setExtracted(e.target.value)}
                    spellCheck={false}
                    style={{ flex: 1, width: '100%', border: '1px solid var(--border)', borderRadius: 6, resize: 'none', padding: 8, fontFamily: 'Consolas, "Courier New", monospace', fontSize: 11, lineHeight: 1.6, background: isDark ? '#1a1a1a' : '#fafafa', color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} />
                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                    <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || !title.trim()}>
                      {saving ? '保存中...' : '💾 保存为记忆'}
                    </button>
                    <button className="btn btn-sm" onClick={handleSmartCheck} disabled={checking}>
                      {checking ? '检查中...' : '🔍 智能检查'}
                    </button>
                    <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(extracted); setError(null) }} title="复制内容到剪贴板">
                      📋 复制
                    </button>
                    <span style={{ fontSize: 9, color: isDark ? '#555' : '#aaa', alignSelf: 'center', marginLeft: 'auto' }}>
                      保存至: <code style={{ fontSize: 9, background: isDark ? '#222' : '#eee', padding: '1px 4px', borderRadius: 2 }}>
                        ~/.claude/projects/···/memory/
                      </code>
                    </span>
                  </div>
                </>
              ) : (
                <div className="empty-hint" style={{ padding: 24, textAlign: 'center' }}>
                  选择会话 → 点击「🚀 提取」
                  <div style={{ marginTop: 8, fontSize: 10, opacity: 0.6 }}>支持多选，可设关键词筛选</div>
                </div>
              )}
              {error && <div style={{ color: '#ff5050', fontSize: 11, padding: '4px 0', flexShrink: 0 }}>{error}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
