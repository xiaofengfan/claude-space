/**
 * SSH 连接管理面板 — 测试连接、打开远程终端、浏览远程文件。
 */
import { useState } from 'react'
import type { AppSettingsSafe } from '../types/settings'

interface Props {
  settings: AppSettingsSafe | null
  sshStatus: { serverId: string | null; status: string; error: string }
  onSshStatusChange: (status: any) => void
  onOpenRemoteTerminal?: (serverId: string) => void
  onBrowseRemoteFiles?: (serverId: string) => void
}

export function SshConnectionPanel({ settings, sshStatus, onSshStatusChange, onOpenRemoteTerminal, onBrowseRemoteFiles }: Props) {
  const servers = settings?.sshServers || []
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleConnect(serverId: string) {
    setConnectingId(serverId)
    setError('')
    try {
      const result = await window.electronAPI.sshConnect(serverId)
      if (result.success) {
        onSshStatusChange({ serverId, status: 'connected', error: '', connectedAt: new Date().toISOString() })
      } else {
        setError(result.error || '连接失败')
        onSshStatusChange({ serverId, status: 'error', error: result.error || '' })
      }
    } catch (e: any) {
      setError(e.message || '连接失败')
    }
    setConnectingId(null)
  }

  async function handleDisconnect(serverId: string) {
    await window.electronAPI.sshDisconnect(serverId)
    onSshStatusChange({ serverId: null, status: 'disconnected', error: '' })
  }

  const isConnected = (serverId: string) => sshStatus.serverId === serverId && sshStatus.status === 'connected'

  return (
    <div className="ssh-panel">
      <h3>🔌 SSH 连接</h3>

      {error && (
        <div className="chat-connection-error" style={{ margin: '8px 0' }}>
          <span className="chat-error-text">⚠️ {error}</span>
          <span className="chat-error-dismiss" onClick={() => setError('')}>✕</span>
        </div>
      )}

      {servers.length === 0 ? (
        <p className="empty-hint">暂无 SSH 服务器配置。请先在 设置 → SSH 中添加服务器。</p>
      ) : (
        servers.map(s => {
          const connected = isConnected(s.id)
          const connecting = connectingId === s.id
          return (
            <div key={s.id} className={`ssh-server-card ${connected ? 'connected' : ''}`}>
              <div className="ssh-server-info">
                <strong>{s.name}</strong>
                <span className="ssh-server-detail">{s.username}@{s.host}:{s.port}</span>
                <span className={`ssh-status-badge ${connected ? 'status-connected' : 'status-disconnected'}`}>
                  {connecting ? '⏳ 连接中...' : connected ? '🟢 已连接' : '⚫ 未连接'}
                </span>
              </div>
              <div className="ssh-server-actions">
                {connected ? (
                  <button className="btn-secondary" onClick={() => handleDisconnect(s.id)}>断开</button>
                ) : (
                  <button className="btn-primary" onClick={() => handleConnect(s.id)} disabled={connecting}>
                    {connecting ? '连接中...' : '连接'}
                  </button>
                )}
                {connected && (
                  <>
                    <button className="btn-secondary" onClick={() => onOpenRemoteTerminal?.(s.id)}
                      title="打开远程终端">🖥️ 终端</button>
                    <button className="btn-secondary" onClick={() => onBrowseRemoteFiles?.(s.id)}
                      title="浏览远程文件">📁 文件</button>
                  </>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
