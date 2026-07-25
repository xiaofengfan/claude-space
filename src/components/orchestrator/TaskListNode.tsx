/**
 * 任务列表节点
 *
 * 紧凑列表视图，按拓扑序排列
 * 显示节点类型图标 + 标题 + 状态徽章
 * 支持点击选中
 */

import { useMemo } from 'react';
import type { Task, TaskStatus } from './types';
import {
  KIND_ICON,
  KIND_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from './types';

interface Props {
  tasks: Task[];
  selectedTaskId?: string;
  onSelectTask?: (taskId: string) => void;
}

export function TaskListNode({ tasks, selectedTaskId, onSelectTask }: Props) {
  // ── 按拓扑序排序（deps 在前）────────────────────────
  const sortedTasks = useMemo(() => {
    if (tasks.length === 0) return [];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const sorted: Task[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function visit(id: string) {
      if (visited.has(id)) return;
      if (visiting.has(id)) return; // 环保护
      visiting.add(id);
      const task = taskMap.get(id);
      if (task) {
        task.deps.forEach((d) => visit(d));
        visited.add(id);
        sorted.push(task);
      }
      visiting.delete(id);
    }

    tasks.forEach((t) => visit(t.id));
    return sorted;
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="orch-task-list orch-empty">
        <div className="orch-hint">尚无任务</div>
      </div>
    );
  }

  return (
    <div className="orch-task-list">
      <div className="orch-task-list-header">
        <span>任务节点 ({tasks.length})</span>
      </div>
      <div className="orch-task-list-body">
        {sortedTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={selectedTaskId === task.id}
            onSelect={onSelectTask}
          />
        ))}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  selected,
  onSelect,
}: {
  task: Task;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const statusColor = STATUS_COLOR[task.status];
  const isRunning = task.status === 'running';
  const isFailed = task.status === 'failed';

  return (
    <div
      className={`orch-task-row${selected ? ' selected' : ''}${isRunning ? ' running' : ''}${isFailed ? ' failed' : ''}`}
      onClick={() => onSelect?.(task.id)}
      title={`${task.title} (${KIND_LABEL[task.kind]})`}
    >
      <span className="orch-task-row-icon">{KIND_ICON[task.kind]}</span>
      <div className="orch-task-row-content">
        <div className="orch-task-row-title">{task.title}</div>
        <div className="orch-task-row-sub">
          <span className="orch-task-row-id">{task.id}</span>
          {task.kind === 'phase' && task.attempts > 0 && (
            <span className="orch-task-row-attempts">
              ↻ {task.attempts}{task.maxAttempts ? `/${task.maxAttempts}` : ''}
            </span>
          )}
        </div>
      </div>
      <span
        className="orch-task-row-status"
        style={{ color: statusColor }}
        title={STATUS_LABEL[task.status]}
      >
        ●
      </span>
    </div>
  );
}
