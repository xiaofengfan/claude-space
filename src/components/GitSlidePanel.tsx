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
  const [tab, setTab] = useState<'status' | 'history' | 'config'>('status')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [commitMsg, setCommitMsg] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')

  const load = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const [s, l, r, c] = await Promise.all([
        window.electronAPI.gitStatus?.(projectPath),
        window.electronAPI.gitLog?.(projectPath),
        window.electronAPI.gitRemote?.(projectPath),
        window.electronAPI.gitConfig?.(projectPath),
      ])
      if (s?.success) { setStatus(s.output); const m = s.output.match(/^## (.+)/m); setBranch(m?.[1]?.split('...')[0] || '') }
      if (l?.success) setLog(l.output)
      if (r?.success) setRemote(r.output)
      if (c?.success && c.config) { setConfig(c.config); setUserName(c.config['user.name'] || ''); setUserEmail(c.config['user.email'] || '') }
    } catch {}
    setLoading(false)
  }, [projectPath])

  useEffect(() => { load() }, [load])

  const changedFiles = status.split('\n').filter(l => l.trim() && !l.startsWith('##'))

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
          {(['status', 'history', 'config'] as const).map(t => (
            <button key={t} className={`git-slide-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t === 'status' ? '📋 状态' : t === 'history' ? '📜 历史' : '⚙️ 配置'}
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
                    const r = await window.electronAPI.gitRemoteSet?.({ projectPath, name: 'origin', url: remoteUrl })
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

  async function commit() { if (!projectPath || !commitMsg) return; setLoading(true); const r = await window.electronAPI.gitCommit?.({ projectPath, message: commitMsg }); setMsg(r?.success ? '✅ 已提交' : `❌ ${r?.error}`); setCommitMsg(''); setLoading(false); load() }
  async function stageAll() { if (!projectPath) return; setLoading(true); await window.electronAPI.gitAdd?.({ projectPath, files: ['.'] }); setMsg('✅ 已暂存'); setLoading(false); load() }
  async function doPull() { if (!projectPath) return; setLoading(true); const r = await window.electronAPI.gitPull?.(projectPath); setMsg(r?.success ? '✅ 已拉取' : `❌ ${r?.error}`); setLoading(false); load() }
  async function doPush() { if (!projectPath) return; setLoading(true); const r = await window.electronAPI.gitPush?.(projectPath); setMsg(r?.success ? '✅ 已推送' : `❌ ${r?.error}`); setLoading(false); load() }
  async function saveConfig(key: string, value: string) { if (!projectPath || !value) return; await window.electronAPI.gitConfigSet?.({ projectPath, key, value }); load() }
}
