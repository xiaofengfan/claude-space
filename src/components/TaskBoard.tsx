import { TaskItem } from '../types/project'

export function TaskBoard({
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
  const filteredTasks = activeProject
    ? tasks.filter(t => !t.projectPath || t.projectPath === activeProject.path)
    : tasks

  const todoTasks = filteredTasks.filter(t => t.status === 'todo')
  const inProgressTasks = filteredTasks.filter(t => t.status === 'in_progress')
  const doneTasks = filteredTasks.filter(t => t.status === 'done')

  function addTask() {
    const title = prompt('任务标题:')
    if (!title) return
    const newTask: TaskItem = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title,
      description: '',
      status: 'todo',
      projectPath: activeProject?.path,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    onTasksChange([...tasks, newTask])
  }

  function updateStatus(id: string, status: TaskItem['status']) {
    onTasksChange(tasks.map(t => (t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t)))
  }

  function deleteTask(id: string) {
    if (!confirm('删除这个任务？')) return
    onTasksChange(tasks.filter(t => t.id !== id))
  }

  return (
    <div className="task-board">
      <div className="task-board-header">
        <span>📋 任务 {newTaskIds?.size ? <span className="task-badge-new">🆕 {newTaskIds.size}</span> : ''}</span>
        <button onClick={addTask} className="icon-btn" title="新建任务">+</button>
      </div>

      <div className="task-columns">
        <TaskColumn title="待处理" color="#e3f2fd" tasks={todoTasks} onUpdate={updateStatus} onDelete={deleteTask} newTaskIds={newTaskIds} onClearNew={onClearNew} />
        <TaskColumn title="进行中" color="#fff3e0" tasks={inProgressTasks} onUpdate={updateStatus} onDelete={deleteTask} newTaskIds={newTaskIds} onClearNew={onClearNew} />
        <TaskColumn title="已完成" color="#e6f7e6" tasks={doneTasks} onUpdate={updateStatus} onDelete={deleteTask} newTaskIds={newTaskIds} onClearNew={onClearNew} />
      </div>
    </div>
  )
}

function TaskColumn({
  title,
  color,
  tasks,
  onUpdate,
  onDelete,
  newTaskIds,
  onClearNew,
}: {
  title: string
  color: string
  tasks: TaskItem[]
  onUpdate: (id: string, status: TaskItem['status']) => void
  onDelete: (id: string) => void
  newTaskIds?: Set<string>
  onClearNew?: (id: string) => void
}) {
  const statusMap: Record<string, TaskItem['status']> = {
    '待处理': 'todo',
    '进行中': 'in_progress',
    '已完成': 'done',
  }
  const nextStatus = statusMap[title]

  return (
    <div className="task-column" style={{ borderTopColor: color }}>
      <div className="task-column-title">
        {title} <span className="task-count">{tasks.length}</span>
      </div>
      <div className="task-column-items">
        {tasks.map(task => (
          <div key={task.id} className="task-card" onClick={() => onClearNew?.(task.id)}>
            <div className="task-card-title">
              {newTaskIds?.has(task.id) && <span className="badge-new">🆕</span>}
              {task.title}
            </div>
            <div className="task-card-actions">
              {nextStatus && nextStatus !== task.status && (
                <button onClick={() => onUpdate(task.id, nextStatus)} className="task-btn">
                  {nextStatus === 'in_progress' ? '▶' : '✓'}
                </button>
              )}
              <button onClick={() => onDelete(task.id)} className="task-btn task-btn-del">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
