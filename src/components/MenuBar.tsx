import { useState, useRef, useEffect } from 'react'

export interface MenuItem {
  label: string
  shortcut?: string
  action?: () => void
  divider?: boolean
  disabled?: boolean
}

export interface MenuGroup {
  label: string
  items: MenuItem[]
}

export function MenuBar({
  menus,
  onOpenProjectManager,
  theme,
  onThemeToggle,
  onGitToggle,
  onToggleRight,
  rightCollapsed,
  onToggleLeft,
  leftCollapsed,
}: {
  menus: MenuGroup[]
  onOpenProjectManager: () => void
  theme: 'dark' | 'light'
  onThemeToggle: () => void
  onGitToggle: () => void
  onToggleRight?: () => void
  rightCollapsed?: boolean
  onToggleLeft?: () => void
  leftCollapsed?: boolean
}) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="menubar" ref={menuRef}>
      {menus.map((group) => (
        <div key={group.label} className="menubar-item-wrapper">
          <button
            className={`menubar-item ${activeMenu === group.label ? 'active' : ''}`}
            onClick={() => setActiveMenu(activeMenu === group.label ? null : group.label)}
            onMouseEnter={() => activeMenu && setActiveMenu(group.label)}
          >
            {group.label}
          </button>
          {activeMenu === group.label && (
            <div className="menubar-dropdown">
              {group.items.map((item, idx) =>
                item.divider ? (
                  <div key={idx} className="menubar-divider" />
                ) : (
                  <button
                    key={idx}
                    className={`menubar-dropdown-item ${item.disabled ? 'disabled' : ''}`}
                    onClick={() => {
                      item.action?.()
                      setActiveMenu(null)
                    }}
                    disabled={item.disabled}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="menubar-shortcut">{item.shortcut}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
      {/* 窗口控制按钮 */}
      <div className="menubar-win-controls">
        <button className="menubar-win-btn" onClick={onToggleLeft} title={leftCollapsed ? '展开左侧栏' : '折叠左侧栏'}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: 'middle' }}>
            {leftCollapsed ? (
              <path d="M14 1H2L1 2v12l1 1h12l1-1V2l-1-1zM2 14V2h3v12H2zm4 0V2h8v12H6zM5 5L2 8l3 3V5z" />
            ) : (
              <path d="M14 1H2L1 2v12l1 1h12l1-1V2l-1-1zM2 14V2h3v12H2zm4 0V2h8v12H6zM4 5l3 3-3 3V5z" />
            )}
          </svg>
        </button>
        <button className="menubar-win-btn" onClick={onToggleRight} title={rightCollapsed ? '展开右侧栏' : '折叠右侧栏'}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: 'middle' }}>
            {rightCollapsed ? (
              <path d="M14 1H2L1 2v12l1 1h12l1-1V2l-1-1zM2 14V2h3v12H2zm4 0V2h8v12H6zM8 5v6l3-3-3-3z" />
            ) : (
              <path d="M14 1H2L1 2v12l1 1h12l1-1V2l-1-1zM2 14V2h3v12H2zm4 0V2h8v12H6zM11 5L8 8l3 3V5z" />
            )}
          </svg>
        </button>
        <button className="menubar-win-btn" onClick={onThemeToggle} title={`主题: ${theme}`}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button className="menubar-win-btn" onClick={() => window.electronAPI?.minimizeWindow()} title="Minimize">─</button>
        <button className="menubar-win-btn" onClick={() => window.electronAPI?.maximizeWindow()} title="Maximize">□</button>
        <button className="menubar-win-btn menubar-win-close" onClick={() => window.electronAPI?.closeWindow()} title="Close">✕</button>
      </div>
    </div>
  )
}
