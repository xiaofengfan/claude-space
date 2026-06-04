import { ChildProcess, spawn, execSync } from 'child_process'
import { EventEmitter } from 'events'

// Resolve claude binary path once at module level
function resolveClaudePath(): string {
  try {
    if (process.platform === 'win32') {
      const out = execSync('where claude.cmd', { timeout: 5000, windowsHide: true })
      const lines = out.toString().trim().split('\n')
      return lines[0]?.trim() || 'claude.cmd'
    }
    return 'claude'
  } catch {
    return process.platform === 'win32' ? 'claude.cmd' : 'claude'
  }
}
const CLAUDE_BIN = resolveClaudePath()

export interface ClaudeProcessOptions {
  cwd?: string; sessionId?: string; model?: string; apiKey?: string; baseUrl?: string
  permissionMode?: 'auto' | 'manual'  // auto = skip permissions, manual = show dialogs
}

export interface ClaudeEvent {
  type: string; subtype?: string; message?: any; result?: string
  session_id?: string; total_cost_usd?: number; duration_ms?: number
  usage?: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  [key: string]: any
}

export class ClaudeProcess extends EventEmitter {
  private proc: ChildProcess | null = null
  private buffer = ''
  private options: ClaudeProcessOptions
  private _sessionId: string | undefined
  private _isRunning = false
  private _errorMsg = ''

  constructor(options: ClaudeProcessOptions = {}) { super(); this.options = options }

  get isRunning() { return this._isRunning }
  get sessionId() { return this._sessionId }
  get lastError() { return this._errorMsg }

  /** Update sessionId between sends (call from main.ts when user switches sessions) */
  setSessionId(sessionId: string | undefined): void {
    this.options.sessionId = sessionId
    if (sessionId !== this._sessionId) {
      this._sessionId = undefined
    }
  }

  /** Update permission mode between sends */
  setPermissionMode(mode: 'auto' | 'manual'): void {
    this.options.permissionMode = mode
  }

