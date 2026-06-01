import { useState } from 'react'
import type { AppSettingsSafe, ModelProvider, ModelConfigSafe } from '../types/settings'

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
    id: '',
    name: '',
    provider: 'Claude',
    apiKey: '',
    baseUrl: PROVIDER_DEFAULTS.Claude,
    model: PROVIDER_MODELS.Claude,
    apiKeySource: 'user',
  }
}

export function SettingsDialog({
  onClose,
  settings,
  onSettingsChange,
}: {
  onClose: () => void
  settings: AppSettingsSafe | null
  onSettingsChange: (s: AppSettingsSafe) => void
}) {
  const [editing, setEditing] = useState<EditForm | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [testingModel, setTestingModel] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; version?: string; latency?: number; error?: string }>>({})

  const models = settings?.models || []

  function startEdit(model: ModelConfigSafe) {
    setEditing({
      id: model.id,
      name: model.name,
      provider: model.provider,
      apiKey: '',  // 留空表示不修改
      baseUrl: model.baseUrl,
      model: model.model,
      apiKeySource: model.apiKeySource,
    })
    setIsAdding(false)
  }

  function startAdd() {
    setEditing(emptyForm())
    setIsAdding(true)
  }

  function cancelEdit() {
    setEditing(null)
    setIsAdding(false)
  }

  function handleSaveEdit() {
    if (!editing || !settings) return

    if (!editing.name.trim()) return

    const id = isAdding
      ? 'model-' + Date.now().toString(36)
      : editing.id

    let newModels: ModelConfigSafe[]

    if (isAdding) {
      // 新模型 — apiKey 来自表单
      newModels = [
        ...models,
        {
          id,
          name: editing.name.trim(),
          provider: editing.provider,
          apiKeyHint: editing.apiKey ? maskLocal(editing.apiKey) : '未设置',
          baseUrl: editing.baseUrl,
          model: editing.model,
          apiKeySource: editing.apiKey ? 'user' as const : 'env' as const,
        },
      ]
    } else {
      // 编辑已有模型
      newModels = models.map(m => {
        if (m.id !== editing.id) return m
        return {
          ...m,
          name: editing.name.trim(),
          provider: editing.provider,
          apiKeyHint: editing.apiKey
            ? maskLocal(editing.apiKey)
            : m.apiKeyHint,
          baseUrl: editing.baseUrl,
          model: editing.model,
          apiKeySource: editing.apiKey ? 'user' as const : m.apiKeySource,
        }
      })
    }

    const updated: AppSettingsSafe = {
      ...settings,
      models: newModels,
    }

    // 附带 apiKey 明文（通过 (m as any).apiKey 传递）
    const withApiKey = {
      ...updated,
      models: newModels.map(m => {
        if (m.id === id && editing.apiKey) {
          return { ...m, apiKey: editing.apiKey } as any
        }
        return m
      }),
    }

    onSettingsChange(withApiKey)
    setEditing(null)
    setIsAdding(false)
  }

  function handleDelete(modelId: string) {
    if (!settings) return
    const newModels = models.filter(m => m.id !== modelId)
    onSettingsChange({
      ...settings,
      models: newModels,
      activeModelId: settings.activeModelId === modelId
        ? (newModels[0]?.id || null)
        : settings.activeModelId,
    })
  }

  function handleSetActive(modelId: string) {
    if (!settings) return
    onSettingsChange({ ...settings, activeModelId: modelId })
  }

  function handleProviderChange(provider: ModelProvider) {
    if (!editing) return
    setEditing({
      ...editing,
      provider,
      baseUrl: PROVIDER_DEFAULTS[provider],
      model: PROVIDER_MODELS[provider],
    })
  }

  const activeModelId = settings?.activeModelId

  const handleTestConnection = async (model: ModelConfigSafe) => {
    setTestingModel(model.id)
    try {
      const result = await window.electronAPI.connectionHealthCheck({
        modelId: model.id, modelName: model.name, provider: model.provider,
        apiKey: '', baseUrl: model.baseUrl, model: model.model,
      })
      const cliItem = result.items.find(i => i.type === 'claude-cli')
      setTestResults(prev => ({
        ...prev,
        [model.id]: {
          success: result.overall === 'healthy' || result.overall === 'degraded',
          version: cliItem?.message,
          latency: result.items.find(i => i.latencyMs != null)?.latencyMs,
          error: result.overall === 'disconnected' ? result.items.find(i => i.status === 'error')?.message : undefined,
        },
      }))
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [model.id]: { success: false, error: err.message } }))
    }
    setTestingModel(null)
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog settings-dialog" onClick={e => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>⚙️ 设置</h2>
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>
        <div className="dialog-body">
          {/* ── 模型配置 ── */}
          <div className="setting-group">
            <h3>🤖 模型配置</h3>

            {models.map(m => (
              <div key={m.id} className={`model-card ${m.id === activeModelId ? 'active' : ''}`}>
                <div className="model-card-info">
                  <div className="model-card-name">
                    {m.name}
                    {m.id === activeModelId && (
                      <span className="model-card-badge-active">活跃</span>
                    )}
                  </div>
                  <div className="model-card-detail">
                    <span className="model-card-provider">{m.provider}</span>
                    {' · '}{m.model}
                  </div>
                  <div className="model-card-detail" style={{ fontFamily: 'monospace', fontSize: 10 }}>
                    {m.baseUrl}
                  </div>
                  <div className="model-card-detail">
                    API Key: {m.apiKeyHint}
                  </div>
                  {testResults[m.id] && (
                    <div className={`model-test-result ${testResults[m.id].success ? 'success' : 'error'}`}>
                      {testResults[m.id].success
                        ? `✓ ${testResults[m.id].version || '连接成功'}${testResults[m.id].latency != null ? ` (${testResults[m.id].latency}ms)` : ''}`
                        : `✗ ${testResults[m.id].error || '连接失败'}`
                      }
                    </div>
                  )}
                </div>
                <div className="model-card-actions">
                  {m.id !== activeModelId && (
                    <button className="icon-btn" onClick={() => handleSetActive(m.id)} title="设为活跃">
                      ⭐
                    </button>
                  )}
                  <button className="icon-btn" onClick={() => handleTestConnection(m)} title="测试连接"
                    disabled={testingModel === m.id}>
                    {testingModel === m.id ? '⏳' : '🔌'}
                  </button>
                  <button className="icon-btn" onClick={() => startEdit(m)} title="编辑">
                    ✏️
                  </button>
                  <button className="icon-btn" onClick={() => handleDelete(m.id)} title="删除"
                    style={{ color: '#e05555' }}>
                    🗑
                  </button>
                </div>
              </div>
            ))}

            {!editing && (
              <button className="btn-add-model" onClick={startAdd}>
                + 添加模型
              </button>
            )}
          </div>

          {/* ── 编辑/添加表单 ── */}
          {editing && (
            <div className="model-form">
              <h4 style={{ fontSize: 13, marginBottom: 12, color: '#ccc' }}>
                {isAdding ? '添加模型' : `编辑: ${editing.name || editing.id}`}
              </h4>
              <div className="model-form-field">
                <label>名称</label>
                <input
                  className="model-form-input"
                  value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                  placeholder="例如: DeepSeek V3"
                />
              </div>
              <div className="model-form-field">
                <label>提供商</label>
                <select
                  className="model-form-select"
                  value={editing.provider}
                  onChange={e => handleProviderChange(e.target.value as ModelProvider)}
                >
                  <option value="Claude">Claude (Anthropic)</option>
                  <option value="DeepSeek">DeepSeek</option>
                  <option value="OpenAI">OpenAI</option>
                  <option value="Custom">自定义</option>
                </select>
              </div>
              <div className="model-form-field">
                <label>API Key {isAdding ? '' : '(留空保持不变)'}</label>
                <input
                  className="model-form-input"
                  type="password"
                  value={editing.apiKey}
                  onChange={e => setEditing({ ...editing, apiKey: e.target.value, apiKeySource: e.target.value ? 'user' : editing.apiKeySource })}
                  placeholder={isAdding ? '输入 API Key' : '留空则保持原有 Key'}
                />
              </div>
              <div className="model-form-field">
                <label>Base URL</label>
                <input
                  className="model-form-input"
                  value={editing.baseUrl}
                  onChange={e => setEditing({ ...editing, baseUrl: e.target.value })}
                  placeholder="https://api.example.com"
                />
              </div>
              <div className="model-form-field">
                <label>Model</label>
                <input
                  className="model-form-input"
                  value={editing.model}
                  onChange={e => setEditing({ ...editing, model: e.target.value })}
                  placeholder="例如: deepseek-chat"
                />
              </div>
              <div className="model-form-actions">
                <button className="btn-cancel" onClick={cancelEdit}>取消</button>
                <button className="btn-primary" onClick={handleSaveEdit}>
                  {isAdding ? '添加' : '保存'}
                </button>
              </div>
            </div>
          )}

          {/* ── 工作区 ── */}
          <div className="setting-group">
            <h3>📁 工作区路径</h3>
            <label style={{ fontSize: 13, color: '#aaa' }}>默认: E:\claudespace</label>
            <p className="setting-hint">
              可通过菜单「文件 → 打开项目文件夹」添加自定义路径。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 本地脱敏函数（用于显示 hint） */
function maskLocal(key: string): string {
  if (!key || key.length < 8) return '****'
  return key.slice(0, 3) + '****' + key.slice(-4)
}
