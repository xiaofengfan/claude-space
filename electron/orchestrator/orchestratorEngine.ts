/**
 * 编排引擎
 *
 * Phase 1 MVP 核心模块，负责：
 * - create()：加载模板生成 Task[] 落 SQLite
 * - start()：进入调度循环（computeRunnable + 并发控制）
 * - executeTask()：worktree + ClaudeProcess + 等待结果 + merge
 * - pause()/resume()：checkpoint
 * - stop()：cleanup
 * - approve()：人工审批
 * - 优雅退出钩子（SIGINT/SIGTERM/beforeExit）
 *
 * 设计原则：
 * - 依赖注入：ClaudeRunner/GateRunner 通过构造函数注入，便于测试
 * - 事件驱动：通过 emit 推送状态变更到渲染层
 * - 单实例多编排：一个 Engine 实例可管理多个 Orchestration
 */

import * as crypto from 'crypto';
import { SqliteStore } from './sqliteStore.js';
import { WorktreeManager } from './worktreeManager.js';
import {
  computeRunnable,
  graphProgress,
  initTaskStatus,
  propagateFailure,
  validateGraph,
  computeBackoffDelay,
} from './dagScheduler.js';
import { getTemplate } from './templates.js';
import { DEFAULT_CONFIG, type OrchestratorConfig } from './types.js';
import type {
  ClaudeEvent,
  Orchestration,
  OrchestrationEvent,
  OrchestrationStatus,
  OrchestratorConfig as ConfigType,
  Project,
  Run,
  Task,
  TaskDef,
  TaskIO,
  Template,
} from './types.js';
import { OrchestratorError, TimeoutError } from './errors.js';

// ── 依赖注入接口 ───────────────────────────────────────────

/**
 * Claude 执行器接口
 *
 * 由调用方实现，负责与 Claude Code CLI 通信
 */
export interface ClaudeRunner {
  run(opts: {
    prompt: string;
    cwd: string;
    model?: string;
    timeoutMs?: number;
    onEvent?: (event: ClaudeEvent) => void;
  }): Promise<{
    success: boolean;
    sessionId?: string;
    error?: string;
    commitHash?: string;
  }>;
}

/**
 * 门禁执行器接口
 *
 * 由调用方实现，负责测试 + 代码审查
 */
export interface GateRunner {
  runTest(opts: {
    cwd: string;
    command?: string;
    timeoutMs?: number;
  }): Promise<{ success: boolean; error?: string }>;
  runReview(opts: {
    cwd: string;
    model?: string;
  }): Promise<{ success: boolean; error?: string }>;
}

// ── Engine 选项 ───────────────────────────────────────────

export interface OrchestratorEngineOptions {
  repoPath: string;
  config?: Partial<OrchestratorConfig>;
  claudeRunner: ClaudeRunner;
  gateRunner: GateRunner;
  /** 事件推送（通常对接 IPC 的 webContents.send） */
  emit?: (event: OrchestrationEvent) => void;
}

export interface CreateOrchestrationOpts {
  templateId: string;
  goal: string;
  testCommand?: string;
  autoApprove?: boolean;
  model?: string;
}

// ── 内部状态 ───────────────────────────────────────────────

interface PendingApproval {
  taskId: string;
  resolve: (decision: 'approve' | 'reject') => void;
}

interface RunningState {
  paused: boolean;
  stopped: boolean;
  /** 当前正在运行的 task ids（用于 stop 时清理） */
  runningTasks: Set<string>;
}

// ── Engine 实现 ───────────────────────────────────────────

const SLEEP_MS = 500; // 调度循环空闲时的轮询间隔
const MAX_LOOP_ITERATIONS = 100000; // 安全阀，防止无限循环

export class OrchestratorEngine {
  private readonly repoPath: string;
  private readonly config: OrchestratorConfig;
  private readonly store: SqliteStore;
  private readonly worktree: WorktreeManager;
  private readonly claudeRunner: ClaudeRunner;
  private readonly gateRunner: GateRunner;
  private readonly emitFn?: (event: OrchestrationEvent) => void;

  /** projectId（同 repoPath 复用一个） */
  private projectId?: string;

  /** 编排运行状态（按 orchestrationId 索引） */
  private readonly states = new Map<string, RunningState>();

  /** 等待审批的 Promise resolvers */
  private readonly approvalWaits = new Map<string, PendingApproval>();

  /** 每个编排的 fallback 总次数（防止无限回退循环） */
  private readonly fallbackCounts = new Map<string, number>();
  private readonly MAX_FALLBACKS = 3;

