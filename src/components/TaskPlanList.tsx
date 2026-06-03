import { useState, useMemo } from 'react'
import { TaskItem } from '../types/project'

const STATUS_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  todo:        { label: '待处理', icon: '⚪', color: '#9e9e9e', bg: '#2a2a2a' },
  in_progress: { label: '进行中', icon: '🔵', color: '#ff9800', bg: '#2a1f00' },
  done:        { label: '已完成', icon: '✅', color: '#4caf50', bg: '#0a1f0a' },
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: string }> = {
  task:      { label: '任务', icon: '📋' },
  approval:  { label: '审批', icon: '🔔' },
  tool:      { label: '工具', icon: '🔧' },
}

export function TaskPlanList({
  tasks,
  activeProject,
  onTasksChange,
  newTaskIds,
  onClearNew,
}: {
  tasks: TaskItem[]
  activeProject: { path: string; name: string } | null
  onTasksChange: (tasks: TaskItem[]) => void
  newTaskIds?: Set<string>
  onClearNew?: (id: string) => void
}) {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('task')
  const [searchText, setSearchText] = useState('')
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt' | 'title'>('updatedAt')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filteredTasks = useMemo(() => {
    let result = activeProject
      ? tasks.filter(t => !t.projectPath || t.projectPath === activeProject.path)
      : tasks

    if (statusFilter !== 'all') {
      result = result.filter(t => t.status === statusFilter)
    }
    if (categoryFilter !== 'all') {
      result = result.filter(t => (t.category || 'task') === categoryFilter)
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
      )
    }

    result = [...result].sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title)
      if (sortBy === 'createdAt') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

    return result
  }, [tasks, activeProject, statusFilter, categoryFilter, searchText, sortBy])

  function addTask() {
    const title = prompt('任务标题:')
    if (!title) return
    const newTask: TaskItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title,
      description: '',
      status: 'todo',
      category: 'task',
      projectPath: activeProject?.path,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    onTasksChange([...tasks, newTask])
  }

  function updateStatus(id: string, status: TaskItem['status']) {
    onTasksChange(tasks.map(t => (t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t)))
  }

  function updateCategory(id: string, category: TaskItem['category']) {
    onTasksChange(tasks.map(t => (t.id === id ? { ...t, category, updatedAt: new Date().toISOString() } : t)))
  }

  function deleteTask(id: string) {
    if (!confirm('删除这个任务？')) return
    onTasksChange(tasks.filter(t => t.id !== id))
  }

  // Stats
  const todoCount = filteredTasks.filter(t => t.status === 'todo').length
  const inProgressCount = filteredTasks.filter(t => t.status === 'in_progress').length
  const doneCount = filteredTasks.filter(t => t.status === 'done').length
  const totalCount = filteredTasks.length

  return (
    <div className="task-plan-list">
      {/* Header */}
      <div className="task-plan-header">
        <span className="task-plan-title">
          📋 任务计划
          {totalCount > 0 && <span className="task-plan-total">{totalCount}</span>}
        </span>
        <button onClick={addTask} className="icon-btn" title="新建任务">+</button>
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="task-plan-progress">
          <div className="task-plan-progress-bar">
            <div className="task-plan-progress-fill todo" style={{ flex: todoCount }} title={`待处理 ${todoCount}`} />
            <div className="task-plan-progress-fill in_progress" style={{ flex: inProgressCount }} title={`进行中 ${inProgressCount}`} />
            <div className="task-plan-progress-fill done" style={{ flex: doneCount }} title={`已完成 ${doneCount}`} />
          </div>
          <div className="task-plan-progress-labels">
            <span>⚪ {todoCount} 待处理</span>
            <span>🔵 {inProgressCount} 进行中</span>
            <span>✅ {doneCount} 已完成</span>
          </div>
          {totalCount > 0 && (
            <div className="task-plan-progress-pct">
              {Math.round((doneCount / totalCount) * 100)}% 完成
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="task-plan-filters">
        <input
          className="task-plan-search"
          type="text"
          placeholder="🔍 搜索任务..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
        />
        <select className="task-plan-filter" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">全部状态</option>
          <option value="todo">⚪ 待处理</option>
          <option value="in_progress">🔵 进行中</option>
          <option value="done">✅ 已完成</option>
        </select>
        <select className="task-plan-filter" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="all">全部分类</option>
          <option value="task">📋 任务</option>
          <option value="approval">🔔 审批</option>
          <option value="tool">🔧 工具</option>
        </select>
        <select className="task-plan-filter" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
          <option value="updatedAt">最近更新</option>
          <option value="createdAt">最近创建</option>
          <option value="title">按标题</option>
        </select>
      </div>

      {/* Task list */}
      <div className="task-plan-items">
        {filteredTasks.length === 0 ? (
          <div className="task-plan-empty">
            {searchText || statusFilter !== 'all' || categoryFilter !== 'all'
              ? '没有匹配的计划任务'
              : '暂无计划任务 — 点击右上角 + 创建第一个任务\n（当前仅显示"任务"分类，切换筛选可查看工具/审批）'}
          </div>
        ) : (
          filteredTasks.map(task => {
            const status = STATUS_CONFIG[task.status] || STATUS_CONFIG.todo
            const category = CATEGORY_CONFIG[task.category || 'task'] || CATEGORY_CONFIG.task
            const isExpanded = expandedId === task.id
            const isNew = newTaskIds?.has(task.id)

            return (
              <div
                key={task.id}
                className={`task-plan-item ${isExpanded ? 'expanded' : ''} ${isNew ? 'new' : ''}`}
                onClick={() => {
                  onClearNew?.(task.id)
                  setExpandedId(isExpanded ? null : task.id)
                }}
              >
                <div className="task-plan-item-row">
                  {/* Status badge */}
                  <span className="task-plan-status" style={{ color: status.color, background: status.bg }} title={status.label}>
                    {status.icon}
                  </span>

                  {/* New badge */}
                  {isNew && <span className="task-plan-badge-new">🆕</span>}

                  {/* Title */}
                  <span className="task-plan-item-title">{task.title}</span>

                  {/* Category */}
                  <span className="task-plan-category" title={category.label}>
                    {category.icon}
                  </span>

                  {/* Time */}
                  <span className="task-plan-time">
                    {formatTimeAgo(new Date(task.updatedAt))}
                  </span>

                  {/* Quick actions */}
                  <div className="task-plan-actions" onClick={e => e.stopPropagation()}>
                    {task.status !== 'in_progress' && task.status !== 'done' && (
                      <button
                        className="task-plan-act-btn start"
                        title="开始处理"
                        onClick={() => updateStatus(task.id, 'in_progress')}
                      >▶</button>
                    )}
                    {task.status !== 'done' && (
                      <button
                        className="task-plan-act-btn done"
                        title="标记完成"
                        onClick={() => updateStatus(task.id, 'done')}
                      >✓</button>
                    )}
                    {task.status === 'done' && (
                      <button
                        className="task-plan-act-btn reopen"
                        title="重新打开"
                        onClick={() => updateStatus(task.id, 'todo')}
                      >↩</button>
                    )}
                    <button
                      className="task-plan-act-btn del"
                      title="删除"
                      onClick={() => deleteTask(task.id)}
                    >✕</button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="task-plan-detail">
                    {task.description && (
                      <div className="task-plan-desc">{task.description}</div>
                    )}
                    <div className="task-plan-meta">
                      <span>状态：
                        <select
                          value={task.status}
                          onChange={e => updateStatus(task.id, e.target.value as TaskItem['status'])}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="todo">待处理</option>
                          <option value="in_progress">进行中</option>
                          <option value="done">已完成</option>
                        </select>
                      </span>
                      <span>分类：
                        <select
                          value={task.category || 'task'}
                          onChange={e => updateCategory(task.id, e.target.value as TaskItem['category'])}
                          onClick={e => e.stopPropagation()}
                        >
                          <option value="task">📋 任务</option>
                          <option value="approval">🔔 审批</option>
                          <option value="tool">🔧 工具</option>
                        </select>
                      </span>
                      <span>创建：{new Date(task.createdAt).toLocaleString('zh-CN')}</span>
                      <span>更新：{new Date(task.updatedAt).toLocaleString('zh-CN')}</span>
                      {task.agentType && <span>智能体：🤖 {task.agentType}</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}天前`
  return new Date(date).toLocaleDateString('zh-CN')
}
