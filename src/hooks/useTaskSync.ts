import { useEffect, useRef } from 'react'
import type { TaskItem } from '../types'

interface UseTaskSyncOpts {
  tasks: TaskItem[]
  onTasksChange: (tasks: TaskItem[]) => void
  activeProjectPath?: string
  onApproval?: (approval: ApprovalRequest) => void
  autoApproval?: boolean
}

export interface ApprovalRequest {
  id: string
  question: string
  options: { label: string; description: string }[]
  toolCallId: string
  timestamp: number
}

export function useTaskSync({ tasks, onTasksChange, activeProjectPath, onApproval, autoApproval }: UseTaskSyncOpts) {
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  useEffect(() => {
    const unsub = window.electronAPI.onClaudeEvent((event: any) => {
      // Handle tool_result → mark tool tasks as done
      if (event.type === 'user' && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const updated = tasksRef.current.map(t =>
              t.toolCallId === block.tool_use_id ? { ...t, status: 'done' as const, updatedAt: new Date().toISOString() } : t
            )
            onTasksChange(updated)
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
        if (['Bash', 'Write', 'Edit', 'Read', 'Glob', 'Grep', 'Workflow', 'Agent'].includes(name)) {
          const toolTask: TaskItem = {
            id: 'tool_' + Date.now().toString(36),
            title: `${getToolEmoji(name)} ${name}: ${getToolSummary(name, input)}`,
            description: getToolDetail(name, input).slice(0, 200),
            status: 'in_progress',
            category: 'tool',
            toolCallId: toolId,
            projectPath: activeProjectPath,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
          if (!tasksRef.current.some(t => t.toolCallId === toolId)) {
            onTasksChange([...tasksRef.current, toolTask])
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
          // Dedup: skip if same toolCallId already exists
          if (!tasksRef.current.some(t => t.toolCallId === toolId)) {
            onTasksChange([...tasksRef.current, newTask])
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
              timestamp: Date.now(),
            }

            // Auto-approve if enabled — log and skip dialog
            if (autoApproval) {
              const firstOption = q.options?.[0]
              const approvalTask: TaskItem = {
                id: approval.id,
                title: `✅ ${approval.question.slice(0, 50)}`,
                description: `自动审批: ${firstOption?.label || '通过'} | ${q.options?.map((o: any) => o.label).join(', ') || ''}`,
                status: 'done',
                category: 'approval',
                toolCallId: toolId,
                projectPath: activeProjectPath,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
              if (!tasksRef.current.some(t => t.toolCallId === toolId)) {
                onTasksChange([...tasksRef.current, approvalTask])
              }
              // Log auto-approval
              window.electronAPI.approvalLog?.({
                timestamp: new Date().toISOString(),
                question: approval.question,
                optionChosen: firstOption?.label || '自动通过',
                auto: true,
              })
            } else {
              // Normal approval flow — show dialog
              const approvalTask: TaskItem = {
                id: approval.id,
                title: `🔔 ${approval.question.slice(0, 50)}`,
                description: q.options?.map((o: any) => o.label).join(', ') || '',
                status: 'todo',
                category: 'approval',
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
      }
    })

    return unsub
  }, [activeProjectPath])
}

function getToolEmoji(name: string): string {
  const m: Record<string, string> = {
    Bash: '💻', Write: '📝', Edit: '✏️', Read: '📖',
    Glob: '🔍', Grep: '🔎', Workflow: '⚙️', Agent: '🤖',
  }
  return m[name] || '🔧'
}

function getToolSummary(name: string, input: any): string {
  switch (name) {
    case 'Bash': return (input.command || '').slice(0, 50)
    case 'Write':
    case 'Edit':
    case 'Read': return (input.file_path || '').split(/[/\\]/).pop() || ''
    case 'Glob':
    case 'Grep': return (input.pattern || '').slice(0, 40)
    case 'Workflow': return (input.description || '').slice(0, 40)
    case 'Agent': return (input.description || input.subagent_type || '').slice(0, 40)
    default: return ''
  }
}

function getToolDetail(name: string, input: any): string {
  switch (name) {
    case 'Bash': return input.command || ''
    case 'Write':
    case 'Edit': return input.file_path || ''
    case 'Read': return input.file_path || ''
    default: return ''
  }
}
