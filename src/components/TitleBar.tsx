import { useState, useEffect } from 'react'

export function TitleBar({
  theme,
  onThemeToggle,
  onSettingsClick,
}: {
  theme: 'dark' | 'light'
  onThemeToggle: () => void
  onSettingsClick: () => void
}) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI.isMaximized().then(setIsMaximized)
  }, [])

  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <span className="titlebar-title">🤖 Claude Space</span>
      </div>
      <div className="titlebar-actions">
        <button className="titlebar-btn" onClick={onThemeToggle} title={`切换主题 (当前: ${theme})`}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button className="titlebar-btn" onClick={onSettingsClick} title="设置">
          ⚙️
        </button>
        <button className="titlebar-btn" onClick={() => window.electronAPI.minimizeWindow()}>
          ─
        </button>
        <button className="titlebar-btn" onClick={() => { window.electronAPI.maximizeWindow(); setIsMaximized(!isMaximized) }}>
          {isMaximized ? '❐' : '□'}
        </button>
        <button className="titlebar-btn titlebar-close" onClick={() => window.electronAPI.closeWindow()}>
          ✕
        </button>
      </div>
    </header>
  )
}
