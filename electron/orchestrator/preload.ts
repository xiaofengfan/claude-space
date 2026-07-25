/**
 * Preload API 暴露
 *
 * 通过 contextBridge.exposeInMainWorld('orchestrator', ...) 暴露到渲染层
 * 与 claude-space 现有的 window.electronAPI 并存，互不干扰
 *
 * 使用方式（渲染层）：
 *   const orch = await window.orchestrator.create({ templateId: 'hotfix', goal: '...' })
 *   await window.orchestrator.start(orch.id)
 *   window.orchestrator.onStatusChange((event) => { ... })
 */

import { contextBridge, ipcRenderer } from 'electron';
import { ORCH_CHANNELS, ORCH_EVENTS } from './channels.js';
import type {
  CreateOrchestrationOpts,
  IpcResponse,
  Orchestration,
  OrchestrationEvent,
  Run,
  Task,
  TaskIO,
  Template,
} from './types.js';

// ── 事件负载类型（IPC 传输时附加 repoPath）──────────────

interface EventPayload<T extends OrchestrationEvent> {
  repoPath: string;
  orchestrationId: string;
  [key: string]: unknown;
}

// ── 暴露的 API 接口 ─────────────────────────────────────

export interface OrchestratorApi {
  // 任务管理
  create(opts: CreateOrchestrationOpts): Promise<IpcResponse<Orchestration>>;
  createWithTemplate(opts: { template: Template; goal: string; testCommand?: string; autoApprove?: boolean; model?: string; repoPath?: string }): Promise<IpcResponse<Orchestration>>;
  start(orchestrationId: string): Promise<IpcResponse<void>>;
  pause(orchestrationId: string): Promise<IpcResponse<void>>;
  resume(orchestrationId: string): Promise<IpcResponse<void>>;
  stop(orchestrationId: string): Promise<IpcResponse<void>>;
  updateTaskIO(opts: { taskId: string; inputs?: TaskIO[]; outputs?: TaskIO[]; repoPath?: string }): Promise<IpcResponse<void>>;

  // 查询
  status(orchestrationId: string): Promise<IpcResponse<{ orchestration: Orchestration; tasks: Task[] } | null>>;
  list(repoPath?: string): Promise<IpcResponse<Orchestration[]>>;
  taskDetail(taskId: string): Promise<IpcResponse<{ task: Task; runs: Run[] } | null>>;
  taskList(orchestrationId: string): Promise<IpcResponse<Task[]>>;

  // 审批
  approve(orchestrationId: string, taskId: string, decision: 'approve' | 'reject'): Promise<IpcResponse<void>>;
  reject(orchestrationId: string, taskId: string): Promise<IpcResponse<void>>;
  takeover(orchestrationId: string, taskId: string): Promise<IpcResponse<void>>;

  // 模板
  templates(): Promise<IpcResponse<Template[]>>;

  // 维护
  cleanup(): Promise<IpcResponse<void>>;
  healthCheck(): Promise<IpcResponse<{ ok: boolean; issues: string[] }>>;

  // 事件监听（返回取消订阅函数）
  onStatusChange(callback: (payload: EventPayload<Extract<OrchestrationEvent, { type: 'status-change' }>>) => void): () => void;
  onTaskStarted(callback: (payload: EventPayload<Extract<OrchestrationEvent, { type: 'task-started' }>>) => void): () => void;
  onTaskCompleted(callback: (payload: EventPayload<Extract<OrchestrationEvent, { type: 'task-completed' }>>) => void): () => void;
  onTaskLog(callback: (payload: EventPayload<Extract<OrchestrationEvent, { type: 'task-log' }>>) => void): () => void;
  onAwaitApproval(callback: (payload: EventPayload<Extract<OrchestrationEvent, { type: 'await-approval' }>>) => void): () => void;
  onLog(callback: (payload: EventPayload<Extract<OrchestrationEvent, { type: 'log' }>>) => void): () => void;
}

// ── 实现辅助 ─────────────────────────────────────────────

/**
 * 创建事件监听器
 *
 * @param channel - IPC 事件通道
 * @param callback - 回调函数
 * @returns 取消订阅函数
 */
