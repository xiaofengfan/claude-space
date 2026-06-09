/**
 * 终端进程管理器 — 直接 spawn Claude，JSONL 尾随同步 Chat
 * Claude 退出后回退到 shell，可重新启动
 */
// node-pty may not be available (native module ABI mismatch with Electron)
let pty: any = null
try { pty = require('node-pty') } catch { /* unavailable */ }
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import os from 'os'

// 调试日志 — 打包版 console.log 不可见，写文件
const DEBUG_LOG = path.join(os.homedir(), 'claude-space-debug.log')
function debugLog(msg: string): void {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  fs.appendFileSync(DEBUG_LOG, line, 'utf-8')
}

export interface TerminalProcessOptions {
  cwd?: string
  sessionId?: string
  claudePath?: string    // claude 绝对路径
  model?: string
  apiKey?: string
  baseUrl?: string
  cols?: number
  rows?: number
  permissionMode?: 'auto' | 'manual'  // auto = 跳过权限确认
}

export interface ClaudeEvent {
  type: string; subtype?: string; message?: any; session_id?: string
  total_cost_usd?: number; duration_ms?: number
  usage?: { input_tokens: number; output_tokens: number; [key: string]: any }
  [key: string]: any
}

const CLAUDE_HOME = path.join(os.homedir(), '.claude')

export class TerminalProcess extends EventEmitter {
  private ptyProcess: pty.IPty | null = null
  private jsonlInterval: ReturnType<typeof setInterval> | null = null
  private jsonlPath: string | null = null
  private jsonlTailSize = 0
  private _tailBuffer = ''  // 跨轮询间隔的部分行缓冲区
  private options: TerminalProcessOptions
  private _sessionId: string | undefined
  private _running = false
  private _claudeRunning = false
  private _errorMsg = ''
  private cwd = ''

  constructor(options: TerminalProcessOptions = {}) {
    super()
    this.options = options
  }

  get isRunning() { return this._running }
  get isClaudeRunning() { return this._claudeRunning }
  get sessionId() { return this._sessionId }
  get lastError() { return this._errorMsg }