  /** 优雅退出钩子 */
  private disposed = false;
  private readonly exitHandler = () => this.disposeAll();

  constructor(opts: OrchestratorEngineOptions) {
    this.repoPath = opts.repoPath;
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    this.claudeRunner = opts.claudeRunner;
    this.gateRunner = opts.gateRunner;
    this.emitFn = opts.emit;

    this.store = SqliteStore.get(this.repoPath);
    this.worktree = new WorktreeManager(this.repoPath);

    // 注册优雅退出
    process.on('SIGINT', this.exitHandler);
    process.on('SIGTERM', this.exitHandler);
    process.on('beforeExit', this.exitHandler);
  }

  // ── 事件辅助 ──────────────────────────────────────────

  private emit(event: OrchestrationEvent): void {
    try {
      this.emitFn?.(event);
    } catch (e) {
      console.warn('[orchestrator] emit failed:', e);
    }
  }

  private log(orchestrationId: string, message: string): void {
    this.emit({ type: 'log', orchestrationId, message });
  }

  // ── 项目管理 ──────────────────────────────────────────

  /**
   * 获取或创建项目记录
   */
  private ensureProject(): Project {
    let project = this.store.getProjectByRepo(this.repoPath);
    if (!project) {
      const now = new Date().toISOString();
      project = {
        id: this.genId('proj'),
        repoPath: this.repoPath,
        createdAt: now,
        updatedAt: now,
      };
      this.store.saveProject(project);
    }
    this.projectId = project.id;
    return project;
  }

  // ── 创建编排 ──────────────────────────────────────────

  /**
   * 创建编排
   *
   * 步骤：
   * 1. 加载模板
   * 2. 转换 TaskDef[] → Task[]，初始化状态
   * 3. 验证 DAG
   * 4. 落 SQLite
   */
  async create(opts: CreateOrchestrationOpts): Promise<Orchestration> {
    const template = getTemplate(opts.templateId);
    if (!template) {
      throw new OrchestratorError(`模板不存在: ${opts.templateId}`);
    }

    const project = this.ensureProject();
    const now = new Date().toISOString();
    const orchestrationId = this.genId('orch');

    const orchestration: Orchestration = {
      id: orchestrationId,
      projectId: project.id,
      templateId: template.id,
      status: 'pending',
      goal: opts.goal,
      testCommand: opts.testCommand,
      autoApprove: opts.autoApprove ?? false,
      model: opts.model ?? this.config.model,
      createdAt: now,
      updatedAt: now,
    };

    // 将 TaskDef 转为 Task 并初始化状态
    const tasks = this.instantiateTasks(template, orchestrationId);

    // 校验：模板必须包含至少一个任务
    if (tasks.length === 0) {
      throw new OrchestratorError(`模板 "${template.id}" 没有任务定义，无法创建编排。请先在模板编辑器中添加阶段/任务。`);
    }

    // 验证 DAG
    validateGraph(tasks);

    // 落库
    this.store.transaction(() => {
      this.store.saveOrchestration(orchestration);
      for (const task of tasks) {
        this.store.saveTask(task);
      }
    });

    this.log(orchestrationId, `创建编排 ${orchestrationId}，模板 ${template.id}，共 ${tasks.length} 个任务`);
    return orchestration;
  }

  /**
   * 把模板中的 TaskDef 转为可执行的 Task
   *
   * 所有任务统一初始化为 pending，由 computeRunnable 判断是否可执行
   */
  private instantiateTasks(template: Template, orchestrationId: string): Task[] {
    const now = new Date().toISOString();
    return template.tasks.map((def: TaskDef) => ({
      ...def,
      orchestrationId,
      status: 'pending' as const,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }));
  }

  // ── 启动/暂停/恢复/停止 ────────────────────────────────

  /**
   * 启动编排
   *
   * - 首次启动：预检 + 标记 running + 进入调度循环
   * - 恢复启动：从 SQLite 恢复状态
   */
  async start(orchestrationId: string): Promise<void> {
    const orch = this.store.getOrchestration(orchestrationId);
    if (!orch) {
      throw new OrchestratorError(`编排不存在: ${orchestrationId}`);
    }

    if (orch.status === 'running') {
      throw new OrchestratorError(`编排已在运行: ${orchestrationId}`);
    }

    // 首次启动需要预检
    if (orch.status === 'pending') {
      await this.worktree.preflight();
    }

    // 初始化运行状态
    this.states.set(orchestrationId, {
      paused: false,
      stopped: false,
      runningTasks: new Set(),
    });

    this.store.updateOrchestrationStatus(orchestrationId, 'running');
    this.emit({ type: 'status-change', orchestrationId, status: 'running' });
    this.log(orchestrationId, '启动编排');

    // 异步进入调度循环
    this.runLoop(orchestrationId).catch((e) => {
      this.handleFatalError(orchestrationId, e);
    });
  }