function createListener<T>(
  channel: string,
  callback: (payload: T) => void,
): () => void {
  const handler = (_event: unknown, payload: T) => {
    try {
      callback(payload);
    } catch (e) {
      console.error(`[orchestrator:preload] ${channel} callback error:`, e);
    }
  };
  ipcRenderer.on(channel, handler as (...args: unknown[]) => void);
  return () => {
    ipcRenderer.off(channel, handler as (...args: unknown[]) => void);
  };
}

// ── 暴露 API ─────────────────────────────────────────────

const api: OrchestratorApi = {
  // 任务管理
  create: (opts) => ipcRenderer.invoke(ORCH_CHANNELS.CREATE, opts),
  createWithTemplate: (opts) => ipcRenderer.invoke(ORCH_CHANNELS.CREATE_WITH_TEMPLATE, opts),
  start: (orchestrationId) => ipcRenderer.invoke(ORCH_CHANNELS.START, orchestrationId),
  pause: (orchestrationId) => ipcRenderer.invoke(ORCH_CHANNELS.PAUSE, orchestrationId),
  resume: (orchestrationId) => ipcRenderer.invoke(ORCH_CHANNELS.RESUME, orchestrationId),
  stop: (orchestrationId) => ipcRenderer.invoke(ORCH_CHANNELS.STOP, orchestrationId),
  updateTaskIO: (opts) => ipcRenderer.invoke(ORCH_CHANNELS.UPDATE_TASK_IO, opts),

  // 查询
  status: (orchestrationId) => ipcRenderer.invoke(ORCH_CHANNELS.STATUS, orchestrationId),
  list: (repoPath?: string) => ipcRenderer.invoke(ORCH_CHANNELS.LIST, repoPath),
  taskDetail: (taskId) => ipcRenderer.invoke(ORCH_CHANNELS.TASK_DETAIL, taskId),
  taskList: (orchestrationId) => ipcRenderer.invoke(ORCH_CHANNELS.TASK_LIST, orchestrationId),

  // 审批
  approve: (orchestrationId, taskId, decision) =>
    ipcRenderer.invoke(ORCH_CHANNELS.APPROVE, { orchestrationId, taskId, decision }),
  reject: (orchestrationId, taskId) =>
    ipcRenderer.invoke(ORCH_CHANNELS.REJECT, { orchestrationId, taskId }),
  takeover: (orchestrationId, taskId) =>
    ipcRenderer.invoke(ORCH_CHANNELS.TAKEOVER, { orchestrationId, taskId }),

  // 模板
  templates: () => ipcRenderer.invoke(ORCH_CHANNELS.TEMPLATES),

  // 维护
  cleanup: () => ipcRenderer.invoke(ORCH_CHANNELS.CLEANUP),
  healthCheck: () => ipcRenderer.invoke(ORCH_CHANNELS.HEALTH_CHECK),

  // 事件监听
  onStatusChange: (callback) => createListener(ORCH_EVENTS.STATUS_CHANGE, callback),
  onTaskStarted: (callback) => createListener(ORCH_EVENTS.TASK_STARTED, callback),
  onTaskCompleted: (callback) => createListener(ORCH_EVENTS.TASK_COMPLETED, callback),
  onTaskLog: (callback) => createListener(ORCH_EVENTS.TASK_LOG, callback),
  onAwaitApproval: (callback) => createListener(ORCH_EVENTS.AWAIT_APPROVAL, callback),
  onLog: (callback) => createListener(ORCH_EVENTS.LOG, callback),
};

/**
 * 暴露 orchestrator API 到渲染层
 *
 * 在 preload.ts 中调用一次：
 *   exposeOrchestratorApi()
 *
 * 渲染层通过 window.orchestrator 访问
 */
export function exposeOrchestratorApi(): void {
  contextBridge.exposeInMainWorld('orchestrator', api);
  console.log('[orchestrator:preload] 已暴露 window.orchestrator API');
}

// ── 类型声明（供渲染层使用）──────────────────────────────

declare global {
  interface Window {
    orchestrator?: OrchestratorApi;
  }
}
