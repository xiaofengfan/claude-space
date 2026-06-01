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
}: {
  menus: MenuGroup[]
  onOpenProjectManager: () => void
  theme: 'dark' | 'light'
  onThemeToggle: () => void
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
