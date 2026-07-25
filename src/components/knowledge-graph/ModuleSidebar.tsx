/**
 * 业务模块侧边栏 — 独立组件，用于整体左侧栏
 *
 * 功能：
 * 1. 从图谱数据（graph:load）加载业务模块（与 KnowledgeGraphSidebar 同源）
 * 2. 按业务分组分类展示模块
 * 3. 每个模块支持任务监测：添加任务、切换状态、删除任务
 * 4. 任务数据持久化到 {projectPath}/.trae-kg/module-tasks.json
 * 5. 按模块显示任务进度（已完成/总数）
 * 6. 支持搜索过滤、状态过滤
 *
 * 数据来源：
 * - 业务模块：window.electronAPI.graphLoad(projectPath) → entities/relations
 * - 任务数据：window.electronAPI.readFile/writeFile 持久化
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { GraphEntity, GraphRelation } from '../../types/knowledgeGraph';

// ── 类型 ──────────────────────────────────────────
interface Props {
  projectPath: string;
  theme: 'dark' | 'light';
  /** 刷新触发器（值变化时重新加载图谱数据） */
  refreshTrigger?: number;
  /** 打开图谱主面板 */
  onOpenGraph?: () => void;
}

type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

interface ModuleTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// ── 配置 ──────────────────────────────────────────
interface ModuleGroup {
  key: string;
  label: string;
  icon: string;
  color: string;
}

const MODULE_GROUPS: ModuleGroup[] = [
  { key: 'core', label: '核心系统', icon: '🎯', color: '#e74c3c' },
  { key: 'business', label: '业务功能', icon: '🧩', color: '#4a5cf7' },
  { key: 'integration', label: '集成模块', icon: '🔗', color: '#9b59b6' },
  { key: 'infra', label: '基础设施', icon: '🔧', color: '#7f8c8d' },
  { key: 'common', label: '通用组件', icon: '♻️', color: '#16a085' },
];

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; icon: string; color: string; next: TaskStatus }> = {
  todo:     { label: '待开发', icon: '⬜', color: '#95a5a6', next: 'doing' },
  doing:    { label: '进行中', icon: '🔵', color: '#3498db', next: 'done' },
  done:     { label: '已完成', icon: '✅', color: '#27ae60', next: 'archived' as any },
  blocked:  { label: '阻塞', icon: '⛔', color: '#e74c3c', next: 'todo' },
};

const TASK_PRIORITY_CONFIG: Record<TaskPriority, { label: string; icon: string; color: string }> = {
  low:      { label: '低', icon: '▽', color: '#95a5a6' },
  medium:   { label: '中', icon: '◁', color: '#f39c12' },
  high:     { label: '高', icon: '◀', color: '#e67e22' },
  critical: { label: '紧急', icon: '★', color: '#e74c3c' },
};

const TASKS_FILE_NAME = 'module-tasks.json';

// ── 业务模块识别规则 ──────────────────────────────
// 中文业务模块名（用户管理、订单管理等）
const CN_BUSINESS_NAMES =
  /系统管理|用户管理|权限管理|角色管理|菜单管理|字典管理|组织管理|部门管理|报表管理|流程管理|订单管理|客户管理|产品管理|项目管理|任务管理|审批管理|合同管理|支付管理|通知管理|消息管理|商品管理|库存管理|仓储管理|采购管理|销售管理|财务管理|人事管理|考勤管理|薪酬管理|资产管理/;

// 英文业务模块名（order、user 等）
const EN_BUSINESS_NAMES =
  /^(order|customer|product|user|auth|payment|invoice|approval|report|notification|inventory|warehouse|purchase|sale|finance|hr|attendance|payroll|asset|business|biz)$/i;

// 核心/系统操作功能名（系统级、入口、核心业务）
const CN_CORE_NAMES = /系统核心|核心模块|核心业务|应用入口|主入口|系统操作|操作管理|系统中心|核心引擎|系统引擎|主应用/;
const EN_CORE_NAMES = /^(core|system|main|bootstrap|app|application|kernel|engine)$/i;

