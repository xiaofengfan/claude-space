/**
 * 远程文件浏览器 — 通过 SFTP 浏览远程服务器文件系统。
 */
import { useState, useEffect } from 'react'

interface Props {
  sshStatus: { serverId: string | null; status: string }
  settings: any
}

interface RemoteFileNode {
  name: string; path: string; type: 'file' | 'directory' | 'symlink'
  size?: number; modifiedAt?: string; permissions?: string
  children?: RemoteFileNode[]
}

export function RemoteFileBrowser({ sshStatus, settings }: Props) {
  const [remotePath, setRemotePath] = useState('/')
  const [files, setFiles] = useState<RemoteFileNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedContent, setSelectedContent] = useState('')
  const [selectedName, setSelectedName] = useState('')

  const serverId = sshStatus.serverId
  const isConnected = sshStatus.status === 'connected'

  async function loadFiles(dirPath: string) {
    if (!serverId || !isConnected) return
    setLoading(true)
    setError('')
    try {
      const result = await window.electronAPI.sshListRemoteFiles({ serverId, remotePath: dirPath })
      setFiles(result || [])
      setRemotePath(dirPath)
    } catch (e: any) {
      setError('读取远程目录失败: ' + (e.message || '未知错误'))
    }
    setLoading(false)
  }

  useEffect(() => {
    if (isConnected && serverId) loadFiles('/')
  }, [isConnected, serverId])

  async function handleFileClick(node: RemoteFileNode) {
    if (node.type === 'directory') {
      loadFiles(node.path)
    } else {
      setSelectedName(node.name)
      try {
        const result = await window.electronAPI.sshReadRemoteFile({ serverId: serverId!, remotePath: node.path })
        if (result.success) {
          setSelectedContent(result.content || '(空文件)')
        } else {
          setSelectedContent(`读取失败: ${result.error}`)
        }
      } catch (e: any) {
        setSelectedContent('读取失败: ' + (e.message || '未知错误'))
      }
    }
  }

  function navigateUp() {
    const parts = remotePath.replace(/\/$/, '').split('/')
    parts.pop()
    loadFiles(parts.join('/') || '/')
  }

  function navigateToSegment(idx: number) {
    const parts = remotePath.replace(/\/$/, '').split('/').filter(Boolean)
    loadFiles('/' + parts.slice(0, idx + 1).join('/'))
  }

  if (!isConnected) return <p className="empty-hint">请先在 SSH 面板连接服务器</p>

  const pathParts = remotePath.replace(/\/$/, '').split('/').filter(Boolean)

  return (
    <div className="remote-file-browser">
      <div className="remote-path-breadcrumb">
        <button className="btn-icon" onClick={() => loadFiles('/')} disabled={loading}>🏠</button>
        <button className="btn-icon" onClick={navigateUp} disabled={loading || remotePath === '/'}>⬆️</button>
        <span className="breadcrumb-path">
          /{pathParts.map((p, i) => (
            <span key={i}>
              <span className="breadcrumb-seg" onClick={() => navigateToSegment(i)}>{p}</span>/
            </span>
          ))}
        </span>
        <button className="btn-icon" onClick={() => loadFiles(remotePath)} disabled={loading}>🔄</button>
      </div>

      {error && <div className="ssh-error">{error}</div>}
      {loading && <div className="ssh-loading">加载中...</div>}

      <div className="remote-file-list">
        {files.map(f => (
          <div key={f.path} className="remote-file-item"
            onClick={() => handleFileClick(f)}
            style={{ cursor: 'pointer' }}>
            <span className="remote-file-icon">
              {f.type === 'directory' ? '📁' : f.type === 'symlink' ? '🔗' : '📄'}
            </span>
            <span className="remote-file-name">{f.name}</span>
            <span className="remote-file-size">{f.size ? formatSize(f.size) : ''}</span>
            <span className="remote-file-perm">{f.permissions || ''}</span>
          </div>
        ))}
        {files.length === 0 && !loading && <p className="empty-hint">目录为空</p>}
      </div>

      {selectedContent && (
        <div className="remote-file-preview">
          <h4>📄 {selectedName}</h4>
          <pre>{selectedContent.length > 10000 ? selectedContent.slice(0, 10000) + '\n...(已截断)' : selectedContent}</pre>
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
