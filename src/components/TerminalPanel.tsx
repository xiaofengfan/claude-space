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
  background: '#0d0d0d', foreground: '#e0e0e0', cursor: '#00ff88',
  cursorAccent: '#0d0d0d', selectionBackground: '#ffffff50',
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
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
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
      // 容器不可见时用默认尺寸，避免 cols=0 导致 pty 输出错位乱码
      cols: 120, rows: 30,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    try { term.loadAddon(new WebglAddon()) } catch { /* Canvas fallback */ }

    term.open(containerRef.current)
    // 容器不可见时（display:none）跳过 fit，保持默认 cols/rows，避免 0 尺寸导致 pty 输出错位
    if (containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
      fitAddon.fit()
    }

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Chat 模式下终端不可见 → 立即 blur，防止 xterm.js 捕获键盘事件
    // （否则打字会逐字符发送到 PTY，干扰 Chat 的正常流程）
    if (!visible) {
      term.blur()
    }

    // 用户输入 → PTY
    term.onData((data) => onTerminalData?.(data))

    // ── 剪贴板：自定义键盘事件处理 ──────────────────────
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Ctrl+Shift+C → 复制选中文本
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {
            // fallback
            const textarea = document.createElement('textarea')
            textarea.value = selection
            textarea.style.position = 'fixed'
            textarea.style.opacity = '0'
            document.body.appendChild(textarea)
            textarea.select()
            try { document.execCommand('copy') } catch { /* silent */ }
            document.body.removeChild(textarea)
          })
          term.clearSelection()
        }
        return false // 阻止默认行为
      }
      // Ctrl+Shift+V → 粘贴到终端
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        navigator.clipboard.readText().then(text => {
          if (text) onTerminalData?.(text)
        }).catch(() => { /* clipboard read denied */ })
        return false
      }
      // Ctrl+Insert → 复制
      if (e.ctrlKey && e.key === 'Insert') {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {})
        }
        return false
      }
      // Shift+Insert → 粘贴
      if (e.shiftKey && e.key === 'Insert') {
        navigator.clipboard.readText().then(text => {
          if (text) onTerminalData?.(text)
        }).catch(() => {})
        return false
      }
      return true
    })

    // ── 右键菜单 ────────────────────────────────────────
    const container = containerRef.current
    let contextMenu: HTMLDivElement | null = null

    const hideContextMenu = () => {
      if (contextMenu) {
        contextMenu.remove()
        contextMenu = null
      }
    }

    container.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault()
      hideContextMenu()

      const menu = document.createElement('div')
      menu.className = 'terminal-context-menu'
      menu.style.cssText = `
        position: fixed; left: ${e.clientX}px; top: ${e.clientY}px;
        background: #2a2a4a; border: 1px solid #444; border-radius: 6px;
        padding: 4px 0; min-width: 180px; z-index: 10000;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4); font-size: 13px;
      `
      const hasSelection = !!term.getSelection()

      const addItem = (label: string, shortcut: string, disabled: boolean, action: () => void) => {
        const item = document.createElement('div')
        item.className = 'terminal-context-item'
        item.style.cssText = `
          padding: 6px 12px; cursor: ${disabled ? 'default' : 'pointer'};
          opacity: ${disabled ? '0.4' : '1'}; color: #ccc;
          display: flex; justify-content: space-between; align-items: center;
          transition: background 0.15s;
        `
        item.innerHTML = `<span>${label}</span><span style="color:#888;font-size:11px">${shortcut}</span>`
        if (!disabled) {
          item.addEventListener('mouseenter', () => { item.style.background = '#3a3a6a' })
          item.addEventListener('mouseleave', () => { item.style.background = 'transparent' })
          item.addEventListener('click', () => { action(); hideContextMenu() })
        }
        menu.appendChild(item)
      }

      addItem('📋 复制', 'Ctrl+Shift+C', !hasSelection, () => {
        const sel = term.getSelection()
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {})
        }
      })
      addItem('📄 粘贴', 'Ctrl+Shift+V', false, () => {
        navigator.clipboard.readText().then(t => { if (t) onTerminalData?.(t) }).catch(() => {})
      })
      // separator
      const sep = document.createElement('div')
      sep.style.cssText = 'margin: 4px 0; border-top: 1px solid #444'
      menu.appendChild(sep)
      addItem('🔄 重启 Claude', '', false, () => handleRestart())

      document.body.appendChild(menu)
      contextMenu = menu
      contextMenuRef.current = menu

      const closeOnClick = () => { hideContextMenu(); document.removeEventListener('click', closeOnClick) }
      setTimeout(() => document.addEventListener('click', closeOnClick), 0)
    })

    // 容器尺寸变化
    const observer = new ResizeObserver(() => {
      // 容器不可见时跳过 fit，避免 0 尺寸重置 xterm
      if (containerRef.current && containerRef.current.clientWidth > 0 && containerRef.current.clientHeight > 0) {
        fitAddon.fit()
      }
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      hideContextMenu()
      term.dispose()
    }
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
      // 容器从 display:none 切到 flex 需要时间布局，延迟 300ms 确保 xterm 能算出正确尺寸
      setTimeout(() => {
        if (!fitAddonRef.current || !termRef.current) return
        fitAddonRef.current.fit()
        const newCols = termRef.current.cols
        const newRows = termRef.current.rows
        if (newCols > 0 && newRows > 0) {
          window.electronAPI?.terminalResize({ cols: newCols, rows: newRows })
        }
        // 强制 xterm 重新渲染，修复历史内容的错位
        termRef.current.refresh(0, termRef.current.rows - 1)
      }, 300)
    }
    // 终端不可见时 blur，防止 xterm.js 捕获键盘事件发送到 PTY
    if (!visible && termRef.current) {
      termRef.current.blur()
    }
  }, [visible])

  // 监听 terminal:data（PTY 输出 → xterm.js）
  useEffect(() => {
    const cleanup = window.electronAPI?.onTerminalData?.((data: string) => {
      termRef.current?.write(data)
    })
    return () => cleanup?.()
  }, [])

  // 切换至终端视图时聚焦并刷新选区
  useEffect(() => {
    if (visible && termRef.current) {
      setTimeout(() => {
        if (!termRef.current) return
        termRef.current.focus()
        termRef.current.refresh(0, termRef.current.rows - 1)
      }, 100)
    }
  }, [visible])

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
