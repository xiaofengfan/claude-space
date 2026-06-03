import { useState, useEffect } from 'react'
import { FileEditor } from './FileEditor'
import { MenuBar } from './MenuBar'

/**
 * FileViewerWindow — 文件查看器独立窗口的简化布局。
 * 当 URL 包含 ?fileViewer=1&filePath=...&fileName=... 时渲染。
 */
export function FileViewerWindow({
  filePath,
  fileName,
  projectPath,
}: {
  filePath: string
  fileName: string
  projectPath?: string
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('claude-space-theme') as 'dark' | 'light') || 'dark'
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <div className="app" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <MenuBar
        menus={[
          {
            label: '文件',
            items: [
              {
                label: '在项目中打开',
                action: async () => {
                  if (projectPath) {
                    await window.electronAPI.openProjectInNewWindow(projectPath)
                  }
                },
              },
              { label: '', divider: true },
              { label: '关闭窗口', shortcut: 'Ctrl+W', action: () => window.electronAPI.closeWindow() },
            ],
          },
          {
            label: '视图',
            items: [
              {
                label: theme === 'dark' ? '☀️ 亮色主题' : '🌙 暗色主题',
                action: () => setTheme(t => t === 'dark' ? 'light' : 'dark'),
              },
            ],
          },
        ]}
        theme={theme}
        onThemeToggle={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        onOpenProjectManager={() => {}}
        onGitToggle={() => {}}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <FileEditor
          filePath={filePath}
          fileName={fileName}
          theme={theme}
          onClose={() => window.electronAPI.closeWindow()}
          onOpenInNewWindow={() => {}}
        />
      </div>

      {/* Simple status bar */}
      <div className="status-bar" style={{ flexShrink: 0 }}>
        <span className="status-left">📄 {filePath}</span>
      </div>
    </div>
  )
}
