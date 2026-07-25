/**
 * 任务详情面板
 *
 * 显示选中任务的：
 * - 基本信息（id/title/kind/status/phase/attempts）
 * - 输入/输出配置（可编辑，用于执行前手动调整）
 * - prompt 模板（phase 节点）
 * - worktree 路径和分支
 * - 运行历史（runs 列表，含 commitHash/outcome/error）
 * - 最后错误信息
 * - 实时日志
 */

import { useEffect, useState, useCallback } from 'react';
import type {
  Task,
  TaskDetailData,
  TaskIO,
  Run,
  IpcResponse,
} from './types';
import {
  KIND_ICON,
  KIND_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
} from './types';

interface Props {
  /** 选中任务的基础信息（来自 tasks 列表） */
  task: Task | null;
  /** 实时日志（按 taskId 索引） */
  logs: Record<string, string[]>;
  /** 当前项目路径（用于 updateTaskIO IPC） */
  repoPath?: string;
  /** 任务所属编排使用的模板 ID（用于显示模板来源） */
  templateId?: string;
  /** 模板显示名 */
  templateLabel?: string;
}

const IO_TYPE_OPTIONS: { value: TaskIO['type']; label: string; icon: string }[] = [
  { value: 'file', label: '文件', icon: '📄' },
  { value: 'dir', label: '目录', icon: '📁' },
  { value: 'doc', label: '文档', icon: '📑' },
  { value: 'var', label: '变量', icon: '🔹' },
];

const OUTCOME_LABEL: Record<NonNullable<Run['outcome']>, string> = {
  success: '成功',
  failure: '失败',
  'gate-fail': '门禁未通过',
  interrupted: '已中断',
};

const OUTCOME_COLOR: Record<NonNullable<Run['outcome']>, string> = {
  success: '#4ade80',
  failure: '#ef4444',
  'gate-fail': '#f59e0b',
  interrupted: '#a78bfa',
};

