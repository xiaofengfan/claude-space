/**
 * SSH 远程终端进程 — 使用 ssh2 shell 代替 node-pty。
 * 实现 ITerminalProvider 接口，与 RemoteTerminalPanel 解耦。
 * 事件接口与 TerminalProcess 完全一致，TerminalPanel 可复用。
 */
import { Client, ClientChannel } from 'ssh2'
import { EventEmitter } from 'events'
import { SshService } from './sshService'
import type { ITerminalProvider, TerminalStatus } from './terminalProvider'

export interface SshTerminalOptions {
  serverId: string
  sshService: SshService
  cols?: number
  rows?: number
}

export class SshTerminalProcess extends EventEmitter implements ITerminalProvider {
  private client: Client | null = null
  private stream: ClientChannel | null = null
  private options: SshTerminalOptions
  private _running = false
  private _connected = false
  private _sessionId: string | undefined
  private _errorMsg = ''

  constructor(options: SshTerminalOptions) {
    super()
    this.options = options
  }

  get isRunning() { return this._running }
  get isConnected() { return this._connected }
  get sessionId() { return this._sessionId }
  get lastError() { return this._errorMsg }

  /** 建立 SSH 连接并打开交互式 shell */
  start(): void {
    if (this.client) this.kill()

    this._errorMsg = ''
    this._running = true
    this.emit('status', { running: true, shellRunning: true, connected: false, sessionId: null, error: '' })

    const conn = (this.options.sshService as any).pool?.get(this.options.serverId)
    if (!conn) {
      this._errorMsg = `未连接到服务器 ${this.options.serverId}，请先在 SSH 面板建立连接`
      this._running = false
      this.emit('status', { running: false, shellRunning: false, connected: false, sessionId: null, error: this._errorMsg })
      return
    }

    this.client = conn.client

    this.client.shell({
      term: 'xterm-256color',
      cols: this.options.cols || 120,
      rows: this.options.rows || 40,
    }, (err, stream) => {
      if (err) {
        this._errorMsg = '打开远程 shell 失败: ' + err.message
        this._running = false
        this.emit('status', { running: false, shellRunning: false, connected: false, sessionId: null, error: this._errorMsg })
        return
      }

      this.stream = stream
      this._connected = true
      this.emit('status', { running: true, shellRunning: true, connected: true, sessionId: this._sessionId, error: '' })

      // 转发远程输出到 xterm.js
      stream.on('data', (data: Buffer) => {
        this.emit('terminal-data', data.toString())
      })

      stream.stderr.on('data', (data: Buffer) => {
        this.emit('terminal-data', data.toString())
      })

      stream.on('close', (code: number | null) => {
        this._connected = false
        this._running = false
        this.stream = null
        this.emit('status', { running: false, shellRunning: false, connected: false, sessionId: this._sessionId, error: code ? `exit code ${code}` : '' })
      })

      stream.on('error', (e: Error) => {
        this._errorMsg = e.message
        this.emit('status', { running: true, shellRunning: false, connected: false, sessionId: this._sessionId, error: e.message })
      })
    })
  }

  /** 写入数据到远程终端 */
  write(data: string): void {
    if (this.stream?.writable) {
      this.stream.write(data)
    }
  }

  /** 调整远程终端大小 */
  resize(cols: number, rows: number): void {
    if (this.stream) {
      this.stream.setWindow(rows, cols, 0, 0)
    }
  }

  /** 关闭远程终端 */
  kill(): void {
    if (this.stream) {
      try { this.stream.close() } catch {}
      this.stream = null
    }
    this._running = false
    this._connected = false
    this._sessionId = undefined
    this.emit('status', { running: false, shellRunning: false, connected: false, sessionId: null, error: '' })
  }
}
