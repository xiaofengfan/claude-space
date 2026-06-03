/**
 * 终端传输层抽象接口。
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  RemoteTerminalPanel (xterm.js)                      │
 * │  ↓ terminal-data    ↑ write / resize / kill          │
 * ├──────────────────────────────────────────────────────┤
 * │  ITerminalProvider (本接口)                           │
 * │  ├── SshTerminalProcess   → ssh2 (当前)              │
 * │  └── WebSocketProvider    → WebSocket (未来 Web 端)   │
 * └──────────────────────────────────────────────────────┘
 *
 * RemoteTerminalPanel 只依赖 ITerminalProvider，不感知底层传输方式。
 */

/** 终端状态 */
export interface TerminalStatus {
  running: boolean
  connected: boolean
  error: string
  sessionId?: string | null
}

/** 终端传输层接口 */
export interface ITerminalProvider {
  /** 启动终端连接 */
  start(): void

  /** 写入数据（用户键盘输入） */
  write(data: string): void

  /** 调整终端窗口大小 */
  resize(cols: number, rows: number): void

  /** 关闭终端连接 */
  kill(): void

  /** 底层传输就绪（已连接并开始传输数据） */
  isRunning: boolean
  isConnected: boolean
  lastError: string

  // ── 事件（由实现类 emit） ──

  /** 收到终端数据 → UI 渲染 */
  on(event: 'terminal-data', listener: (data: string) => void): this
  /** 终端状态变化 */
  on(event: 'status', listener: (status: TerminalStatus) => void): this

  off(event: 'terminal-data', listener: (data: string) => void): this
  off(event: 'status', listener: (status: TerminalStatus) => void): this
}

/** WebSocket 终端连接选项（预留，供未来 Web 端使用） */
export interface WebSocketTerminalOptions {
  /** WebSocket 服务地址，如 wss://remote.example.com/terminal */
  url: string
  /** 连接时携带的认证 token */
  token?: string
  /** 初始终端大小 */
  cols?: number
  rows?: number
}
