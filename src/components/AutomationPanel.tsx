import { useState, useEffect } from 'react'

interface Props { theme: 'dark' | 'light'; activeProjectPath?: string }
type TabId = 'overview' | 'loops' | 'workflows'

export function AutomationPanel({ theme }: Props) {
  const [tab, setTab] = useState<TabId>('overview')
  const [loops, setLoops] = useState<any[]>([]); const [runs, setRuns] = useState<any[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState(''); const [newPrompt, setNewPrompt] = useState(''); const [newInterval, setNewInterval] = useState('10m')
  const [runningId, setRunningId] = useState<string | null>(null); const [runningWf, setRunningWf] = useState<string | null>(null)
  const isDark = theme === 'dark'

  useEffect(() => { loadLoops(); loadRuns() }, [])

  async function loadLoops() { try { const r = await window.electronAPI.loopList?.(); if (r?.success) setLoops(r.loops || []) } catch {} }
  async function loadRuns() { try { const r = await window.electronAPI.workflowListRuns?.(); if (r?.success) setRuns(r.runs || []) } catch {} }

  async function handleCreate() { if (!newName.trim() || !newPrompt.trim()) { alert('请填写名称和提示词'); return }; try { const r = await window.electronAPI.loopCreate?.({ name: newName.trim(), prompt: newPrompt.trim(), interval: newInterval }); if (r?.success) { setShowCreate(false); setNewName(''); setNewPrompt(''); loadLoops() } else alert(r?.error || '创建失败') } catch {} }
  async function handleRunNow(id: string) { setRunningId(id); try { await window.electronAPI.loopRunNow?.(id); loadLoops() } catch {}; setRunningId(null) }
  async function handleDeleteLoop(id: string) { if (!confirm('删除该循环任务？')) return; try { await window.electronAPI.loopDelete?.(id); loadLoops() } catch {} }

  const activeLoops = loops.filter((l: any) => l.status === 'running').length

  return (
    <div className="content-rules-list-view">
      <div className="content-rules-toolbar">
        <span style={{ fontWeight: 600, fontSize: 12 }}>🤖 自动化工坊</span><div style={{ flex: 1 }} />
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {(['overview', 'loops', 'workflows'] as TabId[]).map(t => (
          <button key={t} className={'sk-mkt-tab' + (tab === t ? ' active' : '')} onClick={() => setTab(t)} style={{ fontSize: 11, padding: '4px 10px' }}>
            {t === 'overview' ? '📊 概览' : t === 'loops' ? '🔄 循环任务' : '🧠 工作流'}
          </button>
        ))}
      </div>

      <div className="content-rules-scroll-list" style={{ padding: 16 }}>
        {tab === 'overview' && (
          <div>
            <div className="kn-section"><div className="kn-section-title">🤖 自动化工坊</div></div>
            <div style={{ fontSize: 11, color: isDark ? '#888' : '#999', lineHeight: 1.8, marginBottom: 16 }}>利用 Claude Code 的多智能体能力管理开发工作流。</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <div className="sk-mkt-stat-item" style={{ flex: 1, padding: '16px 12px' }}><span className="sk-mkt-stat-num" style={{ color: activeLoops > 0 ? '#3fb950' : '' }}>{activeLoops}</span><span className="sk-mkt-stat-label">运行中</span></div>
              <div className="sk-mkt-stat-item" style={{ flex: 1, padding: '16px 12px' }}><span className="sk-mkt-stat-num">{runs.length}</span><span className="sk-mkt-stat-label">执行</span></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="sk-mkt-source-item" style={{ padding: '12px 14px', cursor: 'pointer' }} onClick={() => setTab('loops')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 20 }}>🔄</span><div><div style={{ fontSize: 13, fontWeight: 600 }}>循环任务</div><div style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>定时自动化任务</div></div><span style={{ marginLeft: 'auto', fontSize: 11, color: isDark ? '#666' : '#999' }}>→</span></div>
              </div>
              <div className="sk-mkt-source-item" style={{ padding: '12px 14px', cursor: 'pointer' }} onClick={() => setTab('workflows')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 20 }}>🧠</span><div><div style={{ fontSize: 13, fontWeight: 600 }}>执行记录</div><div style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>查看歷史工作流執行結果</div></div><span style={{ marginLeft: 'auto', fontSize: 11, color: isDark ? '#666' : '#999' }}>→</span></div>
              </div>
            </div>
          </div>
        )}

        {tab === 'loops' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="kn-section" style={{ flex: 1, marginBottom: 0 }}><div className="kn-section-title">🔄 循环任务 ({loops.length})</div></div>
              <button className="btn btn-sm" onClick={() => setShowCreate(true)}>➕ 新建</button>
            </div>
            {loops.length === 0 ? <div className="empty-hint" style={{ padding: 40, textAlign: 'center' }}><div style={{ fontSize: 24, opacity: 0.3, marginBottom: 8 }}>🔄</div>暂无循环任务</div>
              : loops.map((loop: any) => (
                <div key={loop.id} className="sk-mkt-source-item" style={{ padding: '10px 12px', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{loop.status === 'running' ? '🟢' : '⏸️'} {loop.name}</span>
                    <span style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>{loop.interval}</span>
                    <span style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>{loop.lastRun ? new Date(loop.lastRun).toLocaleString() : '未运行'}</span>
                  </div>
                  <div style={{ fontSize: 10, color: isDark ? '#666' : '#999', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loop.prompt}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    <button className="btn btn-sm" onClick={() => handleRunNow(loop.id)} disabled={runningId === loop.id || loop.status === 'running'} style={{ fontSize: 10 }}>{runningId === loop.id ? '启动中...' : '▶️ 执行'}</button>
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

        {tab === 'workflows' && (
          <div>
            <div className="kn-section" style={{ marginBottom: 12 }}><div className="kn-section-title">🧠 执行记录 ({runs.length})</div></div>
            {runs.length === 0 ? <div className="empty-hint" style={{ padding: 40, textAlign: 'center' }}><div style={{ fontSize: 24, opacity: 0.3, marginBottom: 8 }}>🧠</div>暂无记录</div>
              : runs.map((run: any) => (
                <div key={run.id} className="sk-mkt-source-item" style={{ padding: '10px 12px', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{run.status === 'running' ? '🟢' : run.status === 'success' ? '✅' : run.status === 'failed' ? '❌' : '⏳'} {run.name}</span>
                    <span style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>{run.status}</span>
                    <span style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>{run.startedAt ? new Date(run.startedAt).toLocaleString() : ''}</span>
                  </div>
                  {run.result && <div style={{ fontSize: 10, color: isDark ? '#666' : '#999', marginTop: 4, maxHeight: 60, overflow: 'hidden' }}>{run.result.slice(0, 200)}</div>}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
