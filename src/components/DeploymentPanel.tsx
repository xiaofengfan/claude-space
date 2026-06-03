/**
 * 部署面板 — 配置部署目标并执行 SFTP 部署。
 */
import { useState } from 'react'
import type { DeployTarget, DeployProgress } from '../types/ssh'
import { DEFAULT_DEPLOY_EXCLUDES } from '../types/ssh'

interface Props {
  settings: any
  sshStatus: { serverId: string | null; status: string }
  activeProject: { name: string; path: string } | null
  onSettingsChange: (settings: any) => void
}

export function DeploymentPanel({ settings, sshStatus, activeProject, onSettingsChange }: Props) {
  const targets: DeployTarget[] = settings?.deployTargets || []
  const servers = settings?.sshServers || []

  const [editingTarget, setEditingTarget] = useState<Partial<DeployTarget> | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployLog, setDeployLog] = useState<string[]>([])
  const [deployError, setDeployError] = useState('')

  function handleSaveTarget() {
    if (!editingTarget) return
    const now = new Date().toISOString()
    const target: DeployTarget = {
      id: editingTarget.id || 'deploy-' + Date.now().toString(36),
      name: editingTarget.name || '未命名',
      sshServerId: editingTarget.sshServerId || '',
      remotePath: editingTarget.remotePath || '',
      preDeployCommands: editingTarget.preDeployCommands || [],
      postDeployCommands: editingTarget.postDeployCommands || [],
      excludePatterns: editingTarget.excludePatterns || [...DEFAULT_DEPLOY_EXCLUDES],
      autoDeploy: editingTarget.autoDeploy || false,
      createdAt: editingTarget.createdAt || now,
      updatedAt: now,
    }
    const updated = isAdding
      ? [...targets, target]
      : targets.map(t => t.id === target.id ? target : t)
    onSettingsChange({ ...settings, deployTargets: updated })
    setEditingTarget(null)
    setIsAdding(false)
  }

  async function handleDeploy(target: DeployTarget) {
    if (!activeProject) return
    setDeploying(true)
    setDeployError('')
    setDeployLog([])

    // 监听部署状态
    const unsub = window.electronAPI.onSshDeployStatus?.((status: any) => {
      if (status.phase === 'completed') {
        setDeployLog(prev => [...prev, `✅ 部署完成! 上传了 ${status.uploaded || 0} 个文件`])
        setDeploying(false)
      } else if (status.command) {
        setDeployLog(prev => [...prev, `[${status.phase}] ${status.command}`])
      } else {
        setDeployLog(prev => [...prev, `[${status.phase}] ${status.currentFile}`])
      }
    })

    try {
      const result = await window.electronAPI.sshDeploy({
        projectPath: activeProject.path,
        deployTargetId: target.id,
      })
      if (!result.success) {
        setDeployError(result.error || '部署失败')
        setDeployLog(prev => [...prev, `❌ 部署失败: ${result.error}`])
      }
    } catch (e: any) {
      setDeployError(e.message || '部署失败')
    }
    setDeploying(false)
    unsub?.()
  }

  const serverOptions = servers.filter((s: any) => sshStatus.serverId === s.id || true)

  return (
    <div className="deployment-panel">
      <h3>🚀 项目部署</h3>

      {!activeProject && <p className="empty-hint">请先选择一个项目</p>}

      {/* Deploy targets list */}
      {targets.length > 0 && (
        <div className="deploy-targets">
          {targets.map(t => {
            const server = servers.find((s: any) => s.id === t.sshServerId)
            return (
              <div key={t.id} className="deploy-target-card">
                <div className="deploy-target-info">
                  <strong>{t.name}</strong>
                  <span>→ {server?.name || t.sshServerId}:{t.remotePath}</span>
                  <span className="deploy-detail">
                    {t.preDeployCommands.length} 条前置命令, {t.postDeployCommands.length} 条后置命令
                  </span>
                </div>
                <div className="deploy-target-actions">
                  <button className="btn-primary" onClick={() => handleDeploy(t)} disabled={deploying || !activeProject}>
                    {deploying ? '⏳ 部署中...' : '🚀 部署'}
                  </button>
                  <button className="icon-btn" onClick={() => setEditingTarget({ ...t })}>✏️</button>
                  <button className="icon-btn" onClick={() => {
                    onSettingsChange({ ...settings, deployTargets: targets.filter(dt => dt.id !== t.id) })
                  }}>🗑️</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {targets.length === 0 && <p className="empty-hint">暂无部署目标</p>}

      {/* Add/Edit target form */}
      {editingTarget && (
        <div className="model-edit-form">
          <div className="form-row">
            <label>名称</label>
            <input value={editingTarget.name || ''} onChange={e => setEditingTarget({ ...editingTarget, name: e.target.value })}
              placeholder="如：生产环境" />
          </div>
          <div className="form-row">
            <label>SSH 服务器</label>
            <select value={editingTarget.sshServerId || ''} onChange={e => setEditingTarget({ ...editingTarget, sshServerId: e.target.value })}>
              <option value="">选择一个服务器...</option>
              {serverOptions.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>远程路径</label>
            <input value={editingTarget.remotePath || ''} onChange={e => setEditingTarget({ ...editingTarget, remotePath: e.target.value })}
              placeholder="/var/www/app" />
          </div>
          <div className="form-row">
            <label>前置命令 (每行一个)</label>
            <textarea rows={3} value={(editingTarget.preDeployCommands || []).join('\n')}
              onChange={e => setEditingTarget({ ...editingTarget, preDeployCommands: e.target.value.split('\n').filter(Boolean) })}
              placeholder="cd /var/www/app&#10;pm2 stop app" />
          </div>
          <div className="form-row">
            <label>后置命令 (每行一个)</label>
            <textarea rows={3} value={(editingTarget.postDeployCommands || []).join('\n')}
              onChange={e => setEditingTarget({ ...editingTarget, postDeployCommands: e.target.value.split('\n').filter(Boolean) })}
              placeholder="npm install --production&#10;pm2 start app" />
          </div>
          <div className="form-row">
            <label>排除模式 (每行一个)</label>
            <textarea rows={3} value={(editingTarget.excludePatterns || DEFAULT_DEPLOY_EXCLUDES).join('\n')}
              onChange={e => setEditingTarget({ ...editingTarget, excludePatterns: e.target.value.split('\n').filter(Boolean) })} />
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={handleSaveTarget}>
              {isAdding ? '添加' : '保存'}
            </button>
            <button className="btn-secondary" onClick={() => { setEditingTarget(null); setIsAdding(false) }}>取消</button>
          </div>
        </div>
      )}

      {!editingTarget && (
        <button className="btn-primary" onClick={() => { setEditingTarget({}); setIsAdding(true) }}
          style={{ marginTop: 8 }}>+ 添加部署目标</button>
      )}

      {/* Deploy log */}
      {deployLog.length > 0 && (
        <div className="deploy-log">
          <h4>📋 部署日志</h4>
          <pre>{deployLog.join('\n')}</pre>
        </div>
      )}

      {deployError && (
        <div className="chat-connection-error" style={{ marginTop: 8 }}>
          <span className="chat-error-text">❌ {deployError}</span>
        </div>
      )}
    </div>
  )
}