// 集成模块名（API、集成、接口等）
const CN_INTEGRATION_NAMES = /接口集成|集成模块|消息集成|第三方集成|外部接口|对外接口|开放平台/;
const EN_INTEGRATION_NAMES = /^(api|integration|interface|gateway|connector|webhook|callback)$/i;

// 基础设施名（配置、缓存、日志、数据库等）
const CN_INFRA_NAMES = /基础设施|数据库|数据源|缓存|日志|配置中心|消息队列|任务调度|监控告警/;
const EN_INFRA_NAMES = /^(config|database|db|cache|redis|logger|logging|messaging|queue|schedule|monitor|alert|datasource|connection|pool)$/i;

// 通用组件名（util、common、helper、shared、tool 等）
const EN_COMMON_NAMES = /^(util|utils|util-lib|common|commons|helper|helpers|tool|tools|toolkit|lib|libs|library|shared|share|generic|utils-common|common-lib)$/i;

/**
 * 判断是否为业务功能模块（不包含代码文件、配置文件）
 *
 * 准入规则（满足任一即纳入）：
 * 1. AI 产出的实体（source='ai'） — AI 分析的业务实体
 * 2. metadata.moduleType 标记的业务模块
 * 3. tags 包含 business/sub-module/core/integration/infra/common
 * 4. 中文/英文名称匹配业务模块
 * 5. 扫描器 type=module 且名称匹配业务模块正则
 *
 * 排除规则：
 * - 扫描器的 type=file / type=directory / type=dependency 等非业务模块
 * - 普通的 type=module 但名称无业务含义的（如 utils、components 这类代码包目录）
 */
function isBusinessModule(e: GraphEntity): boolean {
  // 1. AI 产出的实体（source='ai'） — AI 分析的业务实体全部纳入
  if ((e as any).source === 'ai') return true;
  // 2. metadata.moduleType 标记
  const mt = e.metadata?.moduleType;
  if (mt === 'core' || mt === 'business' || mt === 'integration' || mt === 'infra' || mt === 'common') return true;
  // 3. tags 包含业务模块标记
  const tags = e.tags || [];
  if (tags.some((t) => ['business', 'sub-module', 'core', 'integration', 'infra', 'common'].includes(t))) return true;
  // 4. 中英文业务模块名匹配
  if (CN_BUSINESS_NAMES.test(e.name) || EN_BUSINESS_NAMES.test(e.name)) return true;
  // 5. 扫描器 type=module 且名称匹配业务模块正则
  if (e.type === 'module' && (CN_BUSINESS_NAMES.test(e.name) || EN_BUSINESS_NAMES.test(e.name))) return true;
  // 6. 扫描器 type=module 且名称匹配核心模块正则
  if (e.type === 'module' && (CN_CORE_NAMES.test(e.name) || EN_CORE_NAMES.test(e.name))) return true;
  // 7. 扫描器 type=module 且名称匹配集成模块正则
  if (e.type === 'module' && (CN_INTEGRATION_NAMES.test(e.name) || EN_INTEGRATION_NAMES.test(e.name))) return true;
  // 8. 扫描器 type=module 且名称匹配基础设施正则
  if (e.type === 'module' && (CN_INFRA_NAMES.test(e.name) || EN_INFRA_NAMES.test(e.name))) return true;
  // 9. 扫描器 type=module 且名称匹配通用组件正则
  if (e.type === 'module' && EN_COMMON_NAMES.test(e.name)) return true;
  // 其他情况：不纳入（避免把代码包/配置文件当成业务模块）
  return false;
}

/**
 * 获取模块所属分组
 *
 * 分类优先级：
 * 1. metadata.moduleType 直接映射
 * 2. tags 直接映射
 * 3. AI 实体基于 metadata.archLayer 推断
 * 4. 中英文名称关键词推断
 * 5. 无法准确分类 → 返回 null（被过滤掉，不显示）
 */
