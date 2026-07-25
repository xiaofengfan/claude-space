/**
 * 统一模板类型和工具函数
 *
 * 融合简单模式（phases 数组）和高级模式（DAG tasks）为统一数据模型。
 * 底层统一用 TaskDef[]，线性模板 = 链式 deps 的 DAG 特例。
 */

// ── 类型定义（与后端 types.ts 对齐）──────────────────────

export type TaskKind = 'phase' | 'gate' | 'human-gate' | 'harness-call' | 'sub-workflow' | 'switch';
export type GateType = 'test' | 'review';
export type TemplateKind = 'greenfield' | 'refactor' | 'migration' | 'upgrade' | 'hotfix' | 'custom';

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
  retryPolicy?: RetryPolicy;
  advisors?: Advisor[];
  cases?: SwitchCase[];
  workflow?: string;
  params?: Record<string, string>;
  harness?: string;
  injectAs?: string;
  model?: string;
  inputs?: TaskIO[];
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

export interface UnifiedTemplate {
  id: string;
  name: string;
  description: string;
  kind: TemplateKind;
  icon: string;
  tasks: TaskDef[];
  entry: string;
  terminals: string[];
  params?: ParamDef[];
  maxIterations?: number;
  edges?: EdgeDef[];
  builtin?: boolean;
  projectPath?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ── 常量 ─────────────────────────────────────────────────

export const PHASES = [
  { id: 'INGEST', label: '需求采集', icon: '📥' },
  { id: 'ANALYZE', label: '分析架构', icon: '🔍' },
  { id: 'ARCHITECT', label: '架构设计', icon: '🏗️' },
  { id: 'EXECUTE', label: '执行实现', icon: '⚙️' },
  { id: 'TEST', label: '测试验证', icon: '🧪' },
  { id: 'REVIEW', label: '代码审查', icon: '👁️' },
  { id: 'DEPLOY', label: '部署发布', icon: '🚀' },
  { id: 'DONE', label: '完成', icon: '✅' },
];

export const KIND_LABELS: Record<TaskKind, string> = {
  'phase': 'AI 阶段',
  'gate': '质量门禁',
  'human-gate': '人工审批',
  'harness-call': '多轮交互',
  'sub-workflow': '子工作流',
  'switch': '条件分支',
};

export const KIND_ICONS: Record<TaskKind, string> = {
  'phase': '🤖',
  'gate': '🛡️',
  'human-gate': '✋',
  'harness-call': '🔁',
  'sub-workflow': '📦',
  'switch': '🔀',
};

export const KIND_COLORS: Record<TaskKind, string> = {
  'phase': '#4a9eff',
  'gate': '#f5a623',
  'human-gate': '#bd10e0',
  'harness-call': '#7ed321',
  'sub-workflow': '#9013fe',
  'switch': '#f8e71c',
};

export const MODELS = [
  { id: 'sonnet', label: 'Sonnet (快速)' },
  { id: 'opus', label: 'Opus (深度)' },
];

export const TEMPLATE_KINDS = [
  { id: 'custom', label: '自定义', icon: '📦' },
  { id: 'greenfield', label: '全新项目', icon: '🌱' },
  { id: 'refactor', label: '重构', icon: '🔧' },
  { id: 'migration', label: '迁移', icon: '🔄' },
  { id: 'upgrade', label: '升级', icon: '⬆️' },
  { id: 'hotfix', label: '热修复', icon: '🔥' },
];

export const ADVISOR_TRIGGERS: Record<string, string> = {
  'failure': '失败时',
  'gate-fail': '门禁失败时',
  'before-approve': '审批前',
  'on-retry': '重试时',
  'after-node': '节点完成后',
};

// ── 转换函数 ─────────────────────────────────────────────

/** 把旧 phases 数组转为线性 TaskDef[]（链式 deps） */
export function phasesToTasks(phases: Array<{
  name: string;
  type: 'single' | 'parallel' | 'loop';
  prompt: string;
  model: string;
}>): { tasks: TaskDef[]; entry: string; terminals: string[] } {
  const tasks: TaskDef[] = [];
  let prevId: string | undefined;
  for (let i = 0; i < phases.length; i++) {
    const id = 'task-' + Date.now().toString(36) + '-' + i;
    const t: TaskDef = {
      id,
      title: phases[i].name,
      kind: 'phase',
      deps: prevId ? [prevId] : [],
      prompt: phases[i].prompt,
      model: phases[i].model,
    };
    tasks.push(t);
    prevId = id;
  }
  return {
    tasks,
    entry: tasks[0]?.id || '',
    terminals: tasks.length > 0 ? [tasks[tasks.length - 1].id] : [],
  };
}

/** 创建空模板 */
export function createEmptyTemplate(): UnifiedTemplate {
  const now = new Date().toISOString();
  const taskId = 'task-' + Date.now().toString(36);
  return {
    id: 'custom-' + Date.now().toString(36),
    name: '',
    description: '',
    kind: 'custom',
    icon: '📦',
    tasks: [{
      id: taskId,
      title: '阶段 1',
      kind: 'phase',
      deps: [],
      prompt: '',
      model: 'sonnet',
    }],
    entry: taskId,
    terminals: [taskId],
    builtin: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** 生成新任务 id */
export function genTaskId(): string {
  return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

// ── localStorage 持久化 ─────────────────────────────────

const STORAGE_KEY = 'cs-unified-templates';
const OLD_STORAGE_KEY = 'cs-workflow-templates';

/** 加载自定义模板（含旧数据迁移） */
export function loadCustomTemplates(): UnifiedTemplate[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  // 迁移旧格式
  try {
    const oldSaved = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldSaved) {
      const oldTemplates = JSON.parse(oldSaved);
      if (Array.isArray(oldTemplates)) {
        const migrated: UnifiedTemplate[] = oldTemplates
          .filter((t: any) => t && t.phases && Array.isArray(t.phases))
          .map((t: any) => {
            const { tasks, entry, terminals } = phasesToTasks(t.phases);
            return {
              id: t.id || 'custom-' + Date.now().toString(36),
              name: t.name || '未命名',
              description: t.description || '',
              kind: 'custom' as TemplateKind,
              icon: t.icon || '📦',
              tasks,
              entry,
              terminals,
              builtin: false,
              projectPath: t.projectPath,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          });
        if (migrated.length > 0) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
          return migrated;
        }
      }
    }
  } catch {}

  return [];
}

/** 保存自定义模板 */
export function saveCustomTemplates(templates: UnifiedTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

/** 后端 Template（DAG）转 UnifiedTemplate */
export function backendTemplateToUnified(t: any): UnifiedTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    kind: t.kind || 'custom',
    icon: t.icon || '📦',
    tasks: t.tasks || [],
    entry: t.entry || (t.tasks && t.tasks[0]?.id) || '',
    terminals: t.terminals || (t.tasks && t.tasks.length > 0 ? [t.tasks[t.tasks.length - 1].id] : []),
    params: t.params,
    maxIterations: t.maxIterations,
    edges: t.edges,
    builtin: true,
  };
}
