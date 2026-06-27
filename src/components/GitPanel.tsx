import { useState, useEffect, useCallback } from 'react'
import { VersionDetailDialog } from './VersionDetailDialog'

interface Props {
  projectPath?: string
}

interface CommitEntry {
  hash: string
  date: string
  author: string
  message: string
}

export function GitPanel({ projectPath }: Props) {
  const [status, setStatus] = useState<string>('')
  const [branch, setBranch] = useState<string>('')
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [commitMsg, setCommitMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [isRepo, setIsRepo] = useState(true)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)

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

      // 加载详细版本列表
      const l = await window.electronAPI.gitLogDetail?.(projectPath)
      if (l?.success) {
        const parsed: CommitEntry[] = l.output.split('\n')
          .filter(line => line.includes('|'))
          .map(line => {
            const [hash, date, author, ...msgParts] = line.split('|')
            return { hash: hash?.trim() || '', date: date?.trim() || '', author: author?.trim() || '', message: msgParts.join('|').trim() }
          })
          .filter(c => c.hash)
        setCommits(parsed)
      }
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

  function formatRelativeTime(dateStr: string): string {
    try {
      const d = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - d.getTime()
      const diffMin = Math.floor(diffMs / 60000)
      if (diffMin < 1) return '刚刚'
      if (diffMin < 60) return `${diffMin} 分钟前`
      const diffHour = Math.floor(diffMin / 60)
      if (diffHour < 24) return `${diffHour} 小时前`
      const diffDay = Math.floor(diffHour / 24)
      if (diffDay < 7) return `${diffDay} 天前`
      const diffWeek = Math.floor(diffDay / 7)
      if (diffWeek < 4) return `${diffWeek} 周前`
      return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    } catch { return dateStr }
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
          <p style={{ color: 'var(--accent-text)', marginBottom: 12 }}>此项目不是 Git 仓库</p>
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

      {/* 版本列表 - 取代旧的简单日志 */}
      <div className="git-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="git-section-title" style={{ display: 'flex', alignItems: 'center' }}>
          📜 版本列表
          <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>
            {commits.length} 个版本
          </span>
        </div>
        <div className="version-list">
          {commits.length === 0 && !loading && (
            <p className="empty-hint" style={{ padding: 12 }}>无提交记录</p>
          )}
          {commits.map((c, i) => (
            <div
              key={c.hash}
              className={`version-item ${i === 0 ? 'version-item-latest' : ''}`}
              onClick={() => setSelectedHash(c.hash)}
              title="点击查看版本详情"
            >
              <div className="version-item-row">
                <span className="version-item-icon">{i === 0 ? '🟢' : '📄'}</span>
                <span className="version-item-hash">{c.hash.slice(0, 7)}</span>
                <span className="version-item-time">{formatRelativeTime(c.date)}</span>
              </div>
              <div className="version-item-msg">{c.message}</div>
              <div className="version-item-author">{c.author}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 版本详情弹窗 */}
      {selectedHash && projectPath && (
        <VersionDetailDialog
          projectPath={projectPath}
          hash={selectedHash}
          onClose={() => setSelectedHash(null)}
        />
      )}
    </div>
  )
}
