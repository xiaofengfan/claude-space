/**
 * DAG 调度器
 *
 * 借鉴 Foundry packages/core/src/domain/graph.ts，重写为 claude-space 风格
 *
 * 核心算法：
 * - validateGraph：DFS 三色标记法做环检测
 * - topoSort：Kahn 算法拓扑排序
 * - computeRunnable：返回可执行任务（PENDING + deps 全 DONE）
 * - graphProgress：计算 stalled/running/ready 状态
 */

import type { Task, TaskStatus } from './types.js';
import { DagError } from './errors.js';

/**
 * 验证 DAG 合法性
 *
 * 规则：
 * 1. 所有 deps 引用的 task 必须存在
 * 2. 不允许自环（task 依赖自己）
 * 3. 不允许环（A→B→A）
 *
 * @param tasks - 全部任务列表
 * @throws DagError 如果图不合法
 */
export function validateGraph(tasks: Task[]): void {
  const ids = new Set(tasks.map((t) => t.id));

  // 1. 检查 deps 引用
  for (const t of tasks) {
    for (const dep of t.deps) {
      if (!ids.has(dep)) {
        throw new DagError(`任务 ${t.id} 依赖不存在的任务 ${dep}`);
      }
      if (dep === t.id) {
        throw new DagError(`任务 ${t.id} 依赖自己`);
      }
    }
  }

  // 2. DFS 三色标记法检测环
  // 0=未访问, 1=访问中, 2=已完成
  const color = new Map<string, number>();
  for (const t of tasks) color.set(t.id, 0);

  const adj = new Map<string, string[]>();
  for (const t of tasks) adj.set(t.id, [...t.deps]);

  const dfs = (id: string, path: string[]): void => {
    color.set(id, 1);
    const deps = adj.get(id) ?? [];
    for (const dep of deps) {
      const c = color.get(dep);
      if (c === 1) {
        // 发现环
        throw new DagError(`检测到环：${[...path, id, dep].join(' → ')}`);
      }
      if (c === 0) {
        dfs(dep, [...path, id]);
      }
    }
    color.set(id, 2);
  };

  for (const t of tasks) {
    if (color.get(t.id) === 0) {
      dfs(t.id, []);
    }
  }
}

/**
 * 拓扑排序（Kahn 算法）
 *
 * @param tasks - 全部任务列表
 * @returns 拓扑序的任务列表（deps 在前）
 */
export function topoSort(tasks: Task[]): Task[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const indeg = new Map<string, number>();
  for (const t of tasks) indeg.set(t.id, 0);

  // 反向邻接：dep → 依赖它的 tasks
  const radj = new Map<string, string[]>();
  for (const t of tasks) radj.set(t.id, []);

  for (const t of tasks) {
    for (const dep of t.deps) {
      radj.get(dep)?.push(t.id);
      indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, d] of indeg) {
    if (d === 0) queue.push(id);
  }

  const result: Task[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(taskMap.get(id)!);
    for (const next of radj.get(id) ?? []) {
      indeg.set(next, (indeg.get(next) ?? 0) - 1);
      if ((indeg.get(next) ?? 0) === 0) queue.push(next);
    }
  }

  if (result.length !== tasks.length) {
    throw new DagError('拓扑排序失败：图中存在环');
  }

  return result;
}

/**
 * 计算当前可执行的任务列表
 *
 * 规则：状态为 PENDING + 所有 deps 为 DONE + 未达 maxAttempts
 *
 * @param tasks - 全部任务列表
 * @param concurrency - 最大并发数
 * @returns 可执行任务列表（长度 <= concurrency）
 */
export function computeRunnable(tasks: Task[], concurrency: number): Task[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const ready: Task[] = [];
  for (const t of tasks) {
    if (t.status !== 'pending') continue;

    // 检查所有 deps 是否 DONE
    const allDepsDone = t.deps.every((depId) => {
      const dep = taskMap.get(depId);
      return dep?.status === 'done';
    });

    // 如果有 FAILED 的 dep，本任务标记为 BLOCKED（不返回）
    const hasFailedDep = t.deps.some((depId) => {
      const dep = taskMap.get(depId);
      return dep?.status === 'failed' || dep?.status === 'blocked';
    });

    if (hasFailedDep) continue; // 由 propagateFailure 处理
    if (allDepsDone) ready.push(t);
  }

  return ready.slice(0, concurrency);
}

