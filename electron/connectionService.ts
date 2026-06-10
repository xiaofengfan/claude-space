/**
 * 连接服务 — CLI 探测、API 连通性检测、认证验证、会话监控
 * 后续可扩展支持其他模型/提供商
 */
import { spawn, execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { resolveClaudePath } from './utils'

const CLAUDE_BIN = resolveClaudePath()

// ── 类型 ──────────────────────────────────────────────────

export interface CliDetectionResult {
  found: boolean
  version?: string
  path?: string
  installCommand?: string
}

export interface ApiTestResult {
  reachable: boolean
  statusCode?: number
  latencyMs: number
  error?: string
  models?: string[]
}

export interface ConnectionCheckItem {
  type: 'claude-cli' | 'api-endpoint' | 'auth' | 'session'
  label: string
  status: 'ok' | 'warning' | 'error' | 'idle'
  message: string
  detail?: string
  checkedAt?: string
  latencyMs?: number
}

export interface ConnectionHealth {
  overall: 'healthy' | 'degraded' | 'disconnected' | 'unknown'
  items: ConnectionCheckItem[]
  lastChecked: string | null
}

// ── CLI 检测 ──────────────────────────────────────────────

/** 检测 Claude CLI 是否安装 */
export async function detectCli(): Promise<CliDetectionResult> {
  return new Promise((resolve) => {
    execFile(CLAUDE_BIN, ['--version'], { timeout: 10000 }, (_err, versionOut) => {
      if (_err) {
        resolve({
          found: false,
          installCommand: 'npm install -g @anthropic-ai/claude-code',
        })
        return
      }
      const version = versionOut?.trim() || undefined
      resolve({
        found: true,
        version,
        path: CLAUDE_BIN,
      })
    })
  })
}

// ── API 端点检测 ──────────────────────────────────────────

/** 检测 API 端点是否可达（通过 node built-in https） */
export async function testApiEndpoint(
  baseUrl: string,
  apiKey: string,
  timeoutMs: number = 10000,
): Promise<ApiTestResult> {
  const startTime = Date.now()

  return new Promise((resolve) => {
    const url = new URL(baseUrl + '/v1/messages')
    const isHttps = url.protocol === 'https:'
    const httpModule = isHttps ? require('https') : require('http')

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
    }

    const req = httpModule.request(options, (res: any) => {
      let body = ''
      res.on('data', (chunk: Buffer) => body += chunk.toString())
      res.on('end', () => {
        const latencyMs = Date.now() - startTime
        // 200/201 = 认证有效 + 端点正常
        // 401/403 = 端点可达但认证无效
        // 404 = 端点可能路径不对（比如 DeepSeek 用 /anthropic 后缀）
        if (res.statusCode === 200 || res.statusCode === 201) {
          try {
            const data = JSON.parse(body)
            resolve({
              reachable: true,
              statusCode: res.statusCode,
              latencyMs,
              models: data.models || undefined,
            })
          } catch {
            resolve({ reachable: true, statusCode: res.statusCode, latencyMs })
          }
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          resolve({
            reachable: true,
            statusCode: res.statusCode,
            latencyMs,
            error: `认证失败 (HTTP ${res.statusCode})`,
          })
        } else {
          resolve({
            reachable: true,
            statusCode: res.statusCode,
            latencyMs,
            error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}`,
          })
        }
      })
    })

    req.on('error', (err: any) => {
      const latencyMs = Date.now() - startTime
      resolve({
        reachable: false,
        latencyMs,
        error: err.code === 'ENOTFOUND' ? 'DNS 解析失败，检查 baseUrl' :
               err.code === 'ECONNREFUSED' ? '连接被拒绝' :
               err.code === 'ETIMEDOUT' ? `超时 (${timeoutMs}ms)` :
               err.message,
      })
    })

    req.on('timeout', () => {
      req.destroy()
      resolve({
        reachable: false,
        latencyMs: Date.now() - startTime,
        error: `请求超时 (${timeoutMs}ms)`,
      })
    })

    // 发送一个最小的请求体（仅用于探测）
    req.write(JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }))
    req.end()
  })
}

// ── 综合健康检查 ──────────────────────────────────────────

/** 对单个模型配置执行完整连接健康检查 */
export async function runHealthCheck(
  modelConfig: {
    id: string; name: string; provider: string
    apiKey: string; baseUrl: string; model: string
  },
  activeSessionId?: string,
): Promise<ConnectionHealth> {
  const items: ConnectionCheckItem[] = []
  const now = new Date().toISOString()

  // 1. CLI 检测
  const cliResult = await detectCli()
  items.push({
    type: 'claude-cli',
    label: 'Claude CLI',
    status: cliResult.found ? 'ok' : 'error',
    message: cliResult.found
      ? `v${cliResult.version || '已安装'}`
      : '未找到 Claude CLI',
    detail: cliResult.found
      ? `路径: ${cliResult.path}`
      : `安装: ${cliResult.installCommand || 'npm install -g @anthropic-ai/claude-code'}`,
    checkedAt: now,
  })

  // 2. API 端点检测
  if (modelConfig.apiKey && modelConfig.baseUrl) {
    const apiResult = await testApiEndpoint(modelConfig.baseUrl, modelConfig.apiKey)
    items.push({
      type: 'api-endpoint',
      label: 'API 端点',
      status: apiResult.reachable ? 'ok' : 'error',
      message: apiResult.reachable
        ? `可达 (${apiResult.latencyMs}ms)`
        : '无法连接',
      detail: `${modelConfig.baseUrl} → HTTP ${apiResult.statusCode || 'N/A'}${apiResult.error ? ` (${apiResult.error})` : ''}`,
      checkedAt: now,
      latencyMs: apiResult.latencyMs,
    })

    // 3. 认证检测
    items.push({
      type: 'auth',
      label: 'API 认证',
      status: apiResult.reachable && apiResult.statusCode === 200 ? 'ok'
            : apiResult.reachable && (apiResult.statusCode === 401 || apiResult.statusCode === 403) ? 'error'
            : apiResult.reachable ? 'warning'
            : 'idle',
      message: apiResult.reachable && apiResult.statusCode === 200 ? '认证有效'
            : apiResult.reachable && (apiResult.statusCode === 401 || apiResult.statusCode === 403) ? '认证失败'
            : apiResult.error ? `无法验证 (${apiResult.error})` : '待检测',
      checkedAt: now,
      latencyMs: apiResult.latencyMs,
    })
  } else {
    items.push({
      type: 'api-endpoint',
      label: 'API 端点',
      status: 'idle',
      message: '未配置 API 端点',
      detail: '请在设置中配置 API Key 和 Base URL',
      checkedAt: now,
    })
    items.push({
      type: 'auth',
      label: 'API 认证',
      status: 'idle',
      message: '未配置',
      detail: '需要 API Key',
      checkedAt: now,
    })
  }

  // 4. 会话状态
  items.push({
    type: 'session',
    label: '活跃会话',
    status: activeSessionId ? 'ok' : 'idle',
    message: activeSessionId ? '会话已建立' : '无活跃会话',
    detail: activeSessionId || '启动对话后将自动创建会话',
    checkedAt: now,
  })

  // 判断整体状态
  const hasError = items.some(i => i.status === 'error')
  const hasWarning = items.some(i => i.status === 'warning')
  const allIdle = items.every(i => i.status === 'idle')
  const allOk = items.every(i => i.status === 'ok' || i.status === 'idle')

  const overall: ConnectionHealth['overall'] = allIdle
    ? 'unknown'
    : hasError
      ? 'disconnected'
      : hasWarning
        ? 'degraded'
        : allOk
          ? 'healthy'
          : 'degraded'

  return { overall, items, lastChecked: now }
}

// ── 环境变量信息 ──────────────────────────────────────────

/** 获取当前环境变量中 AI 相关配置概览（脱敏） */
export function getEnvConfig() {
  return {
    hasApiKey: !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN,
    baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    model: process.env.ANTHROPIC_MODEL || '(默认)',
    claudeCodeNoColor: process.env.CLAUDE_CODE_NO_COLOR === '1',
    platform: process.platform,
    nodeVersion: process.version,
    homeDir: os.homedir(),
  }
}
