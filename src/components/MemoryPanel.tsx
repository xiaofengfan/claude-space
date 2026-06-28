import { useState, useEffect, useCallback, useRef } from 'react'
import { MemoryDetailDialog } from './MemoryDetailDialog'
import { SessionExtractDialog } from './SessionExtractDialog'

interface MemoryEntry {
  name: string; description: string; fileName: string; type?: string; mtime?: string
}

interface Props {
  theme: 'dark' | 'light'
  activeProjectPath?: string
  onApplyToChat?: (text: string) => void
}

const TYPE_CONFIG: { key: string; label: string; icon: string }[] = [
  { key: 'all', label: '全部', icon: '📋' },
  { key: 'user', label: '用户', icon: '👤' },
  { key: 'project', label: '项目', icon: '📁' },
  { key: 'feedback', label: '反馈', icon: '💡' },
  { key: 'reference', label: '参考', icon: '🔗' },
]

function getTypeIcon(type?: string): string {
  return TYPE_CONFIG.find(t => t.key === type)?.icon || '📄'
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

export function MemoryPanel({ theme, activeProjectPath, onApplyToChat }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [filterType, setFilterType] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Dialog state
  const [dialogEntry, setDialogEntry] = useState<MemoryEntry | null>(null)
  const [dialogContent, setDialogContent] = useState('')

  const isDark = theme === 'dark'
  const filtered = filterType === 'all' ? entries : entries.filter(e => e.type === filterType)

  // ── 加载记忆列表 ──────────────────────────────────
  const loadEntries = useCallback(async () => {
    if (!activeProjectPath) return
    setLoading(true)
    try {
      const r = await window.electronAPI.memoryList(activeProjectPath)
      if (r?.success) setEntries(r.entries)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [activeProjectPath])

  useEffect(() => { loadEntries() }, [loadEntries])

  // ── 打开弹窗 ──────────────────────────────────────
  async function openDialog(entry: MemoryEntry) {
    if (!activeProjectPath) return
    setError(null)
    setDialogContent('')
    setDialogEntry(entry)
    try {
      const r = await window.electronAPI.memoryRead({ projectPath: activeProjectPath, fileName: entry.fileName })
      if (r?.success) setDialogContent(r.content)
      else setError(r?.error || '读取失败')
    } catch (err: any) { setError(err?.message || '读取失败') }
  }

  function closeDialog() {
    setDialogEntry(null)
    setDialogContent('')
  }

  // ── 保存 ──────────────────────────────────────────
  async function handleSave(newContent: string) {
    if (!dialogEntry || !activeProjectPath) return
    const r = await window.electronAPI.memoryWrite({ projectPath: activeProjectPath, fileName: dialogEntry.fileName, content: newContent })
    if (!r?.success) throw new Error(r?.error || '保存失败')
    setDialogContent(newContent)
    await loadEntries()
  }

  // ── 删除 ──────────────────────────────────────────
  async function handleDelete() {
    if (!dialogEntry || !activeProjectPath) return
    if (!confirm(`确定删除记忆 "${dialogEntry.name}"？`)) return
    const r = await window.electronAPI.memoryDelete({ projectPath: activeProjectPath, fileName: dialogEntry.fileName })
    if (r?.success) { closeDialog(); await loadEntries() }
    else alert(r?.error || '删除失败')
  }

  // ── 会话提取 ────────────────────────────────────
  const [showExtract, setShowExtract] = useState(false)

  async function handleExtractSave(title: string, content: string) {
    if (!activeProjectPath) return
    const fileName = title.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) + '.md'
    const r = await window.electronAPI.memoryCreate({
      projectPath: activeProjectPath, fileName,
      name: title, description: `从会话提取：${title.slice(0, 40)}`,
      type: 'project', content,
    })
    if (!r?.success) throw new Error(r?.error || '保存失败')
    await loadEntries()
  }

  // ── 新建 ──────────────────────────────────────────
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createType, setCreateType] = useState('project')
  const [createContent, setCreateContent] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  function handleCreate() {
    setCreateName(''); setCreateDesc(''); setCreateType('project'); setCreateContent(''); setError(null)
    setShowCreateForm(true)
  }

  async function handleCreateSubmit() {
    if (!createName.trim() || !activeProjectPath) { setError('请输入记忆名称'); return }
    const fileName = createName.trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-|-$/g, '') + '.md'
    setIsCreating(true); setError(null)
    try {
      const r = await window.electronAPI.memoryCreate({
        projectPath: activeProjectPath, fileName, name: createName.trim(),
        description: createDesc.trim(), type: createType, content: createContent,
      })
      if (r?.success) {
        setShowCreateForm(false); await loadEntries()
        openDialog({ name: createName.trim(), description: createDesc.trim(), fileName, type: createType })
      } else setError(r?.error || '创建失败')
    } catch (err: any) { setError(err?.message || '创建失败') }
    finally { setIsCreating(false) }
  }

  // ── 无项目 ────────────────────────────────────────
  if (!activeProjectPath) {
    return (
      <div className="memory-panel">
        <div className="memory-empty"><span style={{ fontSize: 32, opacity: 0.3 }}>🧠</span><span>请先选择一个项目</span></div>
      </div>
    )
  }

  // ═══════════════════════════════════════════════════
  // 列表视图
  // ═══════════════════════════════════════════════════
  return (
    <div className="memory-panel">
      <div className="memory-toolbar">
        <span style={{ fontWeight: 600, fontSize: 12 }}>🧠 记忆管理</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => activeProjectPath && setShowExtract(true)} title="从历史会话提取记忆">📤 提取</button>
        <button className="btn btn-sm" onClick={handleCreate}>+ 新建</button>
      </div>

      {/* 类型筛选 */}
      <div className="memory-filter-tabs">
        {TYPE_CONFIG.map(t => {
          const count = t.key === 'all' ? entries.length : entries.filter(e => e.type === t.key).length
          return (
            <button key={t.key} className={`memory-filter-tab${filterType === t.key ? ' active' : ''}`} onClick={() => setFilterType(t.key)}>
              {t.icon} {t.label}<span className="memory-filter-count">{count}</span>
            </button>
          )
        })}
      </div>

      {/* 列表 */}
      <div className="memory-list">
        {error && <div className="memory-error" style={{ flexShrink: 0 }}>{error}</div>}
        {loading ? (
          <div className="empty-hint" style={{ padding: 24 }}>加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-hint" style={{ padding: 24, textAlign: 'center' }}>
            {entries.length === 0 ? '暂无记忆记录' : '该分类暂无记忆'}
          </div>
        ) : (
          filtered.map(entry => {
            const dateStr = entry.mtime ? formatRelativeTime(entry.mtime) : ''
            return (
              <div key={entry.fileName} className="memory-list-item" onClick={() => openDialog(entry)}
                style={{ cursor: 'pointer' }}>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{getTypeIcon(entry.type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</div>
                  <div style={{ fontSize: 10, color: isDark ? '#666' : '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{entry.description}</div>
                </div>
                {dateStr && <span style={{ fontSize: 9, color: isDark ? '#555' : '#bbb', flexShrink: 0, marginLeft: 4 }}>{dateStr}</span>}
              </div>
            )
          })
        )}
      </div>

      {/* 详情弹窗 */}
      {dialogEntry && dialogContent !== undefined && (
        <MemoryDetailDialog
          entry={dialogEntry}
          content={dialogContent}
          theme={theme}
          activeProjectPath={activeProjectPath}
          onClose={closeDialog}
          onDelete={handleDelete}
          onSave={handleSave}
          onApplyToChat={onApplyToChat}
        />
      )}

      {/* 会话提取弹窗 */}
      {showExtract && activeProjectPath && (
        <SessionExtractDialog
          theme={theme}
          projectPath={activeProjectPath}
          onSave={handleExtractSave}
          onClose={() => setShowExtract(false)}
          onApplyToChat={onApplyToChat}
        />
      )}

      {/* 新建弹窗 */}
      {showCreateForm && (
        <div className="dialog-overlay" onClick={() => setShowCreateForm(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 400 }}>
            <div className="dialog-header">
              <h2>📝 新建记忆</h2>
              <button onClick={() => setShowCreateForm(false)} className="dialog-close">✕</button>
            </div>
            <div className="dialog-body" style={{ padding: 16 }}>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>名称 *</label>
                <input type="text" value={createName} onChange={e => setCreateName(e.target.value)} placeholder="记忆名称" autoFocus
                  style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 6, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>描述</label>
                <input type="text" value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="简短描述"
                  style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 6, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>类型</label>
                <select value={createType} onChange={e => setCreateType(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 6, color: isDark ? '#e0e0e0' : '#333', outline: 'none', cursor: 'pointer' }}>
                  <option value="project">📁 项目</option><option value="user">👤 用户</option><option value="feedback">💡 反馈</option><option value="reference">🔗 参考</option>
                </select>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>内容</label>
                <textarea value={createContent} onChange={e => setCreateContent(e.target.value)} placeholder="记忆内容（支持 Markdown）" rows={4}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 6, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              {error && <div style={{ color: '#ff5050', fontSize: 11, marginBottom: 6 }}>{error}</div>}
            </div>
            <div className="dialog-footer" style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowCreateForm(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreateSubmit} disabled={!createName.trim() || isCreating}>
                {isCreating ? '创建中...' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
