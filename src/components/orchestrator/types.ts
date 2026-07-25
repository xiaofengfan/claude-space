/**
 * 编排面板共享类型（前端版本）
 *
 * 与 claude-space-orchestrator/electron/orchestrator/types.ts 对应
 * 仅保留渲染层需要的字段，避免引入 Node 依赖
 */

// ── v3 引擎扩展类型（前置声明，供 TaskDef/Template 引用）────────
export interface RetryPolicy {
  maxAttempts: number;
  backoff?: 'none' | 'linear' | 'exponential';
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  condition?: string;
}

export interface Advisor {
  trigger: 'failure' | 'gate-fail' | 'before-approve' | 'on-retry' | 'after-node';
  harness: string;
  injectAs?: string;
  config?: Record<string, unknown>;
}

export interface SwitchCase {
  when: string;
  to: string;
  label?: string;
}

export interface ParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  enum?: string[];
}

export interface EdgeDef {
  from: string;
  to: string;
  when?: string | { expr: string };
  priority?: number;
  label?: string;
}

export type TaskKind =
  | 'phase'
  | 'gate'
  | 'human-gate'
  | 'harness-call'
  | 'sub-workflow'
  | 'switch';

export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'done'
  | 'failed'
  | 'blocked';

export type GateType = 'test' | 'review';

export interface TaskDef {
  id: string;
  title: string;
  description?: string;
  kind: TaskKind;
  deps: string[];
  phase?: string;
  prompt?: string;
  gate?: GateType;
  approvalPrompt?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  fallbackTo?: string;
  // v3 扩展字段
  retryPolicy?: RetryPolicy;
  advisors?: Advisor[];
  cases?: SwitchCase[];
  workflow?: string;
  params?: Record<string, string>;
  harness?: string;
  injectAs?: string;
  /** phase 节点使用的模型（sonnet/opus 等，可选）*/
  model?: string;
  /** 输入：文档/目录/变量 */
  inputs?: TaskIO[];
  /** 输出：产物目标 */
  outputs?: TaskIO[];
}

/** 阶段输入/输出项 */
export interface TaskIO {
  name: string;
  type: 'file' | 'dir' | 'doc' | 'var';
  path?: string;
  description?: string;
  required?: boolean;
}

export interface Task extends TaskDef {
  orchestrationId: string;
  status: TaskStatus;
  attempts: number;
  worktreePath?: string;
  worktreeBranch?: string;
  lastError?: string;
  lastRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  taskId: string;
  attempt: number;
  sessionId?: string;
  startedAt: string;
  finishedAt?: string;
  outcome?: 'success' | 'failure' | 'gate-fail' | 'interrupted';
  commitHash?: string;
  error?: string;
}

export type OrchestrationStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'success'
  | 'failed'
  | 'interrupted';

export interface Orchestration {
  id: string;
  projectId: string;
  templateId: string;
  status: OrchestrationStatus;
  goal: string;
  testCommand?: string;
  autoApprove: boolean;
  model?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  kind: 'greenfield' | 'refactor' | 'migration' | 'upgrade' | 'hotfix' | 'custom';
  tasks: TaskDef[];
  entry: string;
  terminals: string[];
  // v3 扩展字段
  params?: ParamDef[];
  maxIterations?: number;
  edges?: EdgeDef[];
}

export interface IpcResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface OrchestrationStatusData {
  orchestration: Orchestration;
  tasks: Task[];
}

export interface TaskDetailData {
  task: Task;
  runs: Run[];
}

// ── 事件 payload 类型 ────────────────────────────────
export interface EventPayload {
  repoPath: string;
  orchestrationId: string;
  [key: string]: unknown;
}

// ── 节点类型与图标映射 ───────────────────────────────
export const KIND_ICON: Record<TaskKind, string> = {
  phase: '🤖',
  gate: '✓',
  'human-gate': '✋',
  'harness-call': '🔗',
  'sub-workflow': '📦',
  switch: '🔀',
};

export const KIND_LABEL: Record<TaskKind, string> = {
  phase: 'AI 执行',
  gate: '质量门禁',
  'human-gate': '人工审批',
  'harness-call': 'Harness 调用',
  'sub-workflow': '子工作流',
  switch: '条件分支',
};

