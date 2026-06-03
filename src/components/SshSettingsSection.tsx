/**
 * SSH 服务器配置区 — 在 SettingsDialog 中渲染，管理 SSH 服务器列表。
 */
import { useState } from 'react'
import type { SshServerConfigSafe, SshAuthMethod } from '../types/ssh'

interface Props {
  servers: SshServerConfigSafe[]
  onServersChange: (servers: SshServerConfigSafe[]) => void
}

export function SshSettingsSection({ servers, onServersChange }: Props) {
  const [editing, setEditing] = useState<Partial<SshServerConfigSafe> | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { overall: string; items: any[] }>>({})

  function handleSave() {
    if (!editing || !editing.name?.trim()) return
    const now = new Date().toISOString()
    // 展开 editing 以保留 newPassword / newPrivateKeyContent 等额外字段
    const saved = {
      ...editing,
      id: editing.id || 'ssh-' + Date.now().toString(36),
      name: editing.name,
      host: sanitizeHost(editing.host || ''),
      port: editing.port || 22,
      username: editing.username || '',
      authMethod: editing.authMethod || 'password',
      passwordHint: (editing as any).newPassword ? '****' : (editing.passwordHint || '未设置'),
      privateKeyPath: editing.privateKeyPath || '',
      privateKeyHint: editing.privateKeyPath ? `已配置 (${editing.privateKeyPath.split(/[/\\]/).pop()})` : '未设置',
      createdAt: editing.createdAt || now,
      updatedAt: now,
    }

    if (isAdding) {
      onServersChange([...servers, saved])
    } else {
      onServersChange(servers.map(s => s.id === saved.id ? saved : s))
    }
    setEditing(null)
    setIsAdding(false)
  }

  function handleDelete(id: string) {
    if (confirm('确定删除此 SSH 服务器配置？')) {
      onServersChange(servers.filter(s => s.id !== id))
    }
  }

  /** 清理主机地址：去掉 http://、https:// 和尾部斜杠 */
  function sanitizeHost(h: string): string {
    return h.replace(/^https?:\/\//i, '').replace(/\/+$/, '').trim()
  }

  async function handleTest(config: SshServerConfigSafe) {
    setTestingId(config.id)
    try {
      const result = await window.electronAPI.sshTestConnection({ ...config, newPassword: (editing as any)?.newPassword })
      setTestResults(prev => ({ ...prev, [config.id]: result }))
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [config.id]: { overall: 'disconnected', items: [{ type: 'error', label: '错误', status: 'error', message: e.message }] } }))
    }
    setTestingId(null)
  }

  function handleEdit(s: SshServerConfigSafe) {
    setEditing({ ...s })
    setIsAdding(false)
  }

  function startAdd() {
    setEditing({ name: '', host: '', port: 22, username: '', authMethod: 'password', passwordHint: '未设置', privateKeyPath: '', privateKeyHint: '未设置' })
    setIsAdding(true)
  }

  return (
    <div className="setting-group">
      <h3>🔌 SSH 远程服务器</h3>
      <p className="setting-hint">配置 SSH 服务器以进行远程开发和部署。</p>

      {servers.length === 0 && !editing && (
        <p className="empty-hint">暂无配置的 SSH 服务器</p>
      )}

      {servers.map(s => (
        <div key={s.id} className="model-card">
          <div className="model-card-info">
            <strong>{s.name}</strong>
            <span className="model-card-detail">{s.username}@{s.host}:{s.port}</span>
            <span className="model-card-detail">认证: {s.authMethod === 'password' ? '密码' : '密钥'} | {s.privateKeyHint}</span>
          </div>
          <div className="model-card-actions">
            <button className="icon-btn" onClick={() => handleTest(s)} disabled={testingId === s.id}
              title="测试连接">
              {testingId === s.id ? '⏳' : '🔍'}
            </button>
            <button className="icon-btn" onClick={() => handleEdit(s)} title="编辑">✏️</button>
            <button className="icon-btn" onClick={() => handleDelete(s.id)} title="删除">🗑️</button>
          </div>
          {testResults[s.id] && (
            <div className={`test-result test-${testResults[s.id].overall}`}>
              {testResults[s.id].items.map((item: any, i: number) => (
                <div key={i} className={`test-item test-${item.status}`}>
                  {item.status === 'ok' ? '✅' : item.status === 'warning' ? '⚠️' : '❌'} {item.label}: {item.message}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Edit / Add form */}
      {editing && (
        <div className="model-edit-form">
          <div className="form-row">
            <label>名称</label>
            <input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="如：生产服务器" />
          </div>
          <div className="form-row">
            <label>主机</label>
            <input value={editing.host || ''} onChange={e => setEditing({ ...editing, host: e.target.value })}
              placeholder="192.168.1.100 或 example.com" />
          </div>
          <div className="form-row">
            <label>端口</label>
            <input type="number" value={editing.port || 22} onChange={e => setEditing({ ...editing, port: +e.target.value })} />
          </div>
          <div className="form-row">
            <label>用户名</label>
            <input value={editing.username || ''} onChange={e => setEditing({ ...editing, username: e.target.value })}
              placeholder="root" />
          </div>
          <div className="form-row">
            <label>认证方式</label>
            <select value={editing.authMethod || 'password'} onChange={e => setEditing({ ...editing, authMethod: e.target.value as SshAuthMethod })}>
              <option value="password">密码</option>
              <option value="key">SSH 密钥</option>
            </select>
          </div>
          {editing.authMethod === 'password' ? (
            <div className="form-row">
              <label>密码</label>
              <input type="password" value={(editing as any).newPassword || ''}
                onChange={e => setEditing({ ...editing, newPassword: e.target.value } as any)}
                placeholder={editing.passwordHint !== '未设置' ? '留空保留原密码' : '输入 SSH 密码'} />
            </div>
          ) : (
            <div className="form-row">
              <label>私钥文件路径</label>
              <input value={editing.privateKeyPath || ''}
                onChange={e => setEditing({ ...editing, privateKeyPath: e.target.value })}
                placeholder="C:\Users\name\.ssh\id_rsa 或 /home/user/.ssh/id_rsa" />
            </div>
          )}
          <div className="form-actions">
            <button className="btn-primary" onClick={handleSave} disabled={!editing.name?.trim()}>
              {isAdding ? '添加' : '保存'}
            </button>
            <button className="btn-secondary" onClick={() => { setEditing(null); setIsAdding(false) }}>取消</button>
          </div>
        </div>
      )}

      {!editing && (
        <button className="btn-primary" onClick={startAdd} style={{ marginTop: 8 }}>+ 添加 SSH 服务器</button>
      )}
    </div>
  )
}
