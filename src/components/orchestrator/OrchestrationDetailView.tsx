/**
 * 编排执行详情（主操作区 tab 内容）
 *
 * 显示单个编排的执行状态：Stepper + Metrics + 子 Tab（概览/流程图/任务/日志）
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  Orchestration, OrchestrationStatusData, Task, IpcResponse, EventPayload,
} from './types';
import { DagGraph } from './DagGraph';
import { TaskControlPanel } from './TaskControlPanel';
import { TaskDetailPanel } from './TaskDetailPanel';
import { TaskListNode } from './TaskListNode';

type SubTab = 'overview' | 'graph' | 'tasks' | 'logs';

const PHASE_STEPS = ['INGEST', 'COMPREHEND', 'ANALYZE', 'UNDERSTAND', 'ARCHITECT', 'DECOMPOSE', 'PLAN', 'EXECUTE', 'INTEGRATE', 'DONE'];
const PHASE_STEP_LABEL: Record<string, string> = {
  INGEST: '接入', COMPREHEND: '解读', ANALYZE: '分析', UNDERSTAND: '理解',
  ARCHITECT: '架构', DECOMPOSE: '拆分', PLAN: '计划', EXECUTE: '执行',
  INTEGRATE: '整合', DEPLOY: '部署', DONE: '完成',
};
const TEMPLATE_LABEL: Record<string, string> = {
  greenfield: '🌱 全新项目', refactor: '♻️ 项目重构', migration: '🚚 技术栈迁移',
  upgrade: '⬆️ 小型升级', hotfix: '🚑 紧急修复',
  'greenfield-adv': '🌱 全新项目·高级', 'refactor-adv': '♻️ 项目重构·高级',
  'migration-adv': '🚚 技术栈迁移·高级', 'upgrade-adv': '⬆️ 小型升级·高级',
  'hotfix-adv': '🚑 紧急修复·高级',
};
const STATUS_LABEL: Record<string, string> = {
  pending: '⚪ 待启动', running: '🟢 执行中', paused: '🟡 已暂停',
  success: '✅ 成功', failed: '🔴 失败', interrupted: '⚫ 已中断',
};
const ORCH_STATUS_COLOR: Record<string, string> = {
  pending: '#888', running: '#6c8cff', paused: '#f59e0b',
  success: '#4ade80', failed: '#ef4444', interrupted: '#666',
};
const ORCH_STATUS_LABEL: Record<string, string> = STATUS_LABEL;

function phaseToStepIndex(phase?: string): number {
  if (!phase) return 0;
  const idx = PHASE_STEPS.indexOf(phase);
  return idx >= 0 ? idx : 0;
}
function fmtTime(sec: number): string {
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm' + (sec % 60) + 's';
  return Math.floor(sec / 3600) + 'h' + Math.floor((sec % 3600) / 60) + 'm';
}

interface Props {
  orchId: string;
  repoPath: string;
}

export function OrchestrationDetailView({ orchId, repoPath }: Props) {
  const [statusData, setStatusData] = useState<OrchestrationStatusData | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [subTab, setSubTab] = useState<SubTab>('tasks');
  const [acting, setActing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const [toast, setToast] = useState<{ type: 'error' | 'success' | 'info'; msg: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'error' | 'success' | 'info', msg: string) => {
    setToast({ type, msg });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res: IpcResponse<OrchestrationStatusData> = await window.orchestrator.status(orchId);
      if (res.ok && res.data) setStatusData(res.data);
    } catch {}
  }, [orchId]);

  useEffect(() => {
    loadStatus();
    const timer = setInterval(loadStatus, 3000);
    return () => clearInterval(timer);
  }, [orchId, loadStatus]);

  // 事件订阅
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const api = window.orchestrator;
    if (!api) return;
    try { unsubs.push(api.onStatusChange(() => loadStatus())); } catch {}
    try { unsubs.push(api.onTaskStarted(() => loadStatus())); } catch {}
    try { unsubs.push(api.onTaskCompleted(() => loadStatus())); } catch {}
    try {
      unsubs.push(api.onTaskLog((p) => {
        if (p.orchestrationId !== orchId) return;
        setLogs((prev) => ({ ...prev, [String(p.taskId)]: [...(prev[String(p.taskId)] || []), String(p.line || '')] }));
      }));
    } catch {}
    try { unsubs.push(api.onAwaitApproval(() => loadStatus())); } catch {}
    try {
      unsubs.push(api.onLog((p) => {
        if (p.orchestrationId !== orchId) return;
        const tid = String(p.taskId || '_global');
        setLogs((prev) => ({ ...prev, [tid]: [...(prev[tid] || []), String(p.line || '')] }));
      }));
    } catch {}
    return () => unsubs.forEach((u) => { try { u(); } catch {} });
  }, [orchId, loadStatus]);

  // 计时器
  useEffect(() => {
    if (!statusData || statusData.orchestration.status !== 'running') {
      startTimeRef.current = null;
      return;
    }
    if (!startTimeRef.current) startTimeRef.current = Date.now() - elapsed * 1000;
    const t = setInterval(() => {
      if (startTimeRef.current) setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [statusData?.orchestration.status]);

  const callAction = async (fn: () => Promise<IpcResponse>) => {
    setActing(true);
    try {
      const res = await fn();
      if (!res.ok) {
        showToast('error', res.error?.message || '操作失败');
      } else {
        await loadStatus();
        showToast('success', '操作成功');
      }
    } catch (e: any) {
      showToast('error', e?.message || '操作异常');
    } finally {
      setActing(false);
    }
  };

  const currentOrch = statusData?.orchestration;
  const currentTasks = statusData?.tasks || [];
  const selectedTask = currentTasks.find((t) => t.id === selectedTaskId) || null;

  // 自动选中第一个任务
  useEffect(() => {
    if (currentTasks.length > 0 && !selectedTaskId) {
      setSelectedTaskId(currentTasks[0].id);
    }
  }, [currentTasks, selectedTaskId]);
  const metrics = useMemo(() => {
    const total = currentTasks.length;
    const done = currentTasks.filter((t) => t.status === 'done').length;
    const failed = currentTasks.filter((t) => t.status === 'failed').length;
    const running = currentTasks.filter((t) => t.status === 'running').length;
    const pending = currentTasks.filter((t) => t.status === 'pending' || t.status === 'ready').length;
    const blocked = currentTasks.filter((t) => t.status === 'blocked').length;
    return { total, done, failed, running, pending, blocked, progress: total ? Math.round((done / total) * 100) : 0 };
  }, [currentTasks]);

  const runningTasks = currentTasks.filter((t) => t.status === 'running');
  const currentPhase = runningTasks[0]?.phase;
  const stepIdx = phaseToStepIndex(currentPhase);

  if (!currentOrch) {
    return <div className="orch-detail-loading">加载中…</div>;
  }

  return (
    <div className="orch-detail-view">
      {toast && (
        <div className={`orch-toast orch-toast-${toast.type}`}>
          {toast.type === 'error' ? '❌' : toast.type === 'success' ? '✅' : 'ℹ️'} {toast.msg}
        </div>
      )}
      {/* 顶部：目标 + 基本信息（横向布局）+ 控制按钮 */}
      <div className="orch-detail-header orch-detail-header-h">
        {/* 左侧：目标 + 基本信息 */}
        <div className="orch-detail-info-h">
          <div className="orch-detail-goal-h">
            <span className="orch-detail-goal-label">🎯</span>
            <span className="orch-detail-goal-text">{currentOrch.goal}</span>
          </div>
          <div className="orch-detail-meta-h">
            <span className="orch-tpl-badge orch-tpl-badge-inline">{TEMPLATE_LABEL[currentOrch.templateId] || currentOrch.templateId}</span>
            <span className="orch-detail-meta-item">
              <span className="orch-detail-meta-label">状态</span>
              <span style={{ color: ORCH_STATUS_COLOR[currentOrch.status] }}>● {ORCH_STATUS_LABEL[currentOrch.status]}</span>
            </span>
            <span className="orch-detail-meta-item">
              <span className="orch-detail-meta-label">进度</span>
              <span>{metrics.done}/{metrics.total}</span>
            </span>
            <span className="orch-detail-meta-item">
              <span className="orch-detail-meta-label">执行中</span>
              <span style={{ color: metrics.running > 0 ? '#6c8cff' : 'inherit' }}>{metrics.running}</span>
            </span>
            <span className="orch-detail-meta-item">
              <span className="orch-detail-meta-label">耗时</span>
              <span>{fmtTime(elapsed)}</span>
            </span>
          </div>
        </div>
        {/* 右侧：控制按钮 */}
        <div className="orch-detail-controls">
          <TaskControlPanel
            orchestration={currentOrch}
            tasks={currentTasks}
            selectedTaskId={selectedTaskId}
            onStart={() => callAction(() => window.orchestrator.start(orchId))}
            onPause={() => callAction(() => window.orchestrator.pause(orchId))}
            onResume={() => callAction(() => window.orchestrator.resume(orchId))}
            onStop={() => callAction(() => window.orchestrator.stop(orchId))}
            onApprove={(tid) => callAction(() => window.orchestrator.approve(orchId, tid))}
            onReject={(tid) => callAction(() => window.orchestrator.reject(orchId, tid))}
            onTakeover={(tid) => callAction(() => window.orchestrator.takeover(orchId, tid))}
            acting={acting}
          />
        </div>
      </div>

      {/* Stepper */}
      <div className="orch-stepper">
        {PHASE_STEPS.map((phase, idx) => {
          const isCurrent = idx === stepIdx;
          const isDone = idx < stepIdx;
          const isLast = idx === PHASE_STEPS.length - 1;
          return (
            <div key={phase} className={`orch-step ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}`}>
              <div className="orch-step-dot">{isDone ? '✓' : isCurrent ? '●' : idx + 1}</div>
              <div className="orch-step-label">{PHASE_STEP_LABEL[phase]}</div>
              {!isLast && <div className="orch-step-line" />}
            </div>
          );
        })}
      </div>

      {/* 子 Tab — 默认显示"任务"标签，让用户立即看到任务列表 */}
      <div className="orch-subtab-bar">
        <button className={`orch-subtab ${subTab === 'tasks' ? 'active' : ''}`} onClick={() => setSubTab('tasks')} type="button">📋 任务 ({currentTasks.length})</button>
        <button className={`orch-subtab ${subTab === 'overview' ? 'active' : ''}`} onClick={() => setSubTab('overview')} type="button">📊 概览</button>
        <button className={`orch-subtab ${subTab === 'graph' ? 'active' : ''}`} onClick={() => setSubTab('graph')} type="button">🕸️ 流程图</button>
        <button className={`orch-subtab ${subTab === 'logs' ? 'active' : ''}`} onClick={() => setSubTab('logs')} type="button">📝 日志</button>
      </div>

      <div className="orch-subtab-content">
        {subTab === 'tasks' && (
          <div className="orch-tasks-tab">
            <div className="orch-tasks-list"><TaskListNode tasks={currentTasks} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} /></div>
            <div className="orch-tasks-detail"><TaskDetailPanel task={selectedTask} logs={logs} repoPath={repoPath} templateId={currentOrch?.templateId} templateLabel={TEMPLATE_LABEL[currentOrch?.templateId || ''] || currentOrch?.templateId} /></div>
          </div>
        )}
        {subTab === 'overview' && (
          <div className="orch-overview-grid">
            <div className="orch-info-card">
              <h4>编排信息</h4>
              <div className="orch-info-row"><span className="orch-info-key">编排 ID</span><code className="orch-info-val">{currentOrch.id}</code></div>
              <div className="orch-info-row"><span className="orch-info-key">所用模板</span><span className="orch-info-val"><span className="orch-tpl-badge">{TEMPLATE_LABEL[currentOrch.templateId] || currentOrch.templateId}</span></span></div>
              <div className="orch-info-row"><span className="orch-info-key">模板 ID</span><code className="orch-info-val">{currentOrch.templateId}</code></div>
              <div className="orch-info-row"><span className="orch-info-key">状态</span><span className="orch-info-val">{ORCH_STATUS_LABEL[currentOrch.status]}</span></div>
              <div className="orch-info-row"><span className="orch-info-key">自动审批</span><span className="orch-info-val">{currentOrch.autoApprove ? '是' : '否'}</span></div>
              <div className="orch-info-row"><span className="orch-info-key">测试命令</span><code className="orch-info-val">{currentOrch.testCommand || '—'}</code></div>
              <div className="orch-info-row"><span className="orch-info-key">创建时间</span><span className="orch-info-val">{new Date(currentOrch.createdAt).toLocaleString('zh-CN')}</span></div>
              <div className="orch-info-row"><span className="orch-info-key">仓库路径</span><code className="orch-info-val">{repoPath}</code></div>
            </div>
            <div className="orch-info-card">
              <h4>任务统计</h4>
              <div className="orch-stat-grid">
                <div className="orch-stat-item"><div className="orch-stat-dot" style={{ background: '#4ade80' }} /><span>已完成</span><strong>{metrics.done}</strong></div>
                <div className="orch-stat-item"><div className="orch-stat-dot" style={{ background: '#6c8cff' }} /><span>执行中</span><strong>{metrics.running}</strong></div>
                <div className="orch-stat-item"><div className="orch-stat-dot" style={{ background: '#888' }} /><span>待执行</span><strong>{metrics.pending}</strong></div>
                <div className="orch-stat-item"><div className="orch-stat-dot" style={{ background: '#f59e0b' }} /><span>阻塞</span><strong>{metrics.blocked}</strong></div>
                <div className="orch-stat-item"><div className="orch-stat-dot" style={{ background: '#ef4444' }} /><span>失败</span><strong>{metrics.failed}</strong></div>
                <div className="orch-stat-item"><div className="orch-stat-dot" style={{ background: '#6c8cff' }} /><span>总计</span><strong>{metrics.total}</strong></div>
              </div>
            </div>
            <div className="orch-info-card orch-info-card-wide">
              <h4>当前阶段：{PHASE_STEP_LABEL[currentPhase || ''] || currentPhase || '—'}</h4>
              <DagGraph tasks={currentTasks} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} />
            </div>
          </div>
        )}
        {subTab === 'graph' && (
          <div className="orch-graph-tab"><DagGraph tasks={currentTasks} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} /></div>
        )}
        {subTab === 'logs' && (
          <div className="orch-logs-tab">
            {Object.keys(logs).length === 0 ? (
              <div className="orch-empty-state"><div className="orch-empty-icon">📝</div><div className="orch-empty-text">暂无日志，启动编排后可查看实时执行日志</div></div>
            ) : (
              Object.entries(logs).map(([taskId, lines]) => (
                <div key={taskId} className="orch-log-block">
                  <div className="orch-log-header">📋 {currentTasks.find(t => t.id === taskId)?.title || taskId}</div>
                  <pre className="orch-log-content">{lines.join('\n')}</pre>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