function getModuleGroup(e: GraphEntity): string | null {
  // 1. metadata.moduleType 直接映射
  const mt = e.metadata?.moduleType;
  if (mt === 'core') return 'core';
  if (mt === 'business') return 'business';
  if (mt === 'integration') return 'integration';
  if (mt === 'infra') return 'infra';
  if (mt === 'common') return 'common';

  // 2. tags 直接映射
  const tags = e.tags || [];
  if (tags.includes('core')) return 'core';
  if (tags.includes('business') || tags.includes('sub-module')) return 'business';
  if (tags.includes('integration')) return 'integration';
  if (tags.includes('infra')) return 'infra';
  if (tags.includes('common')) return 'common';

  const name = e.name || '';
  const nameLower = name.toLowerCase();
  const path = (e.filePath || '').toLowerCase();

  // 3. 中英文名称精确匹配
  if (CN_BUSINESS_NAMES.test(name)) return 'business';
  if (CN_CORE_NAMES.test(name) || EN_CORE_NAMES.test(nameLower)) return 'core';
  if (CN_INTEGRATION_NAMES.test(name) || EN_INTEGRATION_NAMES.test(nameLower)) return 'integration';
  if (CN_INFRA_NAMES.test(name) || EN_INFRA_NAMES.test(nameLower)) return 'infra';
  if (EN_BUSINESS_NAMES.test(nameLower)) return 'business';
  if (EN_COMMON_NAMES.test(nameLower)) return 'common';

  // 4. AI 实体基于 metadata.archLayer 推断
  if ((e as any).source === 'ai') {
    const archLayer = e.metadata?.archLayer;
    if (archLayer === 'entry') return 'core';
    if (archLayer === 'controller' || archLayer === 'router' || archLayer === 'view') return 'integration';
    if (archLayer === 'service' || archLayer === 'domain' || archLayer === 'manager' || archLayer === 'workflow') return 'business';
    // AI 实体兜底：根据 originalType 推断
    const origType = ((e as any).originalType || e.type || '').toLowerCase();
    if (origType === 'database' || origType === 'entity' || origType === 'repository' || origType === 'dao') return 'infra';
    if (origType === 'api' || origType === 'route' || origType === 'controller' || origType === 'endpoint') return 'integration';
    if (origType === 'service' || origType === 'module' || origType === 'manager' || origType === 'domain') return 'business';
    // AI 实体确实无法分类的，归入 business（AI 分析的实体都有业务意义）
    return 'business';
  }

  // 5. 基于路径关键词推断（扫描器节点）
  if (/\/(config|conf|database|db|cache|datasource|logger|logging|messaging|queue|schedule|monitor)\//.test(path)) {
    return 'infra';
  }
  if (/\/(api|integration|interface|gateway|connector|webhook)\//.test(path)) {
    return 'integration';
  }
  if (/\/(util|utils|common|helper|tools|lib|shared)\//.test(path)) {
    return 'common';
  }
  if (/\/(core|system|main|bootstrap|app)\//.test(path)) {
    return 'core';
  }

  // 6. 无法准确分类 → 返回 null（被过滤掉）
  return null;
}

function countChildren(entityId: string, relations: GraphRelation[]): number {
  return relations.filter((r) => r.type === 'contains' && r.sourceId === entityId).length;
}

function countDependencies(entityId: string, relations: GraphRelation[]): number {
  return relations.filter(
    (r) => r.type !== 'contains' && (r.sourceId === entityId || r.targetId === entityId),
  ).length;
}

