import { useEffect, useRef } from 'react'
import type { TaskItem } from '../types'

interface UseTaskSyncOpts {
  tasks: TaskItem[]
  onTasksChange: (tasks: TaskItem[]) => void
  activeProjectPath?: string
  onApproval?: (approval: ApprovalRequest) => void
  autoApproval?: boolean
  onMonitorEvent?: (evt: { id: string; type: string; title: string; detail: string; status: 'running' | 'completed' | 'pending'; timestamp: number }) => void
  onTaskComplete?: (taskTitle: string) => void
  onActivityStart?: () => void  // Claude 开始执行工具时触发，用于自动切换面板
  onAutoApprove?: (response: string) => void  // 自动审批时发送响应到终端/spawn stdin
}

export interface ApprovalRequest {
  id: string
  question: string
  options: { label: string; description: string }[]
  toolCallId: string
  toolName?: string       // e.g. "Bash", "Write", "Edit"
  toolInput?: string       // tool input summary (command, file path, etc.)
  timestamp: number
}

/** Sensitive tools that typically require user permission */
const SENSITIVE_TOOLS = ['Bash', 'Write', 'Edit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent']

export function useTaskSync({ tasks, onTasksChange, activeProjectPath, onApproval, autoApproval, onMonitorEvent, onTaskComplete, onActivityStart, onAutoApprove }: UseTaskSyncOpts) {
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  useEffect(() => {
    // ── Listen for Claude stream-json events ──
    const unsubEvent = window.electronAPI.onClaudeEvent((event: any) => {
      // Handle tool_result → mark matching tasks as done
      if (event.type === 'user' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_result') {
            const toolUseId = block.tool_use_id
            const now = new Date().toISOString()
            let changed = false
            const updated = tasksRef.current.map(t => {
              if (t.status === 'done') return t
              // Match by toolCallId
              if (toolUseId && t.toolCallId === toolUseId) { changed = true; return { ...t, status: 'done' as const, updatedAt: now } }
              return t
            })
            if (changed) {
              onTasksChange(updated)
              const doneTask = updated.find(t => t.toolCallId === toolUseId)
              if (doneTask) onTaskComplete?.(doneTask.title)
            }
            if (toolUseId) onMonitorEvent?.({ id: toolUseId, type: 'tool_use', title: '✅ 工具完成', detail: '', status: 'completed', timestamp: Date.now() })
          }
        }
        return
      }

      const blocks = event.message?.content
      if (!Array.isArray(blocks)) return

      for (const block of blocks) {
        if (block.type !== 'tool_use') continue

        const name = block.name
        const input = block.input || {}
        const toolId = block.id

        // ── Track ALL tool uses for monitoring ──
        if (['Bash', 'Write', 'Edit', 'Read', 'Glob', 'Grep', 'Workflow', 'Agent', 'WebFetch', 'WebSearch'].includes(name)) {
          onActivityStart?.()  // 通知外部：Claude 开始干活了
          const toolTask: TaskItem = {
            id: 'tool_' + Date.now().toString(36),
            title: `${getToolEmoji(name)} ${name}: ${getToolSummary(name, input)}`,
            description: getToolDetail(name, input).slice(0, 200),
            status: 'in_progress',
            category: 'tool',
            agentType: inferAgentType(name),
            toolCallId: toolId,
            projectPath: activeProjectPath,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          if (!tasksRef.current.some(t => t.toolCallId === toolId)) {
            onTasksChange([...tasksRef.current, toolTask])
            onMonitorEvent?.({ id: toolId, type: 'tool_use', title: toolTask.title, detail: toolTask.description, status: 'running', timestamp: Date.now() })
          }
        }

        // ── TaskCreate → 创建 TaskItem ──
        if (name === 'TaskCreate') {
          const title = input.subject || input.title || '未命名任务'
          const description = input.description || ''
          const newTask: TaskItem = {
            id: 't_' + Date.now().toString(36),
            title,
            description: description.slice(0, 200),
            status: 'todo',
            category: 'task',
            agentType: input.agentType || undefined,
            toolCallId: toolId,
            projectPath: activeProjectPath,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          if (!tasksRef.current.some(t => t.toolCallId === toolId)) {
            onTasksChange([...tasksRef.current, newTask])
            onMonitorEvent?.({ id: toolId, type: 'task_create', title: title, detail: description, status: 'running', timestamp: Date.now() })
          }
        }

        // ── TaskUpdate → 更新 TaskItem 状态 ──
        if (name === 'TaskUpdate') {
          const taskId = input.taskId
          const newStatus = input.status
          if (taskId && newStatus) {
            const statusMap: Record<string, TaskItem['status']> = {
              todo: 'todo', pending: 'todo', in_progress: 'in_progress',
              completed: 'done', done: 'done', cancelled: 'done',
            }
            const mapped = statusMap[newStatus] || 'in_progress'
            const updated = tasksRef.current.map(t =>
              t.toolCallId === taskId || t.id === taskId
                ? { ...t, status: mapped, updatedAt: new Date().toISOString() }
                : t
            )
            onTasksChange(updated)
          }
        }

        // ── AskUserQuestion → 审批通知 ──
        if (name === 'AskUserQuestion') {
          const questions = input.questions
          if (questions && questions.length > 0) {
            const q = questions[0]
            const approval: ApprovalRequest = {
              id: 'approval_' + Date.now().toString(36),
              question: q.question || q.header || '需要您的审批',
              options: q.options || [],
              toolCallId: toolId,
              toolName: 'AskUserQuestion',
              timestamp: Date.now(),
            }

            if (autoApproval) {
              const firstOption = q.options?.[0]
              const approvalTask: TaskItem = {
                id: approval.id,
                title: `✅ ${approval.question.slice(0, 50)}`,
                description: `自动审批: ${firstOption?.label || '通过'} | ${q.options?.map((o: any) => o.label).join(', ') || ''}`,
                status: 'done',
                category: 'approval',
                agentType: 'Coordinator',
                toolCallId: toolId,
                projectPath: activeProjectPath,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
              if (!tasksRef.current.some(t => t.toolCallId === toolId)) {
                onTasksChange([...tasksRef.current, approvalTask])
              }
              window.electronAPI.approvalLog?.({
                timestamp: new Date().toISOString(),
                question: approval.question,
                optionChosen: firstOption?.label || '自动通过',
                auto: true,
              })
            } else {
              const approvalTask: TaskItem = {
                id: approval.id,
                title: `🔔 ${approval.question.slice(0, 50)}`,
                description: q.options?.map((o: any) => o.label).join(', ') || '',
                status: 'todo',
                category: 'approval',
                agentType: 'Coordinator',
                toolCallId: toolId,
                projectPath: activeProjectPath,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
              if (!tasksRef.current.some(t => t.toolCallId === toolId)) {
                onTasksChange([...tasksRef.current, approvalTask])
              }
              onApproval?.(approval)
            }
          }
        }

        // ── Sensitive tool permission → 审批通知 ──
        // Detect tool_use blocks for tools that typically need permission
        // Only trigger for tools NOT already handled above (TaskCreate/TaskUpdate/AskUserQuestion)
        if (name !== 'TaskCreate' && name !== 'TaskUpdate' && name !== 'AskUserQuestion' &&
            SENSITIVE_TOOLS.includes(name)) {
          // Check if this tool_use explicitly asks for permission
          // 仅匹配 permission.status === 'prompt'/'ask'，不再用 !block.permission 兜底
          // （--dangerously-skip-permissions 模式下无 permission 字段，不应误触发）
          const needsPermission = block.permission?.status === 'prompt' ||
            block.permission?.status === 'ask'

          if (needsPermission && !autoApproval) {
            const toolSummary = getToolDetail(name, input)
            const approvalId = 'perm_' + Date.now().toString(36)

            const approval: ApprovalRequest = {
              id: approvalId,
              question: `工具权限请求: ${name}`,
              options: [
                { label: '✅ 允许执行一次', description: toolSummary.slice(0, 100) },
                { label: '🔄 始终允许此类操作', description: `允许所有 ${name} 工具在本次会话中执行` },
                { label: '❌ 拒绝', description: '跳过此工具调用' },
              ],
              toolCallId: toolId,
              toolName: name,
              toolInput: toolSummary.slice(0, 200),
              timestamp: Date.now(),
            }

            const approvalTask: TaskItem = {
              id: approvalId,
              title: `🔔 ${getToolEmoji(name)} ${name}: ${getToolSummary(name, input)}`,
              description: toolSummary.slice(0, 200),
              status: 'todo',
              category: 'approval',
              agentType: inferAgentType(name),
              toolCallId: toolId,
              projectPath: activeProjectPath,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            if (!tasksRef.current.some(t => t.toolCallId === toolId && t.category === 'approval')) {
              onTasksChange([...tasksRef.current, approvalTask])
            }
            onApproval?.(approval)
          }

          // Auto-approval: 仅在 Claude 确实等待权限时才发送响应
          // 如果 --dangerously-skip-permissions 已生效，Claude 自动放行，不应发送 y 干扰 stdin
          if (autoApproval && needsPermission && SENSITIVE_TOOLS.includes(name)) {
            // 发送 y + Enter 到 Claude stdin，使其继续执行
            onAutoApprove?.('y\r')
            const approvalId = 'auto_' + Date.now().toString(36)
            const toolSummary = getToolDetail(name, input)
            const autoTask: TaskItem = {
              id: approvalId,
              title: `✅ ${getToolEmoji(name)} ${name}: ${getToolSummary(name, input)}`,
              description: `自动审批: ${toolSummary.slice(0, 150)}`,
              status: 'done',
              category: 'approval',
              agentType: inferAgentType(name),
              toolCallId: toolId,
              projectPath: activeProjectPath,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            if (!tasksRef.current.some(t => t.toolCallId === toolId && t.category === 'approval')) {
              onTasksChange([...tasksRef.current, autoTask])
            }
            window.electronAPI.approvalLog?.({
              timestamp: new Date().toISOString(),
              question: `${name}: ${toolSummary.slice(0, 80)}`,
              optionChosen: '自动允许',
              auto: true,
            })
          }
        }
      }
    })

    // ── Listen for stderr-based permission prompts (fallback detection) ──
    const unsubPerm = window.electronAPI.onClaudePermissionPrompt?.((prompt: { text: string; timestamp: number }) => {
      if (autoApproval) {
        // Auto-approve: 通过回调发送 y（自动路由到终端或 spawn stdin）
        onAutoApprove?.('y\r')
        // Log it
        window.electronAPI.approvalLog?.({
          timestamp: new Date().toISOString(),
          question: prompt.text.slice(0, 200),
          optionChosen: '自动允许 (基于 stderr 检测)',
          auto: true,
        })
        return
      }

      // Manual approval: show dialog
      const approvalId = 'stderr_' + Date.now().toString(36)
      const approval: ApprovalRequest = {
        id: approvalId,
        question: 'Claude 需要您的确认',
        options: [
          { label: '✅ 允许 (y)', description: prompt.text.slice(0, 200) },
          { label: '❌ 拒绝 (n)', description: '跳过此操作' },
        ],
        toolCallId: '',
        toolName: 'PermissionPrompt',
        toolInput: prompt.text.slice(0, 200),
        timestamp: Date.now(),
      }

      const approvalTask: TaskItem = {
        id: approvalId,
        title: `🔔 权限请求: ${prompt.text.slice(0, 50)}`,
        description: prompt.text.slice(0, 200),
        status: 'todo',
        category: 'approval',
        agentType: 'Architect',
        projectPath: activeProjectPath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      if (!tasksRef.current.some(t => t.id === approvalId)) {
        onTasksChange([...tasksRef.current, approvalTask])
      }
      onApproval?.(approval)

      onMonitorEvent?.({
        id: approvalId,
        type: 'permission_prompt',
        title: `🔔 权限请求来自终端`,
        detail: prompt.text.slice(0, 100),
        status: 'pending',
        timestamp: Date.now(),
      })
    })

    return () => {
      unsubEvent()
      unsubPerm?.()
    }
  }, [activeProjectPath, autoApproval])
}

/** Infer agent type from tool name — maps tools to team roles */
function inferAgentType(toolName: string): string {
  const map: Record<string, string> = {
    Bash: 'Implementer',
    Write: 'Implementer',
    Edit: 'Implementer',
    Read: 'CodeExplorer',
    Glob: 'CodeExplorer',
    Grep: 'CodeExplorer',
    WebFetch: 'CodeExplorer',
    WebSearch: 'CodeExplorer',
    Agent: 'Coordinator',
    Workflow: 'Coordinator',
    TaskCreate: 'Coordinator',
    TaskUpdate: 'Coordinator',
    AskUserQuestion: 'Coordinator',
  }
  return map[toolName] || 'Implementer'
}

function getToolEmoji(name: string): string {
  const m: Record<string, string> = {
    Bash: '💻', Write: '📝', Edit: '✏️', Read: '📖',
    Glob: '🔍', Grep: '🔎', Workflow: '⚙️', Agent: '🤖',
    WebFetch: '🌐', WebSearch: '🔍',
  }
  return m[name] || '🔧'
}

function getToolSummary(name: string, input: any): string {
  switch (name) {
    case 'Bash': return (input.command || input.description || '').slice(0, 50)
    case 'Write':
    case 'Edit':
    case 'Read': return (input.file_path || '').split(/[/\\]/).pop() || ''
    case 'Glob':
    case 'Grep': return (input.pattern || '').slice(0, 40)
    case 'Workflow': return (input.description || input.script || '').slice(0, 40)
    case 'Agent': return (input.description || input.subagent_type || '').slice(0, 40)
    case 'WebFetch': return (input.url || '').slice(0, 50)
    case 'WebSearch': return (input.query || '').slice(0, 50)
    case 'AskUserQuestion': return (input.questions?.[0]?.question || '').slice(0, 50)
    default: return ''
  }
}

function getToolDetail(name: string, input: any): string {
  switch (name) {
    case 'Bash': return input.command || input.description || ''
    case 'Write':
    case 'Edit': return input.file_path || ''
    case 'Read': return input.file_path || ''
    case 'Glob': return `pattern: ${input.pattern || ''}`
    case 'Grep': return `pattern: ${input.pattern || ''}`
    case 'Workflow': return input.description || input.script?.slice(0, 100) || ''
    case 'Agent': return input.description || input.prompt?.slice(0, 100) || ''
    case 'WebFetch': return input.url || ''
    case 'WebSearch': return input.query || ''
    default: return ''
  }
}
