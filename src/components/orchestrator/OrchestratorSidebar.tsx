/**
 * 编排任务侧边栏（窄列表）
 *
 * 统一入口：编排任务（DAG 模板驱动）+ 循环任务（prompt + interval 周期调度）。
 * 显示当前项目的任务列表，点击任务在主操作区打开详情 tab。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Orchestration, IpcResponse, Template } from './types';

type SidebarTab = 'orchestration' | 'loop';

const STATUS_ICON: Record<string, string> = {
  pending: '⚪', running: '▶', paused: '⏸', success: '✅', failed: '❌', interrupted: '⚫',
};

const TEMPLATE_SHORT: Record<string, string> = {
  greenfield: '🌱', refactor: '♻️', migration: '🚚', upgrade: '⬆️', hotfix: '🚑',
  'greenfield-adv': '🌱', 'refactor-adv': '♻️', 'migration-adv': '🚚', 'upgrade-adv': '⬆️', 'hotfix-adv': '🚑',
  'custom-single-module': '📦', 'custom-multi-module': '🧩', 'custom-code-audit': '🔍',
  'custom-migration': '🔄', 'custom-bug-sweep': '🐛', 'custom-ci-monitor': '⚡',
};

const KIND_ORDER: Template['kind'][] = ['greenfield', 'refactor', 'migration', 'upgrade', 'hotfix', 'custom'];

const KIND_LABEL: Record<string, string> = {
  greenfield: '🌱 全新项目',
  refactor: '♻️ 项目重构',
  migration: '🚚 技术栈迁移',
  upgrade: '⬆️ 小型升级',
  hotfix: '🚑 紧急修复',
  custom: '📦 自定义',
};

const INTERVAL_OPTIONS = [
  { value: '1m', label: '1 分钟' },
  { value: '5m', label: '5 分钟' },
  { value: '10m', label: '10 分钟' },
  { value: '30m', label: '30 分钟' },
  { value: '1h', label: '1 小时' },
  { value: '6h', label: '6 小时' },
  { value: '1d', label: '1 天' },
];

interface Props {
  repoPath: string;
  /** 当前在主操作区打开的编排 ID */
  activeOrchId: string | null;
  /** 点击任务回调（在主操作区打开详情 tab）*/
  onSelectTask: (orchId: string) => void;
  /** 打开模板管理对话框 */
  onOpenTemplateManager: () => void;
}

