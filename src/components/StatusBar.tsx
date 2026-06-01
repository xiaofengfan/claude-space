export function StatusBar({
  claudeRunning, claudeConnected, model, tokens, cost, projectPath, onToggleClaude,
}: {
  claudeRunning: boolean; claudeConnected: boolean; model: string; tokens: number; cost: number
  projectPath?: string; onToggleClaude?: () => void
}) {
  const dot = claudeConnected ? '🟢' : claudeRunning ? '🟡' : '🔴'
  const label = claudeConnected ? '已连接' : claudeRunning ? '等待输入...' : '未连接'

  function fmt(n: number) {
    if (!n) return '0'
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return String(n)
  }

  return (
    <footer className="statusbar">
      <div className="statusbar-section left">
        <span>{dot} {label}</span>
        <button className="statusbar-btn" onClick={onToggleClaude} title={claudeRunning ? '断开' : '连接'}>
          {claudeRunning ? '⏹ 断开' : '▶ 连接'}
        </button>
        {model && <span className="statusbar-sep">|</span>}
        {model && <span>{model}</span>}
      </div>
      <div className="statusbar-section center">
        {tokens > 0 && <span>📊 {fmt(tokens)} tokens</span>}
        {cost > 0 && <span className="statusbar-sep">|</span>}
        {cost > 0 && <span>${cost.toFixed(4)}</span>}
      </div>
      <div className="statusbar-section right">
        {projectPath && <span title={projectPath}>📂 {projectPath.split(/[/\\]/).pop()}</span>}
      </div>
    </footer>
  )
}
