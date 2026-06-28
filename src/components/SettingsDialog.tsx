import { useState, useEffect } from 'react'
import type { AppSettingsSafe, ModelProvider, ModelConfigSafe } from '../types/settings'
import { SshSettingsSection } from './SshSettingsSection'

const PROVIDER_DEFAULTS: Record<ModelProvider, string> = {
  Claude: 'https://api.anthropic.com',
  DeepSeek: 'https://api.deepseek.com',
  OpenAI: 'https://api.openai.com/v1',
  Custom: '',
}

const PROVIDER_MODELS: Record<ModelProvider, string> = {
  Claude: 'claude-sonnet-4-20250514',
  DeepSeek: 'deepseek-chat',
  OpenAI: 'gpt-4o',
  Custom: '',
}

type SettingsTab = 'models' | 'workspace' | 'ssh' | 'general'

const TABS: { key: SettingsTab; icon: string; label: string }[] = [
  { key: 'models', icon: '🤖', label: '模型' },
  { key: 'workspace', icon: '📁', label: '工作空间' },
  { key: 'ssh', icon: '🔌', label: 'SSH' },
  { key: 'general', icon: '⚙️', label: '通用' },
]

interface EditForm {
  id: string
  name: string
  provider: ModelProvider
  apiKey: string
  baseUrl: string
  model: string
  apiKeySource: 'env' | 'user'
}

function emptyForm(): EditForm {
  return {
    id: '', name: '', provider: 'Claude', apiKey: '',
    baseUrl: PROVIDER_DEFAULTS.Claude, model: PROVIDER_MODELS.Claude,
    apiKeySource: 'user',
  }
}

