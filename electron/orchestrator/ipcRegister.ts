/**
 * IPC 注册模块
 *
 * 提供 registerOrchestratorIpc() 函数，由 claude-space 的 main.ts 调用
 * 注册所有 orchestrator:v1: 前缀的 IPC handler
 *
 * 设计原则：
 * - 松耦合：不修改 claude-space 现有代码，只提供注册函数
 * - 单实例：一个 repoPath 对应一个 OrchestratorEngine
 * - 事件推送：通过 BrowserWindow.webContents.send 推送事件到渲染层
 */

import { ipcMain, BrowserWindow } from 'electron';
import { OrchestratorEngine } from './orchestratorEngine.js';
import type { ClaudeRunner, GateRunner } from './orchestratorEngine.js';
import { ORCH_CHANNELS, ORCH_EVENTS } from './channels.js';
import type {
  CreateOrchestrationOpts,
  IpcResponse,
  Orchestration,
  OrchestrationEvent,
  Task,
  TaskIO,
  Template,
} from './types.js';
import { TEMPLATES, registerCustomTemplate, getTemplate } from './templates.js';

// ── Engine 管理器 ─────────────────────────────────────────

/**
 * Engine 实例缓存（按 repoPath 索引）
 *
 * 同一个 repoPath 复用一个 Engine 实例
 */
const engines = new Map<string, OrchestratorEngine>();

/**
 * 获取或创建 Engine 实例
 */
function getEngine(
  repoPath: string,
  claudeRunner: ClaudeRunner,
  gateRunner: GateRunner,
): OrchestratorEngine {
  let engine = engines.get(repoPath);
  if (!engine) {
    engine = new OrchestratorEngine({
      repoPath,
      claudeRunner,
      gateRunner,
      emit: (event) => broadcastEvent(repoPath, event),
    });
    engines.set(repoPath, engine);
  }
  return engine;
}

/**
 * 按 orchestrationId 查找 Engine 实例
 *
 * 由于 Engine 按 repoPath 缓存，不同 repoPath 会创建不同 Engine 和 SQLite。
 * 此函数遍历所有 Engine 实例，找到包含指定编排的实例。
 */
function findEngineByOrchestrationId(orchestrationId: string): OrchestratorEngine | null {
  for (const engine of engines.values()) {
    const status = engine.getStatus(orchestrationId);
    if (status) return engine;
  }
  return null;
}

/**
 * 按 taskId 查找 Engine 实例（通过 taskDetail 探测）
 */
function findEngineByTaskId(taskId: string): OrchestratorEngine | null {
  for (const engine of engines.values()) {
    const detail = engine.getTaskDetail(taskId);
    if (detail) return engine;
  }
  return null;
}

/**
 * 广播事件到所有窗口
 *
 * 渲染层通过 ipcRenderer.on(ORCH_EVENTS.*, ...) 监听
 */
function broadcastEvent(repoPath: string, event: OrchestrationEvent): void {
  const windows = BrowserWindow.getAllWindows();
  const channel = mapEventToChannel(event.type);
  if (!channel) return;

  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, { repoPath, ...event });
    }
  }
}

/**
 * 事件类型 → IPC 通道映射
 */
function mapEventToChannel(type: OrchestrationEvent['type']): string | null {
  switch (type) {
    case 'status-change': return ORCH_EVENTS.STATUS_CHANGE;
    case 'task-started': return ORCH_EVENTS.TASK_STARTED;
    case 'task-completed': return ORCH_EVENTS.TASK_COMPLETED;
    case 'task-log': return ORCH_EVENTS.TASK_LOG;
    case 'await-approval': return ORCH_EVENTS.AWAIT_APPROVAL;
    case 'log': return ORCH_EVENTS.LOG;
    default: return null;
  }
}

// ── 响应辅助 ─────────────────────────────────────────────

function ok<T>(data?: T): IpcResponse<T> {
  return { ok: true, data };
}

function fail(code: string, message: string): IpcResponse {
  return { ok: false, error: { code, message } };
}

