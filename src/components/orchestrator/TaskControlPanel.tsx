/**
 * 任务控制面板
 *
 * 显示编排状态 + 控制按钮（启动/暂停/恢复/停止）
 * 显示当前选中任务的人工审批按钮（approve/reject/takeover）
 */

import { useMemo } from 'react';
import type {
  Orchestration,
  OrchestrationStatus,
  Task,
} from './types';
import {
  ORCH_STATUS_COLOR,
  ORCH_STATUS_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  KIND_ICON,
  KIND_LABEL,
} from './types';

interface Props {
  orchestration: Orchestration | null;
  tasks: Task[];
  selectedTaskId?: string;
  /** 启动编排 */
  onStart: () => void;
  /** 暂停编排 */
  onPause: () => void;
  /** 恢复编排 */
  onResume: () => void;
  /** 停止编排 */
  onStop: () => void;
  /** 审批通过 */
  onApprove: (taskId: string) => void;
  /** 审批拒绝 */
  onReject: (taskId: string) => void;
  /** 接管（手动处理） */
  onTakeover: (taskId: string) => void;
  /** 是否正在执行操作 */
  acting?: boolean;
}

export function TaskControlPanel({
  orchestration,
  tasks,
  selectedTaskId,
  onStart,
  onPause,
  onResume,
  onStop,
  onApprove,
  onReject,
  onTakeover,
  acting,
}: Props) {
  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId],
  );

  // 当前需要审批的任务列表（status=running 且 kind=human-gate）
  const pendingApprovals = useMemo(
    () => tasks.filter((t) => t.kind === 'human-gate' && t.status === 'running'),
    [tasks],
  );

  if (!orchestration) {
    return (
      <div className="orch-control-panel orch-empty">
        <div className="orch-hint">尚未创建编排</div>
      </div>
    );
  }

  const status: OrchestrationStatus = orchestration.status;
  const canStart = status === 'pending';
  const canPause = status === 'running';
  const canResume = status === 'paused';
  const canStop = status === 'running' || status === 'paused';

  return (
    <div className="orch-control-panel">
      {/* ── 编排状态卡 ───────────────────────────── */}
      <div className="orch-control-card">
        <div className="orch-control-card-row">
          <span className="orch-control-label">编排状态</span>
          <span
            className="orch-control-status"
            style={{ color: ORCH_STATUS_COLOR[status] }}
          >
            ● {ORCH_STATUS_LABEL[status]}
          </span>
        </div>
        <div className="orch-control-card-row">
          <span className="orch-control-label">目标</span>
          <span className="orch-control-value">{orchestration.goal}</span>
        </div>
        <div className="orch-control-card-row">
          <span className="orch-control-label">模板</span>
          <span className="orch-control-value">{orchestration.templateId}</span>
        </div>
        <div className="orch-control-card-row">
          <span className="orch-control-label">自动审批</span>
          <span className="orch-control-value">
            {orchestration.autoApprove ? '✅ 是' : '⛔ 否'}
          </span>
        </div>
        {orchestration.testCommand && (
          <div className="orch-control-card-row">
            <span className="orch-control-label">测试命令</span>
            <code className="orch-control-code">{orchestration.testCommand}</code>
          </div>
        )}
      </div>

      {/* ── 编排控制按钮 ─────────────────────────── */}
      <div className="orch-control-actions">
        {canStart && (
          <button
            className="orch-btn orch-btn-primary"
            onClick={onStart}
            disabled={acting}
            type="button"
          >
            ▶ 启动
          </button>
        )}
        {canPause && (
          <button
            className="orch-btn orch-btn-warn"
            onClick={onPause}
            disabled={acting}
            type="button"
          >
            ⏸ 暂停
          </button>
        )}
        {canResume && (
          <button
            className="orch-btn orch-btn-primary"
            onClick={onResume}
            disabled={acting}
            type="button"
          >
            ⏵ 恢复
          </button>
        )}
        {canStop && (
          <button
            className="orch-btn orch-btn-danger"
            onClick={onStop}
            disabled={acting}
            type="button"
          >
            ⏹ 停止
          </button>
        )}
      </div>

      {/* ── 待审批任务 ─────────────────────────── */}
      {pendingApprovals.length > 0 && (
        <div className="orch-control-section">
          <div className="orch-control-section-title">
            ✋ 待人工审批 ({pendingApprovals.length})
          </div>
          {pendingApprovals.map((task) => (
            <div key={task.id} className="orch-approval-item">
              <div className="orch-approval-item-header">
                <span className="orch-approval-item-icon">
                  {KIND_ICON['human-gate']}
                </span>
                <span className="orch-approval-item-title">{task.title}</span>
              </div>
              {task.approvalPrompt && (
                <div className="orch-approval-item-prompt">
                  {task.approvalPrompt}
                </div>
              )}
              <div className="orch-approval-item-actions">
                <button
                  className="orch-btn orch-btn-sm orch-btn-primary"
                  onClick={() => onApprove(task.id)}
                  disabled={acting}
                  type="button"
                >
                  ✓ 通过
                </button>
                <button
                  className="orch-btn orch-btn-sm orch-btn-danger"
                  onClick={() => onReject(task.id)}
                  disabled={acting}
                  type="button"
                >
                  ✕ 拒绝
                </button>
                <button
                  className="orch-btn orch-btn-sm"
                  onClick={() => onTakeover(task.id)}
                  disabled={acting}
                  type="button"
                  title="手动接管，停止自动编排"
                >
                  👤 接管
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 选中任务信息 ─────────────────────────── */}
      {selectedTask && (
        <div className="orch-control-section">
          <div className="orch-control-section-title">当前选中</div>
          <div className="orch-control-card">
            <div className="orch-control-card-row">
              <span className="orch-control-label">节点</span>
              <span className="orch-control-value">
                {KIND_ICON[selectedTask.kind]} {selectedTask.title}
              </span>
            </div>
            <div className="orch-control-card-row">
              <span className="orch-control-label">类型</span>
              <span className="orch-control-value">
                {KIND_LABEL[selectedTask.kind]}
              </span>
            </div>
            <div className="orch-control-card-row">
              <span className="orch-control-label">状态</span>
              <span
                className="orch-control-status"
                style={{ color: STATUS_COLOR[selectedTask.status] }}
              >
                ● {STATUS_LABEL[selectedTask.status]}
              </span>
            </div>
            {selectedTask.kind === 'phase' && selectedTask.maxAttempts && (
              <div className="orch-control-card-row">
                <span className="orch-control-label">重试</span>
                <span className="orch-control-value">
                  {selectedTask.attempts} / {selectedTask.maxAttempts}
                </span>
              </div>
            )}
            {selectedTask.worktreeBranch && (
              <div className="orch-control-card-row">
                <span className="orch-control-label">分支</span>
                <code className="orch-control-code">
                  {selectedTask.worktreeBranch}
                </code>
              </div>
            )}
            {selectedTask.lastError && (
              <div className="orch-control-card-row orch-control-card-error">
                <span className="orch-control-label">错误</span>
                <span className="orch-control-value">
                  {selectedTask.lastError}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
