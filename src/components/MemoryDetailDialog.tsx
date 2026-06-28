import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface MemoryEntry {
  name: string; description: string; fileName: string; type?: string; mtime?: string
}

interface Props {
  entry: MemoryEntry
  content: string
  theme: 'dark' | 'light'
  activeProjectPath: string
  onClose: () => void
  onDelete: () => Promise<void>
  onSave: (content: string) => Promise<void>
  onApplyToChat?: (text: string) => void
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n*/m, '').trim()
}

function formatTime(iso?: string): string {
  if (!iso) return '未知'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const TYPE_LABELS: Record<string, string> = {
  user: '👤 用户', project: '📁 项目', feedback: '💡 反馈', reference: '🔗 参考',
}

export function MemoryDetailDialog({ entry, content, theme, activeProjectPath, onClose, onDelete, onSave, onApplyToChat }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(content)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [winSize, setWinSize] = useState({ w: 900, h: 650 })
  const isDirty = editedContent !== content
  const isDark = theme === 'dark'
  const codeStyle = isDark ? oneDark : oneLight
  const body = stripFrontmatter(content) || content

  useEffect(() => {
    function update() {
      setWinSize({
        w: Math.max(600, Math.floor(window.innerWidth * 0.7)),
        h: Math.max(400, Math.floor(window.innerHeight * 0.7)),
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  async function handleSave() {
    setSaveStatus('saving'); setError(null)
    try { await onSave(editedContent); setSaveStatus('saved'); setTimeout(() => setSaveStatus('idle'), 2000); setIsEditing(false) }
    catch (e: any) { setSaveStatus('error'); setError(e?.message || '保存失败') }
  }

  // 智能操作
  async function doSmartAction(action: string, label: string) {
    const prefix = { extract: '请提取以下内容的关键信息', summarize: '请概括以下内容', deposit: '请将以下内存沉淀为可复用的知识文档' }
    const text = `[${label}] ${entry.name}\n\n${prefix[action as keyof typeof prefix] || '请分析'}：\n\n${body.slice(0, 3000)}`
    try { await navigator.clipboard.writeText(text); showHint(`${label} prompt 已复制`) }
    catch { onApplyToChat?.(text) }
  }

  // 沉淀为知识文档
  async function doDepositToDoc() {
    if (!activeProjectPath) return
    const docName = entry.name.replace(/[\\/:*?"<>|]/g, '-') + '-知识沉淀.md'
    const docContent = `# ${entry.name} — 知识沉淀\n\n> 来源记忆：${entry.fileName}\n> 沉淀时间：${new Date().toLocaleString('zh-CN')}\n> 类型：${entry.type || '未分类'}\n\n---\n\n${body}\n\n---\n\n## 核心要点\n\n- \n\n## 应用场景\n\n- \n\n## 相关参考\n\n- `
    try {
      const r = await window.electronAPI.createFile({ dirPath: activeProjectPath, fileName: docName, content: docContent })
      if (r?.success) { showHint(`✅ 已沉淀为知识文档: ${docName}`); if (r.filePath) onApplyToChat?.(`📄 已创建知识文档：${r.filePath}`) }
      else showHint('❌ 沉淀失败')
    } catch { showHint('❌ 沉淀失败') }
  }

  const hintRef = useRef<HTMLDivElement>(null)
  function showHint(msg: string) {
    if (hintRef.current) { hintRef.current.textContent = msg; hintRef.current.style.opacity = '1'; setTimeout(() => { if (hintRef.current) hintRef.current.style.opacity = '0' }, 2000) }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog memory-detail-dialog" onClick={e => e.stopPropagation()} style={{ width: winSize.w, height: winSize.h }}>
        {/* 标题栏 */}
        <div className="dialog-header">
          <span>{entry.type === 'user' ? '👤' : entry.type === 'project' ? '📁' : entry.type === 'feedback' ? '💡' : entry.type === 'reference' ? '🔗' : '📄'} {entry.name}</span>
          <div style={{ flex: 1 }} />
          <span ref={hintRef} className="memory-hint" style={{ fontSize: 11, opacity: 0, transition: 'opacity .3s' }} />
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>

        <div className="memory-detail-body">
          {/* 左侧元信息 + 智能操作 */}
          <div className="memory-detail-sidebar">
            <div className="memory-detail-meta">
              <div className="memory-detail-meta-row"><span className="memory-detail-meta-label">名称</span><span className="memory-detail-meta-value">{entry.name}</span></div>
              <div className="memory-detail-meta-row"><span className="memory-detail-meta-label">类型</span><span className="memory-detail-meta-value">{TYPE_LABELS[entry.type || ''] || '📄 未分类'}</span></div>
              <div className="memory-detail-meta-row"><span className="memory-detail-meta-label">描述</span><span className="memory-detail-meta-value">{entry.description || '无'}</span></div>
              <div className="memory-detail-meta-row"><span className="memory-detail-meta-label">文件名</span><span className="memory-detail-meta-value">{entry.fileName}</span></div>
              <div className="memory-detail-meta-row"><span className="memory-detail-meta-label">修改时间</span><span className="memory-detail-meta-value">{formatTime(entry.mtime)}</span></div>
              <div className="memory-detail-meta-row"><span className="memory-detail-meta-label">大小</span><span className="memory-detail-meta-value">{content ? `${(content.length / 1024).toFixed(1)} KB` : '未知'}</span></div>
            </div>

            <div className="memory-detail-actions">
              <div style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#666' : '#999', marginBottom: 4, textTransform: 'uppercase' }}>🧠 智能操作</div>
              <button className="btn btn-sm" onClick={() => doSmartAction('extract', '提炼')}>🔍 提炼关键信息</button>
              <button className="btn btn-sm" onClick={() => doSmartAction('summarize', '总结')}>📊 总结概括</button>
              <button className="btn btn-sm" onClick={doDepositToDoc}>📚 沉淀为知识文档</button>
              <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(body).then(() => showHint('已复制')).catch(() => {}) }}>📋 复制内容</button>
            </div>
          </div>

          {/* 右侧内容 */}
          <div className="memory-detail-content">
            {error && <div className="memory-error">{error}</div>}
            {isEditing ? (
              <textarea className="memory-textarea" value={editedContent} onChange={e => setEditedContent(e.target.value)}
                spellCheck={false}
                style={{ flex: 1, width: '100%', border: 'none', resize: 'none', padding: '16px', fontFamily: 'Consolas, "Courier New", monospace', fontSize: 13, lineHeight: 1.6, background: isDark ? '#1a1a1a' : '#fafafa', color: isDark ? '#e0e0e0' : '#333', outline: 'none' }} />
            ) : (
              <div className="memory-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '')
                    return !match ? <code className={className} {...props}>{children}</code>
                      : <SyntaxHighlighter style={codeStyle} language={match[1]} PreTag="div">{String(children).replace(/\n$/, '')}</SyntaxHighlighter>
                  },
                }}>{body || '*（空）*'}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="dialog-footer" style={{ justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={() => { onApplyToChat?.(`[${entry.name}]\n${body.slice(0, 5000)}`); showHint('已应用到Chat') }}>📤 应用到 Chat</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {isEditing ? (
              <>
                <button className="btn btn-sm" onClick={() => { setIsEditing(false); setEditedContent(content); setError(null) }}>取消</button>
                <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saveStatus === 'saving' || !isDirty}>
                  {saveStatus === 'saving' ? '保存中...' : '💾 保存'}
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-sm" onClick={() => setIsEditing(true)}>✏️ 编辑</button>
                <button className="btn btn-sm" style={{ color: '#ff5050' }} onClick={onDelete}>🗑️ 删除</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
