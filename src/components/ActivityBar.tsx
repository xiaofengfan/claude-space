import { useEffect, useRef } from 'react'

interface ActivityBarView {
  id: string
  label: string
  badge?: number
}

// ── VS Code Codicon 风格 SVG 路径 ─────────────────
const ICONS: Record<string, string> = {
  files: 'M13.71 4.29l-4-4L9.29 0H2L1 1v14l1 1h12l1-1V5l-.29-.71zM10 1.41L12.59 4H10V1.41zM2 15V1h7v4l1 1h4v9H2z',
  modules: 'M8 1L1 4v8l7 3 7-3V4L8 1zm0 1.93L13.07 4 8 5.93 2.93 4 8 2.93zM2 5.4l5 2.14v5.32l-5-2.14V5.4zm12 0v5.32l-5 2.14V7.54l5-2.14z',
  search: 'M15.44 14.56l-3.85-3.85A6.44 6.44 0 0013 7.5 6.5 6.5 0 106.5 14a6.44 6.44 0 003.21-.87l3.85 3.85 1.44-1.44zM6.5 12A4.5 4.5 0 1111 7.5 4.5 4.5 0 016.5 12z',
  sessions: 'M8 8a3 3 0 100-6 3 3 0 000 6zm0 1c-3.33 0-6 1.34-6 3v1h12v-1c0-1.66-2.67-3-6-3z',
  rules: 'M8 1L1 3.5v5.2C1 12.16 4.56 15.67 8 16c3.44-.33 7-3.84 7-7.3V3.5L8 1zm0 13.15V2.35l5 1.75v4.6c0 3.08-2.68 5.45-5 5.45z',
  memory: 'M8 1C4.14 1 1 4.14 1 8c0 1.38.43 2.65 1.17 3.71.31.45.13 1.05-.32 1.36-.44.3-1.03.12-1.33-.32A7.94 7.94 0 010 8a8 8 0 0116 0c0 1.55-.44 3-1.2 4.23-.3.44-.89.62-1.33.32-.44-.3-.62-.89-.32-1.33C14.57 10.65 15 9.38 15 8c0-3.86-3.14-7-7-7zM5 7h6v2H5V7zm.5 3.5h5v2h-5v-2zM8 0v2H7V0h1z',
  skills: 'M14.7 2.3l-1-1c-.4-.4-1-.4-1.4 0L11 2.6 5.9 7.7c-.3.3-.5.7-.6 1.1l-.6 2c-.1.4.1.8.4 1.1.2.2.5.3.8.3.1 0 .2 0 .3-.1l2-.6c.4-.1.8-.3 1.1-.6L13.4 5l1.3-1.3c.4-.4.4-1 0-1.4zM11 5.1L6.9 9.2c-.1.1-.2.2-.3.4l-.4 1.1 1.1-.4c.1-.1.3-.2.4-.3L12.9 6 11 5.1zM5 2c-1.7 0-3 1.3-3 3v6c0 1.7 1.3 3 3 3h5c1.7 0 3-1.3 3-3v-1h-1v1c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h1V2H5z',
  git: 'M8 1C4.14 1 1 4.14 1 8c0 2.76 1.68 5.12 4.06 6.1.3.06.4-.13.4-.29 0-.14-.01-.52-.01-.99-1.65.36-1.99-.8-1.99-.8-.27-.7-.66-.88-.66-.88-.54-.37.04-.36.04-.36.6.04.91.62.91.62.53.91 1.4.65 1.74.5.06-.39.2-.65.37-.8-1.33-.15-2.73-.67-2.73-2.98 0-.66.23-1.2.62-1.62-.06-.15-.27-.77.06-1.6 0 0 .5-.16 1.65.62A5.72 5.72 0 018 4.97c.5.01 1.01.07 1.49.22 1.14-.78 1.65-.62 1.65-.62.33.83.12 1.45.06 1.6.38.42.62.96.62 1.62 0 2.31-1.4 2.83-2.73 2.98.21.19.41.56.41 1.13 0 .82-.01 1.48-.01 1.68 0 .16.1.35.4.29A7.01 7.01 0 0015 8c0-3.86-3.14-7-7-7z',
  orchestrator: 'M11 2L9.5 3.5 8 2 6.5 3.5 5 2 3 4v8l2 2h8l2-2V4l-2-2zm-1 5h-2v2h2V7zm0 4h-2v2h2v-2zm-3 0H5v2h2v-2zm0-4H5v2h2V7z',
  'knowledge-graph': 'M8 1C4.14 1 1 4.14 1 8s3.14 7 7 7 7-3.14 7-7-3.14-7-7-7zm0 2c2.76 0 5 2.24 5 5s-2.24 5-5 5-5-2.24-5-5 2.24-5 5-5zm-2 3a1 1 0 100 2 1 1 0 000-2zm4 0a1 1 0 100 2 1 1 0 000-2zm-2 4a1 1 0 100 2 1 1 0 000-2z',
}

const VIEWS: ActivityBarView[] = [
  { id: 'files', label: '文件资源管理器' },
  { id: 'modules', label: '业务模块' },
  { id: 'sessions', label: '会话历史' },
  { id: 'rules', label: '项目规则' },
  { id: 'memory', label: '记忆管理' },
  { id: 'git', label: '版本控制' },
  { id: 'skills', label: '技能管理' },
  { id: 'knowledge-graph', label: '项目图谱' },
  { id: 'orchestrator', label: 'AI 编排工坊' },
]

export const VIEW_LABELS: Record<string, string> = {
  files: '文件资源管理器',
  modules: '业务模块',
  sessions: '会话历史',
  rules: '项目规则',
  memory: '记忆管理',
  git: '版本控制',
  skills: '技能管理',
  'knowledge-graph': '项目图谱',
  orchestrator: 'AI 编排工坊',
}

export type { ActivityBarView }

interface Props {
  activeView: string
  onViewChange: (view: string) => void
  onToggleLeft?: () => void
  leftCollapsed?: boolean
}

export function ActivityBar({ activeView, onViewChange, onToggleLeft, leftCollapsed }: Props) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const prevent = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation() }
    el.addEventListener('mousedown', prevent)
    return () => el.removeEventListener('mousedown', prevent)
  }, [])

  return (
    <div className="activity-bar" ref={barRef}>
      {VIEWS.map((view) => (
        <button
          key={view.id}
          className={`activity-bar-btn${activeView === view.id ? ' active' : ''}`}
          onClick={() => onViewChange(view.id)}
          title={view.label}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
            <path d={ICONS[view.id] || ''} fillRule="evenodd" clipRule="evenodd" />
          </svg>
          {view.badge !== undefined && view.badge > 0 && (
            <span className="activity-bar-badge">{view.badge}</span>
          )}
        </button>
      ))}

      {/* 底部 spacer + 折叠/展开按钮 */}
      <div style={{ flex: 1 }} />
      <button
        className={`activity-bar-btn collapse-btn${leftCollapsed ? ' collapsed' : ''}`}
        onClick={onToggleLeft}
        title={leftCollapsed ? '展开左侧栏' : '折叠左侧栏'}
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          {leftCollapsed ? (
            <path d="M14 1H2L1 2v12l1 1h12l1-1V2l-1-1zM2 14V2h3v12H2zm4 0V2h8v12H6zM8 5v6l3-3-3-3z" />
          ) : (
            <path d="M14 1H2L1 2v12l1 1h12l1-1V2l-1-1zM2 14V2h3v12H2zm4 0V2h8v12H6zM11 5L8 8l3 3V5z" />
          )}
        </svg>
      </button>
    </div>
  )
}
