/**
 * ConnectionPanel — 连接检测、环境信息、多模型连接状态
 * 后续可扩展支持其他模型和形态
 */
import { useState, useEffect, useCallback } from 'react'
import type { ConnectionHealth, CliDetectionResult, ApiTestResult } from '../types/connection'
import type { AppSettingsSafe, ModelConfigSafe } from '../types/settings'

interface Props {
  settings: AppSettingsSafe | null
  claudeRunning: boolean
  claudeConnected: boolean
  activeSessionId?: string
  activeModelId: string | null
}

interface EnvConfigInfo {
  hasApiKey: boolean
  baseUrl: string
  model: string
  claudeCodeNoColor: boolean
  platform: string
  nodeVersion: string
  homeDir: string
}

interface ModelCheckState {
  [modelId: string]: {
    checking: boolean
    health: ConnectionHealth | null
    cliResult: CliDetectionResult | null
    apiResult: ApiTestResult | null
    error?: string
  }
}

export function ConnectionPanel({ settings, claudeRunning, claudeConnected, activeSessionId, activeModelId }: Props) {
  const [envConfig, setEnvConfig] = useState<EnvConfigInfo | null>(null)
  const [envLoading, setEnvLoading] = useState(false)
  const [modelChecks, setModelChecks] = useState<ModelCheckState>({})
  const [cliResult, setCliResult] = useState<CliDetectionResult | null>(null)
  const [cliChecking, setCliChecking] = useState(false)

  // 加载环境信息
  const loadEnvConfig = useCallback(async () => {
    setEnvLoading(true)
    try {
      const config = await window.electronAPI.connectionGetEnvConfig()
      setEnvConfig(config)
    } catch (err: any) {
      console.error('加载环境信息失败:', err)
    } finally {
      setEnvLoading(false)
    }
  }, [])

  // 检查 CLI
  const checkCli = useCallback(async () => {
    setCliChecking(true)
    try {
      const result = await window.electronAPI.connectionCheckCli()
      setCliResult(result)
    } catch (err: any) {
      console.error('CLI 检测失败:', err)
    } finally {
      setCliChecking(false)
    }
  }, [])

  // 检查单个模型连接
  const checkModel = useCallback(async (model: ModelConfigSafe) => {
    setModelChecks(prev => ({
      ...prev,
      [model.id]: { ...prev[model.id], checking: true, error: undefined },
    }))
    try {
      // 需要从 settings 中获取实际 apiKey，但 settings 是脱敏的
      // 主进程 loadSettings 会从磁盘读取完整的 apiKey
      // 这里传空字符串让主进程用存储的 key
      const health = await window.electronAPI.connectionHealthCheck({
        modelId: model.id,
        modelName: model.name,
        provider: model.provider,
        apiKey: '', // 主进程会读取存储的完整 key
        baseUrl: model.baseUrl,
        model: model.model,
      })
      setModelChecks(prev => ({
        ...prev,
        [model.id]: { ...prev[model.id], health, checking: false },
      }))
    } catch (err: any) {
      setModelChecks(prev => ({
        ...prev,
        [model.id]: { ...prev[model.id], checking: false, error: err.message },
      }))
    }
  }, [])

  // 检测所有模型
  const checkAll = useCallback(async () => {
    await checkCli()
    const models = settings?.models || []
    for (const model of models) {
      await checkModel(model)
    }
  }, [settings, checkCli, checkModel])

  // 初始化加载 — 自动运行所有检测
  useEffect(() => {
    loadEnvConfig()
    checkCli()
    // Auto-check all models on open
    const models = settings?.models || []
    if (models.length > 0) {
      models.forEach(model => {
        if (!modelChecks[model.id]?.health) {
          checkModel(model)
        }
      })
    }
  }, []) // 仅在挂载时运行一次

  const models = settings?.models || []

  return (
    <div className="connection-panel">
      {/* ── 标题栏 ─────────────────────────────────── */}
      <div className="connection-header">
        <span className="connection-header-title">🔗 连接管理</span>
        <button
          className="connection-btn connection-btn-sm"
          onClick={checkAll}
          disabled={Object.values(modelChecks).some(c => c.checking) || cliChecking}
        >
          {Object.values(modelChecks).some(c => c.checking) || cliChecking ? '⏳ 检测中...' : '🔄 全部检测'}
        </button>
      </div>

      <div className="connection-body">
        {/* ── 会话状态 ─────────────────────────────────── */}
        <section className="connection-section">
          <h3 className="connection-section-title">📡 实时状态</h3>
          <div className="connection-status-row">
            <StatusItem
              label="Claude 进程"
              status={claudeConnected ? 'ok' : claudeRunning ? 'warning' : 'idle'}
              message={claudeConnected ? '已连接' : claudeRunning ? '启动中...' : cliResult?.found ? '就绪 — 发送消息启动' : '未启动'}
            />
            <StatusItem
              label="CLI 版本"
              status={cliResult?.found ? 'ok' : 'error'}
              message={cliChecking ? '检测中...' : cliResult?.found ? `v${cliResult.version || '已安装'}` : cliResult ? '未安装' : '检测中...'}
            />
            <StatusItem
              label="活跃模型"
              status={activeModelId ? 'ok' : 'idle'}
              message={models.find(m => m.id === activeModelId)?.name || (activeModelId || '未选择')}
            />
          </div>
        </section>

        {/* ── 模型连接状态 ─────────────────────────────────── */}
        <section className="connection-section">
          <h3 className="connection-section-title">🔌 模型连接</h3>
          {models.length === 0 ? (
            <div className="connection-empty">暂无模型配置，请在设置中添加</div>
          ) : (
            <div className="connection-model-list">
              {models.map(model => {
                const check = modelChecks[model.id]
                const health = check?.health
                const isActive = model.id === activeModelId

                return (
                  <div key={model.id} className={`connection-model-item ${isActive ? 'active' : ''}`}>
                    <div className="connection-model-header">
                      <span className="connection-model-name">
                        {model.name}
                        {isActive && <span className="connection-model-badge">活跃</span>}
                      </span>
                      <span className="connection-model-provider">{model.provider}</span>
                      <button
                        className="connection-btn connection-btn-xs"
                        onClick={() => checkModel(model)}
                        disabled={check?.checking}
                      >
                        {check?.checking ? '⏳' : '🔍'}
                      </button>
                    </div>
                    <div className="connection-model-detail">
                      <span className="connection-model-url" title={model.baseUrl}>{model.baseUrl}</span>
                      <span className="connection-model-apikey">{model.apiKeyHint}</span>
                    </div>

                    {/* 检测结果 */}
                    {health && (
                      <div className="connection-check-results">
                        {health.items.map((item, i) => (
                          <div key={i} className={`connection-check-item status-${item.status}`}>
                            <span className="connection-check-dot">
                              {item.status === 'ok' ? '✅' : item.status === 'warning' ? '⚠️' : item.status === 'error' ? '❌' : '⬜'}
                            </span>
                            <span className="connection-check-label">{item.label}</span>
                            <span className="connection-check-msg">{item.message}</span>
                            {item.latencyMs != null && (
                              <span className="connection-check-latency">{item.latencyMs}ms</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 错误 */}
                    {check?.error && (
                      <div className="connection-check-error">错误: {check.error}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── CLI 环境 ─────────────────────────────────── */}
        <section className="connection-section">
          <h3 className="connection-section-title">🖥️ CLI 信息</h3>
          <div className="connection-check-results">
            <div className={`connection-check-item status-${cliResult?.found ? 'ok' : 'error'}`}>
              <span className="connection-check-dot">{cliChecking ? '⏳' : cliResult?.found ? '✅' : '❌'}</span>
              <span className="connection-check-label">Claude CLI</span>
              <span className="connection-check-msg">
                {cliChecking ? '检测中...' :
                 cliResult?.found ? `v${cliResult.version || '已安装'}` : '未安装 — npm install -g @anthropic-ai/claude-code'}
              </span>
            </div>
            {cliResult?.path && (
              <div className="connection-check-item status-ok">
                <span className="connection-check-dot">📁</span>
                <span className="connection-check-label">安装路径</span>
                <span className="connection-check-msg connection-mono">{cliResult.path}</span>
              </div>
            )}
            {envConfig && (
              <>
                <div className={`connection-check-item ${envConfig.hasApiKey ? 'status-ok' : 'status-error'}`}>
                  <span className="connection-check-dot">{envConfig.hasApiKey ? '✅' : '❌'}</span>
                  <span className="connection-check-label">API Key</span>
                  <span className="connection-check-msg">{envConfig.hasApiKey ? '已配置' : '未设置'}</span>
                </div>
                <div className="connection-check-item status-ok">
                  <span className="connection-check-dot">🔗</span>
                  <span className="connection-check-label">Base URL</span>
                  <span className="connection-check-msg connection-mono">{envConfig.baseUrl}</span>
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── 运行环境 ─────────────────────────────────── */}
        <section className="connection-section">
          <h3 className="connection-section-title">💻 运行环境</h3>
          {envLoading ? (
            <div className="connection-empty">加载中...</div>
          ) : envConfig ? (
            <div className="connection-env-grid">
              <EnvRow label="平台" value={envConfig.platform === 'win32' ? 'Windows' : envConfig.platform} />
              <EnvRow label="Node.js" value={envConfig.nodeVersion} />
              <EnvRow label="Home" value={envConfig.homeDir} mono />
              <EnvRow label="API Key" value={envConfig.hasApiKey ? '✅ 已设置' : '❌ 未设置'} />
              <EnvRow label="Base URL" value={envConfig.baseUrl} mono />
              <EnvRow label="Model" value={envConfig.model} />
            </div>
          ) : (
            <div className="connection-empty">加载失败</div>
          )}
        </section>

        {/* ── 快速操作 ─────────────────────────────────── */}
        <section className="connection-section">
          <h3 className="connection-section-title">⚡ 快速操作</h3>
          <div className="connection-actions">
            <button className="connection-btn" onClick={checkAll}
              disabled={Object.values(modelChecks).some(c => c.checking) || cliChecking}>
              🔄 全部检测
            </button>
            <button className="connection-btn" onClick={() => checkCli()}
              disabled={cliChecking}>
              🔍 检测 CLI
            </button>
            <button className="connection-btn" onClick={loadEnvConfig}
              disabled={envLoading}>
              📋 刷新环境
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

// ── 子组件 ──────────────────────────────────────────────────

function StatusItem({ label, status, message }: {
  label: string; status: 'ok' | 'warning' | 'error' | 'idle'; message: string
}) {
  const icon = status === 'ok' ? '🟢' : status === 'warning' ? '🟡' : status === 'error' ? '🔴' : '⚫'
  return (
    <div className="conn-status-item">
      <span className="conn-status-icon">{icon}</span>
      <div className="conn-status-info">
        <span className="conn-status-label">{label}</span>
        <span className="conn-status-msg">{message}</span>
      </div>
    </div>
  )
}

function EnvRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="conn-env-row">
      <span className="conn-env-label">{label}</span>
      <span className={`conn-env-value ${mono ? 'connection-mono' : ''}`} title={value}>{value}</span>
    </div>
  )
}
