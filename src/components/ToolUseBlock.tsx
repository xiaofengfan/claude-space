import { ToolCall } from '../types/claude'

const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Edit: '✏️',
  Write: '📝',
  Glob: '🔍',
  Grep: '🔎',
  Bash: '💻',
  WebSearch: '🌐',
  WebFetch: '📡',
  TaskCreate: '📋',
  TaskUpdate: '📌',
  Agent: '🤖',
  Workflow: '⚙️',
}

export function ToolUseBlock({ tool }: { tool: ToolCall }) {
  const icon = TOOL_ICONS[tool.name] || '🔧'
  const inputSummary = summarizeInput(tool.name, tool.input)

  return (
    <div className={`tool-block ${tool.isComplete ? 'complete' : 'pending'}`}>
      <div className="tool-header">
        <span className="tool-icon">{icon}</span>
        <span className="tool-name">{tool.name}</span>
        {!tool.isComplete && <span className="tool-spinner"></span>}
      </div>
      <div className="tool-input">{inputSummary}</div>
      {tool.result && (
        <div className="tool-result">
          <pre>{tool.result.slice(0, 1000)}</pre>
        </div>
      )}
    </div>
  )
}

function summarizeInput(name: string, input: Record<string, any>): string {
  switch (name) {
    case 'Read':
      return `📄 ${input.file_path || '?'}`
    case 'Edit':
      return `✏️ ${input.file_path || '?'}`
    case 'Write':
      return `📝 ${input.file_path || '?'}`
    case 'Glob':
      return `🔍 ${input.pattern || '?'}`
    case 'Grep':
      return `🔎 "${input.pattern || '?'}"`
    case 'Bash':
      return `💻 ${(input.command || '').slice(0, 80)}${(input.command || '').length > 80 ? '...' : ''}`
    case 'WebSearch':
      return `🌐 ${input.query || '?'}`
    case 'WebFetch':
      return `📡 ${input.url || '?'}`
    case 'Agent':
      return `🤖 ${input.description || input.prompt?.slice(0, 60) || '?'}`
    default:
      return JSON.stringify(input).slice(0, 120)
  }
}