export function OrchestratorSidebar({ repoPath, activeOrchId, onSelectTask, onOpenTemplateManager }: Props) {
  const [tab, setTab] = useState<SidebarTab>('orchestration');
  const [orchestrations, setOrchestrations] = useState<Orchestration[]>([]);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newGoal, setNewGoal] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('hotfix');
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);

  // ── 循环任务状态（整合自 AutomationPanel）──
  const [loops, setLoops] = useState<any[]>([]);
  const [activeRuns, setActiveRuns] = useState<Map<string, { loopName: string; output: string; startedAt: string }>>(new Map());
  const [newLoopName, setNewLoopName] = useState('');
  const [newLoopPrompt, setNewLoopPrompt] = useState('');
  const [newLoopInterval, setNewLoopInterval] = useState('10m');
  const loopsRef = useRef(loops);
  loopsRef.current = loops;

  // 加载模板列表
  useEffect(() => {
    window.orchestrator.templates().then((res: IpcResponse<Template[]>) => {
      if (res.ok && res.data) setTemplates(res.data);
    }).catch(() => {});
  }, []);

  // 模板按 kind 分组
  const groupedTemplates = useMemo(() => {
    const groups: Record<string, Template[]> = {};
    for (const t of templates) {
      const k = t.kind || 'custom';
      if (!groups[k]) groups[k] = [];
      groups[k].push(t);
    }
    return groups;
  }, [templates]);

  // 加载编排列表
  const loadList = useCallback(async () => {
    try {
      const res: IpcResponse<Orchestration[]> = await window.orchestrator.list(repoPath);
      if (res.ok && res.data) setOrchestrations(res.data);
    } catch {}
  }, [repoPath]);

  useEffect(() => { loadList(); }, [repoPath]);

  // 定时刷新（运行中的任务自动更新状态）
  useEffect(() => {
    const hasRunning = orchestrations.some((o) => o.status === 'running' || o.status === 'paused');
    if (!hasRunning) return;
    const timer = setInterval(loadList, 5000);
    return () => clearInterval(timer);
  }, [orchestrations, loadList]);

  // ── 循环任务数据加载 & 事件监听 ────────────────────
  const loadLoops = useCallback(async () => {
    try {
      const r = await window.electronAPI.loopList?.();
      if (r?.success) {
        setLoops((r.loops || []).map((l: any) => ({ ...l, status: l.enabled !== false ? 'active' : 'paused' })));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (tab !== 'loop') return;
    loadLoops();
  }, [tab, loadLoops]);

  useEffect(() => {
    const unsubStatus = window.electronAPI.onLoopStatus?.((data: any) => {
      if (data.status === 'running') {
        setActiveRuns(prev => {
          const next = new Map(prev);
          next.set(data.loopId, { loopName: data.loopName || '', output: '', startedAt: new Date().toISOString() });
          return next;
        });
      } else {
        setActiveRuns(prev => {
          const next = new Map(prev);
          next.delete(data.loopId);
          return next;
        });
      }
      loadLoops();
    });

    const unsubOutput = window.electronAPI.onLoopOutput?.((data: { loopId: string; runId: string; text: string }) => {
      setActiveRuns(prev => {
        const next = new Map(prev);
        const existing = next.get(data.loopId);
        if (existing) {
          next.set(data.loopId, { ...existing, output: (existing.output + data.text).slice(-3000) });
        }
        return next;
      });
    });

    return () => { unsubStatus?.(); unsubOutput?.() };
  }, [loadLoops]);

  // ── 编排任务创建 ────────────────────────────────────
  const handleCreateOrchestration = async () => {
    if (!newGoal.trim()) return;
    setCreating(true);
    try {
      const res = await window.orchestrator.create({
        repoPath, templateId: newTemplateId, goal: newGoal.trim(), autoApprove: false,
      });
      if (res.ok) {
        setShowNewDialog(false);
        setNewGoal('');
        await loadList();
        if (res.data) {
          const id = typeof res.data === 'string' ? res.data : (res.data as any).id || (res.data as any).orchestrationId;
          if (id) onSelectTask(id);
        }
      }
    } catch {}
    setCreating(false);
  };

  // ── 循环任务创建 ────────────────────────────────────
  const handleCreateLoop = async () => {
    if (!newLoopName.trim() || !newLoopPrompt.trim()) return;
    setCreating(true);
    try {
      const r = await window.electronAPI.loopCreate?.({
        name: newLoopName.trim(),
        prompt: newLoopPrompt.trim(),
        interval: newLoopInterval,
      });
      if (r?.success) {
        setShowNewDialog(false);
        setNewLoopName('');
        setNewLoopPrompt('');
        setNewLoopInterval('10m');
        await loadLoops();
      }
    } catch {}
    setCreating(false);
  };

  const handleRunNow = async (id: string) => {
    try { await window.electronAPI.loopRunNow?.(id) } catch {}
  };
  const handleDeleteLoop = async (id: string) => {
    if (!confirm('删除该循环任务？')) return;
    try { await window.electronAPI.loopDelete?.(id); loadLoops() } catch {}
  };
  const handleToggleLoop = async (id: string) => {
    const loop = loopsRef.current.find((l: any) => l.id === id);
    if (!loop) return;
    if (loop.status === 'active') {
      await window.electronAPI.loopPause?.(id);
    } else {
      await window.electronAPI.loopResume?.(id);
    }
    loadLoops();
  };

  if (!window.orchestrator) {
    return (
      <div className="orch-sidebar-v13">
        <div className="orch-sidebar-empty">
          <p style={{ fontSize: 12, color: '#888' }}>orchestrator API 不可用</p>
        </div>
      </div>
    );
  }

  return (
    <div className="orch-sidebar-v13">
      <div className="orch-sidebar-head-v13">
        <h3>🤖 AI 编排工坊</h3>
        <div className="orch-sidebar-actions-v13">
          <button className="orch-icon-btn" onClick={() => setShowNewDialog(true)} title="新建任务" type="button">+</button>
          {tab === 'orchestration' && (
            <button className="orch-icon-btn" onClick={onOpenTemplateManager} title="编排模板" type="button">📋</button>
          )}
        </div>
      </div>

      {/* Tab 切换：编排任务 / 循环任务 */}
      <div className="orch-sidebar-tabs">
        <button
          className={`orch-sidebar-tab${tab === 'orchestration' ? ' active' : ''}`}
          onClick={() => setTab('orchestration')}
          type="button"
        >
          📋 编排任务 ({orchestrations.length})
        </button>
        <button
          className={`orch-sidebar-tab${tab === 'loop' ? ' active' : ''}`}
          onClick={() => setTab('loop')}
          type="button"
        >
          🔄 循环任务 ({loops.length})
        </button>
      </div>

      <div className="orch-task-list-v13">
        {/* ── 编排任务列表 ──────────────────────────────── */}
        {tab === 'orchestration' && (
          orchestrations.length === 0 ? (
            <div className="orch-sidebar-empty">
              <div className="orch-sidebar-empty-icon">📋</div>
              <p>暂无编排任务</p>
              <p className="orch-sidebar-empty-hint">点击 + 新建编排</p>
            </div>
          ) : (
            orchestrations.map((o) => (
              <div
                key={o.id}
                className={`orch-task-item-v13 ${activeOrchId === o.id ? 'active' : ''} ${o.status === 'running' ? 'running' : ''}`}
                onClick={() => onSelectTask(o.id)}
              >
                <span className="orch-task-icon">{STATUS_ICON[o.status] || '⚪'}</span>
                <div className="orch-task-body">
                  <div className="orch-task-title">{o.goal.slice(0, 30) || o.templateId}</div>
                  <div className="orch-task-meta">
                    <span className="orch-task-tpl">{TEMPLATE_SHORT[o.templateId] || '📄'} {o.templateId.replace('-adv', '')}</span>
                    <span className={`orch-task-status status-${o.status}`}>{o.status}</span>
                  </div>
                </div>
              </div>
            ))
          )
        )}

        {/* ── 循环任务列表 ──────────────────────────────── */}
        {tab === 'loop' && (
          loops.length === 0 ? (
            <div className="orch-sidebar-empty">
              <div className="orch-sidebar-empty-icon">🔄</div>
              <p>暂无循环任务</p>
              <p className="orch-sidebar-empty-hint">点击 + 新建循环任务（按间隔自动运行）</p>
            </div>
          ) : (
            loops.map((loop: any) => (
              <div
                key={loop.id}
                className={`orch-task-item-v13 ${activeRuns.has(loop.id) ? 'running' : ''}`}
                style={{ opacity: loop.status === 'paused' ? 0.5 : 1 }}
              >
                <span className="orch-task-icon">
                  {activeRuns.has(loop.id) ? '🔵' : loop.status === 'active' ? '🟢' : '⏸️'}
                </span>
                <div className="orch-task-body">
                  <div className="orch-task-title">{loop.name}</div>
                  <div className="orch-task-meta">
                    <span className="orch-task-tpl">🔄 {loop.interval}</span>
                    <span className={`orch-task-status status-${loop.status === 'active' ? 'running' : 'paused'}`}>
                      {activeRuns.has(loop.id) ? '执行中' : loop.status === 'active' ? '已激活' : '已暂停'}
                    </span>
                  </div>
                  {loop.lastRun && (
                    <div className="orch-task-meta">
                      <span className="orch-task-tpl" style={{ fontSize: 9, opacity: 0.7 }}>
                        上次: {new Date(loop.lastRun).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {loop.lastError && (
                    <div style={{ fontSize: 9, color: '#ff5050', marginTop: 2 }}>❌ {loop.lastError}</div>
                  )}
                  {activeRuns.has(loop.id) && (
                    <div style={{ fontSize: 9, color: '#888', marginTop: 2, maxHeight: 60, overflow: 'hidden', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: '4px 6px', borderRadius: 3 }}>
                      {activeRuns.get(loop.id)?.output?.slice(-400)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <button
                      className="orch-icon-btn"
                      onClick={() => handleRunNow(loop.id)}
                      disabled={activeRuns.has(loop.id)}
                      title="立即执行"
                      type="button"
                      style={{ fontSize: 10, padding: '2px 6px' }}
                    >
                      ▶
                    </button>
                    <button
                      className="orch-icon-btn"
                      onClick={() => handleToggleLoop(loop.id)}
                      title={loop.status === 'active' ? '暂停' : '激活'}
                      type="button"
                      style={{ fontSize: 10, padding: '2px 6px' }}
                    >
                      {loop.status === 'active' ? '⏸' : '▶'}
                    </button>
                    <button
                      className="orch-icon-btn"
                      onClick={() => handleDeleteLoop(loop.id)}
                      title="删除"
                      type="button"
                      style={{ fontSize: 10, padding: '2px 6px', color: '#ff5050' }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* 新建对话框：根据当前 Tab 选择创建模式 */}
      {showNewDialog && (
        <div className="dialog-overlay" onClick={() => setShowNewDialog(false)}>
          <div className="dialog" style={{ width: '460px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>
              {tab === 'orchestration' ? '📋 新建编排任务' : '🔄 新建循环任务'}
            </h3>

            {/* 模式切换 */}
            <div style={{ marginBottom: 12, display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
              <button
                className={`orch-sidebar-tab${tab === 'orchestration' ? ' active' : ''}`}
                onClick={() => setTab('orchestration')}
                type="button"
                style={{ flex: 1, padding: '6px 8px' }}
              >
                📋 编排任务（DAG 模板）
              </button>
              <button
                className={`orch-sidebar-tab${tab === 'loop' ? ' active' : ''}`}
                onClick={() => setTab('loop')}
                type="button"
                style={{ flex: 1, padding: '6px 8px' }}
              >
                🔄 循环任务（定时调度）
              </button>
            </div>

            {/* ── 编排任务表单 ────────────────────────── */}
            {tab === 'orchestration' && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>模板</label>
                  <select value={newTemplateId} onChange={(e) => setNewTemplateId(e.target.value)}
                    style={{ width: '100%', padding: 8, background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 4 }}>
                    {KIND_ORDER.map(kind => {
                      const list = groupedTemplates[kind] || [];
                      if (list.length === 0) return null;
                      return (
                        <optgroup key={kind} label={KIND_LABEL[kind]}>
                          {list.map(t => (
                            <option key={t.id} value={t.id}>
                              {TEMPLATE_SHORT[t.id] || '📄'} {t.name}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>项目目标</label>
                  <textarea value={newGoal} onChange={(e) => setNewGoal(e.target.value)}
                    placeholder="例如：将项目从 Spring MVC 迁移到 Spring Boot 3.x" rows={3}
                    style={{ width: '100%', padding: 8, background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 4, resize: 'vertical' }} />
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 12, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                  💡 DAG 模板驱动，按阶段自动执行（ingest→analyze→architect→execute→deploy）
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="orch-btn" onClick={() => setShowNewDialog(false)} type="button">取消</button>
                  <button className="orch-btn orch-btn-primary" onClick={handleCreateOrchestration} disabled={creating || !newGoal.trim()} type="button">
                    {creating ? '创建中…' : '创建'}
                  </button>
                </div>
              </>
            )}

            {/* ── 循环任务表单 ────────────────────────── */}
            {tab === 'loop' && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>名称</label>
                  <input type="text" value={newLoopName} onChange={(e) => setNewLoopName(e.target.value)}
                    placeholder="例如：CI 监控"
                    style={{ width: '100%', padding: 8, background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 4, boxSizing: 'border-box' }} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>执行间隔</label>
                  <select value={newLoopInterval} onChange={(e) => setNewLoopInterval(e.target.value)}
                    style={{ width: '100%', padding: 8, background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 4 }}>
                    {INTERVAL_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>提示词</label>
                  <textarea value={newLoopPrompt} onChange={(e) => setNewLoopPrompt(e.target.value)}
                    placeholder="例如：检查 CI 状态并修复失败用例..." rows={4}
                    style={{ width: '100%', padding: 8, background: 'var(--bg-elevated)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 4, resize: 'vertical', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 12, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                  💡 按间隔周期自动执行同一提示词，适合监控、巡检、日报等场景
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="orch-btn" onClick={() => setShowNewDialog(false)} type="button">取消</button>
                  <button className="orch-btn orch-btn-primary" onClick={handleCreateLoop} disabled={creating || !newLoopName.trim() || !newLoopPrompt.trim()} type="button">
                    {creating ? '创建中…' : '创建'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
