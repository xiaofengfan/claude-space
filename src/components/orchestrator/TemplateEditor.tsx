/**
 * 统一模板编辑器（融合版）
 *
 * 将原简单模式 TemplateManagerDialog 的「阶段管理」与高级模式的「详细信息设置」
 * 融合为单一编辑器。底层统一为 DAG（TaskDef[]）数据模型。
 *
 * 布局：
 * - 顶部：基本信息（icon/name/desc/kind/projectPath）
 * - 中部：阶段管理（融合简单模式核心）
 *   - 阶段卡片列表，按 DAG 拓扑序展示
 *   - 每个卡片：序号 + 标题 + kind 切换 + phase + model + prompt + 上下移动/删除/复制
 *   - 卡片内可折叠「高级配置」（融合高级模式核心）：retryPolicy/advisors/timeout/fallback/maxAttempts
 * - 下部：图级配置（折叠区）：params/maxIterations/edges
 * - 底部：流程图预览 + 应用到项目按钮
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { TaskDef, TaskKind, RetryPolicy, Advisor, SwitchCase, EdgeDef, ParamDef, GateType, TaskIO } from './types';
import { templateToWorkflowDetail } from './types';
import {
  KIND_LABELS, KIND_ICONS, KIND_COLORS, MODELS, PHASES,
  TEMPLATE_KINDS, ADVISOR_TRIGGERS, genTaskId,
  type UnifiedTemplate,
} from './unifiedTemplate';
import { WfFlowGraph } from './WfFlowGraph';

// ── 常量 ───────────────────────────────────────────────

const KIND_OPTIONS: { value: TaskKind; label: string; icon: string }[] = [
  { value: 'phase', label: 'AI 阶段', icon: '🤖' },
  { value: 'gate', label: '质量门禁', icon: '🛡️' },
  { value: 'human-gate', label: '人工审批', icon: '✋' },
  { value: 'harness-call', label: '多轮交互', icon: '🔁' },
  { value: 'sub-workflow', label: '子工作流', icon: '📦' },
  { value: 'switch', label: '条件分支', icon: '🔀' },
];

const GATE_OPTIONS: { value: GateType; label: string }[] = [
  { value: 'test', label: '测试门禁' },
  { value: 'review', label: '代码审查' },
];

const BACKOFF_OPTIONS: { value: RetryPolicy['backoff']; label: string }[] = [
  { value: 'none', label: '无退避' },
  { value: 'linear', label: '线性退避' },
  { value: 'exponential', label: '指数退避' },
];

const ADVISOR_TRIGGER_OPTIONS = Object.entries(ADVISOR_TRIGGERS).map(([value, label]) => ({ value, label }));

// ── Props ───────────────────────────────────────────────

interface Props {
  template: UnifiedTemplate;
  onChange: (t: UnifiedTemplate) => void;
  /** 保存/另存为回调；返回字符串视为反馈消息，undefined 表示无反馈 */
  onSave: () => void | string | Promise<void | string>;
  onDelete?: () => void;
  onApplyToProject?: (goal: string, autoApprove: boolean, testCommand?: string) => Promise<void>;
  onBack?: () => void;
  repoPath?: string;
  /** 是否只读 */
  readOnly?: boolean;
  /** 是否为内置模板（内置模板保存=另存为自定义） */
  isBuiltin?: boolean;
  saving?: boolean;
  applying?: boolean;
}

