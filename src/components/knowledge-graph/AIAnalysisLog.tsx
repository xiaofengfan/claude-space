import { useState, useEffect, useRef } from 'react'

export interface AIAnalysisEntry {
  id: string
  label: string
  status: 'running' | 'done' | 'error'
  preview: string
  startTime: string
  finishTime?: string
  projectPath: string
  entities?: number
  relations?: number
  error?: string
}

interface Props {
  theme: 'dark' | 'light'
  entries: AIAnalysisEntry[]
  onDismiss: (id: string) => void
  onClear: () => void
}

export function AIAnalysisLog({ theme, entries, onDismiss, onClear }: Props) {
  const isDark = theme === 'dark'
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [entries])

  if (entries.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#ccc' : '#555' }}>🕸️ 图谱分析</span>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', fontSize: 12 }}>
          暂无分析任务
        </div>
      </div>
    )
  }

  const hasRunning = entries.some(e => e.status === 'running')

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#ccc' : '#555' }}>
          🕸️ 图谱分析 ({entries.length})
        </span>
        {hasRunning && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4a5cf7', animation: 'pulse-glow 0.8s infinite' }} />}
        <div style={{ flex: 1 }} />
        <button onClick={onClear} style={{
          background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 10,
        }}>清空</button>
      </div>

      {/* Entries */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {entries.map(entry => (
          <div key={entry.id} style={{
            margin: '2px 6px', padding: '8px 10px', borderRadius: 4,
            background: isDark ? '#1a1a1a' : '#f5f5f5',
            borderLeft: `3px solid ${
              entry.status === 'running' ? '#4a5cf7' :
              entry.status === 'done' ? '#4caf50' : '#e74c3c'
            }`,
          }}>
            {/* Status line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span>{entry.status === 'running' ? '🤖' : entry.status === 'done' ? '✅' : '⚠️'}</span>
              <span style={{
                fontSize: 12, fontWeight: 600, flex: 1,
                color: isDark ? '#ddd' : '#444',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {entry.label}
              </span>
              <span style={{ fontSize: 9, color: '#666' }}>
                {new Date(entry.startTime).toLocaleTimeString()}
                {entry.finishTime && (
                  <span title={`开始 ${new Date(entry.startTime).toLocaleString()} → 完成 ${new Date(entry.finishTime).toLocaleString()}`}>
                    {' · '}
                    {(() => {
                      const diff = new Date(entry.finishTime!).getTime() - new Date(entry.startTime).getTime()
                      const sec = Math.floor(diff / 1000)
                      const min = Math.floor(sec / 60)
                      return min > 0 ? `${min}分${sec % 60}秒` : `${sec}秒`
                    })()}
                  </span>
                )}
              </span>
              <button onClick={() => onDismiss(entry.id)} style={{
                background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12,
              }}>✕</button>
            </div>

            {/* Status badge */}
            <div style={{
              display: 'inline-block', padding: '1px 6px', borderRadius: 6, fontSize: 9, fontWeight: 600,
              background: entry.status === 'running' ? '#4a5cf720' :
                         entry.status === 'done' ? '#4caf5020' : '#e74c3c20',
              color: entry.status === 'running' ? '#6c8cff' :
                     entry.status === 'done' ? '#4caf50' : '#e74c3c',
              marginBottom: 4,
            }}>
              {entry.status === 'running' ? '分析中...' :
               entry.status === 'done' ? `完成 · ${entry.entities || 0}实体 ${entry.relations || 0}关系` :
               '失败'}
            </div>

            {/* Preview */}
            {entry.preview && (
              <pre style={{
                fontSize: 10, lineHeight: 1.4, maxHeight: 80, overflow: 'auto',
                padding: 6, borderRadius: 3, margin: 0,
                background: isDark ? '#111' : '#eee',
                color: isDark ? '#999' : '#666',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {entry.preview.slice(-800)}
              </pre>
            )}

            {/* Error */}
            {entry.error && (
              <div style={{ fontSize: 10, color: '#e74c3c', marginTop: 2 }}>
                {entry.error}
              </div>
            )}

            {/* Progress bar */}
            {entry.status === 'running' && (
              <div style={{
                marginTop: 4, height: 2, background: isDark ? '#222' : '#ddd',
                borderRadius: 1, overflow: 'hidden',
              }}>
                <div style={{
                  width: '70%', height: '100%', background: '#4a5cf7',
                  animation: 'kg-progress-indeterminate 1.5s ease-in-out infinite',
                }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
