/**
 * TerminalPanel — 嵌入式终端 + 控制头部
 * Shell 优先：打开 Shell → 用户/按钮启动 Claude → JSONL 同步 Chat
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import 'xterm/css/xterm.css'

interface Props {
  cwd?: string
  sessionId?: string
  visible: boolean
  theme?: 'dark' | 'light'
  onTerminalData?: (data: string) => void
}

interface TerminalState {
  shellRunning: boolean
  claudeRunning: boolean
  connected: boolean
  sessionId?: string
  error: string
}

const DARK_THEME = {
  background: '#1a1a2e', foreground: '#e0e0e0', cursor: '#00ff88',
  cursorAccent: '#1a1a2e', selectionBackground: '#ffffff25',
  black: '#2a2a4a', red: '#e05555', green: '#4caf50',
  yellow: '#e89030', blue: '#6c8cff', magenta: '#b05090',
  cyan: '#3a9cc0', white: '#ccc',
  brightBlack: '#555', brightRed: '#f66', brightGreen: '#6f6',
  brightYellow: '#fa0', brightBlue: '#8af', brightMagenta: '#d6a',
  brightCyan: '#6cf', brightWhite: '#fff',
}
const LIGHT_THEME = {
  background: '#f5f5f5', foreground: '#222', cursor: '#6c8cff',
  cursorAccent: '#f5f5f5', selectionBackground: '#00000015',
  black: '#e0e0e0', red: '#d32f2f', green: '#2e7d32',
  yellow: '#e65100', blue: '#1565c0', magenta: '#7b1fa2',
  cyan: '#00838f', white: '#333',
  brightBlack: '#999', brightRed: '#f44336', brightGreen: '#4caf50',
  brightYellow: '#ff9800', brightBlue: '#2196f3', brightMagenta: '#9c27b0',
  brightCyan: '#00bcd4', brightWhite: '#000',
}

export const TerminalPanel: React.FC<Props> = ({ cwd, sessionId, visible, theme, onTerminalData }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [termState, setTermState] = useState<TerminalState>({
    shellRunning: false, claudeRunning: false, connected: false, error: '',
  })

  // 初始化 xterm.js
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'Cascadia Code, Fira Code, JetBrains Mono, Consolas, monospace',
      theme: theme === 'light' ? LIGHT_THEME : DARK_THEME,
      cursorBlink: true, cursorStyle: 'bar',
      scrollback: 5000, tabStopWidth: 4,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    try { term.loadAddon(new WebglAddon()) } catch { /* Canvas fallback */ }

    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon

    // 用户输入 → PTY
    term.onData((data) => onTerminalData?.(data))

    // 容器尺寸变化
    const observer = new ResizeObserver(() => fitAddon.fit())
    observer.observe(containerRef.current)

    return () => { observer.disconnect(); term.dispose() }
  }, [cwd, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 响应式主题切换 — 运行时更新 xterm 颜色
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = theme === 'light' ? LIGHT_THEME : DARK_THEME
    }
  }, [theme])

  // 可见性切换 & resize
  useEffect(() => {
    if (visible && fitAddonRef.current && termRef.current) {
      setTimeout(() => {
        fitAddonRef.current?.fit()
        if (termRef.current) {
          window.electronAPI?.terminalResize({
            cols: termRef.current.cols, rows: termRef.current.rows,
          })
        }
      }, 100)
    }
  }, [visible])

  // 监听 terminal:data（PTY 输出 → xterm.js）
  useEffect(() => {
    const cleanup = window.electronAPI?.onTerminalData?.((data: string) => {
      termRef.current?.write(data)
    })
    return () => cleanup?.()
  }, [])

  // 监听 terminal:status (push)
  useEffect(() => {
    const cleanup = window.electronAPI?.onTerminalStatus?.((status: any) => {
      setTermState({
        shellRunning: status.shellRunning || status.running || false,
        claudeRunning: status.claudeRunning || false,
        connected: status.connected || false,
        sessionId: status.sessionId,
        error: status.error || '',
      })
    })
    return () => cleanup?.()
  }, [])

  // 主动拉取状态 (pull) — 解决 mount 时 event 已发出的竞态
  useEffect(() => {
    window.electronAPI?.terminalStatus?.().then((status: any) => {
      if (!status) return
      setTermState({
        shellRunning: status.running || status.shellRunning || false,
        claudeRunning: status.claudeRunning || false,
        connected: status.connected || false,
        sessionId: status.sessionId || sessionId || '',
        error: status.error || '',
      })
    }).catch(() => {})
  }, [sessionId])

  // 重启 Claude
  const handleRestart = useCallback(() => {
    window.electronAPI?.terminalRestart()
  }, [])

  // 状态图标
  const claudeIcon = termState.claudeRunning
    ? (termState.connected ? '🟢' : '🟡')
    : (termState.shellRunning ? '🔴' : '⚫')
  const claudeLabel = termState.claudeRunning
    ? (termState.connected ? 'Claude 已连接' : 'Claude 启动中...')
    : (termState.shellRunning ? (termState.error ? '错误' : 'Shell 运行中') : '终端未启动')

  return (
    <div className="terminal-panel">
      {/* ── 控制头部 ─────────────────────────────── */}
      <div className="terminal-header">
        <div className="terminal-header-left">
          <span className="terminal-status-item" title={claudeLabel}>
            {claudeIcon} {claudeLabel}
          </span>

          {cwd && (
            <>
              <span className="terminal-status-sep">|</span>
              <span className="terminal-status-item" title={cwd}>
                📁 工作目录: {cwd}
              </span>
            </>
          )}

          {sessionId && (
            <>
              <span className="terminal-status-sep">|</span>
              <span className="terminal-session-badge" title={sessionId}>
                📝 会话: {sessionId.slice(0, 16)}...
              </span>
            </>
          )}

          {termState.error && (
            <>
              <span className="terminal-status-sep">|</span>
              <span className="terminal-status-error" title={termState.error}>
                ⚠️ {termState.error.slice(0, 60)}
              </span>
            </>
          )}
        </div>
        <div className="terminal-header-right">
          {!termState.claudeRunning && termState.shellRunning && (
            <button className="terminal-header-btn launch" onClick={handleRestart}>
              🔄 重启 Claude
            </button>
          )}
        </div>
      </div>

      {/* ── 终端容器 ─────────────────────────────── */}
      <div ref={containerRef} className="terminal-container" />
    </div>
  )
}
