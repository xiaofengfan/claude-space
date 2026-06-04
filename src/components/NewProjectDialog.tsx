import { useState, useRef, useEffect } from 'react'

export function NewProjectDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // 自动聚焦输入框
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('请输入项目名称')
      return
    }
    if (/[<>:"/\\|?*]/.test(trimmed)) {
      setError('项目名称包含非法字符：< > : " / \\ | ? *')
      return
    }
    setError('')
    setCreating(true)
    try {
      await onCreate(trimmed)
      onClose()
    } catch (err: any) {
      setError(err?.message || '创建项目失败')
    } finally {
      setCreating(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleCreate()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 420 }}>
        <div className="dialog-header">
          <h2>🆕 新建项目</h2>
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>
        <div className="dialog-body">
          <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
            输入项目名称，将在工作区 <code style={{ background: '#141428', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
              E:\claudespace
            </code> 下创建项目目录。
          </p>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#aaa', marginBottom: 6 }}>
              项目名称
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              onKeyDown={handleKeyDown}
              placeholder="例如：my-project"
              disabled={creating}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 14,
                background: '#141428',
                border: error ? '1px solid #e0556a' : '1px solid #2a2a4a',
                borderRadius: 6,
                color: '#ddd',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#e0556a', marginBottom: 8 }}>
              ⚠️ {error}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <button className="btn-cancel" onClick={onClose} disabled={creating}>
            取消
          </button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={creating || !name.trim()}
            style={creating ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
          >
            {creating ? '创建中...' : '创建项目'}
          </button>
        </div>
      </div>
    </div>
  )
}
