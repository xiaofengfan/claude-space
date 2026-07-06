import { useState, useEffect, useCallback, useRef } from 'react'

interface Props { theme: 'dark' | 'light'; activeProjectPath?: string }
type TabId = 'overview' | 'loops' | 'history'

export function AutomationPanel({ theme }: Props) {
  const [tab, setTab] = useState<TabId>('overview')
  const [loops, setLoops] = useState<any[]>([])
  const [runs, setRuns] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [activeRuns, setActiveRuns] = useState<Map<string, { loopName: string; output: string; startedAt: string }>>(new Map())
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState(''); const [newPrompt, setNewPrompt] = useState(''); const [newInterval, setNewInterval] = useState('10m')
  const isDark = theme === 'dark'
  const loopsRef = useRef(loops)
  loopsRef.current = loops

  useEffect(() => { loadLoops(); loadRuns(); loadHistory() }, [])

  // ── 实时事件监听 ────────────────────────────────
  useEffect(() => {
    const unsubStatus = window.electronAPI.onLoopStatus?.((data: any) => {
      // 运行时更新 activeRuns
      if (data.status === 'running') {
        setActiveRuns(prev => {
          const next = new Map(prev)
          next.set(data.loopId, { loopName: data.loopName || '', output: '', startedAt: new Date().toISOString() })
          return next
        })
      } else {
        setActiveRuns(prev => {
          const next = new Map(prev)
          next.delete(data.loopId)
          return next
        })
      }
      // 刷新列表和历史
      loadLoops()
      loadHistory()
    })

    const unsubOutput = window.electronAPI.onLoopOutput?.((data: { loopId: string; runId: string; text: string }) => {
      setActiveRuns(prev => {
        const next = new Map(prev)
        const existing = next.get(data.loopId)
        if (existing) {
          next.set(data.loopId, { ...existing, output: (existing.output + data.text).slice(-3000) })
        }
        return next
      })
    })

    const unsubWfStatus = window.electronAPI.onWorkflowStatus?.(() => { loadRuns() })
    const unsubWfLog = window.electronAPI.onWorkflowLog?.(() => { loadRuns() })

    return () => { unsubStatus?.(); unsubOutput?.(); unsubWfStatus?.(); unsubWfLog?.() }
  }, [])

  // ── 数据加载 ────────────────────────────────────
  async function loadLoops() {
    try {
      const r = await window.electronAPI.loopList?.()
      if (r?.success) setLoops((r.loops || []).map((l: any) => ({ ...l, status: l.enabled !== false ? 'active' : 'paused' })))
    } catch {}
  }
  async function loadRuns() {
    try { const r = await window.electronAPI.workflowListRuns?.(); if (r?.success) setRuns(r.runs || []) } catch {}
  }
  async function loadHistory(loopId?: string) {
    try { const r = await window.electronAPI.loopHistory?.(loopId); if (r?.success) setHistory(r.runs || []) } catch {}
  }

  // ── 操作 ────────────────────────────────────────
  async function handleCreate() {
    if (!newName.trim() || !newPrompt.trim()) { alert('请填写名称和提示词'); return }
    try {
      const r = await window.electronAPI.loopCreate?.({ name: newName.trim(), prompt: newPrompt.trim(), interval: newInterval })
      if (r?.success) { setShowCreate(false); setNewName(''); setNewPrompt(''); loadLoops() }
      else alert(r?.error || '创建失败')
    } catch {}
  }
  async function handleRunNow(id: string) {
    try { await window.electronAPI.loopRunNow?.(id) } catch {}
  }
  async function handleDeleteLoop(id: string) {
    if (!confirm('删除该循环任务？')) return
    try { await window.electronAPI.loopDelete?.(id); loadLoops() } catch {}
  }
  async function handleToggleLoop(id: string) {
    const loop = loopsRef.current.find((l: any) => l.id === id)
    if (!loop) return
    if (loop.status === 'active') {
      await window.electronAPI.loopPause?.(id)
    } else {
      await window.electronAPI.loopResume?.(id)
    }
    loadLoops()
  }

  const activeCount = loops.filter((l: any) => l.status === 'active').length
  const runningCount = activeRuns.size
  const recentHistory = history.slice(0, 20)

  return (
    <div className="content-rules-list-view">
      <div className="content-rules-toolbar">
        <span style={{ fontWeight: 600, fontSize: 12 }}>🤖 自动化工坊</span><div style={{ flex: 1 }} />
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {(['overview', 'loops', 'history'] as TabId[]).map(t => (
          <button key={t} className={'sk-mkt-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)} style={{ fontSize: 11, padding: '4px 10px' }}>
            {t === 'overview' ? '📊 概览' : t === 'loops' ? '🔄 循环任务' : '📜 执行历史'}
          </button>
        ))}
      </div>

      <div className="content-rules-scroll-list" style={{ padding: 16 }}>
        {/* ── 概览 ──────────────────────────────── */}
        {tab === 'overview' && (
          <div>
            <div className="kn-section"><div className="kn-section-title">🤖 自动化工坊</div></div>
            <div style={{ fontSize: 11, color: isDark ? '#888' : '#999', lineHeight: 1.8, marginBottom: 16 }}>
              利用 Claude Code 调度引擎驱动定时自动化任务和工作流。
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <div className="sk-mkt-stat-item" style={{ flex: 1, padding: '16px 12px' }}>
                <span className="sk-mkt-stat-num" style={{ color: activeCount > 0 ? '#3fb950' : undefined }}>{activeCount}</span>
                <span className="sk-mkt-stat-label">已激活</span>
              </div>
              <div className="sk-mkt-stat-item" style={{ flex: 1, padding: '16px 12px' }}>
                <span className="sk-mkt-stat-num" style={{ color: runningCount > 0 ? '#f0883e' : undefined }}>{runningCount}</span>
                <span className="sk-mkt-stat-label">执行中</span>
              </div>
              <div className="sk-mkt-stat-item" style={{ flex: 1, padding: '16px 12px' }}>
                <span className="sk-mkt-stat-num">{history.length}</span>
                <span className="sk-mkt-stat-label">总执行</span>
              </div>
            </div>

            {/* 正在执行的 loop */}
            {runningCount > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: '#f0883e' }}>⚡ 执行中</div>
                {Array.from(activeRuns.entries()).map(([loopId, info]) => (
                  <div key={loopId} className="sk-mkt-source-item" style={{ padding: '10px 12px', marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>🔄 {info.loopName}</div>
                    {info.output && (
                      <div style={{ fontSize: 10, color: isDark ? '#999' : '#777', marginTop: 4, maxHeight: 80, overflow: 'hidden', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: isDark ? '#0d1117' : '#f6f8fa', padding: '6px 8px', borderRadius: 4 }}>
                        {info.output.slice(-800)}
                      </div>
                    )}
                    <div style={{ fontSize: 9, color: isDark ? '#555' : '#bbb', marginTop: 2 }}>运行中...</div>
                  </div>
                ))}
              </div>
            )}

            {/* 最近历史 */}
            {recentHistory.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>📜 最近执行</div>
                {recentHistory.slice(0, 5).map((h: any) => (
                  <div key={h.id} className="sk-mkt-source-item" style={{ padding: '8px 12px', marginBottom: 3, opacity: 0.8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 10 }}>{h.status === 'success' ? '✅' : h.status === 'running' ? '🟢' : '❌'}</span>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>{h.loopName}</span>
                      <span style={{ fontSize: 9, color: isDark ? '#666' : '#999', marginLeft: 'auto' }}>{h.startedAt ? new Date(h.startedAt).toLocaleTimeString() : ''}</span>
                    </div>
                    {h.output && <div style={{ fontSize: 9, color: isDark ? '#666' : '#999', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.output.slice(0, 120)}</div>}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              <div className="sk-mkt-source-item" style={{ padding: '12px 14px', cursor: 'pointer' }} onClick={() => setTab('loops')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 20 }}>🔄</span><div><div style={{ fontSize: 13, fontWeight: 600 }}>循环任务 ({loops.length})</div><div style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>管理定时自动化任务</div></div><span style={{ marginLeft: 'auto', fontSize: 11, color: isDark ? '#666' : '#999' }}>→</span></div>
              </div>
              <div className="sk-mkt-source-item" style={{ padding: '12px 14px', cursor: 'pointer' }} onClick={() => setTab('history')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 20 }}>📜</span><div><div style={{ fontSize: 13, fontWeight: 600 }}>执行历史 ({history.length})</div><div style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>查看过往执行结果和输出</div></div><span style={{ marginLeft: 'auto', fontSize: 11, color: isDark ? '#666' : '#999' }}>→</span></div>
              </div>
            </div>
          </div>
        )}

        {/* ── 循环任务列表 ────────────────────────── */}
        {tab === 'loops' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="kn-section" style={{ flex: 1, marginBottom: 0 }}><div className="kn-section-title">🔄 循环任务 ({loops.length})</div></div>
              <button className="btn btn-sm" onClick={() => setShowCreate(true)}>➕ 新建</button>
            </div>
            {loops.length === 0 ? (
              <div className="empty-hint" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 24, opacity: 0.3, marginBottom: 8 }}>🔄</div>
                <div style={{ fontSize: 12 }}>暂无循环任务</div>
                <div style={{ fontSize: 10, color: isDark ? '#666' : '#999', marginTop: 4 }}>创建定时任务，让 Claude 自动执行重复性工作</div>
              </div>
            ) : loops.map((loop: any) => (
              <div key={loop.id} className="sk-mkt-source-item" style={{ padding: '10px 12px', marginBottom: 6, opacity: loop.status === 'paused' ? 0.5 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                    {activeRuns.has(loop.id) ? '🔵' : loop.status === 'active' ? '🟢' : '⏸️'} {loop.name}
                  </span>
                  <span style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>
                    {activeRuns.has(loop.id) ? '执行中' : loop.status === 'active' ? '已激活' : '已暂停'}
                  </span>
                  <span style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>{loop.interval}</span>
                  <span style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>{loop.lastRun ? new Date(loop.lastRun).toLocaleString() : '未运行'}</span>
                </div>
                <div style={{ fontSize: 10, color: isDark ? '#666' : '#999', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loop.prompt}</div>
                {loop.lastError && <div style={{ fontSize: 10, color: '#ff5050', marginTop: 2 }}>❌ {loop.lastError}</div>}
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <button className="btn btn-sm" onClick={() => handleRunNow(loop.id)} disabled={activeRuns.has(loop.id)} style={{ fontSize: 10 }}>{activeRuns.has(loop.id) ? '执行中...' : '▶️ 执行'}</button>
                  <button className="btn btn-sm" onClick={() => handleToggleLoop(loop.id)} style={{ fontSize: 10 }}>{loop.status === 'active' ? '⏸️ 暂停' : '▶️ 激活'}</button>
                  <button className="btn btn-sm" onClick={() => { loadHistory(loop.id); setTab('history') }} style={{ fontSize: 10 }}>📜 记录</button>
                  <button className="btn btn-sm" onClick={() => handleDeleteLoop(loop.id)} style={{ fontSize: 10, color: '#ff5050' }}>🗑️</button>
                </div>
              </div>
            ))}

            {showCreate && (
              <div className="dialog-overlay" onClick={() => setShowCreate(false)} style={{ position: 'fixed', zIndex: 1200 }}>
                <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 480 }}>
                  <div className="dialog-header"><h2>➕ 新建循环</h2><button onClick={() => setShowCreate(false)} className="dialog-close">✕</button></div>
                  <div className="dialog-body">
                    <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 4, color: isDark ? '#aaa' : '#666' }}>名称</label><input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="CI 监控" style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} /></div>
                    <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 4, color: isDark ? '#aaa' : '#666' }}>间隔</label><select value={newInterval} onChange={e => setNewInterval(e.target.value)} style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }}><option value="1m">1 分钟</option><option value="5m">5 分钟</option><option value="10m">10 分钟</option><option value="30m">30 分钟</option><option value="1h">1 小时</option><option value="6h">6 小时</option><option value="1d">1 天</option></select></div>
                    <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 4, color: isDark ? '#aaa' : '#666' }}>提示词</label><textarea value={newPrompt} onChange={e => setNewPrompt(e.target.value)} placeholder="检查 CI 状态并修复..." rows={5} style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} /></div>
                  </div>
                  <div className="dialog-footer"><button className="btn btn-sm" onClick={() => setShowCreate(false)}>取消</button><button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={!newName.trim() || !newPrompt.trim()}>创建</button></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 执行历史 ────────────────────────────── */}
        {tab === 'history' && (
          <div>
            <div className="kn-section" style={{ marginBottom: 12 }}><div className="kn-section-title">📜 执行历史 ({history.length})</div></div>
            {history.length === 0 ? (
              <div className="empty-hint" style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 24, opacity: 0.3, marginBottom: 8 }}>📜</div>
                <div style={{ fontSize: 12 }}>暂无执行记录</div>
                <div style={{ fontSize: 10, color: isDark ? '#666' : '#999', marginTop: 4 }}>运行循环任务后，执行记录将显示在这里</div>
              </div>
            ) : history.map((h: any) => (
              <details key={h.id} style={{ marginBottom: 6 }}>
                <summary className="sk-mkt-source-item" style={{ padding: '8px 12px', cursor: 'pointer', listStyle: 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10 }}>{h.status === 'success' ? '✅' : h.status === 'running' ? '🔵' : '❌'}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{h.loopName}</span>
                    <span style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>{h.status}</span>
                    {h.tokensUsed != null && <span style={{ fontSize: 9, color: isDark ? '#555' : '#bbb' }}>{h.tokensUsed} tokens</span>}
                    {h.costUsd != null && h.costUsd > 0 && <span style={{ fontSize: 9, color: isDark ? '#555' : '#bbb' }}>${h.costUsd.toFixed(4)}</span>}
                    <span style={{ fontSize: 9, color: isDark ? '#666' : '#999', marginLeft: 'auto' }}>{h.startedAt ? new Date(h.startedAt).toLocaleString() : ''}</span>
                  </div>
                  {h.error && <div style={{ fontSize: 9, color: '#ff5050', marginTop: 2 }}>{h.error}</div>}
                </summary>
                {h.output && (
                  <div style={{ fontSize: 10, color: isDark ? '#ccc' : '#444', padding: '8px 12px', background: isDark ? '#0d1117' : '#f6f8fa', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 6px 6px', maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.5 }}>
                    {h.output}
                  </div>
                )}
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
