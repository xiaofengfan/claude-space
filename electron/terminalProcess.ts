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
import { encodeClaudePath, resolveClaudePath } from './utils'
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

    // claude 命令：优先用传入的绝对路径，其次用系统 PATH 解析
    const claudeBin = this.options.claudePath || resolveClaudePath()
    const args: string[] = [
      '--verbose',
    ]
    if (this.options.permissionMode === 'auto') {
      args.push('--permission-mode', 'bypassPermissions')
    }
    if (this._sessionId) {
      args.push('--resume', this._sessionId)
      debugLog(`start: resuming session ${this._sessionId}`)
    }

    const env: Record<string, string> = { ...(process.env as Record<string, string>) }
    if (this.options.apiKey) env.ANTHROPIC_API_KEY = this.options.apiKey
    if (this.options.baseUrl) env.ANTHROPIC_BASE_URL = this.options.baseUrl
    if (this.options.model) env.ANTHROPIC_MODEL = this.options.model
    env.TERM = 'xterm-256color'

    // Session 目录快照
    const encodedPath = encodeClaudePath(this.cwd.replace(/\\/g, '/'))
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
      // PTY 模式下 spawn Claude，不带 --print 和 stdin 输入
      // 输出通过 PTY onData 直接推送到 xterm.js 渲染
      this.ptyProcess = pty.spawn(claudeBin, args, {
        name: 'xterm-256color',
        cols: this.options.cols || 120,
        rows: this.options.rows || 40,
        cwd: this.cwd,
        env,
      })
      debugLog(`PTY spawned: ${claudeBin} args: ${args.join(' ')} cwd: ${this.cwd} pid: ${this.ptyProcess?.pid}`)

      // 立即发射 running 状态，让 UI 侧知道终端已经启动
      this.emit('status', {
        running: true, connected: false,
        claudeRunning: false,
        sessionId: this._sessionId,
        error: '',
      })

      debugLog(`start: setting up onData handler`)
      // PTY stdout → xterm.js 渲染 + 权限提示检测
      const ptyStartTime = Date.now()
      let ptyOutputBytes = 0
      this.ptyProcess.onData((data: string) => {
        this.emit('terminal-data', data)
        // 捕获前 8 秒或前 8KB 的 PTY 输出到日志文件，用于调试 Claude 启动错误
        const elapsed = Date.now() - ptyStartTime
        if (elapsed < 8000 && ptyOutputBytes < 8192) {
          ptyOutputBytes += data.length
          const clean = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/[\x00-\x08\x0E-\x1F]/g, '').trim()
          if (clean.length > 0) {
            debugLog(`PTY output (+${elapsed}ms): ${clean.slice(0, 500)}`)
          }
        }
        // 检测终端输出中的权限提示 — 必须先清洗 ANSI 再匹配！
        const ansiClean = data.replace(/\x1b\[[0-9;]*m/g, '').replace(/[\x00-\x08\x0E-\x1F]/g, '').trim()
        if (/Do you want to proceed|Allow (this |the )?tool|permission denied|\[y\/n|y\/n\/\^C|\(y\)|\(n\)|Proceed\?/i.test(ansiClean)) {
          if (ansiClean.length > 5) {
            this.emit('permission-prompt', { text: ansiClean, timestamp: Date.now() })
          }
        }
      })

      this.ptyProcess.onExit(({ exitCode }) => {
        debugLog(`PTY exited code=${exitCode} pid=${this.ptyProcess?.pid}`)
        this._claudeRunning = false
        this.stopJsonlWatch()

        // PTY 进程退出时，如果还有尚未读取完的 JSONL 数据，再尝试读取一次
        if (this.jsonlPath) {
          try {
            const stat = fs.statSync(this.jsonlPath)
            if (stat.size > this.jsonlTailSize) {
              debugLog(`onExit: reading remaining JSONL data: ${stat.size - this.jsonlTailSize} bytes`)
              this.tailFrom(this.jsonlTailSize)
            }
          } catch (_e) { /* silent */ }
        }

        this.emit('status', {
          running: true, connected: false,
          claudeRunning: false,
          sessionId: this._sessionId,
          error: exitCode ? `Claude 退出 (code ${exitCode})` : '',
        })
        this.emit('terminal-data', `\r\n\x1b[33mClaude 已退出 (code ${exitCode || 0}) — 输入 claude 重新启动\x1b[0m\r\n`)
        this.emit('close', exitCode)
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

      // 如果是 --resume 模式且 session 文件存在，发送一个空 prompt 让 Claude 继续会话
      // 修复 "No deferred tool marker" 错误 — Claude 在 --resume 后需要 stdin 输入来继续
      if (this._sessionId && this.ptyProcess) {
        const resumeFile = path.join(sessionDir, `${this._sessionId}.jsonl`)
        if (fs.existsSync(resumeFile)) {
          debugLog(`start: --resume mode, waiting for jsonl then sending continue`)
          // 延迟发送继续指令（等待 Claude 初始化完成）
          setTimeout(() => {
            try {
              if (!this.ptyProcess) return
              debugLog(`start: sending empty prompt to continue session`)
              this.ptyProcess.write('\r')
            } catch (e) {}
          }, 2000)
        }
      }

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
    const encodedPath = encodeClaudePath(this.cwd.replace(/\\/g, '/'))
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
    const oldPty = this.ptyProcess  // 保存引用，防止 setTimeout 内 this.ptyProcess 被 start() 覆盖
    this.ptyProcess = null
    if (oldPty) {
      try {
        if (this._claudeRunning) oldPty.write('\x03') // Ctrl+C 优雅退出
      } catch (_e) { /* silent */ }
      setTimeout(() => {
        try { oldPty.kill() } catch (_e) { /* 进程已退出 */ }
      }, 500)
    }
    this._running = false
    this._claudeRunning = false
  }

  // ── 私有 ────────────────────────────────────────────────


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
      // 首次启动时，将已有内容解析后发给订阅者（恢复历史事件）
      if (this.jsonlTailSize > 0) {
        this.tailFrom(0, true /* replay mode */)
      }
    } catch (_e) { /* silent */ }

    // 使用 fs.watch 替代轮询（立即响应文件变更，不阻塞）
    try {
      // 清除旧的 watcher
      if ((this as any)._jsonlWatcher) {
        (this as any)._jsonlWatcher.close()
      }
      const watcher = fs.watch(this.jsonlPath, (eventType) => {
        if (eventType === 'change' && this.jsonlPath) {
          try {
            const stat = fs.statSync(this.jsonlPath)
            if (stat.size > this.jsonlTailSize) {
              this.tailFrom(this.jsonlTailSize)
            }
          } catch (_e) { /* silent */ }
        }
      })
      ;(this as any)._jsonlWatcher = watcher
    } catch (_e) {
      // fs.watch 不可用时回退到轮询
      debugLog('startJsonlWatch: fs.watch failed, falling back to polling')
    }

    // 仍然保留 1000ms 轮询作为兜底（fs.watch 在某些平台可能不可靠）
    this.jsonlInterval = setInterval(() => {
      if (!this.jsonlPath) return
      try {
        const stat = fs.statSync(this.jsonlPath)
        if (stat.size > this.jsonlTailSize) {
          this.tailFrom(this.jsonlTailSize)
        }
      } catch (_e) { /* silent */ }
    }, 1000)
  }

  private tailFrom(fromPos: number, isReplay = false): void {
    if (!this.jsonlPath) return
    try {
      const stat = fs.statSync(this.jsonlPath)
      if (stat.size <= fromPos) return

      const MAX_CHUNK = 256 * 1024  // 256KB per read（防止大文件阻塞主进程）
      let rawData = this._tailBuffer
      this._tailBuffer = ''

      // 分块读取，每块通过 setImmediate 让出事件循环
      const readChunkAndProcess = (fd: number, readPos: number, fileSize: number) => {
        try {
          // 检查文件是否已删除/重置（防止 fd 失效后继续读旧文件）
          try {
            const curStat = fs.fstatSync(fd)
            if (curStat.size < readPos) {
              // 文件被截断或删除，重置
              fs.closeSync(fd)
              this.jsonlTailSize = 0
              return
            }
          } catch { fs.closeSync(fd); return }

          const remaining = fileSize - readPos
          if (remaining <= 0) {
            fs.closeSync(fd)
            this.jsonlTailSize = fileSize
            return
          }

          const chunkSize = Math.min(remaining, MAX_CHUNK)
          const buf = Buffer.alloc(chunkSize)
          fs.readSync(fd, buf, 0, chunkSize, readPos)
          rawData += buf.toString('utf-8')

          const newReadPos = readPos + chunkSize

          if (newReadPos < fileSize) {
            // 还有更多数据 → 异步继续，让事件循环呼吸
            setImmediate(() => readChunkAndProcess(fd, newReadPos, fileSize))
            return
          }

          // 全部读完 → 关闭 fd，解析行
          fs.closeSync(fd)

          // 按行分割
          const lines = rawData.split('\n')
          if (!rawData.endsWith('\n')) {
            this._tailBuffer = lines.pop() || ''
          } else {
            this._tailBuffer = ''
          }

          let parsedCount = 0
          let hasNewAssistant = false
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const event: ClaudeEvent = JSON.parse(line)
              parsedCount++

              // 断连恢复：JSONL 文件发现 Claude 事件但 _claudeRunning=false 时恢复连接
              if (!this._claudeRunning && (event.type === 'assistant' || event.type === 'system')) {
                this._claudeRunning = true
                this.emit('status', {
                  running: true, connected: true,
                  claudeRunning: true,
                  sessionId: this._sessionId,
                  error: '',
                })
              }

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
              // Claude 退出事件 → 更新状态
              if (event.type === 'result' && event.is_error) {
                debugLog(`tailFrom: Claude error event: ${JSON.stringify(event).slice(0, 200)}`)
              }

              this.emit('event', event)
            } catch (parseErr: any) {
              // 不静默吞错误 — 记录到 debug log 帮助排查
              debugLog(`tailFrom JSON parse error: ${parseErr.message} line: ${line.slice(0, 100)}`)
            }
          }

          this.jsonlTailSize = newReadPos
          // 批量处理日志（避免日志刷屏）
          if (parsedCount > 50) {
            debugLog(`tailFrom: batch processed ${parsedCount} events, newTailSize=${newReadPos}`)
          }
        } catch (err: any) {
          try { fs.closeSync(fd) } catch {}
          debugLog(`tailFrom readChunk error: ${err.message}`)
        }
      }

      // 开始异步分块读取
      const fd = fs.openSync(this.jsonlPath, 'r')
      setImmediate(() => readChunkAndProcess(fd, fromPos, stat.size))

    } catch (err: any) {
      debugLog(`tailFrom error: ${err.message}`)
    }
  }

  private stopJsonlWatch(): void {
    if (this.jsonlInterval) {
      clearInterval(this.jsonlInterval)
      this.jsonlInterval = null
    }
  }
}
