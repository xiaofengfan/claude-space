import { useEffect, useRef } from 'react'

interface ActivityBarView {
  id: string
  label: string
  badge?: number
}

// ── VS Code Codicon 风格 SVG 路径 ─────────────────
const ICONS: Record<string, string> = {
  files: 'M13.71 4.29l-4-4L9.29 0H2L1 1v14l1 1h12l1-1V5l-.29-.71zM10 1.41L12.59 4H10V1.41zM2 15V1h7v4l1 1h4v9H2z',
  search: 'M15.44 14.56l-3.85-3.85A6.44 6.44 0 0013 7.5 6.5 6.5 0 106.5 14a6.44 6.44 0 003.21-.87l3.85 3.85 1.44-1.44zM6.5 12A4.5 4.5 0 1111 7.5 4.5 4.5 0 016.5 12z',
  sessions: 'M8 8a3 3 0 100-6 3 3 0 000 6zm0 1c-3.33 0-6 1.34-6 3v1h12v-1c0-1.66-2.67-3-6-3z',
  rules: 'M8 1L1 3.5v5.2C1 12.16 4.56 15.67 8 16c3.44-.33 7-3.84 7-7.3V3.5L8 1zm0 13.15V2.35l5 1.75v4.6c0 3.08-2.68 5.45-5 5.45z',
  memory: 'M8 1C4.14 1 1 4.14 1 8c0 1.38.43 2.65 1.17 3.71.31.45.13 1.05-.32 1.36-.44.3-1.03.12-1.33-.32A7.94 7.94 0 010 8a8 8 0 0116 0c0 1.55-.44 3-1.2 4.23-.3.44-.89.62-1.33.32-.44-.3-.62-.89-.32-1.33C14.57 10.65 15 9.38 15 8c0-3.86-3.14-7-7-7zM5 7h6v2H5V7zm.5 3.5h5v2h-5v-2zM8 0v2H7V0h1z',
  skills: 'M14.7 2.3l-1-1c-.4-.4-1-.4-1.4 0L11 2.6 5.9 7.7c-.3.3-.5.7-.6 1.1l-.6 2c-.1.4.1.8.4 1.1.2.2.5.3.8.3.1 0 .2 0 .3-.1l2-.6c.4-.1.8-.3 1.1-.6L13.4 5l1.3-1.3c.4-.4.4-1 0-1.4zM11 5.1L6.9 9.2c-.1.1-.2.2-.3.4l-.4 1.1 1.1-.4c.1-.1.3-.2.4-.3L12.9 6 11 5.1zM5 2c-1.7 0-3 1.3-3 3v6c0 1.7 1.3 3 3 3h5c1.7 0 3-1.3 3-3v-1h-1v1c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h1V2H5z',
  git: 'M8 1C4.14 1 1 4.14 1 8c0 2.76 1.68 5.12 4.06 6.1.3.06.4-.13.4-.29 0-.14-.01-.52-.01-.99-1.65.36-1.99-.8-1.99-.8-.27-.7-.66-.88-.66-.88-.54-.37.04-.36.04-.36.6.04.91.62.91.62.53.91 1.4.65 1.74.5.06-.39.2-.65.37-.8-1.33-.15-2.73-.67-2.73-2.98 0-.66.23-1.2.62-1.62-.06-.15-.27-.77.06-1.6 0 0 .5-.16 1.65.62A5.72 5.72 0 018 4.97c.5.01 1.01.07 1.49.22 1.14-.78 1.65-.62 1.65-.62.33.83.12 1.45.06 1.6.38.42.62.96.62 1.62 0 2.31-1.4 2.83-2.73 2.98.21.19.41.56.41 1.13 0 .82-.01 1.48-.01 1.68 0 .16.1.35.4.29A7.01 7.01 0 0015 8c0-3.86-3.14-7-7-7z',
  automation: 'M13 7.8V6.2l-1.4-.6c-.1-.3-.2-.6-.4-.9l.3-1.5-1.2-1.2-1.5.3c-.3-.2-.6-.3-.9-.4L7.2.8H5.6l-.6 1.4c-.3.1-.6.2-.9.4l-1.5-.3L1.4 3.2l.3 1.5c-.2.3-.3.6-.4.9L0 6.2v1.6l1.4.6c.1.3.2.6.4.9l-.3 1.5 1.2 1.2 1.5-.3c.3.2.6.3.9.4l.6 1.4h1.6l.6-1.4c.3-.1.6-.2.9-.4l1.5.3 1.2-1.2-.3-1.5c.2-.3.3-.6.4-.9l1.4-.6zM6.4 10c-1.5 0-2.8-1.2-2.8-2.8S4.9 4.4 6.4 4.4s2.8 1.2 2.8 2.8S7.9 10 6.4 10zm0-1c1 0 1.8-.8 1.8-1.8S7.4 5.4 6.4 5.4 4.6 6.2 4.6 7.2 5.4 9 6.4 9z',
}

const VIEWS: ActivityBarView[] = [
  { id: 'files', label: '文件资源管理器' },
  { id: 'sessions', label: '会话历史' },
  { id: 'rules', label: '项目规则' },
  { id: 'memory', label: '记忆管理' },
  { id: 'git', label: '版本控制' },
  { id: 'skills', label: '技能管理' },
  { id: 'automation', label: '自动化工坊' },
]

export const VIEW_LABELS: Record<string, string> = {
  files: '文件资源管理器',
  sessions: '会话历史',
  rules: '项目规则',
  memory: '记忆管理',
  git: '版本控制',
  skills: '技能管理',
  automation: '自动化工坊',
}

export type { ActivityBarView }

interface Props {
  activeView: string
  onViewChange: (view: string) => void
}

export function ActivityBar({ activeView, onViewChange }: Props) {
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
          <svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor">
            <path d={ICONS[view.id] || ''} fillRule="evenodd" clipRule="evenodd" />
          </svg>
          {view.badge !== undefined && view.badge > 0 && (
            <span className="activity-bar-badge">{view.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}
