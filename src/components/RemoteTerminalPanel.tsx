/**
 * 远程终端面板 — 通过 SSH shell 连接到远程服务器，使用 xterm.js 渲染。
 */
import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import 'xterm/css/xterm.css'

interface Props {
  sshStatus: { serverId: string | null; status: string }
  visible: boolean
  theme: 'dark' | 'light'
}

export function RemoteTerminalPanel({ sshStatus, visible, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<any>(null)
  const fitRef = useRef<any>(null)
  const [running, setRunning] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState(false)

  // 初始化 xterm.js
  useEffect(() => {
    if (!visible || !containerRef.current) return

    const isDark = theme === 'dark'
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: isDark ? '#0d0d0d' : '#ffffff',
        foreground: isDark ? '#c9d1d9' : '#24292f',
        cursor: isDark ? '#58a6ff' : '#0969da',
        selectionBackground: isDark ? '#264f78' : '#afcdff',
      },
      cols: 120,
      rows: 40,
      allowProposedApi: true,
    })
    term.open(containerRef.current)
    termRef.current = term

    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    setTimeout(() => fit.fit(), 100)

    try {
      const webgl = new WebglAddon()
      term.loadAddon(webgl)
    } catch { /* fallback */ }

    // 用户输入 → SSH
    term.onData((data: string) => {
      window.electronAPI.sshTerminalInput(data)
    })

    // 监听远程终端数据
    const unsub = window.electronAPI.onSshTerminalData?.((data: string) => {
      termRef.current?.write(data)
    })

    // 监听远程终端状态
    const unsubStatus = window.electronAPI.onSshTerminalStatus?.((status: any) => {
      setRunning(status.running || status.shellRunning)
      setConnected(status.connected)
      if (status.error) setError(status.error)
    })

    // 窗口大小调整
    const handleResize = () => {
      fitRef.current?.fit()
      if (termRef.current) {
        window.electronAPI.sshTerminalResize({
          cols: termRef.current.cols,
          rows: termRef.current.rows,
        })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      unsub?.()
      unsubStatus?.()
      window.removeEventListener('resize', handleResize)
      term.dispose()
      termRef.current = null
    }
  }, [visible, theme])

  // 启动远程终端
  async function startRemoteTerminal() {
    if (!sshStatus.serverId) return
    setError('')
    try {
      const result = await window.electronAPI.sshStartTerminal({
        serverId: sshStatus.serverId,
        cols: 120, rows: 40,
      })
      if (result.success) {
        setStarted(true)
        setRunning(true)
      } else {
        setError(result.error || '启动远程终端失败')
      }
    } catch (e: any) {
      setError(e.message || '启动远程终端失败')
    }
  }

  async function stopRemoteTerminal() {
    await window.electronAPI.sshTerminalKill()
    termRef.current?.clear()
    setStarted(false)
    setRunning(false)
    setConnected(false)
  }

  if (!visible) return null

  const isConnected = sshStatus.status === 'connected'

  return (
    <div className="terminal-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="terminal-header">
        <span>🌐 远程终端 {sshStatus.serverId ? `(${sshStatus.serverId})` : ''}</span>
        <span className="terminal-status">
          {!isConnected ? '⚫ 未连接 SSH' : !started ? '🔴 未启动' : connected ? '🟢 已连接' : running ? '🟡 启动中...' : '🔴 已断开'}
        </span>
        <div className="terminal-actions">
          {isConnected && !started && (
            <button className="btn-primary" onClick={startRemoteTerminal}>启动远程终端</button>
          )}
          {started && (
            <button className="btn-secondary" onClick={stopRemoteTerminal}>断开</button>
          )}
        </div>
      </div>

      {error && (
        <div className="chat-connection-error" style={{ margin: 0 }}>
          <span className="chat-error-text">⚠️ {error}</span>
          <span className="chat-error-dismiss" onClick={() => setError('')}>✕</span>
        </div>
      )}

      <div ref={containerRef} className="terminal-container" style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  )
}