function wrap<T>(fn: () => Promise<T>): Promise<IpcResponse<T>> {
  return fn()
    .then((data) => ok(data))
    .catch((e) => {
      const code = e?.code || 'INTERNAL_ERROR';
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[orchestrator:ipc] ${code}:`, message);
      return fail(code, message);
    });
}

// ── 注册函数 ─────────────────────────────────────────────

export interface RegisterOpts {
  /** 默认 repoPath（用于无 session 的请求） */
  repoPath: string;
  /** Claude 执行器 */
  claudeRunner: ClaudeRunner;
  /** 门禁执行器 */
  gateRunner: GateRunner;
}

/**
 * 注册所有 orchestrator IPC handler
 *
 * 在 app.whenReady() 后调用一次
 */
export function registerOrchestratorIpc(opts: RegisterOpts): void {
  const { repoPath, claudeRunner, gateRunner } = opts;

  // ── 创建编排 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.CREATE, async (_event, args: CreateOrchestrationOpts) => {
    return wrap(async () => {
      const engine = getEngine(args.repoPath || repoPath, claudeRunner, gateRunner);
      return engine.create(args);
    });
  });

  // ── 启动编排 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.START, async (_event, orchestrationId: string) => {
    return wrap(async () => {
      const engine = findEngineByOrchestrationId(orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
      await engine.start(orchestrationId);
      return undefined;
    });
  });

  // ── 暂停编排 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.PAUSE, async (_event, orchestrationId: string) => {
    return wrap(async () => {
      const engine = findEngineByOrchestrationId(orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
      await engine.pause(orchestrationId);
      return undefined;
    });
  });

  // ── 恢复编排 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.RESUME, async (_event, orchestrationId: string) => {
    return wrap(async () => {
      const engine = findEngineByOrchestrationId(orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
      await engine.resume(orchestrationId);
      return undefined;
    });
  });

  // ── 停止编排 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.STOP, async (_event, orchestrationId: string) => {
    return wrap(async () => {
      const engine = findEngineByOrchestrationId(orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
      await engine.stop(orchestrationId);
      return undefined;
    });
  });

  // ── 查询状态 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.STATUS, async (_event, orchestrationId: string) => {
    return wrap(async () => {
      const engine = findEngineByOrchestrationId(orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
      return engine.getStatus(orchestrationId);
    });
  });

  // ── 列出编排（按 repoPath 隔离）────────────────────────
  ipcMain.handle(ORCH_CHANNELS.LIST, async (_event, filterRepoPath?: string) => {
    return wrap(async () => {
      // 如果传了 repoPath，只返回该项目的编排
      if (filterRepoPath) {
        const engine = getEngine(filterRepoPath, claudeRunner, gateRunner);
        return engine.listOrchestrations();
      }
      // 未传 repoPath 时返回全部（兼容旧行为）
      if (engines.size === 0) {
        const engine = getEngine(repoPath, claudeRunner, gateRunner);
        return engine.listOrchestrations();
      }
      const all: Orchestration[] = [];
      for (const engine of engines.values()) {
        const list = await engine.listOrchestrations();
        all.push(...list);
      }
      all.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
      return all;
    });
  });

  // ── 审批 ──────────────────────────────────────────────
  ipcMain.handle(
    ORCH_CHANNELS.APPROVE,
    async (_event, args: { orchestrationId: string; taskId: string; decision: 'approve' | 'reject' }) => {
      return wrap(async () => {
        const engine = findEngineByOrchestrationId(args.orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
        await engine.approve(args.orchestrationId, args.taskId, args.decision);
        return undefined;
      });
    },
  );

  // ── 拒绝（快捷方式） ──────────────────────────────────
  ipcMain.handle(
    ORCH_CHANNELS.REJECT,
    async (_event, args: { orchestrationId: string; taskId: string }) => {
      return wrap(async () => {
        const engine = findEngineByOrchestrationId(args.orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
        await engine.approve(args.orchestrationId, args.taskId, 'reject');
        return undefined;
      });
    },
  );

  // ── 接管任务 ──────────────────────────────────────────
  ipcMain.handle(
    ORCH_CHANNELS.TAKEOVER,
    async (_event, args: { orchestrationId: string; taskId: string }) => {
      return wrap(async () => {
        const engine = findEngineByOrchestrationId(args.orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
        await engine.takeover(args.orchestrationId, args.taskId);
        return undefined;
      });
    },
  );

  // ── 任务详情 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.TASK_DETAIL, async (_event, taskId: string) => {
    return wrap(async () => {
      const engine = findEngineByTaskId(taskId) || getEngine(repoPath, claudeRunner, gateRunner);
      return engine.getTaskDetail(taskId);
    });
  });

  // ── 任务列表 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.TASK_LIST, async (_event, orchestrationId: string) => {
    return wrap(async () => {
      const engine = findEngineByOrchestrationId(orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
      const status = engine.getStatus(orchestrationId);
      return status?.tasks ?? [];
    });
  });

  // ── 读取产物 ──────────────────────────────────────────
  ipcMain.handle(
    ORCH_CHANNELS.ARTIFACT_READ,
    async (_event, args: { orchestrationId: string; taskId: string; artifactPath: string }) => {
      return wrap(async () => {
        const engine = findEngineByOrchestrationId(args.orchestrationId) || getEngine(repoPath, claudeRunner, gateRunner);
        return engine.getTaskDetail(args.taskId);
      });
    },
  );

  // ── 模板列表 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.TEMPLATES, async () => {
    return wrap(async () => TEMPLATES as Template[]);
  });

  // ── 使用完整模板对象创建编排（统一编辑器自定义模板）─────
  ipcMain.handle(ORCH_CHANNELS.CREATE_WITH_TEMPLATE, async (_event, args: { template: Template; goal: string; testCommand?: string; autoApprove?: boolean; model?: string; repoPath?: string }) => {
    return wrap(async () => {
      // 安全检查：如果传入的模板没有 tasks（前端可能丢失），回退到内置模板
      let templateToRegister = args.template;
      if (!args.template.tasks || args.template.tasks.length === 0) {
        const builtin = getTemplate(args.template.id);
        if (builtin && builtin.tasks && builtin.tasks.length > 0) {
          // 合并：保留前端传入的 name/description 等元数据，使用内置模板的 tasks
          templateToRegister = { ...args.template, tasks: builtin.tasks, entry: builtin.entry, terminals: builtin.terminals };
          console.log(`[orchestrator:ipc] 模板 "${args.template.id}" tasks 为空，已回退到内置模板的 ${builtin.tasks.length} 个任务`);
        }
      }
      registerCustomTemplate(templateToRegister);
      const engine = getEngine(args.repoPath || repoPath, claudeRunner, gateRunner);
      return engine.create({
        templateId: templateToRegister.id,
        goal: args.goal,
        testCommand: args.testCommand,
        autoApprove: args.autoApprove,
        model: args.model,
      });
    });
  });

  // ── 更新任务的输入/输出配置 ──────────────────────────
  ipcMain.handle(ORCH_CHANNELS.UPDATE_TASK_IO, async (_event, args: { taskId: string; inputs?: TaskIO[]; outputs?: TaskIO[]; repoPath?: string }) => {
    return wrap(async () => {
      const engine = getEngine(args.repoPath || repoPath, claudeRunner, gateRunner);
      engine.updateTaskIO(args.taskId, args.inputs, args.outputs);
      return undefined;
    });
  });

  // ── 清理 ──────────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.CLEANUP, async () => {
    return wrap(async () => {
      const engine = getEngine(repoPath, claudeRunner, gateRunner);
      await engine.cleanup();
      return undefined;
    });
  });

  // ── 健康检查 ──────────────────────────────────────────
  ipcMain.handle(ORCH_CHANNELS.HEALTH_CHECK, async () => {
    return wrap(async () => {
      const engine = getEngine(repoPath, claudeRunner, gateRunner);
      return engine.healthCheck();
    });
  });

  console.log('[orchestrator:ipc] 已注册', Object.keys(ORCH_CHANNELS).length, '个 IPC handler');
}

// ── 资源释放 ─────────────────────────────────────────────

/**
 * 释放所有 Engine 资源（在 app.on('before-quit') 调用）
 */
export function disposeAllOrchestratorEngines(): void {
  for (const engine of engines.values()) {
    engine.dispose();
  }
  engines.clear();
}