export function TaskDetailPanel({ task, logs, repoPath, templateId, templateLabel }: Props) {
  const [detail, setDetail] = useState<TaskDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // IO 编辑状态
  const [editInputs, setEditInputs] = useState<TaskIO[]>([]);
  const [editOutputs, setEditOutputs] = useState<TaskIO[]>([]);
  const [ioDirty, setIoDirty] = useState(false);
  const [savingIO, setSavingIO] = useState(false);
  const [ioSaved, setIoSaved] = useState(false);

  // 拉取任务详情（含 runs）
  useEffect(() => {
    if (!task) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res: IpcResponse<TaskDetailData> = await window.orchestrator.taskDetail(task.id);
        if (cancelled) return;
        if (res.ok && res.data) {
          setDetail(res.data);
        } else {
          setError(res.error?.message || '加载详情失败');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'orchestrator API 不可用');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [task?.id, task?.updatedAt]); // 任务更新时重新拉取

  // 同步 task 的 IO 到编辑状态
  useEffect(() => {
    setEditInputs(task?.inputs ? [...task.inputs] : []);
    setEditOutputs(task?.outputs ? [...task.outputs] : []);
    setIoDirty(false);
    setIoSaved(false);
  }, [task?.id]);

  const canEditIO = task && (task.status === 'pending' || task.status === 'ready' || task.status === 'blocked');

  const updateInputItem = (idx: number, patch: Partial<TaskIO>) => {
    setEditInputs(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
    setIoDirty(true);
    setIoSaved(false);
  };
  const updateOutputItem = (idx: number, patch: Partial<TaskIO>) => {
    setEditOutputs(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
    setIoDirty(true);
    setIoSaved(false);
  };
  const addInputItem = () => {
    setEditInputs(prev => [...prev, { name: '', type: 'file', path: '', required: true }]);
    setIoDirty(true);
    setIoSaved(false);
  };
  const addOutputItem = () => {
    setEditOutputs(prev => [...prev, { name: '', type: 'file', path: '', required: false }]);
    setIoDirty(true);
    setIoSaved(false);
  };
  const removeInputItem = (idx: number) => {
    setEditInputs(prev => prev.filter((_, i) => i !== idx));
    setIoDirty(true);
    setIoSaved(false);
  };
  const removeOutputItem = (idx: number) => {
    setEditOutputs(prev => prev.filter((_, i) => i !== idx));
    setIoDirty(true);
    setIoSaved(false);
  };

  const saveIO = useCallback(async () => {
    if (!task) return;
    setSavingIO(true);
    try {
      const res = await window.orchestrator.updateTaskIO({
        taskId: task.id,
        inputs: editInputs,
        outputs: editOutputs,
        repoPath,
      });
      if (res.ok) {
        setIoDirty(false);
        setIoSaved(true);
      } else {
        alert('保存失败: ' + (res.error?.message || '未知错误'));
      }
    } catch (e: any) {
      alert('保存失败: ' + (e?.message || e));
    } finally {
      setSavingIO(false);
    }
  }, [task, editInputs, editOutputs, repoPath]);

  if (!task) {
    return (
      <div className="orch-detail-panel orch-empty">
        <div className="orch-hint">点击流程图节点查看详情</div>
      </div>
    );
  }

  const taskLogs = logs[task.id] || [];

  return (
    <div className="orch-detail-panel">
      <div className="orch-detail-header">
        <span className="orch-detail-icon">{KIND_ICON[task.kind]}</span>
        <div className="orch-detail-title-block">
          <div className="orch-detail-title">{task.title}</div>
          <div className="orch-detail-subtitle">
            {task.id} · {KIND_LABEL[task.kind]}
          </div>
        </div>
        <span
          className="orch-detail-status"
          style={{ color: STATUS_COLOR[task.status] }}
        >
          ● {STATUS_LABEL[task.status]}
        </span>
      </div>

      {/* ── 基本信息卡 ───────────────────────────── */}
      <div className="orch-detail-section">
        <div className="orch-detail-section-title">基本信息</div>
        <div className="orch-detail-grid">
          {templateId && (
            <div className="orch-detail-field orch-detail-field-full">
              <span className="orch-detail-field-label">模板来源</span>
              <span className="orch-detail-field-value">
                <span className="orch-tpl-badge">{templateLabel || templateId}</span>
                <code className="orch-detail-code" style={{ marginLeft: 6, fontSize: 10 }}>{templateId}</code>
              </span>
            </div>
          )}
          <div className="orch-detail-field">
            <span className="orch-detail-field-label">阶段</span>
            <span className="orch-detail-field-value">{task.phase || '-'}</span>
          </div>
          {task.model && (
            <div className="orch-detail-field">
              <span className="orch-detail-field-label">模型</span>
              <span className="orch-detail-field-value">
                <code className="orch-detail-code">{task.model}</code>
              </span>
            </div>
          )}
          {task.kind === 'phase' && task.maxAttempts && (
            <div className="orch-detail-field">
              <span className="orch-detail-field-label">重试次数</span>
              <span className="orch-detail-field-value">
                {task.attempts} / {task.maxAttempts}
              </span>
            </div>
          )}
          {task.timeoutMs && (
            <div className="orch-detail-field">
              <span className="orch-detail-field-label">超时</span>
              <span className="orch-detail-field-value">
                {(task.timeoutMs / 60000).toFixed(0)} 分钟
              </span>
            </div>
          )}
          {task.fallbackTo && (
            <div className="orch-detail-field">
              <span className="orch-detail-field-label">失败回退</span>
              <span className="orch-detail-field-value">
                → {task.fallbackTo}
              </span>
            </div>
          )}
          {task.deps.length > 0 && (
            <div className="orch-detail-field">
              <span className="orch-detail-field-label">依赖</span>
              <span className="orch-detail-field-value">
                {task.deps.join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Worktree 信息 ────────────────────────── */}
      {task.worktreePath && (
        <div className="orch-detail-section">
          <div className="orch-detail-section-title">Git Worktree</div>
          <div className="orch-detail-grid">
            <div className="orch-detail-field orch-detail-field-full">
              <span className="orch-detail-field-label">路径</span>
              <code className="orch-detail-code">{task.worktreePath}</code>
            </div>
            {task.worktreeBranch && (
              <div className="orch-detail-field orch-detail-field-full">
                <span className="orch-detail-field-label">分支</span>
                <code className="orch-detail-code">{task.worktreeBranch}</code>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 输入/输出配置（可编辑）────────────────── */}
      <div className="orch-detail-section">
        <div className="orch-detail-section-title">
          📥 输入 / 📤 输出配置
          {canEditIO ? (
            <span className="orch-io-edit-hint">（可编辑）</span>
          ) : (
            <span className="orch-io-edit-hint orch-io-readonly">（只读 · {STATUS_LABEL[task.status]}）</span>
          )}
        </div>

        {/* 输入列表 */}
        <div className="orch-io-block">
          <div className="orch-io-block-label">📥 输入</div>
          {editInputs.length === 0 && <span className="orch-hint">无输入配置</span>}
          {editInputs.map((item, idx) => (
            <div key={idx} className="orch-io-edit-row">
              <select
                value={item.type}
                onChange={e => updateInputItem(idx, { type: e.target.value as TaskIO['type'] })}
                disabled={!canEditIO}
                className="orch-io-select"
              >
                {IO_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
              </select>
              <input
                type="text" placeholder="名称" value={item.name}
                onChange={e => updateInputItem(idx, { name: e.target.value })}
                disabled={!canEditIO}
                className="orch-io-input orch-io-input-name"
              />
              <input
                type="text" placeholder="路径/变量值" value={item.path || ''}
                onChange={e => updateInputItem(idx, { path: e.target.value })}
                disabled={!canEditIO}
                className="orch-io-input orch-io-input-path"
              />
              <label className="orch-io-required">
                <input
                  type="checkbox" checked={item.required || false}
                  onChange={e => updateInputItem(idx, { required: e.target.checked })}
                  disabled={!canEditIO}
                />
                必填
              </label>
              {canEditIO && (
                <button className="orch-io-remove" onClick={() => removeInputItem(idx)} type="button">✕</button>
              )}
            </div>
          ))}
          {canEditIO && (
            <button className="orch-io-add" onClick={addInputItem} type="button">➕ 添加输入</button>
          )}
        </div>

        {/* 输出列表 */}
        <div className="orch-io-block">
          <div className="orch-io-block-label">📤 输出</div>
          {editOutputs.length === 0 && <span className="orch-hint">无输出配置</span>}
          {editOutputs.map((item, idx) => (
            <div key={idx} className="orch-io-edit-row">
              <select
                value={item.type}
                onChange={e => updateOutputItem(idx, { type: e.target.value as TaskIO['type'] })}
                disabled={!canEditIO}
                className="orch-io-select"
              >
                {IO_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
              </select>
              <input
                type="text" placeholder="名称" value={item.name}
                onChange={e => updateOutputItem(idx, { name: e.target.value })}
                disabled={!canEditIO}
                className="orch-io-input orch-io-input-name"
              />
              <input
                type="text" placeholder="产物路径" value={item.path || ''}
                onChange={e => updateOutputItem(idx, { path: e.target.value })}
                disabled={!canEditIO}
                className="orch-io-input orch-io-input-path"
              />
              <label className="orch-io-required">
                <input
                  type="checkbox" checked={item.required || false}
                  onChange={e => updateOutputItem(idx, { required: e.target.checked })}
                  disabled={!canEditIO}
                />
                必填
              </label>
              {canEditIO && (
                <button className="orch-io-remove" onClick={() => removeOutputItem(idx)} type="button">✕</button>
              )}
            </div>
          ))}
          {canEditIO && (
            <button className="orch-io-add" onClick={addOutputItem} type="button">➕ 添加输出</button>
          )}
        </div>

        {/* 保存按钮 */}
        {canEditIO && ioDirty && (
          <div className="orch-io-save-bar">
            <button
              className="orch-io-save-btn"
              onClick={saveIO}
              disabled={savingIO}
              type="button"
            >
              {savingIO ? '保存中…' : ioSaved ? '✓ 已保存' : '💾 保存 IO 配置'}
            </button>
            {ioSaved && <span className="orch-io-saved-hint">配置已保存，执行时将使用此配置</span>}
          </div>
        )}
      </div>

      {/* ── Prompt（phase 节点，继承自模板）───────── */}
      {task.kind === 'phase' && task.prompt && (
        <div className="orch-detail-section">
          <div className="orch-detail-section-title">
            AI Prompt 模板
            <span className="orch-io-edit-hint">（继承自模板{templateId ? ` · ${templateId}` : ''}）</span>
          </div>
          <pre className="orch-detail-pre">{task.prompt}</pre>
        </div>
      )}

      {/* ── 审批提示（human-gate 节点）────────────── */}
      {task.kind === 'human-gate' && task.approvalPrompt && (
        <div className="orch-detail-section">
          <div className="orch-detail-section-title">审批提示</div>
          <div className="orch-detail-approval-prompt">
            {task.approvalPrompt}
          </div>
        </div>
      )}

      {/* ── 错误信息 ───────────────────────────── */}
      {task.lastError && (
        <div className="orch-detail-section">
          <div className="orch-detail-section-title">最后错误</div>
          <pre className="orch-detail-pre orch-detail-error">
            {task.lastError}
          </pre>
        </div>
      )}

      {/* ── 运行历史 ────────────────────────────── */}
      <div className="orch-detail-section">
        <div className="orch-detail-section-title">
          运行历史
          {loading && <span className="orch-detail-loading"> 加载中...</span>}
          {error && <span className="orch-detail-error-text"> ⚠️ {error}</span>}
        </div>
        {detail && detail.runs && detail.runs.length > 0 ? (
          <div className="orch-detail-runs">
            {detail.runs
              .slice()
              .sort((a, b) => b.attempt - a.attempt)
              .map((run) => (
                <div key={run.id} className="orch-detail-run">
                  <div className="orch-detail-run-row">
                    <span className="orch-detail-run-label">
                      尝试 #{run.attempt}
                    </span>
                    {run.outcome && (
                      <span
                        className="orch-detail-run-outcome"
                        style={{ color: OUTCOME_COLOR[run.outcome] }}
                      >
                        ● {OUTCOME_LABEL[run.outcome]}
                      </span>
                    )}
                    {run.commitHash && (
                      <code className="orch-detail-run-commit">
                        {run.commitHash.slice(0, 7)}
                      </code>
                    )}
                  </div>
                  <div className="orch-detail-run-time">
                    {new Date(run.startedAt).toLocaleString('zh-CN')}
                    {run.finishedAt && ` → ${new Date(run.finishedAt).toLocaleString('zh-CN')}`}
                  </div>
                  {run.error && (
                    <pre className="orch-detail-pre orch-detail-error orch-detail-run-error">
                      {run.error}
                    </pre>
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="orch-hint">暂无运行记录</div>
        )}
      </div>

      {/* ── 实时日志 ────────────────────────────── */}
      {taskLogs.length > 0 && (
        <div className="orch-detail-section">
          <div className="orch-detail-section-title">实时日志</div>
          <pre className="orch-detail-pre orch-detail-logs">
            {taskLogs.join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}