  /**
   * 暂停编排
   *
   * - 标记 paused，调度循环会在当前任务结束后退出
   * - 不打断正在运行的任务
   */
  async pause(orchestrationId: string): Promise<void> {
    const state = this.states.get(orchestrationId);
    if (!state) {
      throw new OrchestratorError(`编排未运行: ${orchestrationId}`);
    }
    state.paused = true;
    this.store.updateOrchestrationStatus(orchestrationId, 'paused');
    this.emit({ type: 'status-change', orchestrationId, status: 'paused' });
    this.log(orchestrationId, '暂停编排');
  }

  /**
   * 恢复编排
   */
  async resume(orchestrationId: string): Promise<void> {
    const state = this.states.get(orchestrationId);
    if (!state) {
      throw new OrchestratorError(`编排未暂停: ${orchestrationId}`);
    }
    state.paused = false;
    this.store.updateOrchestrationStatus(orchestrationId, 'running');
    this.emit({ type: 'status-change', orchestrationId, status: 'running' });
    this.log(orchestrationId, '恢复编排');

    // 重新进入调度循环
    this.runLoop(orchestrationId).catch((e) => {
      this.handleFatalError(orchestrationId, e);
    });
  }

  /**
   * 停止编排
   *
   * - 标记 stopped
   * - 等待运行中的任务结束（最多 5 秒）
   * - 清理 worktree
   * - 标记 orchestration 为 interrupted
   */
  async stop(orchestrationId: string): Promise<void> {
    const state = this.states.get(orchestrationId);
    if (!state) {
      throw new OrchestratorError(`编排未运行: ${orchestrationId}`);
    }
    state.stopped = true;

    // 等待运行中的任务结束（最多 5 秒）
    const deadline = Date.now() + 5000;
    while (state.runningTasks.size > 0 && Date.now() < deadline) {
      await this.sleep(100);
    }

    // 清理 worktree
    try {
      await this.worktree.pruneAll();
    } catch (e) {
      this.log(orchestrationId, `清理 worktree 失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 标记运行中的任务为 pending（下次 resume 可继续）
    const tasks = this.store.listTasks(orchestrationId);
    for (const t of tasks) {
      if (t.status === 'running') {
        this.store.updateTaskStatus(t.id, 'pending', { lastError: 'interrupted' });
      }
    }

    this.store.updateOrchestrationStatus(orchestrationId, 'interrupted');
    this.emit({ type: 'status-change', orchestrationId, status: 'interrupted' });
    this.log(orchestrationId, '停止编排');
    this.states.delete(orchestrationId);
  }

  // ── 审批 ──────────────────────────────────────────────

  /**
   * 审批处理（人工 gate）
   *
   * @param orchestrationId - 编排 id
   * @param taskId - 任务 id
   * @param decision - approve / reject
   */
  async approve(
    orchestrationId: string,
    taskId: string,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    const wait = this.approvalWaits.get(taskId);
    if (!wait) {
      throw new OrchestratorError(`没有等待审批的任务: ${taskId}`);
    }
    this.approvalWaits.delete(taskId);
    wait.resolve(decision);
    this.log(orchestrationId, `审批 ${taskId}: ${decision}`);
  }

  /**
   * 接管任务（手动操作后标记完成）
   */
  async takeover(orchestrationId: string, taskId: string): Promise<void> {
    const task = this.store.getTask(taskId);
    if (!task || task.orchestrationId !== orchestrationId) {
      throw new OrchestratorError(`任务不存在或不属于该编排: ${taskId}`);
    }
    this.store.updateTaskStatus(taskId, 'done', { lastError: undefined });
    this.emit({
      type: 'task-completed',
      orchestrationId,
      taskId,
      outcome: 'success',
    });
    this.log(orchestrationId, `接管任务 ${taskId}`);
  }

  // ── 调度循环 ──────────────────────────────────────────

  /**
   * 调度主循环
   *
   * 算法：
   * 1. 读取全部 tasks
   * 2. 计算 progress，如果 isAllDone → 成功；如果 isStalled → 失败
   * 3. computeRunnable（concurrency 限制）
   * 4. 并发执行 runnable
   * 5. 等待任一完成，回到 1
   */
  private async runLoop(orchestrationId: string): Promise<void> {
    let iterations = 0;

    while (iterations++ < MAX_LOOP_ITERATIONS) {
      const state = this.states.get(orchestrationId);
      if (!state || state.paused || state.stopped) {
        return; // 退出循环
      }

      const tasks = this.store.listTasks(orchestrationId);
      const progress = graphProgress(tasks);

      // 全部完成 → 成功
      if (progress.isAllDone) {
        this.markOrchestrationSuccess(orchestrationId);
        return;
      }

      // 停滞：没有可执行的任务
      if (progress.isStalled) {
        // 检查是否有等待审批的任务
        const hasApprovalWait = Array.from(this.approvalWaits.keys()).length > 0;
        if (hasApprovalWait) {
          await this.sleep(SLEEP_MS);
          continue;
        }
        // 检查是否有运行中的任务（不应该有，但保险）
        if (progress.running > 0) {
          await this.sleep(SLEEP_MS);
          continue;
        }
        // 真的停滞了
        this.markOrchestrationFailed(orchestrationId, '调度停滞，无可执行任务');
        return;
      }

      // 计算可执行任务
      const runnable = computeRunnable(tasks, this.config.concurrency);
      if (runnable.length === 0) {
        await this.sleep(SLEEP_MS);
        continue;
      }

      // 并发执行（受 concurrency 限制，computeRunnable 已裁剪）
      const promises = runnable.map((task) => this.executeTask(task));
      await Promise.allSettled(promises);
    }

    // 超过最大迭代次数
    this.markOrchestrationFailed(orchestrationId, `超过最大迭代次数 ${MAX_LOOP_ITERATIONS}`);
  }

  /**
   * 标记编排成功
   */
  private markOrchestrationSuccess(orchestrationId: string): void {
    this.store.updateOrchestrationStatus(orchestrationId, 'success');
    this.emit({ type: 'status-change', orchestrationId, status: 'success' });
    this.log(orchestrationId, '编排完成');
    this.states.delete(orchestrationId);
  }

  /**
   * 标记编排失败
   */
  private markOrchestrationFailed(orchestrationId: string, reason: string): void {
    this.store.updateOrchestrationStatus(orchestrationId, 'failed');
    this.emit({ type: 'status-change', orchestrationId, status: 'failed' });
    this.log(orchestrationId, `编排失败: ${reason}`);
    this.states.delete(orchestrationId);
  }

  /**
   * 处理致命错误
   */
  private handleFatalError(orchestrationId: string, error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[orchestrator] fatal error for ${orchestrationId}:`, error);
    this.markOrchestrationFailed(orchestrationId, `致命错误: ${msg}`);
  }

  // ── 任务执行 ──────────────────────────────────────────

  /**
   * 执行单个任务
   *
   * 根据 task.kind 分发到不同执行器
   */
  private async executeTask(task: Task): Promise<void> {
    const state = this.states.get(task.orchestrationId);
    if (!state) {
      return; // 编排已停止
    }

    state.runningTasks.add(task.id);

    try {
      // 标记 running
      const newAttempts = task.attempts + 1;
      this.store.updateTaskStatus(task.id, 'running', {
        attempts: newAttempts,
        lastError: undefined,
      });
      this.emit({
        type: 'task-started',
        orchestrationId: task.orchestrationId,
        taskId: task.id,
        attempt: newAttempts,
      });

      let outcome: 'success' | 'failure' | 'gate-fail';
      let commitHash: string | undefined;
      let errorMsg: string | undefined;

      if (task.kind === 'phase') {
        const result = await this.executePhase(task);
        outcome = result.success ? 'success' : 'failure';
        commitHash = result.commitHash;
        errorMsg = result.error;
      } else if (task.kind === 'gate') {
        const result = await this.executeGate(task);
        outcome = result.success ? 'success' : 'gate-fail';
        errorMsg = result.error;
      } else if (task.kind === 'human-gate') {
        const result = await this.executeHumanGate(task);
        outcome = result.success ? 'success' : 'failure';
        errorMsg = result.error;
      } else if (task.kind === 'harness-call') {
        const result = await this.executeHarnessCall(task);
        outcome = result.success ? 'success' : 'failure';
        errorMsg = result.error;
      } else if (task.kind === 'sub-workflow') {
        const result = await this.executeSubWorkflow(task);
        outcome = result.success ? 'success' : 'failure';
        errorMsg = result.error;
      } else if (task.kind === 'switch') {
        const result = await this.executeSwitch(task);
        outcome = result.success ? 'success' : 'failure';
        errorMsg = result.error;
      } else {
        throw new OrchestratorError(`未知 task kind: ${task.kind}`);
      }

      // 处理结果
      if (outcome === 'success') {
        this.store.updateTaskStatus(task.id, 'done');
        this.emit({
          type: 'task-completed',
          orchestrationId: task.orchestrationId,
          taskId: task.id,
          outcome,
          commitHash,
        });
        this.log(task.orchestrationId, `任务完成: ${task.title}`);
      } else {
        await this.handleTaskFailure(task, outcome, errorMsg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.handleTaskFailure(task, 'failure', msg);
    } finally {
      state.runningTasks.delete(task.id);
    }
  }

  /**
   * 处理任务失败
   *
   * - phase 类型：未超过 maxAttempts → 标记 pending 等待重试
   * - gate/human-gate 类型：不重试，直接 failed + 触发 fallback
   * - 超过 maxAttempts → failed + 触发 fallback
   */
  private async handleTaskFailure(
    task: Task,
    outcome: 'failure' | 'gate-fail',
    errorMsg?: string,
  ): Promise<void> {
    // v3：优先使用 retryPolicy，回退到 maxAttempts
    const policy = task.retryPolicy;
    const maxAttempts = policy?.maxAttempts ?? task.maxAttempts ?? 3;
    const newAttempts = task.attempts + 1;

    // v3：检查重试条件
    if (policy?.condition) {
      // 简化实现：条件表达式非空则允许重试
      this.log(task.orchestrationId, `重试条件检查: ${policy.condition}`);
    }

    this.emit({
      type: 'task-completed',
      orchestrationId: task.orchestrationId,
      taskId: task.id,
      outcome,
    });

    // 只有 phase 才重试，gate/human-gate 直接 failed
    const shouldRetry = task.kind === 'phase' && newAttempts < maxAttempts;

    if (shouldRetry) {
      // v3：退避延迟
      if (policy?.backoff && policy.backoff !== 'none') {
        const delay = computeBackoffDelay(policy, newAttempts);
        this.log(task.orchestrationId, `退避等待 ${delay}ms 后重试`);
        await this.sleep(delay);
      }

      // 还可以重试
      this.store.updateTaskStatus(task.id, 'pending', {
        attempts: newAttempts,
        lastError: errorMsg,
      });
      this.log(
        task.orchestrationId,
        `任务失败（第 ${newAttempts}/${maxAttempts} 次），将重试: ${task.title}${errorMsg ? ' - ' + errorMsg : ''}`,
      );
    } else {
      // 超过重试次数或非 phase 类型
      this.store.updateTaskStatus(task.id, 'failed', {
        attempts: newAttempts,
        lastError: errorMsg,
      });
      this.log(
        task.orchestrationId,
        `任务失败${task.kind === 'phase' ? `（超过最大重试次数 ${maxAttempts}）` : ''}: ${task.title}`,
      );

      // 传播失败到下游
      const tasks = this.store.listTasks(task.orchestrationId);
      propagateFailure(tasks);

      // 触发 fallbackTo（human-gate reject 不 fallback，用户拒绝是最终决定）
      if (task.fallbackTo && task.kind !== 'human-gate') {
        this.resetFallback(task.orchestrationId, task.fallbackTo);
      }
    }
  }

  /**
   * 执行 phase 任务
   *
   * 1. 创建 worktree
   * 2. 调用 Claude
   * 3. 合并到 integration 分支
   * 4. 清理 worktree
   */
    /**
   * 执行 harness-call 任务（多轮 AI 交互）
   *
   * 借鉴 Foundry HarnessContext.runHarness
   * 1. 调用指定 harness（默认用 Claude）
   * 2. 支持多轮交互（暂停/恢复/嵌套）
   * 3. 结果注入到 injectAs 变量
   */
  private async executeHarnessCall(task: Task): Promise<{
    success: boolean;
    commitHash?: string;
    error?: string;
  }> {
    this.log(task.orchestrationId, `执行 harness-call: ${task.title} (harness=${task.harness || 'claude'})`);

    // 复用 phase 执行路径（harness-call 本质是增强的 phase）
    // 实际 harness 嵌套由 spawnClaude 的 session 机制支持
    const result = await this.executePhase(task);

    // 如果指定了 injectAs，把结果存到上下文（简化实现：记日志）
    if (task.injectAs && result.commitHash) {
      this.log(task.orchestrationId, `harness-call 结果注入: ${task.injectAs}=${result.commitHash.slice(0, 8)}`);
    }

    return result;
  }

  /**
   * 执行 sub-workflow 任务（嵌套子 workflow）
   *
   * 借鉴 Foundry HarnessContext.runHarness 递归
   * 1. 加载子 workflow 模板
   * 2. 渲染 params（参数传递）
   * 3. 创建子编排（嵌套）
   * 4. 等待子编排完成
   */
  private async executeSubWorkflow(task: Task): Promise<{
    success: boolean;
    commitHash?: string;
    error?: string;
  }> {
    if (!task.workflow) {
      return { success: false, error: 'sub-workflow 节点未指定 workflow 字段' };
    }

    this.log(task.orchestrationId, `执行 sub-workflow: ${task.title} (workflow=${task.workflow})`);

    // 查找子 workflow 模板
    const subTemplate = getTemplate(task.workflow);
    if (!subTemplate) {
      return { success: false, error: `子 workflow 模板不存在: ${task.workflow}` };
    }

    // 渲染 params 到 goal
    const orch = this.store.getOrchestration(task.orchestrationId);
    let subGoal = orch?.goal || '';
    if (task.params) {
      const paramStr = Object.entries(task.params)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      subGoal = `${subGoal} [子任务参数: ${paramStr}]`;
    }

    // 创建子编排（简化实现：直接执行子模板的任务，不创建独立 orchestration）
    this.log(task.orchestrationId, `子 workflow ${task.workflow} 共 ${subTemplate.tasks.length} 个任务，目标: ${subGoal.slice(0, 80)}`);

    // 简化实现：执行子 workflow 的 entry 节点
    const entryTask = subTemplate.tasks.find((t) => t.id === subTemplate.entry);
    if (!entryTask) {
      return { success: false, error: '子 workflow 无 entry 节点' };
    }

    // 复用 phase 执行逻辑跑 entry 节点
    const subTask: Task = {
      ...entryTask,
      orchestrationId: task.orchestrationId,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await this.executePhase(subTask);
    return result;
  }

  /**
   * 执行 switch 任务（条件分支）
   *
   * 借鉴 Foundry switch 节点
   * 1. 评估 cases 的 when 条件
   * 2. 走第一个满足的分支
   * 3. 如果都不满足，走 default（如果有）
   *
   * 简化实现：switch 节点本身直接 done，由边条件路由决定后续走哪个分支
   */
  private async executeSwitch(task: Task): Promise<{
    success: boolean;
    commitHash?: string;
    error?: string;
  }> {
    this.log(task.orchestrationId, `执行 switch: ${task.title} (${task.cases?.length || 0} 个分支)`);

    if (!task.cases || task.cases.length === 0) {
      return { success: false, error: 'switch 节点未定义 cases' };
    }

    // 记录分支信息（简化实现：总是成功，由 computeRunnableWithConditions 走对应边）
    for (const c of task.cases) {
      this.log(task.orchestrationId, `  分支: ${c.label || c.when} → ${c.to}`);
    }

    // switch 节点本身不做实际工作，直接成功
    // 后续由边条件（edge.when 表达式）决定走哪个分支
    return { success: true };
  }

private async executePhase(task: Task): Promise<{
    success: boolean;
    commitHash?: string;
    error?: string;
  }> {
    // 创建 worktree
    let wtInfo: { path: string; branch: string };
    try {
      wtInfo = await this.worktree.create(task.id);
      this.store.updateTaskStatus(task.id, 'running', {
        worktreePath: wtInfo.path,
        worktreeBranch: wtInfo.branch,
      });
    } catch (e) {
      return {
        success: false,
        error: `创建 worktree 失败: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    try {
      // 渲染 prompt
      const prompt = this.renderPrompt(task.prompt || '', task);

      // 调用 Claude（优先使用模板里指定的 per-task model）
      const result = await this.claudeRunner.run({
        prompt,
        cwd: wtInfo.path,
        model: task.model || this.config.model,
        timeoutMs: task.timeoutMs ?? this.config.taskTimeoutMs,
        onEvent: (event) => {
          this.emit({
            type: 'task-log',
            orchestrationId: task.orchestrationId,
            taskId: task.id,
            event,
          });
        },
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // 合并到 integration
      let commitHash: string | undefined;
      try {
        commitHash = await this.worktree.merge(task.id);
      } catch (e) {
        return {
          success: false,
          error: `合并失败: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      // 保存 run 记录
      this.saveRunRecord(task, result.sessionId, 'success', commitHash);

      return { success: true, commitHash };
    } finally {
      // 清理 worktree
      await this.worktree.remove(task.id).catch(() => {});
    }
  }

  /**
   * 执行 gate 任务（test/review）
   */
  private async executeGate(task: Task): Promise<{
    success: boolean;
    error?: string;
  }> {
    const orch = this.store.getOrchestration(task.orchestrationId);
    const cwd = this.repoPath;

    if (task.gate === 'test') {
      const result = await this.gateRunner.runTest({
        cwd,
        command: orch?.testCommand,
        timeoutMs: this.config.testTimeoutMs,
      });
      this.saveRunRecord(task, undefined, result.success ? 'success' : 'gate-fail');
      return result;
    }

    if (task.gate === 'review') {
      const result = await this.gateRunner.runReview({
        cwd,
        model: this.config.model,
      });
      this.saveRunRecord(task, undefined, result.success ? 'success' : 'gate-fail');
      return result;
    }

    return { success: false, error: `未知 gate 类型: ${task.gate}` };
  }

  /**
   * 执行 human-gate 任务
   *
   * - 推送 await-approval 事件
   * - 等待 approve() 调用
   * - 支持 autoApprove（直接通过）
   */
  private async executeHumanGate(task: Task): Promise<{
    success: boolean;
    error?: string;
  }> {
    const orch = this.store.getOrchestration(task.orchestrationId);

    // 自动审批
    if (orch?.autoApprove) {
      this.saveRunRecord(task, undefined, 'success');
      return { success: true };
    }

    // 推送审批事件
    this.emit({
      type: 'await-approval',
      orchestrationId: task.orchestrationId,
      taskId: task.id,
      prompt: task.approvalPrompt || `请审批任务: ${task.title}`,
    });
    this.log(task.orchestrationId, `等待审批: ${task.title}`);

    // 等待审批
    const decision = await this.waitForApproval(task.id);
    this.saveRunRecord(task, undefined, decision === 'approve' ? 'success' : 'failure');

    if (decision === 'approve') {
      return { success: true };
    }
    return { success: false, error: '审批被拒绝' };
  }

  /**
   * 等待审批
   */
  private waitForApproval(taskId: string): Promise<'approve' | 'reject'> {
    return new Promise((resolve) => {
      this.approvalWaits.set(taskId, { taskId, resolve });
    });
  }

  /**
   * 重置 fallback 节点及其下游
   *
   * 把 fallbackTo 节点 + 其所有下游节点的状态重置为 pending，attempts 归零
   * 限制每个编排最多 fallback MAX_FALLBACKS 次，防止无限循环
   */
  private resetFallback(orchestrationId: string, fallbackTo: string): void {
    // 检查 fallback 次数
    const count = (this.fallbackCounts.get(orchestrationId) ?? 0) + 1;
    if (count > this.MAX_FALLBACKS) {
      this.log(orchestrationId, `回退总次数超过限制 ${this.MAX_FALLBACKS}，不再回退`);
      return;
    }
    this.fallbackCounts.set(orchestrationId, count);

    const tasks = this.store.listTasks(orchestrationId);
    const toReset = this.findDownstream(tasks, fallbackTo);

    for (const t of toReset) {
      if (t.id === fallbackTo) {
        this.store.updateTaskStatus(t.id, 'pending', {
          attempts: 0,
          lastError: undefined,
        });
      } else if (t.status === 'blocked' || t.status === 'failed') {
        this.store.updateTaskStatus(t.id, 'pending', {
          attempts: 0,
          lastError: undefined,
        });
      }
    }
    this.log(orchestrationId, `触发回退到 ${fallbackTo}（第 ${count}/${this.MAX_FALLBACKS} 次），重置 ${toReset.size} 个任务`);
  }

  /**
   * BFS 找出 startId 及其所有下游任务
   */
  private findDownstream(tasks: Task[], startId: string): Set<Task> {
    const result = new Set<Task>();
    const queue = [startId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const task = tasks.find((t) => t.id === id);
      if (!task) continue;
      result.add(task);

      // 找所有依赖此任务的任务
      for (const t of tasks) {
        if (t.deps.includes(id) && !visited.has(t.id)) {
          queue.push(t.id);
        }
      }
    }

    return result;
  }

  // ── 工具方法 ──────────────────────────────────────────

  /**
   * 渲染 prompt 模板
   *
   * 替换占位符：
   * - {goal} → 编排目标
   * - {taskTitle} → 任务标题
   * - {taskId} → 任务 id
   */
  private renderPrompt(prompt: string, task: Task): string {
    const orch = this.store.getOrchestration(task.orchestrationId);
    return prompt
      .replace(/\{goal\}/g, orch?.goal || '')
      .replace(/\{taskTitle\}/g, task.title)
      .replace(/\{taskId\}/g, task.id);
  }

  /**
   * 保存 run 记录
   */
  private saveRunRecord(
    task: Task,
    sessionId: string | undefined,
    outcome: 'success' | 'failure' | 'gate-fail' | 'interrupted',
    commitHash?: string,
  ): void {
    const now = new Date().toISOString();
    const run: Run = {
      id: this.genId('run'),
      taskId: task.id,
      attempt: task.attempts + 1,
      sessionId,
      startedAt: task.updatedAt,
      finishedAt: now,
      outcome,
      commitHash,
    };
    this.store.saveRun(run);
    this.store.updateTaskStatus(task.id, task.status === 'running' ? 'running' : task.status, {
      lastRunId: run.id,
    });
  }

  /**
   * 生成 id
   */
  private genId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── 查询 ──────────────────────────────────────────────

  /**
   * 获取编排状态
   */
  getStatus(orchestrationId: string): {
    orchestration: Orchestration;
    tasks: Task[];
  } | null {
    const orch = this.store.getOrchestration(orchestrationId);
    if (!orch) return null;
    const tasks = this.store.listTasks(orchestrationId);
    return { orchestration: orch, tasks };
  }

  /**
   * 列出当前项目的所有编排
   */
  listOrchestrations(): Orchestration[] {
    if (!this.projectId) {
      this.ensureProject();
    }
    return this.store.listOrchestrations(this.projectId!);
  }

  /**
   * 获取任务详情
   */
  getTaskDetail(taskId: string): { task: Task; runs: Run[] } | null {
    const task = this.store.getTask(taskId);
    if (!task) return null;
    const runs = this.store.listRuns(taskId);
    return { task, runs };
  }

  // ── 健康检查 ──────────────────────────────────────────

  /**
   * 健康检查
   *
   * 检查项：
   * - SQLite 可读写
   * - Git 可用
   * - 工作目录状态
   * - 残留 worktree
   */
  async healthCheck(): Promise<{ ok: boolean; issues: string[] }> {
    const issues: string[] = [];

    // SQLite 读写测试
    try {
      const project = this.ensureProject();
      this.store.saveProject(project);
      const readBack = this.store.getProject(project.id);
      if (!readBack) issues.push('SQLite 写入后读取失败');
    } catch (e) {
      issues.push(`SQLite 异常: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Worktree 预检
    try {
      await this.worktree.preflight();
    } catch (e) {
      issues.push(`预检失败: ${e instanceof Error ? e.message : String(e)}`);
    }

    return { ok: issues.length === 0, issues };
  }

  /**
   * 更新任务的输入/输出配置（允许执行前手动调整步骤的 IO）
   */
  updateTaskIO(taskId: string, inputs?: TaskIO[], outputs?: TaskIO[]): void {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (inputs !== undefined) task.inputs = inputs;
    if (outputs !== undefined) task.outputs = outputs;
    task.updatedAt = new Date().toISOString();
    this.store.saveTask(task);
    this.log(task.orchestrationId, `任务 ${task.title} 的输入/输出配置已更新`);
  }

  /**
   * 清理残留（危险操作，需用户确认）
   */
  async cleanup(): Promise<void> {
    await this.worktree.fullRollback();
  }

  // ── 优雅退出 ──────────────────────────────────────────

  /**
   * 释放资源
   *
   * - 标记所有运行中的编排为 interrupted
   * - 清理 worktree
   * - 关闭 SQLite 连接
   * - 移除进程钩子
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    process.off('SIGINT', this.exitHandler);
    process.off('SIGTERM', this.exitHandler);
    process.off('beforeExit', this.exitHandler);

    // 标记所有运行中的编排为 interrupted
    for (const [orchId, state] of this.states.entries()) {
      state.stopped = true;
      try {
        this.store.updateOrchestrationStatus(orchId, 'interrupted');
        this.emit({ type: 'status-change', orchestrationId: orchId, status: 'interrupted' });
      } catch (e) {
        console.warn(`[orchestrator] dispose: mark ${orchId} interrupted failed:`, e);
      }
    }
    this.states.clear();

    // 清理 worktree（同步尝试）
    this.worktree.pruneAll().catch((e) => {
      console.warn(`[orchestrator] dispose: prune worktrees failed:`, e);
    });

    // 关闭 SQLite
    try {
      this.store.close();
    } catch (e) {
      console.warn(`[orchestrator] dispose: close sqlite failed:`, e);
    }
  }

  /**
   * 退出时调用（同步路径，尽量不阻塞）
   */
  private disposeAll(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const [orchId] of this.states.entries()) {
      try {
        this.store.updateOrchestrationStatus(orchId, 'interrupted');
      } catch {
        // 忽略
      }
    }
    this.states.clear();

    // 关闭 SQLite（确保数据落盘）
    try {
      this.store.close();
    } catch {
      // 忽略
    }
  }
}