export function SettingsDialog({
  onClose, settings, onSettingsChange, onWorkspaceSwitch,
}: {
  onClose: () => void
  settings: AppSettingsSafe | null
  onSettingsChange: (s: AppSettingsSafe) => void
  onWorkspaceSwitch?: (workspaceId: string) => void
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('models')

  // ── Model state ──
  const [editing, setEditing] = useState<EditForm | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [testingModel, setTestingModel] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; version?: string; latency?: number; error?: string }>>({})

  // ── Workspace state ──
  const [workspaceRoot, setWorkspaceRoot] = useState('~/claudespace')
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; path: string; isActive: boolean; createdAt: string }>>([])
  const [newWsName, setNewWsName] = useState('')
  const [newWsPath, setNewWsPath] = useState('')
  const [wsError, setWsError] = useState('')

  useEffect(() => {
    window.electronAPI.getWorkspaceRoot().then(setWorkspaceRoot).catch(() => {})
    window.electronAPI.workspaceList().then(list => { if (list?.length) setWorkspaces(list) }).catch(() => {})
  }, [])

  // ── Workspace handlers ──
  async function handleAddWorkspace() {
    const name = newWsName.trim(); const wsPath = newWsPath.trim()
    if (!name || !wsPath) { setWsError('名称和路径不能为空'); return }
    try {
      const res = await window.electronAPI.workspaceAdd({ name, path: wsPath })
      if (res.success && res.workspace) {
        setWorkspaces(prev => [...prev, res.workspace!])
        setNewWsName(''); setNewWsPath(''); setWsError('')
      } else { setWsError(res.error || '添加失败') }
    } catch (e: any) { setWsError(e.message) }
  }

  async function handleRemoveWorkspace(id: string) {
    await window.electronAPI.workspaceRemove(id)
    setWorkspaces(prev => prev.filter(w => w.id !== id))
  }

  async function handleSetActiveWorkspace(id: string) {
    if (onWorkspaceSwitch) { onWorkspaceSwitch(id) }
    else {
      const res = await window.electronAPI.workspaceSetActive(id)
      if (res.success && res.path) {
        setWorkspaces(prev => prev.map(w => ({ ...w, isActive: w.id === id })))
        setWorkspaceRoot(res.path!)
      }
    }
  }

  async function handleBrowseWorkspacePath() {
    try {
      const result = await window.electronAPI.openDirectoryDialog?.()
      if (result && !result.canceled && result.dirPath) setNewWsPath(result.dirPath)
    } catch { /* 非关键 */ }
  }

  // ── Model handlers ──
  const models = settings?.models || []

  function startEdit(model: ModelConfigSafe) {
    setEditing({ id: model.id, name: model.name, provider: model.provider, apiKey: '', baseUrl: model.baseUrl, model: model.model, apiKeySource: model.apiKeySource })
    setIsAdding(false)
  }
  function startAdd() { setEditing(emptyForm()); setIsAdding(true) }
  function cancelEdit() { setEditing(null); setIsAdding(false) }

  function handleSaveEdit() {
    if (!editing || !settings) return
    if (!editing.name.trim()) return
    const id = isAdding ? 'model-' + Date.now().toString(36) : editing.id
    let newModels: ModelConfigSafe[]
    if (isAdding) {
      newModels = [...models, { id, name: editing.name.trim(), provider: editing.provider, apiKeyHint: editing.apiKey ? maskLocal(editing.apiKey) : '未设置', baseUrl: editing.baseUrl, model: editing.model, apiKeySource: editing.apiKey ? 'user' as const : 'env' as const }]
    } else {
      newModels = models.map(m => m.id !== editing.id ? m : { ...m, name: editing.name.trim(), provider: editing.provider, apiKeyHint: editing.apiKey ? maskLocal(editing.apiKey) : m.apiKeyHint, baseUrl: editing.baseUrl, model: editing.model, apiKeySource: editing.apiKey ? 'user' as const : m.apiKeySource })
    }
    const updated: AppSettingsSafe = { ...settings, models: newModels }
    const withApiKey = { ...updated, models: newModels.map(m => (m.id === id && editing.apiKey) ? { ...m, apiKey: editing.apiKey } as any : m) }
    onSettingsChange(withApiKey)
    setEditing(null); setIsAdding(false)
  }

  function handleDelete(modelId: string) {
    if (!settings) return
    const newModels = models.filter(m => m.id !== modelId)
    onSettingsChange({ ...settings, models: newModels, activeModelId: settings.activeModelId === modelId ? (newModels[0]?.id || null) : settings.activeModelId })
  }

  function handleSetActive(modelId: string) {
    if (!settings) return
    onSettingsChange({ ...settings, activeModelId: modelId })
  }

  function handleProviderChange(provider: ModelProvider) {
    if (!editing) return
    setEditing({ ...editing, provider, baseUrl: PROVIDER_DEFAULTS[provider], model: PROVIDER_MODELS[provider] })
  }

  const handleTestConnection = async (model: ModelConfigSafe) => {
    setTestingModel(model.id)
    try {
      const result = await window.electronAPI.connectionHealthCheck({ modelId: model.id, modelName: model.name, provider: model.provider, apiKey: '', baseUrl: model.baseUrl, model: model.model })
      const cliItem = result.items.find(i => i.type === 'claude-cli')
      setTestResults(prev => ({ ...prev, [model.id]: { success: result.overall === 'healthy' || result.overall === 'degraded', version: cliItem?.message, latency: result.items.find(i => i.latencyMs != null)?.latencyMs, error: result.overall === 'disconnected' ? result.items.find(i => i.status === 'error')?.message : undefined } }))
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [model.id]: { success: false, error: err.message } }))
    }
    setTestingModel(null)
  }

  const activeModelId = settings?.activeModelId

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={e => e.stopPropagation()}>
        {/* ── Header + Tab bar ── */}
        <div className="settings-header">
          <h2>⚙️ 设置</h2>
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>
        <div className="settings-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`settings-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <span className="settings-tab-icon">{tab.icon}</span>
              <span className="settings-tab-label">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div className="settings-body">
          {activeTab === 'models' && (
            <div className="settings-tab-content">
              <div className="setting-section">
                <div className="setting-section-header">
                  <h3>模型配置</h3>
                  {!editing && (
                    <button className="btn-add-model" onClick={startAdd}>+ 添加模型</button>
                  )}
                </div>

                {models.map(m => (
                  <div key={m.id} className={`model-card ${m.id === activeModelId ? 'active' : ''}`}>
                    <div className="model-card-info">
                      <div className="model-card-name">
                        {m.name}
                        {m.id === activeModelId && <span className="model-card-badge-active">活跃</span>}
                      </div>
                      <div className="model-card-detail">
                        <span className="model-card-provider">{m.provider}</span>
                        {' · '}{m.model}
                      </div>
                      <div className="model-card-detail" style={{ fontFamily: 'monospace', fontSize: 10 }}>{m.baseUrl}</div>
                      <div className="model-card-detail">API Key: {m.apiKeyHint}</div>
                      {testResults[m.id] && (
                        <div className={`model-test-result ${testResults[m.id].success ? 'success' : 'error'}`}>
                          {testResults[m.id].success
                            ? `✓ ${testResults[m.id].version || '连接成功'}${testResults[m.id].latency != null ? ` (${testResults[m.id].latency}ms)` : ''}`
                            : `✗ ${testResults[m.id].error || '连接失败'}`}
                        </div>
                      )}
                    </div>
                    <div className="model-card-actions">
                      {m.id !== activeModelId && <button className="icon-btn" onClick={() => handleSetActive(m.id)} title="设为活跃">⭐</button>}
                      <button className="icon-btn" onClick={() => handleTestConnection(m)} title="测试连接" disabled={testingModel === m.id}>{testingModel === m.id ? '⏳' : '🔌'}</button>
                      <button className="icon-btn" onClick={() => startEdit(m)} title="编辑">✏️</button>
                      <button className="icon-btn" onClick={() => handleDelete(m.id)} title="删除" style={{ color: '#e05555' }}>🗑</button>
                    </div>
                  </div>
                ))}

                {models.length === 0 && !editing && (
                  <div className="empty-hint" style={{ padding: 24, textAlign: 'center' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🤖</div>
                    <div style={{ fontSize: 13, color: '#888' }}>暂未配置模型</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>点击「+ 添加模型」开始配置</div>
                  </div>
                )}
              </div>

              {editing && (
                <div className="model-form">
                  <h4 style={{ fontSize: 13, marginBottom: 12, color: '#ccc' }}>{isAdding ? '添加模型' : `编辑: ${editing.name || editing.id}`}</h4>
                  <div className="model-form-field"><label>名称</label><input className="model-form-input" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="例如: DeepSeek V3" /></div>
                  <div className="model-form-field"><label>提供商</label><select className="model-form-select" value={editing.provider} onChange={e => handleProviderChange(e.target.value as ModelProvider)}><option value="Claude">Claude (Anthropic)</option><option value="DeepSeek">DeepSeek</option><option value="OpenAI">OpenAI</option><option value="Custom">自定义</option></select></div>
                  <div className="model-form-field"><label>API Key {isAdding ? '' : '(留空保持不变)'}</label><input className="model-form-input" type="password" value={editing.apiKey} onChange={e => setEditing({ ...editing, apiKey: e.target.value, apiKeySource: e.target.value ? 'user' : editing.apiKeySource })} placeholder={isAdding ? '输入 API Key' : '留空则保持原有 Key'} /></div>
                  <div className="model-form-field"><label>Base URL</label><input className="model-form-input" value={editing.baseUrl} onChange={e => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="https://api.example.com" /></div>
                  <div className="model-form-field"><label>Model</label><input className="model-form-input" value={editing.model} onChange={e => setEditing({ ...editing, model: e.target.value })} placeholder="例如: deepseek-chat" /></div>
                  <div className="model-form-actions">
                    <button className="btn-cancel" onClick={cancelEdit}>取消</button>
                    <button className="btn-primary" onClick={handleSaveEdit}>{isAdding ? '添加' : '保存'}</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'workspace' && (
            <div className="settings-tab-content">
              <div className="setting-section">
                <div className="setting-section-header"><h3>工作空间管理</h3></div>
                <p className="setting-hint" style={{ marginBottom: 16 }}>管理多个工作空间，切换工作空间会触发软重启并重新扫描项目列表。</p>

                <div className="workspace-active-banner">
                  <span className="workspace-active-label">📍 当前活跃</span>
                  <span className="workspace-active-name">{workspaces.find(w => w.isActive)?.name || '默认工作空间'}</span>
                  <span className="workspace-active-path">{workspaceRoot}</span>
                </div>

                {workspaces.length > 0 && (
                  <div className="workspace-list">
                    {workspaces.map(ws => (
                      <div key={ws.id} className={`workspace-card ${ws.isActive ? 'active' : ''}`}>
                        <div className="workspace-card-body">
                          <div className="workspace-card-name">{ws.isActive && '✅ '}{ws.name}</div>
                          <div className="workspace-card-path" title={ws.path}>{ws.path}</div>
                        </div>
                        <div className="workspace-card-actions">
                          {!ws.isActive && <button className="btn-small primary" onClick={() => handleSetActiveWorkspace(ws.id)}>切换</button>}
                          {ws.id !== '_default' && <button className="btn-small danger" onClick={() => handleRemoveWorkspace(ws.id)}>✕</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="workspace-add-form">
                  <div className="workspace-add-title">➕ 添加工作空间</div>
                  <div className="workspace-add-row">
                    <input type="text" value={newWsName} onChange={e => setNewWsName(e.target.value)} placeholder="空间名称" className="workspace-add-input" style={{ flex: 1 }} />
                    <input type="text" value={newWsPath} onChange={e => setNewWsPath(e.target.value)} placeholder="路径 (如: D:\projects)" className="workspace-add-input" style={{ flex: 2 }} />
                    <button className="btn-small" onClick={handleBrowseWorkspacePath} title="浏览文件夹">📂</button>
                  </div>
                  {wsError && <div className="form-error">⚠️ {wsError}</div>}
                  <button className="btn-small primary" onClick={handleAddWorkspace} disabled={!newWsName.trim() || !newWsPath.trim()}
                    style={{ marginTop: 8, width: '100%', padding: '8px 0', opacity: (!newWsName.trim() || !newWsPath.trim()) ? 0.4 : 1 }}>
                    添加
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ssh' && (
            <div className="settings-tab-content">
              <SshSettingsSection
                servers={settings?.sshServers || []}
                onServersChange={(sshServers) => { if (settings) onSettingsChange({ ...settings, sshServers: sshServers as any }) }}
              />
            </div>
          )}

          {activeTab === 'general' && (
            <div className="settings-tab-content">
              <div className="setting-section">
                <div className="setting-section-header"><h3>审批设置</h3></div>
                <div className="setting-toggle-row">
                  <div className="setting-toggle-info">
                    <span className="setting-toggle-label">自动审批</span>
                    <span className="setting-toggle-desc">开启后，所有工具调用将自动执行，不再弹出审批窗口。</span>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={settings?.autoApproval ?? false} onChange={(e) => { if (!settings) return; onSettingsChange({ ...settings, autoApproval: e.target.checked }) }} />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="setting-toggle-row" style={{ borderTop: '1px solid #2a2a4a', paddingTop: 16, marginTop: 16 }}>
                  <div className="setting-toggle-info">
                    <span className="setting-toggle-label">🧠 自动记忆</span>
                    <span className="setting-toggle-desc">开启后，每次会话对话和 Git 提交将自动保存为项目记忆。</span>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={settings?.autoMemory ?? false} onChange={(e) => { if (!settings) return; onSettingsChange({ ...settings, autoMemory: e.target.checked }) }} />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                <div className="setting-toggle-row" style={{ borderTop: '1px solid #2a2a4a', paddingTop: 16, marginTop: 16 }}>
                  <div className="setting-toggle-info">
                    <span className="setting-toggle-label">默认群聊模式</span>
                    <span className="setting-toggle-desc">启动应用时默认使用群聊还是单聊模式。</span>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={settings?.defaultGroupChat ?? false} onChange={(e) => { if (!settings) return; onSettingsChange({ ...settings, defaultGroupChat: e.target.checked }) }} />
                    <span className="toggle-slider"></span>
                  </label>
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#888' }}>{settings?.defaultGroupChat ? '👥 群聊' : '👤 单聊'}</span>
                </div>
              </div>

              <div className="setting-section" style={{ marginTop: 24 }}>
                <div className="setting-section-header"><h3>关于</h3></div>
                <div className="about-info">
                  <div className="about-row"><span className="about-label">应用版本</span><span className="about-value">Claude Space v1.1.5</span></div>
                  <div className="about-row"><span className="about-label">Electron</span><span className="about-value">28.3.3</span></div>
                  <div className="about-row"><span className="about-label">React</span><span className="about-value">18.3.1</span></div>
                  <div className="about-row"><span className="about-label">工作区路径</span><span className="about-value" style={{ fontFamily: 'monospace', fontSize: 11 }}>{workspaceRoot}</span></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function maskLocal(key: string): string {
  if (!key || key.length < 8) return '****'
  return key.slice(0, 3) + '****' + key.slice(-4)
}