  /** Send a prompt to Claude (starts new process if needed) */
  sendPrompt(content: string): void {
    this.kill()

    const autoApprove = this.options.permissionMode === 'auto'
    const args: string[] = []

    if (autoApprove) {
      // Auto-approval: use interactive stdin mode too, but close stdin after sending
      args.push('--input-format', 'stream-json')
      args.push('--output-format', 'stream-json')
      args.push('--verbose')
      args.push('--include-partial-messages')
      args.push('--dangerously-skip-permissions')
    } else {
      // Manual approval: interactive mode for stdin/stdout permission flow
      args.push('--input-format', 'stream-json')
      args.push('--output-format', 'stream-json')
      args.push('--verbose')
      args.push('--include-partial-messages')
      args.push('--permission-mode', 'default')
    }

    const resumeId = this.options.sessionId || this._sessionId
    if (resumeId) {
      args.push('--resume', resumeId)
    }

    const env: Record<string, string> = { ...(process.env as Record<string, string>) }
    if (this.options.apiKey) env.ANTHROPIC_API_KEY = this.options.apiKey
    if (this.options.baseUrl) env.ANTHROPIC_BASE_URL = this.options.baseUrl
    if (this.options.model) env.ANTHROPIC_MODEL = this.options.model
    env.CLAUDE_CODE_NO_COLOR = '1'

    this._errorMsg = ''
    this.buffer = ''
    this._isRunning = true
    this.emit('status', { running: true, connected: false, error: '' })

    const cwd = this.options.cwd || process.cwd()

    try {
      console.log('[claudeProcess] spawning:', CLAUDE_BIN, args.slice(0, 5).join(' '), '...')
      this.proc = spawn(CLAUDE_BIN, args, {
        cwd, env, stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      console.log('[claudeProcess] spawned, pid:', this.proc.pid)

      // Send user message via stdin JSON (both auto and manual modes)
      {
        const userMsg = {
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: content }] },
        }
        const json = JSON.stringify(userMsg) + '\n'
        console.log('[claudeProcess] writing user message to stdin, len:', json.length)
        this.proc.stdin?.write(json)
      }

      // For auto-approval: close stdin to signal EOF (no more input → Claude processes and exits)
      if (autoApprove) {
        this.proc.stdin?.end()
      }

      this.proc.stdout?.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('utf-8')
        this.processBuffer()
      })

      this.proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8').trim()
        if (!text) return

        // Detect permission prompts from stderr (interactive y/n prompts)
        const isPermissionPrompt = /Do you want to proceed|Allow (this |the )?tool|permission denied|\[y\/n|y\/n\/\^C|\(y\)|\(n\)|Proceed\?/i.test(text)
        if (isPermissionPrompt) {
          console.log('[claudeProcess] permission prompt detected:', text.slice(0, 120))
          this.emit('permission-prompt', {
            text,
            timestamp: Date.now(),
          })
        }

        if (text && !text.startsWith('{')) {
          this._errorMsg += text + '\n'
          this.emit('stderr', text)
          this.emit('status', { running: true, connected: false, error: text })
        }
      })

      this.proc.on('close', (code) => {
        console.log('[claudeProcess] process closed, exit code:', code)
        this._isRunning = false
        this.proc = null
        this.emit('close', code)
        this.emit('status', { running: false, connected: false, error: code ? `exit code ${code}` : '' })
      })

      this.proc.on('error', (err) => {
        console.log('[claudeProcess] process error:', err.message)
        this._isRunning = false
        this._errorMsg = err.message
        this.proc = null
        this.emit('close', null)
        this.emit('status', { running: false, connected: false, error: err.message })
      })
    } catch (err: any) {
      console.log('[claudeProcess] spawn exception:', err.message)
      this._isRunning = false
      this._errorMsg = err.message
      this.emit('close', null)
      this.emit('status', { running: false, connected: false, error: err.message })
    }
  }

  /** Write data to Claude's stdin (for permission responses) */
  writeStdin(data: string): void {
    if (this.proc?.stdin?.writable) {
      console.log('[claudeProcess] writeStdin:', data.slice(0, 50))
      this.proc.stdin.write(data)
    } else {
      console.log('[claudeProcess] writeStdin: stdin not writable')
    }
  }

  kill(): void {
    if (this.proc) {
      try { this.proc.kill('SIGTERM') } catch {}
      setTimeout(() => { try { this.proc?.kill('SIGKILL') } catch {} }, 2000)
      this.proc = null
    }
    this._isRunning = false
  }

  /** Alias for kill() — for backward compatibility */
  stop(): void { this.kill() }

  private _parseErrorCount = 0
  private readonly MAX_BUFFER = 200 * 1024  // 200KB — 超过此值则重置缓冲区，防止内存无限增长

  private processBuffer(): void {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''
    // 缓冲区保护：如果部分行超过 MAX_BUFFER，说明数据已损坏，重置
    if (this.buffer.length > this.MAX_BUFFER) {
      console.warn('[claudeProcess] buffer oversized (' + this.buffer.length + ' bytes), resetting. parse errors:', this._parseErrorCount)
      this.buffer = ''
      this._parseErrorCount = 0
    }
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event: ClaudeEvent = JSON.parse(line)
        this._parseErrorCount = 0  // 成功解析 → 重置错误计数
        if (event.type === 'system' && event.subtype === 'init') {
          console.log('[claudeProcess] system/init, model:', event.model, 'session:', event.session_id?.slice(0, 12))
          this._sessionId = event.session_id
          this._errorMsg = ''
          this.emit('status', { running: true, connected: true, error: '', sessionId: event.session_id })
        }
        if (event.type === 'assistant' || event.type === 'result') {
          console.log('[claudeProcess] event:', event.type, event.subtype || '')
        }
        this.emit('event', event)
      } catch (err: any) {
        this._parseErrorCount++
        // 只在前几次错误时记录日志，避免刷屏
        if (this._parseErrorCount <= 3 || this._parseErrorCount % 100 === 0) {
          console.warn('[claudeProcess] JSON parse error #' + this._parseErrorCount + ':',
            line.slice(0, 120), err?.message || '')
        }
        // 连续大量解析失败 → 可能是二进制垃圾数据，重置缓冲区
        if (this._parseErrorCount > 500) {
          console.warn('[claudeProcess] too many parse errors, resetting buffer')
          this.buffer = ''
          this._parseErrorCount = 0
        }
      }
    }
  }
}
