import { useState, useEffect, useRef, useCallback, useMemo } from 'react'

type LogSource = 'all' | 'claude' | 'system' | 'dev'

interface LogEntry {
  text: string
  type: 'info' | 'error' | 'warn' | 'data'
  source: LogSource
}

const FILTER_TABS: { key: LogSource; label: string; icon: string }[] = [
  { key: 'all', label: '全部', icon: '📋' },
  { key: 'claude', label: 'Claude', icon: '🤖' },
  { key: 'system', label: '系统', icon: '⚙️' },
  { key: 'dev', label: '开发', icon: '🔧' },
]

function detectSource(text: string): LogSource {
  if (text.includes('[dev]') || text.includes('[开发]')) return 'dev'
  if (text.includes('[terminal]') || text.includes('[claude]') || text.includes('🤖') || text.includes('🟢') || text.includes('🔴')) return 'claude'
  if (text.includes('[system]') || text.includes('[app]')) return 'system'
  // Default: try to infer from the log format [source]
  const m = text.match(/^\[.*?\]\[(.+?)\]/)
  if (m) {
    const s = m[1].toLowerCase()
    if (s.includes('terminal') || s.includes('claude')) return 'claude'
    if (s.includes('dev')) return 'dev'
    if (s.includes('system') || s.includes('app')) return 'system'
  }
  return 'system' // default
}

export function ConsolePanel({ embedded }: { embedded?: boolean }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const [processName, setProcessName] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState<LogSource>('all')
  const [lineCount, setLineCount] = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const filteredLogs = useMemo(() => {
    if (filter === 'all') return logs
    return logs.filter(l => l.source === filter)
  }, [logs, filter])

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [filteredLogs.length, autoScroll])

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'info', source?: LogSource) => {
    setLogs(prev => [...prev, { text, type, source: source || detectSource(text) }])
  }, [])

  useEffect(() => {
    window.electronAPI.getConsoleLogHistory?.().then(r => {
      if (r?.success && r.lines.length > 0) {
        setLogs(prev => [...prev, ...r.lines.map(l => ({ text: l, type: 'data' as const, source: detectSource(l) }))])
      }
    }).catch(() => {})

    const u1 = window.electronAPI.onDevOutput?.(d => addLog(d, 'data', 'dev')) ?? (() => {})
    const u2 = window.electronAPI.onDevError?.(d => addLog(d, 'error', 'dev')) ?? (() => {})
    const u3 = window.electronAPI.onDevStatus?.(s => {
      setRunning(s.running); setProcessName(s.name)
      addLog(s.running ? `🟢 ${s.name} 已启动` : `🔴 ${s.name} 已停止`, s.running ? 'info' : 'warn', 'dev')
    }) ?? (() => {})
    const u4 = window.electronAPI.onConsoleLogLine?.(line => {
      addLog(line, 'data')
    }) ?? (() => {})
    return () => { u1(); u2(); u3(); u4() }
  }, [addLog])

  // Count lines per source for tab badges
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: logs.length, claude: 0, system: 0, dev: 0 }
    for (const l of logs) { if (counts[l.source] !== undefined) counts[l.source]++ }
    return counts
  }, [logs])

  async function startDev(cmd: string, name: string) {
    addLog(`🚀 启动 ${name}...`, 'info', 'dev')
    setProcessName(name)
    const r = await window.electronAPI.devStart?.({ command: cmd, name })
    if (!r?.success) addLog(`❌ 启动失败: ${r?.error || '未知错误'}`, 'error', 'dev')
  }

  async function stopDev() {
    if (!processName) return
    addLog(`🛑 停止 ${processName}...`, 'warn', 'dev')
    await window.electronAPI.devStop?.()
  }

  function clearLogs() { setLogs([]) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: embedded ? '100%' : '100vh', background: '#0d0d0d', color: '#e0e0e0', fontFamily: 'Consolas, "Courier New", monospace', fontSize: 13 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>🖥️ 控制台</span>
        <span style={{ fontSize: 9, color: running ? '#4caf50' : '#666' }}>
          {running ? `● ${processName || ''}` : ''}
        </span>
        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
          {FILTER_TABS.map(t => (
            <button key={t.key}
              onClick={() => setFilter(t.key)}
              style={{
                padding: '2px 8px', fontSize: 10, border: 'none', borderRadius: 8,
                background: filter === t.key ? '#4a5cf7' : 'transparent',
                color: filter === t.key ? '#fff' : '#888',
                cursor: 'pointer', transition: 'all .12s',
              }}>
              {t.icon} {t.label}
              <span style={{ fontSize: 8, opacity: 0.6, marginLeft: 2 }}>{sourceCounts[t.key]}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => startDev('npm run dev', '前端')} disabled={running}>▶ 前端</button>
        <button className="btn btn-sm" onClick={() => startDev('npm run dev -- --port 5174', '后端')} disabled={running}>▶ 后端</button>
        <button className="btn btn-sm" onClick={stopDev} disabled={!running}>⏹</button>
        <button className="btn btn-sm" onClick={clearLogs}>🗑️</button>
        <label style={{ fontSize: 9, display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', color: '#888' }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} style={{ width: 12, height: 12 }} />滚
        </label>
      </div>

      {/* Log output */}
      <div ref={logRef} style={{ flex: 1, overflow: 'auto', padding: '4px 10px', lineHeight: 1.5, fontSize: 12 }}
        onScroll={() => {
          if (logRef.current) {
            const el = logRef.current
            setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
          }
        }}>
        {filteredLogs.length === 0 ? (
          <div style={{ color: '#555', textAlign: 'center', paddingTop: 40, fontSize: 12 }}>
            {filter === 'all' ? '等待日志输出...' : `暂无 ${FILTER_TABS.find(t => t.key === filter)?.label} 日志`}
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <div key={i} style={{
              color: log.type === 'error' ? '#ff5050' : log.type === 'warn' ? '#f0a040' : '#ccc',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: '1px 0',
            }}>
              {log.text}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Status bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 10px', background: '#1a1a1a', borderTop: '1px solid #2a2a2a', fontSize: 9, color: '#666', flexShrink: 0 }}>
        <span>日志: {logs.length} 行</span>
        <span>显示: {filteredLogs.length} 行</span>
        {running && <span style={{ color: '#4caf50' }}>● 运行中</span>}
      </div>
    </div>
  )
}