export const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: '#666',
  ready: '#888',
  running: '#6c8cff',
  done: '#4ade80',
  failed: '#ef4444',
  blocked: '#f59e0b',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '待执行',
  ready: '就绪',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  blocked: '阻塞',
};

export const ORCH_STATUS_LABEL: Record<OrchestrationStatus, string> = {
  pending: '待启动',
  running: '执行中',
  paused: '已暂停',
  success: '成功',
  failed: '失败',
  interrupted: '已中断',
};

export const ORCH_STATUS_COLOR: Record<OrchestrationStatus, string> = {
  pending: '#888',
  running: '#6c8cff',
  paused: '#f59e0b',
  success: '#4ade80',
  failed: '#ef4444',
  interrupted: '#a78bfa',
};

// ── 工作流详情视图类型（借鉴 Foundry WorkflowDetail）────────
// 把当前 Template（tasks + deps）适配为 Foundry 风格的 nodes + edges 结构

export interface WfNode {
  id: string;
  kind: TaskKind;
  title: string;
  description?: string;
  phase?: string;
  gate?: GateType;
  approvalPrompt?: string;
  maxAttempts?: number;
  timeoutMs?: number;
  fallbackTo?: string;
  prompt?: string;
  deps: string[];
  // v3 扩展
  retryPolicy?: RetryPolicy;
  advisors?: Advisor[];
  cases?: SwitchCase[];
  workflow?: string;
  params?: Record<string, string>;
  harness?: string;
  injectAs?: string;
}

export interface WfEdge {
  from: string;
  to: string;
  isFallback: boolean;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  description: string;
  kind: Template['kind'];
  entry: string;
  terminals: string[];
  nodes: WfNode[];
  edges: WfEdge[];
  // v3 扩展（从 Template 透传）
  params?: ParamDef[];
  maxIterations?: number;
  explicitEdges?: EdgeDef[];
}

// ── Template → WorkflowDetail 适配函数 ────────────────────
export function templateToWorkflowDetail(t: Template): WorkflowDetail {
  const nodes: WfNode[] = t.tasks.map((task) => ({
    id: task.id,
    kind: task.kind,
    title: task.title,
    description: task.description,
    phase: task.phase,
    gate: task.gate,
    approvalPrompt: task.approvalPrompt,
    maxAttempts: task.maxAttempts,
    timeoutMs: task.timeoutMs,
    fallbackTo: task.fallbackTo,
    prompt: task.prompt,
    deps: task.deps,
    // v3 扩展字段
    retryPolicy: task.retryPolicy,
    advisors: task.advisors,
    cases: task.cases,
    workflow: task.workflow,
    params: task.params,
    harness: task.harness,
    injectAs: task.injectAs,
  }));

  const edges: WfEdge[] = [];
  for (const task of t.tasks) {
    for (const dep of task.deps) {
      edges.push({ from: dep, to: task.id, isFallback: false });
    }
    if (task.fallbackTo) {
      edges.push({ from: task.id, to: task.fallbackTo, isFallback: true });
    }
  }

  return {
    id: t.id,
    name: t.name,
    description: t.description,
    kind: t.kind,
    entry: t.entry,
    terminals: t.terminals,
    nodes,
    edges,
    // v3 透传
    params: t.params,
    maxIterations: t.maxIterations,
    explicitEdges: t.edges,
  };
}



// ── 节点 kind 颜色（用于 SVG 流程图）────────────────────
export const NODE_KIND_COLOR: Record<TaskKind, string> = {
  phase: '#3a4a6a',
  gate: '#a05a2a',
  'human-gate': '#6a3a8a',
  'harness-call': '#2a6a5a',
  'sub-workflow': '#6a5a2a',
  switch: '#5a2a6a',
};

// ── Phase 中文标签（借鉴 Foundry）────────────────────────
export const PHASE_CN: Record<string, string> = {
  INGEST: '接入',
  COMPREHEND: '解读',
  ANALYZE: '分析',
  UNDERSTAND: '理解',
  ARCHITECT: '架构',
  DECOMPOSE: '拆分',
  PLAN: '计划',
  EXECUTE: '执行',
  INTEGRATE: '整合',
  DEPLOY: '部署',
  DONE: '完成',
};