export function TemplateEditor({
  template, onChange, onSave, onDelete, onApplyToProject, onBack, repoPath, readOnly = false, isBuiltin = false, saving, applying,
}: Props) {
  // 保存反馈消息
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const saveMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 执行保存并显示反馈
  const handleSaveWithFeedback = useCallback(async () => {
    setSaveMsg(null);
    if (saveMsgTimer.current) clearTimeout(saveMsgTimer.current);
    try {
      const msg = await onSave();
      const text = msg || (isBuiltin ? '✓ 已另存为自定义模板' : '✓ 模板已保存');
      setSaveMsg(text);
    } catch (e: any) {
      setSaveMsg(`✗ 保存失败：${e?.message || e}`);
    } finally {
      saveMsgTimer.current = setTimeout(() => setSaveMsg(null), 3500);
    }
  }, [onSave, isBuiltin]);
  // ── 拓扑排序：把 tasks 按 deps 拓扑序展示为阶段列表 ──
  const orderedTasks = useMemo(() => topoSort(template.tasks), [template.tasks]);

  // 当前选中的阶段（中间面板展示其详情）
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(template.tasks[0]?.id || null);

  // 选中 task 对象
  const selectedTask = template.tasks.find(t => t.id === selectedTaskId) || orderedTasks[0] || null;

  const update = (patch: Partial<UnifiedTemplate>) => onChange({ ...template, ...patch, updatedAt: new Date().toISOString() });

  // ── 阶段（任务）操作 ──
  const addTask = () => {
    const id = genTaskId();
    const last = orderedTasks[orderedTasks.length - 1];
    const newTask: TaskDef = {
      id, title: '新阶段', kind: 'phase', deps: last ? [last.id] : [], prompt: '', model: 'sonnet',
    };
    const tasks = [...template.tasks, newTask];
    update({
      tasks,
      entry: template.entry || id,
      terminals: template.terminals.length > 0 ? template.terminals : [id],
    });
  };

  const updateTask = (id: string, patch: Partial<TaskDef>) => {
    onChange({
      ...template,
      tasks: template.tasks.map(t => t.id === id ? { ...t, ...patch } : t),
      updatedAt: new Date().toISOString(),
    });
  };

  const removeTask = (id: string) => {
    if (template.tasks.length <= 1) return;
    const tasks = template.tasks.filter(t => t.id !== id)
      .map(t => ({
        ...t,
        deps: t.deps.filter(d => d !== id),
        fallbackTo: t.fallbackTo === id ? undefined : t.fallbackTo,
      }));
    const terminals = template.terminals.filter(t => t !== id);
    const entry = template.entry === id ? (tasks[0]?.id || '') : template.entry;
    update({ tasks, entry, terminals: terminals.length > 0 ? terminals : (tasks.length > 0 ? [tasks[tasks.length - 1].id] : []) });
  };

  const duplicateTask = (id: string) => {
    const src = template.tasks.find(t => t.id === id);
    if (!src) return;
    const newId = genTaskId();
    const newTask: TaskDef = {
      ...src, id: newId, title: src.title + ' (副本)',
      deps: src.deps,  // 复制依赖（用户可手动调整）
    };
    const idx = template.tasks.findIndex(t => t.id === id);
    const tasks = [...template.tasks];
    tasks.splice(idx + 1, 0, newTask);
    onChange({
      ...template, tasks,
      updatedAt: new Date().toISOString(),
    });
  };

  const moveTask = (id: string, dir: -1 | 1) => {
    const idx = orderedTasks.findIndex(t => t.id === id);
    const ni = idx + dir;
    if (ni < 0 || ni >= orderedTasks.length) return;
    const cur = orderedTasks[idx];
    const neighbor = orderedTasks[ni];
    // 交换 deps：cur 变成依赖 neighbor 的前驱，neighbor 变成依赖 cur
    const newCurDeps = cur.deps.filter(d => d !== neighbor.id);
    const newNeighborDeps = neighbor.deps.filter(d => d !== cur.id);
    // cur 的 deps 中如果原本依赖前一个，需要把 neighbor.id 加入 cur 的 deps
    // 简化处理：上移 → cur 的 deps 去掉 neighbor.id，neighbor 的 deps 加上 cur.id
    if (dir === -1) {
      // cur 上移：cur 不再依赖 neighbor；neighbor 依赖 cur
      const updated = template.tasks.map(t => {
        if (t.id === cur.id) return { ...t, deps: newCurDeps };
        if (t.id === neighbor.id) return { ...t, deps: [...newNeighborDeps, cur.id] };
        return t;
      });
      onChange({ ...template, tasks: updated, updatedAt: new Date().toISOString() });
    } else {
      // cur 下移：neighbor 依赖 cur（neighbor 上移）；cur 依赖 neighbor
      const updated = template.tasks.map(t => {
        if (t.id === cur.id) return { ...t, deps: [...newCurDeps, neighbor.id] };
        if (t.id === neighbor.id) return { ...t, deps: newNeighborDeps };
        return t;
      });
      onChange({ ...template, tasks: updated, updatedAt: new Date().toISOString() });
    }
  };

  // 选中阶段后选中任务变化
  const handleSelectTask = (id: string) => setSelectedTaskId(id);

  // ── 可拖拽分栏宽度 ──
  const splitRef = useRef<HTMLDivElement>(null);
  const [colWidths, setColWidths] = useState({ stages: 440, graph: 600 });
  const draggingRef = useRef<null | 'stages' | 'graph'>(null);

  const startDrag = useCallback((which: 'stages' | 'graph') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = which;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const which = draggingRef.current;
      if (!which || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const minW = 200;
      const maxStages = Math.min(700, rect.width * 0.5);
      const maxGraph = Math.min(900, rect.width * 0.5);
      if (which === 'stages') {
        const w = e.clientX - rect.left;
        setColWidths(p => ({ ...p, stages: Math.max(minW, Math.min(maxStages, w)) }));
      } else if (which === 'graph') {
        const w = rect.right - e.clientX;
        setColWidths(p => ({ ...p, graph: Math.max(minW, Math.min(maxGraph, w)) }));
      }
    };
    const onUp = () => {
      draggingRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── 渲染 ──
  return (
    <div className="tmpl-editor">
      {/* ── 顶部：返回 + 基本信息 + 目标 + 应用操作 ── */}
      <div className="tmpl-editor-topbar">
        {onBack && (
          <button className="tmpl-back-btn" onClick={onBack} type="button" title="返回模板列表">← 返回</button>
        )}
        <BasicInfoSection template={template} onChange={update} readOnly={readOnly} />
        {onApplyToProject && (
          <ApplyPanel
            template={template}
            repoPath={repoPath || ''}
            onApply={onApplyToProject}
            applying={applying}
          />
        )}
        {!readOnly && (
          <div className="tmpl-editor-actions">
            <button className="tmpl-btn tmpl-btn-primary" onClick={handleSaveWithFeedback} disabled={saving} type="button" title={isBuiltin ? '将当前编辑另存为自定义模板' : '保存模板修改'}>
              {saving ? '保存中…' : (isBuiltin ? '📦 另存为' : '💾 保存')}
            </button>
            {onDelete && (
              <button className="tmpl-btn tmpl-btn-danger" onClick={onDelete} type="button" title="删除模板">🗑️</button>
            )}
            {saveMsg && (
              <span className={saveMsg.startsWith('✓') ? 'tmpl-apply-ok' : 'tmpl-apply-err'}>{saveMsg}</span>
            )}
          </div>
        )}
      </div>

      {/* ── 三栏：左阶段列表 / 中阶段详情 / 右流程图 ── */}
      <div className="tmpl-editor-split" ref={splitRef}>
        {/* 左栏：阶段列表 */}
        <div className="tmpl-editor-col tmpl-editor-col-stagelist" style={{ flex: `0 0 ${colWidths.stages}px`, width: colWidths.stages }}>
          <div className="tmpl-editor-section tmpl-stages-section">
            <div className="tmpl-editor-section-head">
              <h4>📋 阶段 <span className="tmpl-muted">({orderedTasks.length})</span></h4>
              {!readOnly && (
                <button className="tmpl-btn tmpl-btn-sm" onClick={addTask} type="button">➕</button>
              )}
            </div>
            <div className="tmpl-editor-section-body tmpl-stages-list">
              {orderedTasks.length === 0 && (
                <div className="tmpl-empty">暂无阶段</div>
              )}
              {orderedTasks.map((task, idx) => {
                const isEntry = template.entry === task.id;
                const isTerminal = template.terminals.includes(task.id);
                const isSelected = selectedTaskId === task.id;
                return (
                  <div
                    key={task.id}
                    className={`tmpl-stage-item ${isSelected ? 'active' : ''} ${isEntry ? 'entry' : ''} ${isTerminal ? 'terminal' : ''}`}
                    onClick={() => handleSelectTask(task.id)}
                  >
                    <span className="tmpl-stage-num">#{idx + 1}</span>
                    <span className="tmpl-stage-kind-chip" style={{ background: KIND_COLORS[task.kind] }} title={KIND_LABELS[task.kind]}>
                      {KIND_ICONS[task.kind]}
                    </span>
                    <span className="tmpl-stage-title">{task.title || '未命名'}</span>
                    {!readOnly && (
                      <div className="tmpl-stage-ops">
                        <button className="tmpl-btn-icon" onClick={(e) => { e.stopPropagation(); moveTask(task.id, -1); }} disabled={idx === 0} title="上移">↑</button>
                        <button className="tmpl-btn-icon" onClick={(e) => { e.stopPropagation(); moveTask(task.id, 1); }} disabled={idx === orderedTasks.length - 1} title="下移">↓</button>
                        <button className="tmpl-btn-icon" onClick={(e) => { e.stopPropagation(); duplicateTask(task.id); }} title="复制">⧉</button>
                        <button className="tmpl-btn-icon tmpl-btn-icon-danger" onClick={(e) => { e.stopPropagation(); removeTask(task.id); }} disabled={orderedTasks.length <= 1} title="删除">✕</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 拖拽分隔条 1 */}
        <div className="tmpl-col-resizer" onMouseDown={startDrag('stages')} title="拖拽调整宽度" />

        {/* 中栏：阶段详情 */}
        <div className="tmpl-editor-col tmpl-editor-col-taskdetail">
          {selectedTask ? (
            <TaskDetailPanel
              task={selectedTask}
              allTasks={template.tasks}
              entry={template.entry}
              terminals={template.terminals}
              readOnly={readOnly}
              onUpdate={(patch) => updateTask(selectedTask.id, patch)}
            />
          ) : (
            <div className="tmpl-empty">← 从左侧选择一个阶段查看详情</div>
          )}
          {/* 图级配置 */}
          {!readOnly && (
            <GraphConfigSection template={template} onChange={update} />
          )}
        </div>

        {/* 拖拽分隔条 2 */}
        <div className="tmpl-col-resizer" onMouseDown={startDrag('graph')} title="拖拽调整宽度" />

        {/* 右栏：流程图 + 当前阶段内容 */}
        <div className="tmpl-editor-col tmpl-editor-col-graph" style={{ flex: `0 0 ${colWidths.graph}px`, width: colWidths.graph }}>
          <FlowGraphSection
            template={template}
            selectedNodeId={selectedTaskId}
            onSelectNode={handleSelectTask}
          />
          {selectedTask && (
            <CurrentStagePanel task={selectedTask} allTasks={template.tasks} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── 当前阶段内容面板（流程图下方）──────────────────────────

function CurrentStagePanel({ task, allTasks }: { task: TaskDef; allTasks: TaskDef[] }) {
  const steps: string[] = [];
  if (task.kind === 'phase' || task.kind === 'harness-call' || task.kind === 'sub-workflow') {
    if (task.prompt) steps.push('执行 AI 提示词');
    if (task.inputs?.length) steps.push(`读取 ${task.inputs.length} 个输入`);
    if (task.outputs?.length) steps.push(`产出 ${task.outputs.length} 个输出`);
    if (task.model) steps.push(`使用模型 ${task.model}`);
    if (task.timeoutMs) steps.push(`超时 ${Math.round(task.timeoutMs / 1000)}s`);
    if (task.retryPolicy || (task.maxAttempts && task.maxAttempts > 1)) steps.push(`重试 ${task.maxAttempts || task.retryPolicy?.maxAttempts || 1} 次`);
    if (task.advisors?.length) steps.push(`${task.advisors.length} 个 AI 顾问`);
    if (task.fallbackTo) {
      const fb = allTasks.find(t => t.id === task.fallbackTo);
      steps.push(`失败回退 → ${fb?.title || task.fallbackTo}`);
    }
  } else if (task.kind === 'gate') {
    steps.push(task.gate === 'test' ? '执行测试门禁' : '执行代码审查');
  } else if (task.kind === 'human-gate') {
    steps.push(task.approvalPrompt || '等待人工审批');
  } else if (task.kind === 'switch') {
    steps.push(`条件分支 ${task.cases?.length || 0} 路`);
  }

  return (
    <div className="tmpl-current-stage">
      <h5 className="tmpl-current-stage-h">📌 当前阶段内容</h5>
      <div className="tmpl-current-stage-title">{KIND_ICONS[task.kind]} {task.title}</div>
      {task.description && <p className="tmpl-current-stage-desc">{task.description}</p>}
      {steps.length > 0 && (
        <ol className="tmpl-current-stage-steps">
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {(task.inputs?.length || task.outputs?.length) ? (
        <div className="tmpl-current-stage-io">
          {task.inputs && task.inputs.length > 0 && (
            <div className="tmpl-io-block">
              <span className="tmpl-io-label">📥 输入:</span>
              {task.inputs.map((io, i) => (
                <span key={i} className="tmpl-io-chip" title={io.path}>{IO_ICON[io.type]} {io.name}</span>
              ))}
            </div>
          )}
          {task.outputs && task.outputs.length > 0 && (
            <div className="tmpl-io-block">
              <span className="tmpl-io-label">📤 输出:</span>
              {task.outputs.map((io, i) => (
                <span key={i} className="tmpl-io-chip" title={io.path}>{IO_ICON[io.type]} {io.name}</span>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

const IO_ICON: Record<TaskIO['type'], string> = {
  file: '📄',
  dir: '📁',
  doc: '📑',
  var: '🔹',
};

// ── 基本信息 ───────────────────────────────────────────────

function BasicInfoSection({ template, onChange, readOnly }: {
  template: UnifiedTemplate;
  onChange: (patch: Partial<UnifiedTemplate>) => void;
  readOnly?: boolean;
}) {
  const [testResult, setTestResult] = useState<{ kind: 'unit' | 'sim'; lines: { text: string; level: 'ok' | 'warn' | 'err' }[]; ok: boolean } | null>(null);
  const [testing, setTesting] = useState(false);

  const runUnit = () => {
    setTesting(true);
    setTestResult(null);
    // 异步执行避免阻塞 UI
    setTimeout(() => {
      const r = runUnitTest(template);
      setTestResult({ kind: 'unit', lines: r.lines, ok: r.ok });
      setTesting(false);
    }, 50);
  };
  const runSim = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      const r = runSimulation(template);
      setTestResult({ kind: 'sim', lines: r.lines, ok: r.ok });
      setTesting(false);
    }, 50);
  };

  return (
    <div className="tmpl-basic-wrap">
      <div className="tmpl-basic-inline">
        <input
          type="text" value={template.icon} placeholder="📦"
          onChange={e => onChange({ icon: e.target.value })}
          disabled={readOnly}
          className="tmpl-input tmpl-input-icon"
          title="图标"
        />
        <input
          type="text" value={template.name} placeholder="模板名称"
          onChange={e => onChange({ name: e.target.value })}
          disabled={readOnly}
          className="tmpl-input tmpl-input-name"
          title="名称"
        />
        <select
          value={template.kind}
          onChange={e => onChange({ kind: e.target.value as UnifiedTemplate['kind'] })}
          disabled={readOnly}
          className="tmpl-input tmpl-input-kind"
          title="类型"
        >
          {TEMPLATE_KINDS.map(k => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
        </select>
        <input
          type="text" value={template.description} placeholder="模板功能描述"
          onChange={e => onChange({ description: e.target.value })}
          disabled={readOnly}
          className="tmpl-input tmpl-input-desc"
          title="描述"
        />
        <div className="tmpl-test-panel">
          <button className="tmpl-btn-test" onClick={runUnit} disabled={testing} type="button" title="单元测试：校验模板结构完整性">
            {testing && testResult === null ? '…' : '🧪 单元测试'}
          </button>
          <button className="tmpl-btn-test sim" onClick={runSim} disabled={testing} type="button" title="模拟测试：模拟执行流程，检查可达性">
            {testing && testResult === null ? '…' : '▶ 模拟测试'}
          </button>
        </div>
      </div>
      {testResult && (
        <div className={`tmpl-test-result ${testResult.ok ? 'ok' : 'fail'}`}>
          <div className="tmpl-test-result-line" style={{ fontWeight: 600 }}>
            {testResult.kind === 'unit' ? '🧪 单元测试' : '▶ 模拟测试'} — {testResult.ok ? '✓ 通过' : '✗ 失败'}
          </div>
          {testResult.lines.map((l, i) => (
            <span key={i} className={`tmpl-test-result-line ${l.level}`}>{l.level === 'ok' ? '✓ ' : l.level === 'warn' ? '⚠ ' : '✗ '}{l.text}</span>
          ))}
          <button className="tmpl-btn-icon" style={{ position: 'absolute', top: 4, right: 4 }} onClick={() => setTestResult(null)} type="button" title="关闭">✕</button>
        </div>
      )}
    </div>
  );
}

// ── 测试逻辑：单元测试 ──────────────────────────────────────

function runUnitTest(t: UnifiedTemplate): { ok: boolean; lines: { text: string; level: 'ok' | 'warn' | 'err' }[] } {
  const lines: { text: string; level: 'ok' | 'warn' | 'err' }[] = [];
  let hasErr = false;

  // 1. 基本字段
  if (!t.name?.trim()) { lines.push({ text: '模板名称为空', level: 'err' }); hasErr = true; }
  else lines.push({ text: `模板名称: ${t.name}`, level: 'ok' });

  if (!t.description?.trim()) lines.push({ text: '模板描述为空（建议补充）', level: 'warn' });

  // 2. 任务列表
  if (!t.tasks || t.tasks.length === 0) { lines.push({ text: '任务列表为空', level: 'err' }); hasErr = true; return { ok: false, lines }; }
  lines.push({ text: `任务数量: ${t.tasks.length}`, level: 'ok' });

  const taskIds = new Set(t.tasks.map(x => x.id));

  // 3. entry 校验
  if (!t.entry) { lines.push({ text: '未设置入口节点', level: 'err' }); hasErr = true; }
  else if (!taskIds.has(t.entry)) { lines.push({ text: `入口节点 ${t.entry} 不存在`, level: 'err' }); hasErr = true; }
  else lines.push({ text: `入口节点: ${t.tasks.find(x => x.id === t.entry)?.title || t.entry}`, level: 'ok' });

  // 4. terminals 校验
  if (!t.terminals || t.terminals.length === 0) { lines.push({ text: '未设置终止节点', level: 'warn' }); }
  else {
    const missingTerms = t.terminals.filter(x => !taskIds.has(x));
    if (missingTerms.length > 0) { lines.push({ text: `终止节点不存在: ${missingTerms.join(', ')}`, level: 'err' }); hasErr = true; }
    else lines.push({ text: `终止节点: ${t.terminals.length} 个`, level: 'ok' });
  }

  // 5. deps 引用校验
  const danglingDeps: string[] = [];
  for (const task of t.tasks) {
    for (const d of task.deps) {
      if (!taskIds.has(d)) danglingDeps.push(`${task.title}→${d}`);
    }
  }
  if (danglingDeps.length > 0) { lines.push({ text: `悬空依赖: ${danglingDeps.join(', ')}`, level: 'err' }); hasErr = true; }
  else lines.push({ text: '所有依赖引用有效', level: 'ok' });

  // 6. 循环依赖检测（DFS）
  const cycle = detectCycle(t.tasks);
  if (cycle) { lines.push({ text: `检测到循环依赖: ${cycle}`, level: 'err' }); hasErr = true; }
  else lines.push({ text: '无循环依赖（DAG 有效）', level: 'ok' });

  // 7. 可达性：从 entry 出发能否到达所有节点
  const unreachable = checkReachability(t);
  if (unreachable.length > 0) { lines.push({ text: `不可达节点: ${unreachable.join(', ')}`, level: 'warn' }); }
  else lines.push({ text: '所有节点从入口可达', level: 'ok' });

  // 8. 节点内容完整性（警告级）
  let warnCount = 0;
  for (const task of t.tasks) {
    if ((task.kind === 'phase' || task.kind === 'harness-call' || task.kind === 'sub-workflow') && !task.prompt?.trim()) {
      lines.push({ text: `${task.title}: 缺少 prompt 提示词`, level: 'warn' }); warnCount++;
    }
    if (task.kind === 'switch' && (!task.cases || task.cases.length === 0)) {
      lines.push({ text: `${task.title}: switch 节点缺少分支`, level: 'warn' }); warnCount++;
    }
    if (task.kind === 'sub-workflow' && !task.workflow) {
      lines.push({ text: `${task.title}: 子工作流未指定 workflow id`, level: 'warn' }); warnCount++;
    }
  }
  if (warnCount === 0) lines.push({ text: '所有节点内容完整', level: 'ok' });

  return { ok: !hasErr, lines };
}

// ── 测试逻辑：模拟测试 ──────────────────────────────────────

function runSimulation(t: UnifiedTemplate): { ok: boolean; lines: { text: string; level: 'ok' | 'warn' | 'err' }[] } {
  const lines: { text: string; level: 'ok' | 'warn' | 'err' }[] = [];
  let hasErr = false;

  if (!t.tasks || t.tasks.length === 0) { lines.push({ text: '无任务可模拟', level: 'err' }); return { ok: false, lines }; }
  if (!t.entry) { lines.push({ text: '无入口，无法模拟', level: 'err' }); return { ok: false, lines }; }

  // 拓扑排序模拟执行
  const order = topoSort(t.tasks);
  lines.push({ text: `模拟执行 ${order.length} 个阶段（拓扑序）`, level: 'ok' });

  const taskMap = new Map(t.tasks.map(x => [x.id, x]));
  const completed = new Set<string>();
  const executionLog: string[] = [];
  let stepCount = 0;
  const maxIter = t.maxIterations || 1000;

  for (const task of order) {
    stepCount++;
    if (stepCount > maxIter) { lines.push({ text: `超过最大迭代次数 ${maxIter}，可能死循环`, level: 'err' }); hasErr = true; break; }

    // 检查依赖是否完成
    const unmetDeps = task.deps.filter(d => !completed.has(d) && taskMap.has(d));
    if (unmetDeps.length > 0) {
      lines.push({ text: `步骤 ${stepCount}: ${task.title} 依赖未满足 (${unmetDeps.length} 个) — 跳过`, level: 'warn' });
      continue;
    }

    // 模拟执行该阶段
    const inputs = task.inputs?.length || 0;
    const outputs = task.outputs?.length || 0;
    const retry = task.retryPolicy?.maxAttempts || task.maxAttempts || 1;
    executionLog.push(`${stepCount}. ${KIND_ICONS[task.kind]} ${task.title}${inputs > 0 ? ` [读${inputs}输入]` : ''}${outputs > 0 ? ` [产${outputs}输出]` : ''}${retry > 1 ? ` (重试${retry})` : ''}`);
    completed.add(task.id);
  }

  // 输出执行路径（前 12 步）
  const showSteps = Math.min(executionLog.length, 12);
  for (let i = 0; i < showSteps; i++) {
    lines.push({ text: executionLog[i], level: 'ok' });
  }
  if (executionLog.length > 12) {
    lines.push({ text: `... 共 ${executionLog.length} 步（已截断显示）`, level: 'ok' });
  }

  // 终态可达性
  const terminals = t.terminals || [];
  const reachedTerms = terminals.filter(x => completed.has(x));
  if (terminals.length === 0) {
    lines.push({ text: '未定义终止节点', level: 'warn' });
  } else if (reachedTerms.length === terminals.length) {
    lines.push({ text: `所有终止节点可达 (${reachedTerms.length}/${terminals.length})`, level: 'ok' });
  } else {
    lines.push({ text: `${terminals.length - reachedTerms.length} 个终止节点不可达`, level: 'warn' });
  }

  // 统计
  const skipped = order.length - completed.size;
  lines.push({ text: `执行完成: ${completed.size}/${order.length} 成功${skipped > 0 ? `, ${skipped} 跳过` : ''}`, level: skipped > 0 ? 'warn' : 'ok' });

  return { ok: !hasErr, lines };
}

/** 检测循环依赖，返回环上的节点标题链 */
function detectCycle(tasks: TaskDef[]): string | null {
  const adj = new Map<string, string[]>();
  for (const t of tasks) adj.set(t.id, [...(t.deps || [])]);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const t of tasks) color.set(t.id, WHITE);
  const titleOf = new Map(tasks.map(t => [t.id, t.title]));

  // 使用容器对象避免 TS 控制流在闭包中窄化
  const state: { cycle: string[] | null } = { cycle: null };
  const dfs = (id: string, path: string[]): boolean => {
    color.set(id, GRAY);
    path.push(id);
    for (const next of adj.get(id) || []) {
      if (color.get(next) === GRAY) {
        // 找到环
        const start = path.indexOf(next);
        state.cycle = path.slice(start).concat(next);
        return true;
      }
      if (color.get(next) === WHITE && dfs(next, path)) return true;
    }
    path.pop();
    color.set(id, BLACK);
    return false;
  };

  for (const t of tasks) {
    if (color.get(t.id) === WHITE && dfs(t.id, [])) break;
  }
  if (state.cycle) return state.cycle.map(id => titleOf.get(id) || id).join(' → ');
  return null;
}

/** 检查从 entry 可达性，返回不可达节点的标题 */
function checkReachability(t: UnifiedTemplate): string[] {
  if (!t.entry) return t.tasks.map(x => x.title);
  const adj = new Map<string, string[]>();
  // 正向邻接：deps 表示反向，需要构造 from→to
  for (const task of t.tasks) {
    adj.set(task.id, []);
  }
  for (const task of t.tasks) {
    for (const d of task.deps) {
      if (adj.has(d)) adj.get(d)!.push(task.id);
    }
  }
  const visited = new Set<string>();
  const queue = [t.entry];
  visited.add(t.entry);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) || []) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return t.tasks.filter(t => !visited.has(t.id)).map(t => t.title);
}

// ── 阶段详情面板（中间栏，展开所有字段）─────────────────────

function TaskDetailPanel({ task, allTasks, entry, terminals, readOnly, onUpdate }: {
  task: TaskDef;
  allTasks: TaskDef[];
  entry: string;
  terminals: string[];
  readOnly?: boolean;
  onUpdate: (patch: Partial<TaskDef>) => void;
}) {
  const isEntry = entry === task.id;
  const isTerminal = terminals.includes(task.id);

  return (
    <div className="tmpl-task-detail">
      {/* 标题行 */}
      <div className="tmpl-detail-head">
        <span className="tmpl-task-kind-chip" style={{ background: KIND_COLORS[task.kind] }}>
          {KIND_ICONS[task.kind]} {KIND_LABELS[task.kind]}
        </span>
        <input
          type="text" value={task.title} placeholder="阶段标题"
          onChange={e => onUpdate({ title: e.target.value })}
          disabled={readOnly}
          className="tmpl-input tmpl-task-title-input"
        />
        <select
          value={task.kind}
          onChange={e => onUpdate({ kind: e.target.value as TaskKind })}
          disabled={readOnly}
          className="tmpl-input tmpl-task-kind-select"
        >
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
        </select>
        {isEntry && <span className="tmpl-tag entry">入口</span>}
        {isTerminal && <span className="tmpl-tag terminal">终态</span>}
      </div>

      <div className="tmpl-detail-body">
        {/* 描述 */}
        <div className="tmpl-field tmpl-field-full">
          <label>阶段描述</label>
          <textarea
            value={task.description || ''} placeholder="该阶段的详细描述..." rows={2}
            onChange={e => onUpdate({ description: e.target.value })}
            disabled={readOnly}
            className="tmpl-input"
          />
        </div>

        {/* 基础字段：phase / model / timeout */}
        <div className="tmpl-task-row">
          <div className="tmpl-field">
            <label>Phase 阶段</label>
            <select
              value={task.phase || ''}
              onChange={e => onUpdate({ phase: e.target.value || undefined })}
              disabled={readOnly}
              className="tmpl-input"
            >
              <option value="">无</option>
              {PHASES.map(p => <option key={p.id} value={p.id}>{p.icon} {p.label}</option>)}
            </select>
          </div>
          <div className="tmpl-field">
            <label>模型 Model</label>
            <select
              value={task.model || 'sonnet'}
              onChange={e => onUpdate({ model: e.target.value })}
              disabled={readOnly}
              className="tmpl-input"
            >
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="tmpl-field">
            <label>超时（秒）</label>
            <input
              type="number" value={task.timeoutMs ? Math.round(task.timeoutMs / 1000) : ''}
              placeholder="无"
              onChange={e => onUpdate({ timeoutMs: e.target.value ? Number(e.target.value) * 1000 : undefined })}
              disabled={readOnly}
              className="tmpl-input"
            />
          </div>
        </div>

        {/* Gate 配置 */}
        {task.kind === 'gate' && (
          <div className="tmpl-task-row">
            <div className="tmpl-field">
              <label>门禁类型</label>
              <select
                value={task.gate || 'test'}
                onChange={e => onUpdate({ gate: e.target.value as GateType })}
                disabled={readOnly}
                className="tmpl-input"
              >
                {GATE_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Human-gate 审批配置 */}
        {task.kind === 'human-gate' && (
          <div className="tmpl-task-row">
            <div className="tmpl-field tmpl-field-grow">
              <label>审批提示</label>
              <input
                type="text" value={task.approvalPrompt || ''} placeholder="请审批..."
                onChange={e => onUpdate({ approvalPrompt: e.target.value })}
                disabled={readOnly}
                className="tmpl-input"
              />
            </div>
          </div>
        )}

        {/* Harness-call 配置 */}
        {task.kind === 'harness-call' && (
          <div className="tmpl-task-row">
            <div className="tmpl-field">
              <label>Harness</label>
              <input
                type="text" value={task.harness || ''} placeholder="claude"
                onChange={e => onUpdate({ harness: e.target.value })}
                disabled={readOnly}
                className="tmpl-input"
              />
            </div>
            <div className="tmpl-field">
              <label>注入变量 (injectAs)</label>
              <input
                type="text" value={task.injectAs || ''} placeholder="injectAs"
                onChange={e => onUpdate({ injectAs: e.target.value })}
                disabled={readOnly}
                className="tmpl-input"
              />
            </div>
          </div>
        )}

        {/* Sub-workflow 配置 */}
        {task.kind === 'sub-workflow' && (
          <div className="tmpl-task-row">
            <div className="tmpl-field tmpl-field-grow">
              <label>子工作流 ID</label>
              <input
                type="text" value={task.workflow || ''} placeholder="template-id"
                onChange={e => onUpdate({ workflow: e.target.value })}
                disabled={readOnly}
                className="tmpl-input"
              />
            </div>
          </div>
        )}

        {/* Switch 分支 */}
        {task.kind === 'switch' && (
          <SwitchCasesEditor
            cases={task.cases || []}
            onChange={cases => onUpdate({ cases })}
            readOnly={readOnly}
          />
        )}

        {/* Prompt（输入提示词）*/}
        {(task.kind === 'phase' || task.kind === 'harness-call' || task.kind === 'sub-workflow') && (
          <div className="tmpl-field tmpl-field-full">
            <label>📝 Prompt（输入提示词）</label>
            <textarea
              value={task.prompt || ''} placeholder="该阶段的 Claude 提示词..." rows={6}
              onChange={e => onUpdate({ prompt: e.target.value })}
              disabled={readOnly}
              className="tmpl-input tmpl-input-mono"
            />
          </div>
        )}

        {/* 输入参数（task.params：输入变量）*/}
        <div className="tmpl-field tmpl-field-full">
          <label>� 输入参数 (params)</label>
          <ParamsKeyValueEditor
            params={task.params || {}}
            onChange={params => onUpdate({ params })}
            readOnly={readOnly}
          />
        </div>

        {/* 输入：文档/目录 */}
        <div className="tmpl-field tmpl-field-full">
          <label>📥 输入（文档/目录/文件）</label>
          <IOListEditor
            items={task.inputs || []}
            onChange={inputs => onUpdate({ inputs })}
            readOnly={readOnly}
          />
        </div>

        {/* 输出：产物目标 */}
        <div className="tmpl-field tmpl-field-full">
          <label>📤 输出（产物目标）</label>
          <IOListEditor
            items={task.outputs || []}
            onChange={outputs => onUpdate({ outputs })}
            readOnly={readOnly}
          />
        </div>

        {/* 依赖 */}
        <div className="tmpl-task-deps">
          <span className="tmpl-muted">依赖: </span>
          {task.deps.length === 0 ? (
            <span className="tmpl-tag dep">无（入口前置）</span>
          ) : (
            task.deps.map(d => {
              const dep = allTasks.find(t => t.id === d);
              return <span key={d} className="tmpl-tag dep">{dep?.title || d}</span>;
            })
          )}
          {task.fallbackTo && (
            <>
              <span className="tmpl-muted"> · 失败回退: </span>
              <span className="tmpl-tag fallback">{allTasks.find(t => t.id === task.fallbackTo)?.title || task.fallbackTo}</span>
            </>
          )}
        </div>

        {/* 高级配置（始终展开）*/}
        {!readOnly && (
          <div className="tmpl-task-advanced">
            <h5 className="tmpl-adv-h">⚡ 高级配置</h5>

            <RetryPolicyEditor
              policy={task.retryPolicy}
              maxAttempts={task.maxAttempts}
              onChange={(retryPolicy, maxAttempts) => onUpdate({ retryPolicy, maxAttempts })}
            />

            <div className="tmpl-field tmpl-field-grow">
              <label>失败回退到</label>
              <select
                value={task.fallbackTo || ''}
                onChange={e => onUpdate({ fallbackTo: e.target.value || undefined })}
                className="tmpl-input"
              >
                <option value="">无</option>
                {allTasks.filter(t => t.id !== task.id).map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </div>

            <AdvisorsEditor
              advisors={task.advisors || []}
              onChange={advisors => onUpdate({ advisors })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── 参数键值对编辑器（task.params 输入变量）─────────────────

function ParamsKeyValueEditor({ params, onChange, readOnly }: {
  params: Record<string, string>;
  onChange: (p: Record<string, string>) => void;
  readOnly?: boolean;
}) {
  const entries = Object.entries(params);
  return (
    <div className="tmpl-kv-list">
      {entries.length === 0 && <div className="tmpl-empty-inline">无输入参数</div>}
      {entries.map(([k, v], i) => (
        <div key={i} className="tmpl-kv-row">
          <input
            type="text" value={k} placeholder="参数名"
            onChange={e => {
              const next = { ...params };
              delete next[k];
              next[e.target.value] = v;
              onChange(next);
            }}
            disabled={readOnly}
            className="tmpl-input tmpl-input-mono tmpl-input-kv-key"
          />
          <input
            type="text" value={v} placeholder="值"
            onChange={e => onChange({ ...params, [k]: e.target.value })}
            disabled={readOnly}
            className="tmpl-input tmpl-input-kv-val"
          />
          {!readOnly && (
            <button className="tmpl-btn-icon tmpl-btn-icon-danger" onClick={() => {
              const next = { ...params };
              delete next[k];
              onChange(next);
            }} type="button">✕</button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button className="tmpl-btn tmpl-btn-sm" onClick={() => onChange({ ...params, '': '' })} type="button">
          ➕ 添加参数
        </button>
      )}
    </div>
  );
}

// ── 输入/输出列表编辑器（文档/目录/文件）─────────────────────

const IO_TYPE_OPTIONS: { value: TaskIO['type']; label: string; icon: string }[] = [
  { value: 'file', label: '文件', icon: '📄' },
  { value: 'dir', label: '目录', icon: '📁' },
  { value: 'doc', label: '文档', icon: '📑' },
  { value: 'var', label: '变量', icon: '🔹' },
];

function IOListEditor({ items, onChange, readOnly }: {
  items: TaskIO[];
  onChange: (items: TaskIO[]) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="tmpl-io-list">
      {items.length === 0 && <div className="tmpl-empty-inline">无</div>}
      {items.map((item, i) => (
        <div key={i} className="tmpl-io-row">
          <select
            value={item.type}
            onChange={e => onChange(items.map((it, j) => j === i ? { ...it, type: e.target.value as TaskIO['type'] } : it))}
            disabled={readOnly}
            className="tmpl-input tmpl-input-io-type"
          >
            {IO_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.icon} {o.label}</option>)}
          </select>
          <input
            type="text" value={item.name} placeholder="名称"
            onChange={e => onChange(items.map((it, j) => j === i ? { ...it, name: e.target.value } : it))}
            disabled={readOnly}
            className="tmpl-input tmpl-input-io-name"
          />
          <input
            type="text" value={item.path || ''} placeholder="路径（如 src/ 或 docs/spec.md）"
            onChange={e => onChange(items.map((it, j) => j === i ? { ...it, path: e.target.value } : it))}
            disabled={readOnly}
            className="tmpl-input tmpl-input-io-path tmpl-input-mono"
          />
          <label className="tmpl-io-required" title="必填">
            <input
              type="checkbox" checked={!!item.required}
              onChange={e => onChange(items.map((it, j) => j === i ? { ...it, required: e.target.checked } : it))}
              disabled={readOnly}
            />
            <span>必填</span>
          </label>
          {!readOnly && (
            <button className="tmpl-btn-icon tmpl-btn-icon-danger" onClick={() => onChange(items.filter((_, j) => j !== i))} type="button" title="删除">✕</button>
          )}
          <input
            type="text" value={item.description || ''} placeholder="说明（可选）"
            onChange={e => onChange(items.map((it, j) => j === i ? { ...it, description: e.target.value } : it))}
            disabled={readOnly}
            className="tmpl-input tmpl-input-io-desc"
          />
        </div>
      ))}
      {!readOnly && (
        <button className="tmpl-btn tmpl-btn-sm" onClick={() => onChange([...items, { name: '', type: 'file', path: '' }])} type="button">
          ➕ 添加
        </button>
      )}
    </div>
  );
}

// ── 重试策略编辑器 ─────────────────────────────────────────

function RetryPolicyEditor({ policy, maxAttempts, onChange }: {
  policy?: RetryPolicy;
  maxAttempts?: number;
  onChange: (policy: RetryPolicy | undefined, maxAttempts: number | undefined) => void;
}) {
  const hasPolicy = !!policy;
  const current = policy || { maxAttempts: maxAttempts || 1 };

  return (
    <div className="tmpl-adv-section">
      <div className="tmpl-adv-section-head">
        <label className="tmpl-checkbox">
          <input
            type="checkbox" checked={hasPolicy}
            onChange={e => onChange(e.target.checked ? { maxAttempts: 3 } : undefined, e.target.checked ? undefined : (maxAttempts || 1))}
          />
          <span>启用退避重试策略</span>
        </label>
        {!hasPolicy && (
          <div className="tmpl-field tmpl-inline">
            <label>简单重试次数</label>
            <input
              type="number" min={0} value={maxAttempts ?? ''}
              onChange={e => onChange(undefined, e.target.value ? Number(e.target.value) : undefined)}
              className="tmpl-input tmpl-input-narrow"
            />
          </div>
        )}
      </div>
      {hasPolicy && (
        <div className="tmpl-adv-grid">
          <div className="tmpl-field">
            <label>最大次数</label>
            <input
              type="number" min={1} value={current.maxAttempts}
              onChange={e => onChange({ ...current, maxAttempts: Number(e.target.value) }, undefined)}
              className="tmpl-input tmpl-input-narrow"
            />
          </div>
          <div className="tmpl-field">
            <label>退避策略</label>
            <select
              value={current.backoff || 'none'}
              onChange={e => onChange({ ...current, backoff: e.target.value as RetryPolicy['backoff'] }, undefined)}
              className="tmpl-input"
            >
              {BACKOFF_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="tmpl-field">
            <label>基础延迟 (ms)</label>
            <input
              type="number" min={0} value={current.baseDelayMs ?? ''}
              onChange={e => onChange({ ...current, baseDelayMs: e.target.value ? Number(e.target.value) : undefined }, undefined)}
              className="tmpl-input tmpl-input-narrow"
            />
          </div>
          <div className="tmpl-field">
            <label>最大延迟 (ms)</label>
            <input
              type="number" min={0} value={current.maxDelayMs ?? ''}
              onChange={e => onChange({ ...current, maxDelayMs: e.target.value ? Number(e.target.value) : undefined }, undefined)}
              className="tmpl-input tmpl-input-narrow"
            />
          </div>
          <div className="tmpl-field">
            <label>抖动 (0-1)</label>
            <input
              type="number" min={0} max={1} step={0.05} value={current.jitter ?? ''}
              onChange={e => onChange({ ...current, jitter: e.target.value ? Number(e.target.value) : undefined }, undefined)}
              className="tmpl-input tmpl-input-narrow"
            />
          </div>
          <div className="tmpl-field tmpl-field-grow">
            <label>重试条件 (表达式)</label>
            <input
              type="text" value={current.condition || ''} placeholder='如 errorType !== "fatal"'
              onChange={e => onChange({ ...current, condition: e.target.value || undefined }, undefined)}
              className="tmpl-input tmpl-input-mono"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI 顾问编辑器 ─────────────────────────────────────────

function AdvisorsEditor({ advisors, onChange }: {
  advisors: Advisor[];
  onChange: (a: Advisor[]) => void;
}) {
  return (
    <div className="tmpl-adv-section">
      <div className="tmpl-adv-section-head">
        <span className="tmpl-adv-h-inline">💡 AI 顾问</span>
        <button className="tmpl-btn tmpl-btn-sm" onClick={() => onChange([...advisors, { trigger: 'failure', harness: 'fix-advisor', injectAs: '' }])} type="button">
          ➕ 添加
        </button>
      </div>
      {advisors.length === 0 ? (
        <div className="tmpl-empty-inline">无 AI 顾问</div>
      ) : (
        <div className="tmpl-advisors-list">
          {advisors.map((a, i) => (
            <div key={i} className="tmpl-advisor-row">
              <select
                value={a.trigger}
                onChange={e => onChange(advisors.map((x, j) => j === i ? { ...x, trigger: e.target.value as Advisor['trigger'] } : x))}
                className="tmpl-input"
              >
                {ADVISOR_TRIGGER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input
                type="text" value={a.harness} placeholder="harness"
                onChange={e => onChange(advisors.map((x, j) => j === i ? { ...x, harness: e.target.value } : x))}
                className="tmpl-input tmpl-input-mono"
              />
              <input
                type="text" value={a.injectAs || ''} placeholder="injectAs"
                onChange={e => onChange(advisors.map((x, j) => j === i ? { ...x, injectAs: e.target.value || undefined } : x))}
                className="tmpl-input tmpl-input-mono"
              />
              <button className="tmpl-btn-icon tmpl-btn-icon-danger" onClick={() => onChange(advisors.filter((_, j) => j !== i))} type="button">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Switch 分支编辑器 ─────────────────────────────────────

function SwitchCasesEditor({ cases, onChange, readOnly }: {
  cases: SwitchCase[];
  onChange: (c: SwitchCase[]) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="tmpl-task-row">
      <div className="tmpl-field tmpl-field-full">
        <label>条件分支</label>
        {cases.length === 0 && <div className="tmpl-empty-inline">无分支</div>}
        {cases.map((c, i) => (
          <div key={i} className="tmpl-case-row">
            <input
              type="text" value={c.when} placeholder='如 complexity === "high"'
              onChange={e => onChange(cases.map((x, j) => j === i ? { ...x, when: e.target.value } : x))}
              disabled={readOnly}
              className="tmpl-input tmpl-input-mono"
            />
            <span className="tmpl-muted">→</span>
            <input
              type="text" value={c.to} placeholder="目标节点 id"
              onChange={e => onChange(cases.map((x, j) => j === i ? { ...x, to: e.target.value } : x))}
              disabled={readOnly}
              className="tmpl-input tmpl-input-mono"
            />
            <input
              type="text" value={c.label || ''} placeholder="分支标签"
              onChange={e => onChange(cases.map((x, j) => j === i ? { ...x, label: e.target.value || undefined } : x))}
              disabled={readOnly}
              className="tmpl-input"
            />
            {!readOnly && (
              <button className="tmpl-btn-icon tmpl-btn-icon-danger" onClick={() => onChange(cases.filter((_, j) => j !== i))} type="button">✕</button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button className="tmpl-btn tmpl-btn-sm" onClick={() => onChange([...cases, { when: '', to: '' }])} type="button">
            ➕ 添加分支
          </button>
        )}
      </div>
    </div>
  );
}

// ── 图级配置（params / maxIterations / edges）──────────────

function GraphConfigSection({ template, onChange }: {
  template: UnifiedTemplate;
  onChange: (patch: Partial<UnifiedTemplate>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasGraphConfig = (template.params && template.params.length > 0) ||
                         template.maxIterations ||
                         (template.edges && template.edges.length > 0);

  return (
    <div className="tmpl-editor-section">
      <div className="tmpl-editor-section-head">
        <h4>
          <button className="tmpl-collapse-btn" onClick={() => setExpanded(!expanded)} type="button">
            {expanded ? '▼' : '▶'} ⚡ 图级配置
          </button>
          {hasGraphConfig && <span className="tmpl-tag adv">已配置</span>}
        </h4>
      </div>
      {expanded && (
        <div className="tmpl-editor-section-body">
          {/* maxIterations */}
          <div className="tmpl-field">
            <label>最大迭代次数（图级防死循环）</label>
            <input
              type="number" min={0} value={template.maxIterations ?? ''}
              placeholder="无限制"
              onChange={e => onChange({ maxIterations: e.target.value ? Number(e.target.value) : undefined })}
              className="tmpl-input tmpl-input-narrow"
            />
          </div>

          {/* params */}
          <ParamsEditor
            params={template.params || []}
            onChange={params => onChange({ params })}
          />

          {/* edges（显式条件边）*/}
          <EdgesEditor
            edges={template.edges || []}
            tasks={template.tasks}
            onChange={edges => onChange({ edges })}
          />
        </div>
      )}
    </div>
  );
}

function ParamsEditor({ params, onChange }: {
  params: ParamDef[];
  onChange: (p: ParamDef[]) => void;
}) {
  return (
    <div className="tmpl-adv-section">
      <div className="tmpl-adv-section-head">
        <span className="tmpl-adv-h-inline">📋 参数声明</span>
        <button className="tmpl-btn tmpl-btn-sm" onClick={() => onChange([...params, { name: '', type: 'string' }])} type="button">
          ➕ 添加参数
        </button>
      </div>
      {params.length === 0 ? (
        <div className="tmpl-empty-inline">无参数</div>
      ) : (
        <div className="tmpl-params-list">
          {params.map((p, i) => (
            <div key={i} className="tmpl-param-row">
              <input
                type="text" value={p.name} placeholder="参数名"
                onChange={e => onChange(params.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                className="tmpl-input tmpl-input-mono"
              />
              <select
                value={p.type}
                onChange={e => onChange(params.map((x, j) => j === i ? { ...x, type: e.target.value as ParamDef['type'] } : x))}
                className="tmpl-input"
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="enum">enum</option>
              </select>
              <label className="tmpl-checkbox tmpl-inline-checkbox">
                <input
                  type="checkbox" checked={p.required || false}
                  onChange={e => onChange(params.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))}
                />
                <span>必填</span>
              </label>
              <input
                type="text" value={p.default !== undefined ? String(p.default) : ''} placeholder="默认值"
                onChange={e => onChange(params.map((x, j) => j === i ? { ...x, default: e.target.value } : x))}
                className="tmpl-input"
              />
              <input
                type="text" value={p.description || ''} placeholder="描述"
                onChange={e => onChange(params.map((x, j) => j === i ? { ...x, description: e.target.value || undefined } : x))}
                className="tmpl-input"
              />
              <button className="tmpl-btn-icon tmpl-btn-icon-danger" onClick={() => onChange(params.filter((_, j) => j !== i))} type="button">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EdgesEditor({ edges, tasks, onChange }: {
  edges: EdgeDef[];
  tasks: TaskDef[];
  onChange: (e: EdgeDef[]) => void;
}) {
  return (
    <div className="tmpl-adv-section">
      <div className="tmpl-adv-section-head">
        <span className="tmpl-adv-h-inline">🔗 显式边（条件路由）</span>
        <button className="tmpl-btn tmpl-btn-sm" onClick={() => onChange([...edges, { from: '', to: '', when: 'onSuccess' }])} type="button">
          ➕ 添加边
        </button>
      </div>
      {edges.length === 0 ? (
        <div className="tmpl-empty-inline">无显式边（使用隐式 deps 线性依赖）</div>
      ) : (
        <div className="tmpl-edges-list">
          {edges.map((e, i) => (
            <div key={i} className="tmpl-edge-row">
              <select
                value={e.from}
                onChange={ev => onChange(edges.map((x, j) => j === i ? { ...x, from: ev.target.value } : x))}
                className="tmpl-input"
              >
                <option value="">from</option>
                {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <span className="tmpl-muted">→</span>
              <select
                value={e.to}
                onChange={ev => onChange(edges.map((x, j) => j === i ? { ...x, to: ev.target.value } : x))}
                className="tmpl-input"
              >
                <option value="">to</option>
                {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <input
                type="text" value={typeof e.when === 'string' ? e.when : (e.when?.expr || '')}
                placeholder='onSuccess / onFailure / 表达式'
                onChange={ev => {
                  const val = ev.target.value;
                  const when = val.startsWith('on') ? val : { expr: val };
                  onChange(edges.map((x, j) => j === i ? { ...x, when } : x));
                }}
                className="tmpl-input tmpl-input-mono"
              />
              <input
                type="text" value={e.label || ''} placeholder="标签"
                onChange={ev => onChange(edges.map((x, j) => j === i ? { ...x, label: ev.target.value || undefined } : x))}
                className="tmpl-input"
              />
              <button className="tmpl-btn-icon tmpl-btn-icon-danger" onClick={() => onChange(edges.filter((_, j) => j !== i))} type="button">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 流程图预览 ─────────────────────────────────────────────

function FlowGraphSection({ template, selectedNodeId, onSelectNode }: {
  template: UnifiedTemplate;
  selectedNodeId?: string | null;
  onSelectNode?: (id: string) => void;
}) {
  const wf = useMemo(() => {
    const t: any = {
      id: template.id, name: template.name, description: template.description,
      kind: template.kind, entry: template.entry, terminals: template.terminals,
      tasks: template.tasks, params: template.params, maxIterations: template.maxIterations,
      edges: template.edges,
    };
    return templateToWorkflowDetail(t);
  }, [template]);

  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selected = selectedNodeId !== undefined ? selectedNodeId : localSelected;

  return (
    <div className="tmpl-editor-section tmpl-flow-section">
      <h4 className="tmpl-editor-section-h">📊 流程图</h4>
      <WfFlowGraph
        wf={wf}
        selectedNodeId={selected}
        onSelectNode={(id) => {
          setLocalSelected(id);
          onSelectNode?.(id);
        }}
      />
    </div>
  );
}

// ── 应用到项目面板 ─────────────────────────────────────────

function ApplyPanel({ template, repoPath, onApply, applying }: {
  template: UnifiedTemplate;
  repoPath: string;
  onApply: (goal: string, autoApprove: boolean, testCommand?: string) => Promise<void>;
  applying?: boolean;
}) {
  const [goal, setGoal] = useState('');
  const [testCmd, setTestCmd] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // 按钮仅在进行中时禁用；goal 为空时也允许点击，点击后给出提示
  const isBusy = running || applying;

  const run = async () => {
    if (!goal.trim()) {
      setMsg('⚠️ 请先填写项目目标');
      const input = document.querySelector<HTMLInputElement>('.tmpl-input-goal');
      if (input) input.focus();
      return;
    }
    if (!repoPath) {
      setMsg('⚠️ 请先选择项目');
      return;
    }
    setRunning(true); setMsg(null);
    try {
      await onApply(goal.trim(), autoApprove, testCmd.trim() || undefined);
      setMsg('✓ 编排已创建，可在「AI 编排工坊」查看运行状态');
      setGoal('');
    } catch (e: any) {
      setMsg(`✗ 失败：${e?.message || e}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="tmpl-apply-inline">
      <input
        className="tmpl-input tmpl-input-goal"
        placeholder="目标：例如迁移到 Spring Boot 3.x"
        value={goal}
        onChange={e => setGoal(e.target.value)}
        title="项目目标"
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); run(); } }}
      />
      <input
        className="tmpl-input tmpl-input-testcmd"
        placeholder="测试命令（可选）"
        value={testCmd}
        onChange={e => setTestCmd(e.target.value)}
        title="测试命令"
      />
      <label className="tmpl-checkbox tmpl-inline-checkbox" title="自动批准">
        <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
        <span>自动</span>
      </label>
      <button className="tmpl-btn tmpl-btn-primary" disabled={isBusy} onClick={run} type="button" title={goal.trim() ? '应用到项目' : '请先填写目标'}>
        {running ? '创建中…' : '🚀 应用'}
      </button>
      {msg && <span className={msg.startsWith('✓') ? 'tmpl-apply-ok' : 'tmpl-apply-err'}>{msg}</span>}
    </div>
  );
}

// ── 工具：拓扑排序 ─────────────────────────────────────────

function topoSort(tasks: TaskDef[]): TaskDef[] {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const idToTask = new Map<string, TaskDef>();
  for (const t of tasks) {
    idToTask.set(t.id, t);
    inDeg.set(t.id, 0);
    adj.set(t.id, []);
  }
  for (const t of tasks) {
    for (const d of t.deps) {
      if (adj.has(d)) adj.get(d)!.push(t.id);
      if (inDeg.has(t.id)) inDeg.set(t.id, inDeg.get(t.id)! + 1);
    }
  }
  const queue: string[] = [];
  for (const [id, d] of inDeg) if (d === 0) queue.push(id);
  const result: TaskDef[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const t = idToTask.get(id);
    if (t) result.push(t);
    for (const next of adj.get(id) || []) {
      inDeg.set(next, inDeg.get(next)! - 1);
      if (inDeg.get(next) === 0) queue.push(next);
    }
  }
  // 不可达节点放末尾
  for (const t of tasks) {
    if (!result.find(r => r.id === t.id)) result.push(t);
  }
  return result;
}