/**
 * 传播失败：将 deps 中有 FAILED/BLOCKED 的 PENDING 任务标记为 BLOCKED
 *
 * @param tasks - 全部任务列表
 * @returns 被标记为 BLOCKED 的任务 id 列表
 */
export function propagateFailure(tasks: Task[]): string[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const blocked: string[] = [];
  let changed = true;

  while (changed) {
    changed = false;
    for (const t of tasks) {
      if (t.status !== 'pending') continue;
      const hasFailedDep = t.deps.some((depId) => {
        const dep = taskMap.get(depId);
        return dep?.status === 'failed' || dep?.status === 'blocked';
      });
      if (hasFailedDep) {
        t.status = 'blocked';
        blocked.push(t.id);
        changed = true;
      }
    }
  }

  return blocked;
}

/**
 * 计算 DAG 进度
 *
 * ready 计数 = pending 状态 + deps 全 done 的任务数
 * isStalled = 无 running + 无 ready + 未全部完成
 *
 * @param tasks - 全部任务列表
 * @returns 各状态的任务数 + 是否完成 + 是否停滞
 */
export function graphProgress(tasks: Task[]): {
  total: number;
  pending: number;
  ready: number;
  running: number;
  done: number;
  failed: number;
  blocked: number;
  isAllDone: boolean;
  isStalled: boolean;
} {
  const counts = { total: tasks.length, pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0 };
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  for (const t of tasks) {
    switch (t.status) {
      case 'pending': {
        counts.pending++;
        // 计算 ready：pending + deps 全 done
        const allDepsDone = t.deps.every((depId) => taskMap.get(depId)?.status === 'done');
        if (allDepsDone) counts.ready++;
        break;
      }
      case 'ready': counts.ready++; break; // 兼容显式 ready 状态
      case 'running': counts.running++; break;
      case 'done': counts.done++; break;
      case 'failed': counts.failed++; break;
      case 'blocked': counts.blocked++; break;
    }
  }

  return {
    ...counts,
    isAllDone: counts.done === counts.total,
    // 停滞：没有运行中 + 没有可执行 + 没全部完成
    isStalled: counts.running === 0 && counts.ready === 0 && counts.done !== counts.total,
  };
}

/**
 * 初始化任务状态
 *
 * 所有任务统一初始化为 pending，由 computeRunnable 在运行时
 * 根据 deps 完成情况判断是否可执行（ready 是计算概念，不是存储状态）
 *
 * @param defs - 任务定义列表
 * @param orchestrationId - 所属编排 id
 * @returns 初始化后的 Task 列表
 */
