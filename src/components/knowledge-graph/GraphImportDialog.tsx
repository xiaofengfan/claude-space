import { useState } from 'react'

interface Props {
  theme: 'dark' | 'light'
  projectPath: string
  onClose: () => void
  onImport: (data: any) => void
}

export function GraphImportDialog({ theme, projectPath, onClose, onImport }: Props) {
  const isDark = theme === 'dark'
  const [jsonInput, setJsonInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [loading, setLoading] = useState(false)

  async function handleAnalyzeAndImport() {
    setLoading(true)
    setError(null)
    try {
      // 先扫描基础文件结构
      const result = await window.electronAPI.graphAnalyze(projectPath)
      if (result.success && result.data) {
        onImport(result.data)
        onClose()
      } else {
        setError(result.error || '分析失败')
      }
    } catch (e: any) {
      setError(e.message || '分析失败')
    }
    setLoading(false)
  }

  function handlePasteImport() {
    setError(null)
    try {
      const data = JSON.parse(jsonInput)
      if (!data.entities || !Array.isArray(data.entities)) {
        setError('JSON 格式不正确，需要包含 entities 数组')
        return
      }
      onImport(data)
      onClose()
    } catch (e: any) {
      setError('JSON 解析失败: ' + e.message)
    }
  }

  const inputStyle = {
    width: '100%' as const,
    padding: '6px 8px',
    fontSize: 12,
    background: isDark ? '#1a1a1a' : '#fafafa',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: isDark ? '#e0e0e0' : '#333',
    outline: 'none' as const,
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog kg-import-dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>📥 导入知识图谱</h2>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="dialog-body">
          <div className="kg-import-section">
            <label className="kg-import-label">导入方式</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button
                className={`kg-toolbar-btn${mode === 'file' ? ' active' : ''}`}
                onClick={() => setMode('file')}
              >🔍 扫描项目</button>
              <button
                className={`kg-toolbar-btn${mode === 'paste' ? ' active' : ''}`}
                onClick={() => setMode('paste')}
              >📋 粘贴 JSON</button>
            </div>
          </div>

          {mode === 'file' ? (
            <div className="kg-import-section">
              <div className="kg-import-hint">
                <p>自动扫描项目文件结构，生成包含以下内容的图谱：</p>
                <ul style={{ marginLeft: 16, paddingLeft: 0, listStyle: 'disc', marginTop: 4 }}>
                  <li>目录 → <strong>模块</strong> 实体</li>
                  <li>文件 → <strong>文件</strong> 实体（按扩展名分类）</li>
                  <li>目录包含文件的 <strong>包含关系</strong></li>
                </ul>
              </div>
              <button
                className="kg-toolbar-btn primary"
                onClick={handleAnalyzeAndImport}
                disabled={loading}
                style={{ marginTop: 12, padding: '8px 20px' }}
              >
                {loading ? '⏳ 扫描中...' : '🚀 开始扫描'}
              </button>
            </div>
          ) : (
            <div className="kg-import-section">
              <label className="kg-import-label">粘贴图谱 JSON 数据</label>
              <textarea
                className="kg-import-textarea"
                value={jsonInput}
                onChange={e => setJsonInput(e.target.value)}
                placeholder='{"entities": [...], "relations": [...]}'
                style={{ minHeight: 160, ...inputStyle, fontFamily: 'Consolas, monospace' }}
              />
              <div className="kg-import-hint">
                JSON 格式: {`{ "entities": [{ "id": "e1", "name": "...", "type": "module", ... }], "relations": [{ "id": "r1", "sourceId": "e1", "targetId": "e2", "type": "contains" }] }`}
              </div>
              <button
                className="kg-toolbar-btn primary"
                onClick={handlePasteImport}
                disabled={!jsonInput.trim()}
                style={{ marginTop: 8, padding: '8px 20px' }}
              >
                📥 导入
              </button>
            </div>
          )}

          {error && <div style={{ color: '#ff5050', fontSize: 12, marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}
