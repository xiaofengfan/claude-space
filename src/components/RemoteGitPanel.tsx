import { useState, useEffect, useCallback } from 'react'

interface Props {
  projectPath?: string
}

export function RemoteGitPanel({ projectPath }: Props) {
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteBranches, setRemoteBranches] = useState<string[]>([])
  const [remoteLog, setRemoteLog] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const [info, log] = await Promise.all([
        window.electronAPI.gitRemoteInfo(projectPath),
        window.electronAPI.gitRemoteLog({ projectPath }),
      ])
      if (info?.success) {
        setRemoteUrl(info.output)
        setRemoteBranches(info.branches?.split('\n').filter(Boolean).map(b => b.trim()) || [])
      }
      if (log?.success) setRemoteLog(log.output)
    } catch { /* silent */ }
    setLoading(false)
  }, [projectPath])

  useEffect(() => { load() }, [load])

  const doFetch = async () => {
    if (!projectPath) return
    setFetching(true)
    setMsg('获取远程更新...')
    const r = await window.electronAPI.gitFetch(projectPath)
    setMsg(r?.success ? '✅ 远程已同步' : `❌ ${r?.error || '同步失败'}`)
    setFetching(false)
    load()
  }

  if (!projectPath) {
    return <div className="remote-git-panel"><p className="empty-hint">请先选择一个项目</p></div>
  }

  return (
    <div className="remote-git-panel">
      <div className="remote-git-header">
        <span className="remote-git-title">🌐 远程仓库</span>
        <button className="icon-btn" onClick={load} disabled={loading} title="刷新">🔄</button>
        <button className="remote-git-fetch-btn" onClick={doFetch} disabled={fetching}>
          {fetching ? '同步中...' : '⬇ 拉取'}
        </button>
      </div>

      {msg && <div className={`git-msg ${msg.startsWith('✅') ? 'success' : 'error'}`}>{msg}</div>}

      {/* 远程仓库 URL */}
      <div className="remote-git-section">
        <div className="remote-git-section-title">🔗 远程仓库</div>
        {remoteUrl ? (
          <pre className="remote-git-url">{remoteUrl}</pre>
        ) : (
          <p className="empty-hint" style={{ padding: '8px 0' }}>
            {loading ? '加载中...' : '未配置远程仓库'}
          </p>
        )}
      </div>

      {/* 远程分支 */}
      <div className="remote-git-section">
        <div className="remote-git-section-title">
          🌿 远程分支
          <span className="remote-git-count">{remoteBranches.length}</span>
        </div>
        <div className="remote-git-branch-list">
          {remoteBranches.length === 0 && !loading && (
            <p className="empty-hint" style={{ padding: '8px 0' }}>无远程分支</p>
          )}
          {remoteBranches.map((branch, i) => (
            <div key={i} className="remote-git-branch-item">
              <span className="remote-git-branch-icon">⎇</span>
              <span className="remote-git-branch-name">{branch}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 远程提交记录 */}
      <div className="remote-git-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="remote-git-section-title">📜 远程提交</div>
        <div className="remote-git-log">
          {remoteLog ? (
            remoteLog.split('\n').filter(Boolean).map((line, i) => {
              const m = line.match(/^([a-f0-9]+)\s+(.*)/)
              return (
                <div key={i} className="remote-git-log-item">
                  <span className="remote-git-log-hash">{m?.[1]?.slice(0, 7) || '......'}</span>
                  <span className="remote-git-log-msg">{m?.[2] || line}</span>
                </div>
              )
            })
          ) : (
            <p className="empty-hint" style={{ padding: '8px 0' }}>
              {loading ? '加载中...' : '无远程提交记录'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
