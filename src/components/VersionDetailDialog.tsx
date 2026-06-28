import { useState, useEffect } from 'react'

interface Props {
  projectPath: string
  hash: string
  onClose: () => void
}

interface CommitDetail {
  hash: string
  author: string
  date: string
  message: string
  diffStat: string
}

interface MemoryEntry {
  name: string
  description: string
  fileName: string
  type?: string
}

export function VersionDetailDialog({ projectPath, hash, onClose }: Props) {
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [maximized, setMaximized] = useState(false)
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([])
  const [selectedMemory, setSelectedMemory] = useState<string | null>(null)
  const [memoryContent, setMemoryContent] = useState('')
  const [memoryLoading, setMemoryLoading] = useState('')

  useEffect(() => {
    loadDetail()
    loadMemoryList()
  }, [hash])

  async function loadDetail() {
    setLoading(true)
    setError('')
    try {
      const r = await window.electronAPI.gitShowCommit({ projectPath, hash })
      if (!r?.success) {
        setError(r?.error || '获取版本详情失败')
        return
      }
      const raw = r.output
      const hashMatch = raw.match(/╔HASH╗(.+?)╔AUTHOR╗/s)
      const authorMatch = raw.match(/╔AUTHOR╗(.+?)╔DATE╗/s)
      const dateMatch = raw.match(/╔DATE╗(.+?)╔MSG╗/s)
      const msgMatch = raw.match(/╔MSG╗(.+?)╔DIFF╗/s)
      const diffMatch = raw.match(/╔DIFF╗([\s\S]*)/)

      setDetail({
        hash: hashMatch?.[1]?.trim() || hash,
        author: authorMatch?.[1]?.trim() || '',
        date: dateMatch?.[1]?.trim() || '',
        message: msgMatch?.[1]?.trim() || '',
        diffStat: diffMatch?.[1]?.trim() || '',
      })
    } catch (e: any) {
      setError(e.message)
    }
    setLoading(false)
  }

  async function loadMemoryList() {
    try {
      const r = await window.electronAPI.memoryList(projectPath)
      if (r?.success) {
        setMemoryEntries(r.entries)
        // 找到与当前项目最相关的记忆（匹配 projectPath 或 "claude-space"）
        const projectName = projectPath.split(/[/\\]/).pop() || ''
        const relevant = r.entries.find(e =>
          e.fileName.includes('claude_space') ||
          e.description?.toLowerCase().includes(projectName.toLowerCase()) ||
          e.name?.toLowerCase().includes(projectName.toLowerCase())
        )
        if (relevant) {
          setSelectedMemory(relevant.fileName)
          loadMemoryContent(relevant.fileName)
        } else if (r.entries.length > 0) {
          setSelectedMemory(r.entries[0].fileName)
          loadMemoryContent(r.entries[0].fileName)
        }
      }
    } catch { /* silent */ }
  }

  async function loadMemoryContent(fileName: string) {
    setMemoryLoading(fileName)
    setMemoryContent('')
    try {
      const r = await window.electronAPI.memoryRead({ projectPath, fileName })
      if (r?.success) {
        setMemoryContent(r.content)
      }
    } catch { /* silent */ }
    setMemoryLoading('')
  }

  function handleMemorySelect(fileName: string) {
    setSelectedMemory(fileName)
    loadMemoryContent(fileName)
  }

  function formatDate(dateStr: string): string {
    try {
      const d = new Date(dateStr)
      return d.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    } catch { return dateStr }
  }

  function stripFrontmatter(content: string): string {
    return content.replace(/^---[\s\S]*?---\n*/m, '')
  }

  function getMemoryTypeIcon(type?: string): string {
    switch (type) {
      case 'project': return '📁'
      case 'user': return '👤'
      case 'feedback': return '💡'
      case 'reference': return '🔗'
      default: return '📄'
    }
  }

  // 从记忆内容中提取关键信息摘要
  function getMemorySummary(content: string, maxLen = 120): string {
    const body = stripFrontmatter(content).trim()
    const lines = body.split('\n').filter(l => l.trim() && !l.startsWith('#'))
    return lines.join(' ').slice(0, maxLen) + (lines.join(' ').length > maxLen ? '...' : '')
  }

  // 提取记忆的 name 和 description（从 frontmatter）
  function parseFrontmatterField(content: string, field: string): string {
    const re = new RegExp(`^${field}:\\s*(.+)$`, 'm')
    const m = content.match(re)
    return m ? m[1].trim() : ''
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className={`version-detail-dialog ${maximized ? 'maximized' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="version-detail-header">
          <div className="version-detail-title-row">
            <span className="version-detail-icon">📦</span>
            <h2>版本详情</h2>
            <span className="version-detail-badge">{hash.slice(0, 7)}</span>
          </div>
          <div className="version-detail-header-actions">
            <button
              className="icon-btn"
              onClick={() => setMaximized(!maximized)}
              title={maximized ? '还原' : '最大化'}
            >
              {maximized ? '🗗' : '🗖'}
            </button>
            <button className="dialog-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Body: Left + Right */}
        <div className="version-detail-body-split">
          {/* ── 左侧：版本提交信息 ── */}
          <div className="version-detail-left">
            {loading && <div className="version-detail-loading">加载中...</div>}
            {error && <div className="version-detail-error">{error}</div>}

            {detail && !loading && (
              <>
                <div className="version-meta-grid">
                  <div className="version-meta-item">
                    <span className="version-meta-label">提交时间</span>
                    <span className="version-meta-value">{formatDate(detail.date)}</span>
                  </div>
                  <div className="version-meta-item">
                    <span className="version-meta-label">提交作者</span>
                    <span className="version-meta-value">{detail.author}</span>
                  </div>
                  <div className="version-meta-item">
                    <span className="version-meta-label">完整哈希</span>
                    <span className="version-meta-value version-mono">{detail.hash}</span>
                  </div>
                </div>

                <div className="version-section">
                  <div className="version-section-title">📝 功能说明</div>
                  <pre className="version-message">{detail.message}</pre>
                </div>

                <div className="version-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div className="version-section-title">🔧 核心代码变动</div>
                  {detail.diffStat ? (
                    <pre className="version-diff-stat">{detail.diffStat}</pre>
                  ) : (
                    <p className="version-empty-hint">无文件变动</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── 右侧：AI 记忆面板 ── */}
          <div className="version-detail-right">
            <div className="version-memory-header">
              <span className="version-section-title" style={{ border: 'none', margin: 0, padding: 0 }}>
                🧠 AI 记忆
              </span>
              <span className="version-memory-count">{memoryEntries.length} 条</span>
            </div>

            <div className="version-memory-list">
              {memoryEntries.length === 0 && (
                <p className="empty-hint" style={{ padding: 16 }}>暂无记忆记录</p>
              )}
              {memoryEntries.map(entry => (
                <div
                  key={entry.fileName}
                  className={`version-memory-item ${selectedMemory === entry.fileName ? 'active' : ''}`}
                  onClick={() => handleMemorySelect(entry.fileName)}
                >
                  <div className="version-memory-item-icon">
                    {getMemoryTypeIcon(entry.type)}
                  </div>
                  <div className="version-memory-item-body">
                    <div className="version-memory-item-name">{entry.name}</div>
                    <div className="version-memory-item-desc">{entry.description}</div>
                  </div>
                </div>
              ))}
            </div>

            {selectedMemory && (
              <div className="version-memory-preview">
                <div className="version-memory-preview-header">
                  <span>
                    {getMemoryTypeIcon(memoryEntries.find(e => e.fileName === selectedMemory)?.type)}
                    {' '}
                    {memoryEntries.find(e => e.fileName === selectedMemory)?.name || selectedMemory}
                  </span>
                </div>
                <div className="version-memory-preview-body">
                  {memoryLoading === selectedMemory && <p className="empty-hint">加载中...</p>}
                  {!memoryLoading && memoryContent && (
                    <pre className="version-memory-content">
                      {stripFrontmatter(memoryContent).trim() || '(空内容)'}
                    </pre>
                  )}
                  {!memoryLoading && !memoryContent && (
                    <p className="empty-hint">无法加载记忆内容</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
