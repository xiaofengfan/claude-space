/**
 * 编排引擎类型定义
 *
 * 核心概念：
 * - Orchestration：一次编排运行（用户选模板 + 填目标 → 生成一组 Task）
 * - Task：编排中的一个节点（phase/gate/human-gate），有依赖关系形成 DAG
 * - Run：Task 的一次执行尝试（支持重试，每次 attempt 一个 Run）
 */

// ── 任务相关 ──────────────────────────────────────────────

/** 节点类型 */
export type TaskKind =
  | 'phase'         // AI 执行阶段
  | 'gate'          // 质量门禁（test/review）
  | 'human-gate'    // 人工审批
  | 'harness-call'  // 多轮 AI 交互调用（可暂停/恢复/嵌套）
  | 'sub-workflow'  // 嵌套子 workflow
  | 'switch';       // 条件分支

/** 任务状态 */
export type TaskStatus =
  | 'pending'      // 待执行（deps 未完成）
  | 'ready'        // 可执行（deps 全 DONE）
  | 'running'      // 执行中
  | 'done'         // 成功完成
  | 'failed'       // 失败（超过 maxAttempts）
  | 'blocked';     // 被阻塞（deps 有 FAILED）

/** 门禁类型 */
export type GateType = 'test' | 'review';

/** 任务定义（模板中的静态定义） */
export interface TaskDef {
  id: string;
  title: string;
  description?: string;
  kind: TaskKind;
  deps: string[];
  /** phase 节点的阶段名（INGEST/ANALYZE/EXECUTE 等） */
  phase?: string;
  /** phase 节点的 prompt 模板 */
  prompt?: string;
  /** gate 节点的门禁类型 */
  gate?: GateType;
  /** human-gate 节点的审批提示 */
  approvalPrompt?: string;
  /** 最大重试次数（0 表示不重试） */
  maxAttempts?: number;
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** 失败后回退到的任务 id */
  fallbackTo?: string;

  // ── 新增字段（v3 引擎扩展）─────────────────────────

  /** 重试策略（覆盖 maxAttempts 的简单重试）*/
  retryPolicy?: RetryPolicy;

  /** AI 顾问钩子（在特定时机调用 AI 给建议）*/
  advisors?: Advisor[];

  /** switch 节点的条件分支 */
  cases?: SwitchCase[];

  /** sub-workflow 节点引用的 workflow id */
  workflow?: string;

  /** sub-workflow 节点传给子 workflow 的参数 */
  params?: Record<string, string>;

  /** harness-call 节点的 harness 类型 */
  harness?: string;

  /** harness-call 注入建议的变量名 */
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

/** 任务实例（运行时的任务，落 SQLite） */
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

/** 一次执行记录 */
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

// ── 编排相关 ──────────────────────────────────────────────

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

// ── 项目 ──────────────────────────────────────────────────

export interface Project {
  id: string;
  repoPath: string;
  kind?: string;
  goal?: string;
  phase?: string;
  createdAt: string;
  updatedAt: string;
}

// ── 模板 ──────────────────────────────────────────────────

export interface Template {
  id: string;
  name: string;
  description: string;
  kind: 'greenfield' | 'refactor' | 'migration' | 'upgrade' | 'hotfix' | 'custom';
  tasks: TaskDef[];
  /** 入口节点 id */
  entry: string;
  /** 终止节点 id 列表 */
  terminals: string[];

  // ── 新增字段（v3 引擎扩展）─────────────────────────

  /** 参数声明 */
  params?: ParamDef[];

  /** 整图最大访问次数（防死循环，默认 1000）*/
  maxIterations?: number;

  /** 显式边定义（覆盖 deps 隐式边）*/
  edges?: EdgeDef[];


  // ── 统一编辑器扩展字段 ──────────────────────────
  /** 是否内置模板（内置只读，自定义可编辑）*/
  builtin?: boolean;
  /** 模板图标（emoji）*/
  icon?: string;
  /** 关联项目路径（自定义模板可绑定项目）*/
  projectPath?: string;
  /** 创建时间（自定义模板）*/
  createdAt?: string;
  /** 更新时间（自定义模板）*/
  updatedAt?: string;}

// ── Claude 事件 ───────────────────────────────────────────

export interface ClaudeEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

// ── IPC 响应 ──────────────────────────────────────────────

export interface IpcResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ── 编排引擎事件（推送到渲染层）────────────────────────────

export type OrchestrationEvent =
  | { type: 'status-change'; orchestrationId: string; status: OrchestrationStatus }
  | { type: 'task-started'; orchestrationId: string; taskId: string; attempt: number }
  | { type: 'task-completed'; orchestrationId: string; taskId: string; outcome: 'success' | 'failure' | 'gate-fail'; commitHash?: string }
  | { type: 'task-log'; orchestrationId: string; taskId: string; event: ClaudeEvent }
  | { type: 'await-approval'; orchestrationId: string; taskId: string; prompt: string }
  | { type: 'log'; orchestrationId: string; message: string };

// ── 配置 ──────────────────────────────────────────────────

export interface OrchestratorConfig {
  /** 最大并发数（默认 1，最大 3） */
  concurrency: number;
  /** 默认模型 */
  model?: string;
  /** TestGate 超时（默认 10 分钟） */
  testTimeoutMs: number;
  /** Claude 执行超时（默认 30 分钟） */
  taskTimeoutMs: number;
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  concurrency: 1,
  testTimeoutMs: 10 * 60 * 1000,
  taskTimeoutMs: 30 * 60 * 1000,
};


// ── v3 引擎扩展类型 ──────────────────────────────────────

/** 重试策略 */
export interface RetryPolicy {
  /** 最大尝试次数（包含首次）*/
  maxAttempts: number;
  /** 退避策略 */
  backoff?: 'none' | 'linear' | 'exponential';
  /** 基础延迟（毫秒）*/
  baseDelayMs?: number;
  /** 最大延迟（毫秒）*/
  maxDelayMs?: number;
  /** 抖动百分比（0-1）*/
  jitter?: number;
  /** 重试条件表达式（为真才重试）*/
  condition?: string;
}

/** AI 顾问钩子 */
export interface Advisor {
  /** 触发时机 */
  trigger: 'failure' | 'gate-fail' | 'before-approve' | 'on-retry' | 'after-node';
  /** 使用的 harness 类型 */
  harness: string;
  /** 建议注入变量名 */
  injectAs?: string;
  /** harness 配置 */
  config?: Record<string, unknown>;
}

/** switch 条件分支 */
export interface SwitchCase {
  /** 条件表达式（为真则走此分支）*/
  when: string;
  /** 目标节点 id */
  to: string;
  /** 分支标签 */
  label?: string;
}

/** 参数声明 */
export interface ParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  required?: boolean;
  default?: string | number | boolean;
  description?: string;
  /** type=enum 时的可选值 */
  enum?: string[];
}

/** 边定义 */
export interface EdgeDef {
  from: string;
  to: string;
  /** 条件（onSuccess/onFailure/onGateFail/onManualApprove/onManualReject 或表达式对象）*/
  when?: string | { expr: string };
  /** 优先级（数值越大越优先）*/
  priority?: number;
  /** 边标签 */
  label?: string;
}

/** 边条件类型 */
export type EdgeCondition =
  | 'onSuccess'
  | 'onFailure'
  | 'onGateFail'
  | 'onManualApprove'
  | 'onManualReject';