  /** 启动 Claude（直接 spawn，不走 shell 包装） */
  start(): void {
    if (this.ptyProcess) this.kill()

    this.cwd = this.options.cwd || process.cwd()
    this._sessionId = this.options.sessionId || undefined
    this._errorMsg = ''
    this._running = true
    this._claudeRunning = false
    this.jsonlPath = null
    this.jsonlTailSize = 0

    // claude 命令：优先用传入的绝对路径
    const claudeBin = this.options.claudePath || 'claude'
    const args: string[] = []
    if (this.options.permissionMode === 'auto') {
      args.push('--permission-mode', 'bypassPermissions')
    }
    if (this._sessionId) {
      args.push('--resume', this._sessionId)
    }

    const env: Record<string, string> = { ...(process.env as Record<string, string>) }
    if (this.options.apiKey) env.ANTHROPIC_API_KEY = this.options.apiKey
    if (this.options.baseUrl) env.ANTHROPIC_BASE_URL = this.options.baseUrl
    if (this.options.model) env.ANTHROPIC_MODEL = this.options.model
    env.TERM = 'xterm-256color'

    // Session 目录快照
    const encodedPath = this.encodeClaudePath(this.cwd.replace(/\\/g, '/'))
    const sessionDir = path.join(CLAUDE_HOME, 'projects', encodedPath)
    let beforeFiles: Set<string> = new Set()
    try {
      if (fs.existsSync(sessionDir)) {
        beforeFiles = new Set(fs.readdirSync(sessionDir))
      } else {
        fs.mkdirSync(sessionDir, { recursive: true })
      }
    } catch (_e) { /* silent */ }

    if (!pty) {
      this._errorMsg = 'node-pty 不可用（原生模块加载失败）'
      debugLog('ERROR: node-pty unavailable')
      this._running = false
      this.emit('status', { running: false, connected: false, claudeRunning: false, error: this._errorMsg })
      return
    }
    try {
      debugLog(`start: spawning PTY...`)
      this.ptyProcess = pty.spawn(claudeBin, args, {
        name: 'xterm-256color',
        cols: this.options.cols || 120,
        rows: this.options.rows || 40,
        cwd: this.cwd,
        env,
      })
      debugLog(`PTY spawned: ${claudeBin} args: ${args.join(' ')} cwd: ${this.cwd} pid: ${this.ptyProcess?.pid}`)

      debugLog(`start: setting up onData handler`)
      // PTY stdout → xterm.js 渲染 + 权限提示检测
      let ptyOutputLogged = false
      this.ptyProcess.onData((data: string) => {
        this.emit('terminal-data', data)
        // 捕获前几秒 PTY 输出到日志文件，用于调试 Claude 启动错误
        if (!ptyOutputLogged) {
          const clean = data.replace(/\x1b\[[0-9;]*m/g, '').replace(/[\x00-\x08\x0E-\x1F]/g, '').trim()
          if (clean.length > 3) {
            debugLog(`PTY output (first): ${clean.slice(0, 300)}`)
            ptyOutputLogged = true
          }
        }
        // 检测终端输出中的权限提示 — 必须先清洗 ANSI 再匹配！
        const clean = data.replace(/\x1b\[[0-9;]*m/g, '').replace(/[\x00-\x08\x0E-\x1F]/g, '').trim()
        if (/Do you want to proceed|Allow (this |the )?tool|permission denied|\[y\/n|y\/n\/\^C|\(y\)|\(n\)|Proceed\?/i.test(clean)) {
          if (clean.length > 5) {
            this.emit('permission-prompt', { text: clean, timestamp: Date.now() })
          }
        }
      })

      this.ptyProcess.onExit(({ exitCode }) => {
        debugLog(`PTY exited code=${exitCode} pid=${this.ptyProcess?.pid}`)
        this._claudeRunning = false
        this.stopJsonlWatch()
        this.emit('status', {
          running: true, connected: false,
          claudeRunning: false,
          sessionId: this._sessionId,
          error: exitCode ? `Claude 退出 (code ${exitCode})` : '',
        })
        this.emit('terminal-data', `\r\n\x1b[33mClaude 已退出 (code ${exitCode || 0}) — 输入 claude 重新启动\x1b[0m\r\n`)
      })

      this._claudeRunning = true
      // 直接写文件确保可观测（绕过 debugLog 函数本身可能的异常）
      try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] start: before emit status\n`, 'utf-8') } catch {}
      this.emit('status', {
        running: true, connected: false,
        claudeRunning: true,
        sessionId: this._sessionId,
        error: '',
      })
      try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] start: after emit status\n`, 'utf-8') } catch {}

      // 轮询发现 session JSONL 文件
      try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] start: about to call discoverSessionFile\n`, 'utf-8') } catch {}
      this.discoverSessionFile(sessionDir, beforeFiles)
      try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] start: after discoverSessionFile\n`, 'utf-8') } catch {}

    } catch (err: any) {
      this._running = false
      this._claudeRunning = false
      this._errorMsg = err.message
      try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] start: CAUGHT ERROR=${err.message} stack=${err.stack}\n`, 'utf-8') } catch {}
      debugLog(`ERROR spawn failed: ${err.message} bin: ${claudeBin} cwd: ${this.cwd}`)
      this.emit('status', {
        running: false, connected: false,
        claudeRunning: false,
        error: `启动失败: ${err.message}`,
      })
    }
  }

  /** 更新权限模式（在终端运行中动态切换，下次 restart 生效） */
  updatePermissionMode(mode: 'auto' | 'manual'): void {
    this.options.permissionMode = mode
  }

  /** 重新启动 Claude（在当前 PTY 中，Claude 退出后调用） */
  restart(): void {
    if (!this.ptyProcess) {
      // PTY 不存在，完整重启
      this.start()
      return
    }

    this._claudeRunning = false
    this.jsonlPath = null
    this.stopJsonlWatch()

    // 在同一个 PTY 中重新输入 claude 命令
    const claudeBin = this.options.claudePath || 'claude'
    let cmd = claudeBin
    if (this.options.permissionMode === 'auto') {
      cmd += ' --permission-mode bypassPermissions'
    }
    if (this._sessionId) cmd += ` --resume ${this._sessionId}`
    cmd += '\r'
    this.ptyProcess.write(`\r\n\x1b[36m⚡ 重新启动 Claude...\x1b[0m\r\n`)
    this.ptyProcess.write(cmd)

    this._claudeRunning = true
    this.emit('status', {
      running: true, connected: false,
      claudeRunning: true,
      sessionId: this._sessionId,
      error: '',
    })

    // 重新发现 session 文件
    const encodedPath = this.encodeClaudePath(this.cwd.replace(/\\/g, '/'))
    const sessionDir = path.join(CLAUDE_HOME, 'projects', encodedPath)
    let beforeFiles: Set<string> = new Set()
    try {
      if (fs.existsSync(sessionDir)) beforeFiles = new Set(fs.readdirSync(sessionDir))
    } catch (_e) { /* silent */ }
    this.discoverSessionFile(sessionDir, beforeFiles)
  }

  /** 写入 PTY（Chat / Terminal 输入统一入口） */
  write(data: string): void {
    if (this.ptyProcess) this.ptyProcess.write(data)
  }

  resize(cols: number, rows: number): void {
    if (this.ptyProcess) {
      try { this.ptyProcess.resize(cols, rows) } catch (_e) { /* silent */ }
    }
  }

  kill(): void {
    this.stopJsonlWatch()
    if (this.ptyProcess) {
      try {
        if (this._claudeRunning) this.ptyProcess.write('\x03') // Ctrl+C
      } catch (_e) { /* silent */ }
      setTimeout(() => {
        try { this.ptyProcess?.kill() } catch (_e) { /* silent */ }
        this.ptyProcess = null
      }, 500)
    }
    this._running = false
    this._claudeRunning = false
  }

  // ── 私有 ────────────────────────────────────────────────

  private encodeClaudePath(p: string): string {
    return p.replace(':\\', '--').replace(':/', '--').replace(/\//g, '-').replace(/\\/g, '-')
  }

  private discoverSessionFile(sessionDir: string, beforeFiles: Set<string>): void {
    debugLog(`discoverSessionFile: sessionDir=${sessionDir} sessionId=${this._sessionId} beforeCount=${beforeFiles.size}`)
    // ── --resume 模式：直接监听已有 JSONL 文件，无需轮询发现新文件 ──
    if (this._sessionId) {
      const resumeFile = path.join(sessionDir, `${this._sessionId}.jsonl`)
      debugLog(`discoverSessionFile: checking resume file ${resumeFile}`)
      try {
        const exists = fs.existsSync(resumeFile)
        debugLog(`discoverSessionFile: resume file exists=${exists}`)
        if (exists) {
          this.jsonlPath = resumeFile
          this.jsonlTailSize = 0
          this.startJsonlWatch()
          this._claudeRunning = true
          debugLog(`JSONL resume: watching ${resumeFile} (${fs.statSync(resumeFile).size} bytes)`)
          this.emit('status', {
            running: true, connected: true,
            claudeRunning: true,
            sessionId: this._sessionId,
            error: '',
          })
          return
        }
      } catch (_e) { debugLog(`JSONL resume: file check error ${resumeFile}`) }
    }

    let attempts = 0
    const check = setInterval(() => {
      attempts++
      try {
        if (!fs.existsSync(sessionDir)) {
          if (attempts >= 60) {
            // 60次之后切换为慢速重试（5秒间隔），不轻易放弃
            clearInterval(check)
            debugLog(`discoverSessionFile: sessionDir ${sessionDir} still does not exist after ${attempts} attempts, switching to slow retry`)
            this.emit('status', {
              running: true, connected: false,
              claudeRunning: false,
              sessionId: undefined,
              error: '等待 Claude 创建会话文件...',
            })
            // 慢速重试
            const slowCheck = setInterval(() => {
              try {
                if (!fs.existsSync(sessionDir)) return
                const after = fs.readdirSync(sessionDir)
                const newFile = after.find(f => !beforeFiles.has(f) && f.endsWith('.jsonl'))
                if (newFile) {
                  clearInterval(slowCheck)
                  this.jsonlPath = path.join(sessionDir, newFile)
                  this._sessionId = newFile.replace('.jsonl', '')
                  this.jsonlTailSize = 0
                  this.startJsonlWatch()
                  this._claudeRunning = true
                  this.emit('status', {
                    running: true, connected: true,
                    claudeRunning: true,
                    sessionId: this._sessionId,
                    error: '',
                  })
                }
              } catch (_e) { /* silent */ }
            }, 5000)
          }
          return
        }
        const after = fs.readdirSync(sessionDir)
        const newFile = after.find(f => !beforeFiles.has(f) && f.endsWith('.jsonl'))
        if (attempts <= 3 || attempts % 30 === 0) {
          debugLog(`discoverSessionFile poll #${attempts}: after=${after.filter(f => f.endsWith('.jsonl')).join(',')} beforeCount=${beforeFiles.size} newFile=${newFile || 'none'}`)
        }
        if (newFile) {
          clearInterval(check)
          this.jsonlPath = path.join(sessionDir, newFile)
          this._sessionId = newFile.replace('.jsonl', '')
          this.jsonlTailSize = 0
          debugLog(`JSONL discovered: ${newFile} after ${attempts} attempts (${attempts * 100}ms)`)
          this.startJsonlWatch()
          this._claudeRunning = true
          this.emit('status', {
            running: true, connected: true,
            claudeRunning: true,
            sessionId: this._sessionId,
            error: '',
          })
          return
        }
      } catch (_e) { /* silent */ }
    }, 100)
  }

  private startJsonlWatch(): void {
    if (!this.jsonlPath) return
    try {
      this.jsonlTailSize = fs.existsSync(this.jsonlPath) ? fs.statSync(this.jsonlPath).size : 0
    } catch (_e) { /* silent */ }
    if (this.jsonlTailSize > 0) this.tailFrom(0)

    this.jsonlInterval = setInterval(() => {
      if (!this.jsonlPath) return
      try {
        const stat = fs.statSync(this.jsonlPath)
        if (stat.size > this.jsonlTailSize) {
          this.tailFrom(this.jsonlTailSize)
          // tailFrom 内部会更新 jsonlTailSize 为实际读取位置
        }
      } catch (_e) { /* silent */ }
    }, 300)
  }

  private tailFrom(fromPos: number): void {
    if (!this.jsonlPath) return
    try {
      const stat = fs.statSync(this.jsonlPath)
      if (stat.size <= fromPos) return

      const fd = fs.openSync(this.jsonlPath, 'r')
      const MAX_CHUNK = 1024 * 1024  // 1MB per read
      let readPos = fromPos
      let rawData = this._tailBuffer  // 前置之前未完成的部分行
      this._tailBuffer = ''

      // 循环读取，处理文件增长 >1MB 的情况
      while (readPos < stat.size) {
        const chunkSize = Math.min(stat.size - readPos, MAX_CHUNK)
        const buf = Buffer.alloc(chunkSize)
        fs.readSync(fd, buf, 0, chunkSize, readPos)
        rawData += buf.toString('utf-8')
        readPos += chunkSize
      }
      fs.closeSync(fd)

      // 按行分割，保留最后一个不完整行到 _tailBuffer
      const lines = rawData.split('\n')
      // 如果原始数据不以 \n 结尾，最后一行是不完整的
      if (!rawData.endsWith('\n')) {
        this._tailBuffer = lines.pop() || ''
      } else {
        this._tailBuffer = ''
      }

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event: ClaudeEvent = JSON.parse(line)
          if (event.type === 'system' && event.subtype === 'init') {
            if (!this._sessionId || event.session_id !== this._sessionId) {
              this._sessionId = event.session_id
              this._claudeRunning = true
              this.emit('status', {
                running: true, connected: true,
                claudeRunning: true,
                sessionId: event.session_id,
                error: '',
              })
            }
          }
          // 只对新事件打印简短日志（非首次大批量回放时）
          if (event.type === 'assistant' || event.type === 'user') {
            try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] tailFrom event: type=${event.type} sessionId=${this._sessionId?.slice(0,8)}\n`, 'utf-8') } catch {}
          }
          this.emit('event', event)
        } catch {
          // 静默跳过不可解析的行（损坏数据、非 JSON 输出等）
        }
      }

      // 使用实际读取位置（而非文件大小），确保不漏数据
      this.jsonlTailSize = readPos
    } catch {
      // 文件读取失败静默跳过（文件可能正在写入中）
    }
  }

  private stopJsonlWatch(): void {
    if (this.jsonlInterval) {
      clearInterval(this.jsonlInterval)
      this.jsonlInterval = null
    }
  }
}