export function initTaskStatus(
  defs: Task[],
  orchestrationId: string,
): Task[] {
  return defs.map((t) => ({
    ...t,
    orchestrationId,
    status: 'pending' as TaskStatus,
    attempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}


// ── v3 扩展：边条件路由 + maxIterations ──────────────────

/**
 * 计算可执行任务（带边条件路由）
 *
 * 规则：
 * 1. 任务状态为 pending
 * 2. 至少有一条入边条件满足
 * 3. 边条件支持：onSuccess/onFailure/onGateFail/onManualApprove/onManualReject
 *    或表达式对象 { expr: string }（表达式为真则满足）
 * 4. 无显式 edges 的任务走 deps 隐式边（默认 onSuccess）
 *
 * @param tasks - 全部任务列表
 * @param edges - 显式边定义（可选，无则用 deps）
 * @param concurrency - 最大并发数
 * @param taskOutcomes - 任务最近一次的 outcome（用于条件判断）
 */
export function computeRunnableWithConditions(
  tasks: Task[],
  edges: { from: string; to: string; when?: string | { expr: string } }[] | undefined,
  concurrency: number,
  taskOutcomes: Map<string, 'success' | 'failure' | 'gate-fail' | 'pending'>,
): Task[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // 构建入边索引：to → edges[]
  const inEdges = new Map<string, { from: string; when?: string | { expr: string } }[]>();
  for (const t of tasks) inEdges.set(t.id, []);

  if (edges && edges.length > 0) {
    for (const e of edges) {
      const list = inEdges.get(e.to) || [];
      list.push({ from: e.from, when: e.when });
      inEdges.set(e.to, list);
    }
  } else {
    // 无显式 edges，用 deps 作为隐式边（默认 onSuccess）
    for (const t of tasks) {
      for (const dep of t.deps) {
        const list = inEdges.get(t.id) || [];
        list.push({ from: dep, when: 'onSuccess' });
        inEdges.set(t.id, list);
      }
    }
  }

  const ready: Task[] = [];
  for (const t of tasks) {
    if (t.status !== 'pending') continue;

    const edgesIntoT = inEdges.get(t.id) || [];

    // 如果没有入边，说明是入口节点
    if (edgesIntoT.length === 0) {
      ready.push(t);
      continue;
    }

    // 检查是否有 FAILED 的上游（如有则跳过，由 propagateFailure 处理）
    const hasFailedUpstream = edgesIntoT.some((e) => {
      const upstream = taskMap.get(e.from);
      return upstream?.status === 'failed' || upstream?.status === 'blocked';
    });
    if (hasFailedUpstream) continue;

    // 至少一条入边条件满足
    const anyEdgeSatisfied = edgesIntoT.some((e) => {
      const upstream = taskMap.get(e.from);
      if (!upstream || upstream.status !== 'done') return false;
      const outcome = taskOutcomes.get(e.from) || 'success';
      return evalEdgeCondition(e.when, outcome);
    });

    if (anyEdgeSatisfied) ready.push(t);
  }

  return ready.slice(0, concurrency);
}

/**
 * 评估边条件
 */
function evalEdgeCondition(
  when: string | { expr: string } | undefined,
  outcome: 'success' | 'failure' | 'gate-fail' | 'pending',
): boolean {
  if (!when) return outcome === 'success'; // 默认成功才继续

  if (typeof when === 'string') {
    switch (when) {
      case 'onSuccess': return outcome === 'success';
      case 'onFailure': return outcome === 'failure';
      case 'onGateFail': return outcome === 'gate-fail';
      case 'onManualApprove': return outcome === 'success'; // 人工通过算 success
      case 'onManualReject': return outcome === 'failure';  // 人工拒绝算 failure
      default: return true; // 未知条件默认满足
    }
  }

  // 表达式对象 — 简化实现：总是满足（实际需表达式引擎）
  if (when && typeof when === 'object' && when.expr) {
    return true;
  }

  return outcome === 'success';
}

/**
 * 检查图级 maxIterations 防护
 *
 * @param taskVisitCounts - 每个任务的访问次数（task.id → count）
 * @param maxIterations - 整图最大访问次数
 * @returns 是否超过限制
 */
export function checkMaxIterations(
  taskVisitCounts: Map<string, number>,
  maxIterations: number,
): boolean {
  let totalVisits = 0;
  for (const count of taskVisitCounts.values()) {
    totalVisits += count;
  }
  return totalVisits >= maxIterations;
}

/**
 * 计算延迟时间（用于 retryPolicy）
 */
export function computeBackoffDelay(
  policy: { backoff?: string; baseDelayMs?: number; maxDelayMs?: number; jitter?: number },
  attempt: number,
): number {
  const base = policy.baseDelayMs ?? 1000;
  const max = policy.maxDelayMs ?? 60000;
  const jitter = policy.jitter ?? 0.1;

  let delay: number;
  switch (policy.backoff) {
    case 'linear':
      delay = base * attempt;
      break;
    case 'exponential':
      delay = base * Math.pow(2, attempt - 1);
      break;
    case 'none':
    default:
      delay = base;
      break;
  }

  // 限制最大延迟
  delay = Math.min(delay, max);

  // 添加抖动
  if (jitter > 0) {
    const jitterAmount = delay * jitter;
    delay += (Math.random() - 0.5) * 2 * jitterAmount;
  }

  return Math.max(0, Math.round(delay));
}
