import { useState, useEffect, useCallback } from 'react'

interface Props {
  projectPath?: string
  onClose: () => void
}

export function GitSlidePanel({ projectPath, onClose }: Props) {
  const [branch, setBranch] = useState('')
  const [status, setStatus] = useState('')
  const [log, setLog] = useState('')
  const [remote, setRemote] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const [tab, setTab] = useState<'status' | 'history' | 'config' | 'remote'>('status')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')

  // ── 远程数据 ──
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [remoteLog, setRemoteLog] = useState('')
  const [fetching, setFetching] = useState(false)

  const load = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const [s, l, r, c] = await Promise.all([
        window.electronAPI.gitStatus(projectPath),
        window.electronAPI.gitLog(projectPath),
        window.electronAPI.gitRemote(projectPath),
        window.electronAPI.gitConfig(projectPath),
      ])
      if (s?.success) { setStatus(s.output); const m = s.output.match(/^## (.+)/m); setBranch(m?.[1]?.split('...')[0] || '') }
      if (l?.success) setLog(l.output)
      if (r?.success) setRemote(r.output)
      if (c?.success && c.config) { setConfig(c.config); setUserName(c.config['user.name'] || ''); setUserEmail(c.config['user.email'] || '') }
    } catch (_e) { /* silent */ }
    setLoading(false)
  }, [projectPath])

  const loadRemote = useCallback(async () => {
    if (!projectPath) return
    try {
      const [info, rLog] = await Promise.all([
        window.electronAPI.gitRemoteInfo(projectPath),
        window.electronAPI.gitRemoteLog({ projectPath }),
      ])
      if (info?.success) {
        setRemote(info.output)
        setRemoteBranches(info.branches?.split('\n').filter(Boolean).map(b => b.trim()) || [])
      }
      if (rLog?.success) setRemoteLog(rLog.output)
    } catch { /* silent */ }
  }, [projectPath])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'remote') loadRemote() }, [tab, loadRemote])

  const changedFiles = status.split('\n').filter(l => l.trim() && !l.startsWith('##'))

  const doFetch = async () => {
    if (!projectPath) return
    setFetching(true)
    setMsg('获取远程更新...')
    const r = await window.electronAPI.gitFetch(projectPath)
    setMsg(r?.success ? '✅ 远程已同步' : `❌ ${r?.error || '同步失败'}`)
    setFetching(false)
    loadRemote()
  }

  return (
    <div className="git-slide-overlay" onClick={onClose}>
      <div className="git-slide-panel" onClick={e => e.stopPropagation()}>
        <div className="git-slide-header">
          <span className="git-slide-title">⎇ Git</span>
          <span className="git-slide-branch">{branch || projectPath?.split(/[/\\]/).pop()}</span>
          <button className="icon-btn" onClick={load} disabled={loading} title="刷新">🔄</button>
          <button className="icon-btn" onClick={onClose} title="关闭">✕</button>
        </div>

        {/* Tabs */}
        <div className="git-slide-tabs">
          {(['status', 'history', 'remote', 'config'] as const).map(t => (
            <button key={t} className={`git-slide-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'status' ? '📋 状态' : t === 'history' ? '📜 历史' : t === 'remote' ? '🌐 远程' : '⚙️ 配置'}
            </button>
          ))}
        </div>

        <div className="git-slide-body">
          {/* ── Status Tab ── */}
          {tab === 'status' && (
            <>
              {msg && <div className={`git-msg ${msg.startsWith('✅') ? 'success' : 'error'}`}>{msg}</div>}
              {changedFiles.length > 0 && (
                <pre className="git-output">{changedFiles.join('\n')}</pre>
              )}
              {changedFiles.length === 0 && <p className="empty-hint">工作区干净</p>}

              <div className="git-slide-actions">
                <div className="git-commit-row" style={{ marginBottom: 6 }}>
                  <input className="git-commit-input" value={commitMsg} onChange={e => setCommitMsg(e.target.value)}
                    placeholder="提交信息 (Enter)..." onKeyDown={e => e.key === 'Enter' && commit()} />
                  <button className="btn-primary" onClick={commit} disabled={loading || !commitMsg}>提交</button>
                </div>
                <div className="git-action-row">
                  <button className="git-btn" onClick={stageAll} disabled={loading}>📦 暂存全部</button>
                  <button className="git-btn" onClick={doPull} disabled={loading}>⬇ 拉取</button>
                  <button className="git-btn" onClick={doPush} disabled={loading}>⬆ 推送</button>
                </div>
              </div>
            </>
          )}

          {/* ── History Tab ── */}
          {tab === 'history' && (
            <pre className="git-output git-log-full">{log || '无记录'}</pre>
          )}

          {/* ── Remote Tab ── */}
          {tab === 'remote' && (
            <>
              {msg && <div className={`git-msg ${msg.startsWith('✅') ? 'success' : 'error'}`}>{msg}</div>}
              <div className="git-section">
                <div className="git-section-title">🔗 远程仓库</div>
                {remote ? <pre className="git-output">{remote}</pre> : <p className="empty-hint">未配置远程仓库</p>}
              </div>
              <div className="git-section">
                <div className="git-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  🌿 远程分支
                  <span style={{ fontSize: 9, color: '#666', background: 'var(--bg-base)', padding: '1px 6px', borderRadius: 8, marginLeft: 'auto' }}>{remoteBranches.length}</span>
                </div>
                <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                  {remoteBranches.length === 0 && <p className="empty-hint" style={{ padding: '6px 0' }}>无远程分支</p>}
                  {remoteBranches.map((br, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', fontSize: 11, borderRadius: 3 }}>
                      <span style={{ color: 'var(--accent-text)', fontSize: 12 }}>⎇</span>
                      <span style={{ color: '#ccc', fontFamily: 'monospace' }}>{br}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="git-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div className="git-section-title">📜 远程提交</div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {remoteLog ? remoteLog.split('\n').filter(Boolean).map((line, i) => {
                    const m = line.match(/^([a-f0-9]+)\s+(.*)/)
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '4px 4px', fontSize: 11, borderRadius: 3 }}>
                        <span style={{ fontFamily: 'monospace', color: 'var(--accent-text)', flexShrink: 0, fontSize: 10, minWidth: 52 }}>{m?.[1]?.slice(0, 7) || '......'}</span>
                        <span style={{ color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m?.[2] || line}</span>
                      </div>
                    )
                  }) : <p className="empty-hint" style={{ padding: '8px 0' }}>无远程提交记录</p>}
                </div>
              </div>
              <div style={{ padding: '6px 0' }}>
                <button className="git-btn" onClick={doFetch} disabled={fetching} style={{ width: '100%' }}>
                  {fetching ? '同步中...' : '⬇ 拉取远程更新'}
                </button>
              </div>
            </>
          )}

          {/* ── Config Tab ── */}
          {tab === 'config' && (
            <div className="git-config-section">
              <div className="git-config-field">
                <label>远程仓库 URL</label>
                <div className="git-config-row">
                  <input className="git-commit-input" value={remoteUrl} onChange={e => setRemoteUrl(e.target.value)}
                    placeholder="https://github.com/user/repo.git" />
                  <button className="git-btn" onClick={async () => {
                    if (!remoteUrl || !projectPath) return
                    const r = await window.electronAPI.gitRemoteSet({ projectPath, name: 'origin', url: remoteUrl })
                    setMsg(r?.success ? '✅ 已设置' : `❌ ${r?.error}`)
                    load()
                  }}>设置</button>
                </div>
              </div>
              <div className="git-config-field">
                <label>用户名 (user.name)</label>
                <input className="git-commit-input" value={userName} onChange={e => setUserName(e.target.value)}
                  onBlur={() => saveConfig('user.name', userName)} />
              </div>
              <div className="git-config-field">
                <label>邮箱 (user.email)</label>
                <input className="git-commit-input" value={userEmail} onChange={e => setUserEmail(e.target.value)}
                  onBlur={() => saveConfig('user.email', userEmail)} />
              </div>
              <div className="git-config-field">
                <label>当前远程</label>
                <pre className="git-output" style={{ maxHeight: 80 }}>{remote || '未配置远程仓库'}</pre>
              </div>
              <p className="setting-hint">配置保存在项目 .git/config 中</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  async function commit() { if (!projectPath || !commitMsg) return; setLoading(true); const r = await window.electronAPI.gitCommit({ projectPath, message: commitMsg }); setMsg(r?.success ? '✅ 已提交' : `❌ ${r?.error}`); setCommitMsg(''); setLoading(false); load() }
  async function stageAll() { if (!projectPath) return; setLoading(true); await window.electronAPI.gitAdd({ projectPath, files: ['.'] }); setMsg('✅ 已暂存'); setLoading(false); load() }
  async function doPull() { if (!projectPath) return; setLoading(true); const r = await window.electronAPI.gitPull(projectPath); setMsg(r?.success ? '✅ 已拉取' : `❌ ${r?.error}`); setLoading(false); load() }
  async function doPush() { if (!projectPath) return; setLoading(true); const r = await window.electronAPI.gitPush(projectPath); setMsg(r?.success ? '✅ 已推送' : `❌ ${r?.error}`); setLoading(false); load() }
  async function saveConfig(key: string, value: string) { if (!projectPath || !value) return; await window.electronAPI.gitConfigSet({ projectPath, key, value }); load() }
}
