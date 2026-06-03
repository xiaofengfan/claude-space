import { useState, useEffect, useCallback } from 'react'
import { MarkdownEditor } from './MarkdownEditor'
import { FileViewer } from './FileViewer'
import { getFileCategory } from '../utils/fileTypeUtils'

interface FileEditorProps {
  filePath: string
  fileName: string
  theme: 'dark' | 'light'
  onClose: () => void
  onOpenInNewWindow: () => void
}

export function FileEditor({ filePath, fileName, theme, onClose, onOpenInNewWindow }: FileEditorProps) {
  const [content, setContent] = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isBinary, setIsBinary] = useState(false)
  const [fileSize, setFileSize] = useState(0)

  const isDirty = content !== originalContent
  const fileCategory = getFileCategory(fileName, isBinary)

  // Load file content
  useEffect(() => {
    loadFile()
  }, [filePath])

  async function loadFile() {
    setLoading(true)
    setError(null)
    try {
      const res = await window.electronAPI.readFile(filePath)
      if (res.success) {
        setContent(res.content || '')
        setOriginalContent(res.content || '')
        setIsBinary(res.isBinary || false)
        setFileSize(res.size || 0)
      } else {
        setError(res.error || 'Failed to read file')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to read file')
    }
    setLoading(false)
  }

  async function handleSave() {
    if (!isDirty) return
    setSaveStatus('saving')
    try {
      const res = await window.electronAPI.writeFile({ filePath, content })
      if (res.success) {
        setOriginalContent(content)
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } else {
        setSaveStatus('error')
      }
    } catch (e: any) {
      setSaveStatus('error')
    }
  }

  function handleClose() {
    if (isDirty) {
      const confirmed = window.confirm('You have unsaved changes. Close without saving?')
      if (!confirmed) return
    }
    onClose()
  }

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
    }
  }, [content, originalContent, isDirty])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <div className="file-editor">
        <div className="file-editor-toolbar">
          <span className="file-editor-filename">📄 {fileName}</span>
          <span style={{ flex: 1 }} />
          <button className="file-editor-btn" onClick={handleClose}>✕ 关闭</button>
        </div>
        <div className="file-editor-loading">加载中...</div>
      </div>
    )
  }

  // ── Error state ──────────────────────────────────────────
  if (error) {
    return (
      <div className="file-editor">
        <div className="file-editor-toolbar">
          <span className="file-editor-filename">📄 {fileName}</span>
          <span style={{ flex: 1 }} />
          <button className="file-editor-btn" onClick={handleClose}>✕ 关闭</button>
        </div>
        <div className="file-editor-error">
          <p>❌ 无法读取文件: {error}</p>
          <button onClick={loadFile}>🔄 重试</button>
        </div>
      </div>
    )
  }

  return (
    <div className="file-editor">
      {/* Toolbar */}
      <div className="file-editor-toolbar">
        <span className="file-editor-filename">📄 {fileName}</span>
        {isDirty && <span className="file-editor-dirty">● 未保存</span>}
        {saveStatus === 'saved' && <span className="file-editor-saved">✓ 已保存</span>}
        {saveStatus === 'error' && <span className="file-editor-save-error">✗ 保存失败</span>}
        <span style={{ flex: 1 }} />
        {fileCategory === 'markdown' && (
          <button
            className="file-editor-btn"
            onClick={handleSave}
            disabled={!isDirty || saveStatus === 'saving'}
            title="Ctrl+S"
          >
            {saveStatus === 'saving' ? '⏳ 保存中...' : '💾 保存'}
          </button>
        )}
        <button className="file-editor-btn" onClick={onOpenInNewWindow} title="在新窗口中打开">
          🗖 新窗口
        </button>
        <button className="file-editor-btn" onClick={handleClose} title="关闭 (Esc)">
          ✕ 关闭
        </button>
      </div>

      {/* Content */}
      {fileCategory === 'binary' ? (
        <div className="file-viewer-binary">
          <p className="file-viewer-binary-icon">📦</p>
          <p>无法预览二进制文件</p>
          <p className="file-viewer-binary-size">文件大小: {formatSize(fileSize)}</p>
          <p className="file-viewer-binary-hint">该文件类型不支持文本预览</p>
        </div>
      ) : fileCategory === 'markdown' ? (
        <MarkdownEditor content={content} onChange={setContent} theme={theme} />
      ) : (
        <FileViewer content={content} fileName={fileName} theme={theme} />
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
