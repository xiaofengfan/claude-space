import { useState, useEffect, useCallback } from 'react'

interface Props {
  projectPath?: string
}

export function GitPanel({ projectPath }: Props) {
  const [status, setStatus] = useState<string>('')
  const [branch, setBranch] = useState<string>('')
  const [log, setLog] = useState<string>('')
  const [commitMsg, setCommitMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [isRepo, setIsRepo] = useState(true)

  const refresh = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const s = await window.electronAPI.gitStatus?.(projectPath)
      if (s?.success) {
        setStatus(s.output)
        const m = s.output.match(/^## (.+)/m)
        setBranch(m ? m[1].split('...')[0] : '')
        setIsRepo(true)
      } else if (s?.error?.includes('not a git repository')) {
        setIsRepo(false)
        setStatus('')
        setBranch('')
      } else {
        setMsg(s?.error || '获取状态失败')
      }
      const l = await window.electronAPI.gitLog?.(projectPath)
      if (l?.success) setLog(l.output)
    } catch (e: any) { setMsg(e.message) }
    setLoading(false)
  }, [projectPath])

  useEffect(() => { refresh() }, [refresh])

  const doCommit = async () => {
    if (!projectPath || !commitMsg) return
    setLoading(true)
    setMsg('提交中...')
    const r = await window.electronAPI.gitCommit?.({ projectPath, message: commitMsg })
    setMsg(r?.success ? '✅ 提交成功' : `❌ ${r?.error || '失败'}`)
    setCommitMsg('')
    setLoading(false)
    refresh()
  }

  const doPull = async () => {
    if (!projectPath) return
    setLoading(true)
    setMsg('拉取中...')
    const r = await window.electronAPI.gitPull?.(projectPath)
    setMsg(r?.success ? '✅ 拉取成功' : `❌ ${r?.error || '失败'}`)
    setLoading(false)
    refresh()
  }

  const doPush = async () => {
    if (!projectPath) return
    setLoading(true)
    setMsg('推送中...')
    const r = await window.electronAPI.gitPush?.(projectPath)
    setMsg(r?.success ? '✅ 推送成功' : `❌ ${r?.error || '失败'}`)
    setLoading(false)
    refresh()
  }

  if (!projectPath) {
    return <div className="git-panel"><p className="empty-hint">请先选择一个项目</p></div>
  }

  if (!isRepo) {
    return (
      <div className="git-panel">
        <div className="git-header">
          <span className="git-branch">⎇ 未初始化</span>
          <button className="icon-btn" onClick={refresh} disabled={loading} title="刷新">🔄</button>
        </div>
        <div className="git-section" style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ color: '#888', marginBottom: 12 }}>此项目不是 Git 仓库</p>
          <button className="btn-primary" onClick={async () => {
            setLoading(true)
            const r = await window.electronAPI.gitInit?.(projectPath)
            setMsg(r?.success ? '✅ Git 仓库已初始化' : `❌ ${r?.error}`)
            setLoading(false)
            refresh()
          }} disabled={loading}>🔧 初始化 Git 仓库</button>
        </div>
      </div>
    )
  }

  const changedFiles = status.split('\n').filter(l => l.trim() && !l.startsWith('##')).length

  return (
    <div className="git-panel">
      <div className="git-header">
        <span className="git-branch">⎇ {branch || '...'}</span>
        <span className="git-changes">{changedFiles > 0 ? `${changedFiles} 个变更` : '干净'}</span>
        <button className="icon-btn" onClick={refresh} disabled={loading} title="刷新">🔄</button>
      </div>

      {msg && <div className={`git-msg ${msg.startsWith('✅') ? 'success' : 'error'}`}>{msg}</div>}

      {/* Status */}
      <div className="git-section">
        <div className="git-section-title">📋 状态</div>
        <pre className="git-output">{status || (loading ? '加载中...' : '无状态')}</pre>
      </div>

      {/* Actions */}
      <div className="git-section">
        <div className="git-section-title">⚡ 操作</div>
        <div className="git-actions">
          <div className="git-action-row">
            <button className="git-btn" onClick={async () => {
              setLoading(true)
              const r = await window.electronAPI.gitAdd?.({ projectPath: projectPath!, files: ['.'] })
              setMsg(r?.success ? '✅ 已暂存全部' : `❌ ${r?.error}`)
              setLoading(false)
              refresh()
            }} disabled={loading}>📦 暂存全部</button>
          </div>
          <div className="git-commit-row">
            <input
              className="git-commit-input"
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              placeholder="提交信息 (Enter 提交)..."
              onKeyDown={e => e.key === 'Enter' && doCommit()}
            />
            <button className="btn-primary" onClick={doCommit} disabled={loading || !commitMsg}>提交</button>
          </div>
          <div className="git-action-row">
            <button className="git-btn" onClick={doPull} disabled={loading}>⬇ 拉取</button>
            <button className="git-btn" onClick={doPush} disabled={loading}>⬆ 推送</button>
          </div>
        </div>
      </div>

      {/* Log */}
      <div className="git-section">
        <div className="git-section-title">📜 最近提交</div>
        <pre className="git-output git-log">{log || '无记录'}</pre>
      </div>
    </div>
  )
}