function genTaskId(): string {
  return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// ── 组件 ──────────────────────────────────────────
export function ModuleSidebar({ projectPath, theme, refreshTrigger, onOpenGraph }: Props) {
  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [relations, setRelations] = useState<GraphRelation[]>([]);
  const [tasks, setTasks] = useState<Record<string, ModuleTask[]>>({});
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [selectedModuleId, setSelectedModuleId] = useState<string | undefined>(undefined);

  // ── 加载图谱数据 ──────────────────────────────
  // 使用 knowledgeGraph.get IPC（与 KnowledgeGraphPanel 同源）
  // 该 IPC 从 graphCache 获取数据，cache miss 时自动构建 + 合并磁盘 AI 数据
  const loadData = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const kgApi = (window as any).knowledgeGraph;
      if (!kgApi) {
        setEntities([]);
        setRelations([]);
        setLoading(false);
        return;
      }
      const res = await kgApi.get(projectPath);
      if (res?.ok && res.data) {
        // GraphNode → GraphEntity 格式转换
        const nodes = res.data.nodes || [];
        const edges = res.data.edges || [];
        const convertedEntities: GraphEntity[] = nodes.map((n: any) => ({
          id: n.id,
          name: n.label || n.id,
          type: n.type || 'module',
          description: n.properties?.description || '',
          filePath: n.path || n.properties?.filePath || '',
          tags: n.properties?.tags || [],
          metadata: n.properties || {},
          createdAt: n.properties?.createdAt || new Date().toISOString(),
          updatedAt: n.properties?.updatedAt || new Date().toISOString(),
          // 保留 source 字段用于 AI 实体识别
          ...(n.properties?.source ? { source: n.properties.source } : {}),
        }));
        // GraphEdge → GraphRelation 格式转换
        const convertedRelations: GraphRelation[] = edges.map((e: any) => ({
          id: e.id,
          sourceId: e.source,
          targetId: e.target,
          type: e.type,
          label: e.label,
          metadata: e.properties || {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        setEntities(convertedEntities);
        setRelations(convertedRelations);
      } else {
        setEntities([]);
        setRelations([]);
      }
    } catch (e) {
      console.error('[modules] load failed:', e);
      setEntities([]);
      setRelations([]);
    }
    setLoading(false);
  }, [projectPath]);

  // ── 加载任务数据 ──────────────────────────────
  const loadTasks = useCallback(async () => {
    if (!projectPath) return;
    try {
      // 构造任务文件路径：{projectPath}/.trae-kg/module-tasks.json
      const filePath = `${projectPath}/.trae-kg/${TASKS_FILE_NAME}`;
      const res = await window.electronAPI.readFile(filePath);
      if (res?.success && res.content) {
        const parsed = JSON.parse(res.content);
        setTasks(parsed || {});
      } else {
        setTasks({});
      }
    } catch (e) {
      // 文件不存在或解析失败
      setTasks({});
    }
  }, [projectPath]);

  // ── 保存任务数据 ──────────────────────────────
  const saveTasks = useCallback(async (newTasks: Record<string, ModuleTask[]>) => {
    if (!projectPath) return;
    try {
      const filePath = `${projectPath}/.trae-kg/${TASKS_FILE_NAME}`;
      await window.electronAPI.writeFile({
        filePath,
        content: JSON.stringify(newTasks, null, 2),
      });
    } catch (e) {
      console.error('[modules] save tasks failed:', e);
    }
  }, [projectPath]);

  // 初次加载 + refreshTrigger 变化时重新加载
  useEffect(() => {
    loadData();
    loadTasks();
  }, [loadData, loadTasks, refreshTrigger]);

  // ── 业务模块筛选 ──────────────────────────────
  // 先用 isBusinessModule 识别业务模块，再用 getModuleGroup 过滤掉无法分类的
  const businessModules = useMemo(() => {
    const modules = entities.filter((e) => {
      if (!isBusinessModule(e)) return false;
      const gk = getModuleGroup(e);
      return gk !== null; // 无法准确分类的过滤掉
    });
    if (keyword.trim()) {
      const kw = keyword.toLowerCase();
      return modules.filter(
        (e) =>
          e.name.toLowerCase().includes(kw) ||
          (e.filePath || '').toLowerCase().includes(kw),
      );
    }
    return modules;
  }, [entities, keyword]);

  // ── 按分组归类 ──────────────────────────────
  const groupedModules = useMemo(() => {
    const groups: Record<string, GraphEntity[]> = {};
    for (const g of MODULE_GROUPS) groups[g.key] = [];
    for (const e of businessModules) {
      const gk = getModuleGroup(e);
      // 无法准确分类的实体跳过（不显示）
      if (!gk) continue;
      // 仅保留 MODULE_GROUPS 中定义的分组
      if (!groups[gk]) continue;
      // 状态过滤：检查模块下是否有匹配状态的任务
      if (statusFilter) {
        const moduleTasks = tasks[e.id] || [];
        if (!moduleTasks.some((t) => t.status === statusFilter)) continue;
      }
      groups[gk].push(e);
    }
    return groups;
  }, [businessModules, statusFilter, tasks]);

  // ── 全局任务统计 ──────────────────────────────
  const taskStats = useMemo(() => {
    let total = 0, done = 0, doing = 0, blocked = 0, todo = 0;
    for (const moduleId of Object.keys(tasks)) {
      for (const t of tasks[moduleId]) {
        total++;
        if (t.status === 'done') done++;
        else if (t.status === 'doing') doing++;
        else if (t.status === 'blocked') blocked++;
        else todo++;
      }
    }
    return { total, done, doing, blocked, todo };
  }, [tasks]);

  // ── 获取模块任务统计 ──────────────────────────
  const getModuleTaskStats = (moduleId: string) => {
    const moduleTasks = tasks[moduleId] || [];
    const total = moduleTasks.length;
    const done = moduleTasks.filter((t) => t.status === 'done').length;
    const doing = moduleTasks.filter((t) => t.status === 'doing').length;
    const blocked = moduleTasks.filter((t) => t.status === 'blocked').length;
    return { total, done, doing, blocked, todo: total - done - doing - blocked };
  };

  // ── 任务操作 ──────────────────────────────────
  const addTask = (moduleId: string, title: string) => {
    if (!title.trim()) return;
    const newTask: ModuleTask = {
      id: genTaskId(),
      title: title.trim(),
      status: 'todo',
      priority: 'medium',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newTasks = {
      ...tasks,
      [moduleId]: [...(tasks[moduleId] || []), newTask],
    };
    setTasks(newTasks);
    saveTasks(newTasks);
  };

  const updateTaskStatus = (moduleId: string, taskId: string) => {
    const moduleTasks = tasks[moduleId] || [];
    const task = moduleTasks.find((t) => t.id === taskId);
    if (!task) return;
    const currentCfg = TASK_STATUS_CONFIG[task.status];
    // done 状态循环回 todo
    const nextStatus: TaskStatus = task.status === 'done' ? 'todo' : task.status === 'blocked' ? 'todo' : currentCfg.next;
    const newTasks = {
      ...tasks,
      [moduleId]: moduleTasks.map((t) =>
        t.id === taskId
          ? { ...t, status: nextStatus, updatedAt: new Date().toISOString() }
          : t,
      ),
    };
    setTasks(newTasks);
    saveTasks(newTasks);
  };

  const updateTaskPriority = (moduleId: string, taskId: string, priority: TaskPriority) => {
    const moduleTasks = tasks[moduleId] || [];
    const newTasks = {
      ...tasks,
      [moduleId]: moduleTasks.map((t) =>
        t.id === taskId
          ? { ...t, priority, updatedAt: new Date().toISOString() }
          : t,
      ),
    };
    setTasks(newTasks);
    saveTasks(newTasks);
  };

  const deleteTask = (moduleId: string, taskId: string) => {
    const moduleTasks = tasks[moduleId] || [];
    const newTasks = {
      ...tasks,
      [moduleId]: moduleTasks.filter((t) => t.id !== taskId),
    };
    setTasks(newTasks);
    saveTasks(newTasks);
  };

  // ── UI 操作 ──────────────────────────────────
  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleModule = (moduleId: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
    setSelectedModuleId(moduleId);
  };

  // ── 任务输入框状态（每模块一个） ──────────────
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});

  const handleAddTask = (moduleId: string) => {
    const title = taskInputs[moduleId] || '';
    if (title.trim()) {
      addTask(moduleId, title);
      setTaskInputs({ ...taskInputs, [moduleId]: '' });
      // 自动展开模块
      setExpandedModules((prev) => new Set(prev).add(moduleId));
    }
  };

  const totalModules = businessModules.length;

  return (
    <div className="kg-module-sidebar">
      {/* 标题栏 */}
      <div className="kg-module-sidebar-header">
        <span className="kg-module-sidebar-title">📦 业务模块</span>
        <button
          className="kg-module-sidebar-refresh"
          onClick={() => { loadData(); loadTasks(); }}
          disabled={loading}
          title="刷新"
          type="button"
        >
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      {/* 全局任务统计 */}
      <div className="kg-module-task-summary">
        <div className="kg-module-task-summary-row">
          <span className="kg-module-task-summary-label">任务总览</span>
          <span className="kg-module-task-summary-num">{taskStats.total}</span>
        </div>
        <div className="kg-module-task-progress">
          <div
            className="kg-module-task-progress-done"
            style={{ width: `${taskStats.total > 0 ? (taskStats.done / taskStats.total) * 100 : 0}%` }}
          />
        </div>
        <div className="kg-module-task-summary-detail">
          <span title="待开发">⬜ {taskStats.todo}</span>
          <span title="进行中">🔵 {taskStats.doing}</span>
          <span title="已完成">✅ {taskStats.done}</span>
          <span title="阻塞">⛔ {taskStats.blocked}</span>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="kg-module-search">
        <input
          type="text"
          placeholder="搜索模块..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="kg-module-search-input"
        />
        {keyword && (
          <button className="kg-module-search-clear" onClick={() => setKeyword('')} type="button">✕</button>
        )}
      </div>

      {/* 状态过滤条 */}
      <div className="kg-module-status-filter">
        <button
          className={`kg-module-status-chip${statusFilter === '' ? ' active' : ''}`}
          onClick={() => setStatusFilter('')}
          type="button"
        >
          全部 {totalModules}
        </button>
        {(Object.keys(TASK_STATUS_CONFIG) as TaskStatus[]).map((s) => {
          const cfg = TASK_STATUS_CONFIG[s];
          const count = taskStats[s as keyof typeof taskStats] as number || 0;
          return (
            <button
              key={s}
              className={`kg-module-status-chip${statusFilter === s ? ' active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              type="button"
              title={cfg.label}
              style={statusFilter === s ? { borderColor: cfg.color, color: cfg.color } : {}}
            >
              {cfg.icon} {count}
            </button>
          );
        })}
      </div>

      {/* 模块列表 */}
      <div className="kg-module-list">
        {loading && entities.length === 0 ? (
          <div className="kg-module-empty">
            <div className="kg-module-empty-icon">⏳</div>
            <div className="kg-module-empty-text">加载中...</div>
          </div>
        ) : totalModules === 0 ? (
          <div className="kg-module-empty">
            <div className="kg-module-empty-icon">📋</div>
            <div className="kg-module-empty-text">
              {keyword ? '无匹配模块' : '暂无业务模块'}
            </div>
            {!keyword && (
              <div className="kg-module-empty-hint">
                请先进行图谱 AI 分析识别业务模块
                {onOpenGraph && (
                  <button
                    className="kg-module-empty-btn"
                    onClick={onOpenGraph}
                    type="button"
                  >
                    打开图谱分析
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          MODULE_GROUPS.map((group) => {
            const list = groupedModules[group.key] || [];
            if (list.length === 0) return null;
            const isCollapsed = collapsedGroups.has(group.key);
            return (
              <div key={group.key} className="kg-module-group">
                <div
                  className="kg-module-group-header"
                  onClick={() => toggleGroup(group.key)}
                >
                  <span className="kg-module-group-arrow">{isCollapsed ? '▶' : '▼'}</span>
                  <span className="kg-module-group-icon">{group.icon}</span>
                  <span className="kg-module-group-label">{group.label}</span>
                  <span className="kg-module-group-count" style={{ color: group.color }}>{list.length}</span>
                </div>
                {!isCollapsed && (
                  <div className="kg-module-group-items">
                    {list.map((e) => {
                      const isSelected = e.id === selectedModuleId;
                      const isExpanded = expandedModules.has(e.id);
                      const childCount = countChildren(e.id, relations);
                      const depCount = countDependencies(e.id, relations);
                      const stats = getModuleTaskStats(e.id);
                      const progress = stats.total > 0 ? (stats.done / stats.total) * 100 : 0;
                      const moduleTasks = tasks[e.id] || [];
                      return (
                        <div key={e.id} className={`kg-module-item-wrapper${isSelected ? ' selected' : ''}`}>
                          {/* 模块行 */}
                          <div
                            className="kg-module-item"
                            onClick={() => toggleModule(e.id)}
                            title={e.filePath || e.name}
                          >
                            <span className="kg-module-item-arrow">{isExpanded ? '▼' : '▶'}</span>
                            <div className="kg-module-item-content">
                              <div className="kg-module-item-name">{e.name}</div>
                              <div className="kg-module-item-meta">
                                {childCount > 0 && <span className="kg-module-meta-chip">📦 {childCount}</span>}
                                {depCount > 0 && <span className="kg-module-meta-chip">🔗 {depCount}</span>}
                                {stats.total > 0 && (
                                  <span className="kg-module-meta-chip" title={`已完成 ${stats.done}/${stats.total}`}>
                                    ✅ {stats.done}/{stats.total}
                                  </span>
                                )}
                                {e.description && (
                                  <span className="kg-module-item-desc" title={e.description}>{e.description}</span>
                                )}
                              </div>
                              {/* 模块任务进度条 */}
                              {stats.total > 0 && (
                                <div className="kg-module-progress">
                                  <div className="kg-module-progress-fill" style={{ width: `${progress}%` }} />
                                </div>
                              )}
                            </div>
                          </div>

                          {/* 展开后：任务列表 + 添加任务 */}
                          {isExpanded && (
                            <div className="kg-module-tasks">
                              {/* 添加任务输入框 */}
                              <div className="kg-module-task-add">
                                <input
                                  type="text"
                                  placeholder="添加任务..."
                                  value={taskInputs[e.id] || ''}
                                  onChange={(ev) => setTaskInputs({ ...taskInputs, [e.id]: ev.target.value })}
                                  onKeyDown={(ev) => { if (ev.key === 'Enter') handleAddTask(e.id); }}
                                  className="kg-module-task-input"
                                />
                                <button
                                  className="kg-module-task-add-btn"
                                  onClick={() => handleAddTask(e.id)}
                                  type="button"
                                  title="添加任务"
                                >
                                  +
                                </button>
                              </div>

                              {/* 任务列表 */}
                              {moduleTasks.length === 0 ? (
                                <div className="kg-module-task-empty">暂无任务</div>
                              ) : (
                                moduleTasks.map((task) => {
                                  const statusCfg = TASK_STATUS_CONFIG[task.status];
                                  const priorityCfg = TASK_PRIORITY_CONFIG[task.priority];
                                  return (
                                    <div key={task.id} className="kg-module-task">
                                      <button
                                        className="kg-module-task-status"
                                        onClick={() => updateTaskStatus(e.id, task.id)}
                                        title={`状态：${statusCfg.label}（点击切换）`}
                                        type="button"
                                      >
                                        {statusCfg.icon}
                                      </button>
                                      <div className="kg-module-task-content">
                                        <div className={`kg-module-task-title${task.status === 'done' ? ' done' : ''}`}>
                                          {task.title}
                                        </div>
                                        <div className="kg-module-task-info">
                                          <select
                                            className="kg-module-task-priority"
                                            value={task.priority}
                                            onChange={(ev) => updateTaskPriority(e.id, task.id, ev.target.value as TaskPriority)}
                                            title="优先级"
                                            style={{ color: priorityCfg.color }}
                                          >
                                            {(Object.keys(TASK_PRIORITY_CONFIG) as TaskPriority[]).map((p) => (
                                              <option key={p} value={p}>{TASK_PRIORITY_CONFIG[p].label}</option>
                                            ))}
                                          </select>
                                          <span className="kg-module-task-status-label" style={{ color: statusCfg.color }}>
                                            {statusCfg.label}
                                          </span>
                                        </div>
                                      </div>
                                      <button
                                        className="kg-module-task-delete"
                                        onClick={() => deleteTask(e.id, task.id)}
                                        title="删除任务"
                                        type="button"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 底部统计 */}
      <div className="kg-module-sidebar-footer">
        <span>📊 {totalModules} 模块 · {taskStats.total} 任务</span>
        {onOpenGraph && (
          <button className="kg-module-clear-btn" onClick={onOpenGraph} type="button" title="打开图谱">
            🕸️ 图谱
          </button>
        )}
      </div>
    </div>
  );
}
