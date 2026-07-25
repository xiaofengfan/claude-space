/**
 * 分层架构视图 — 支持独立架构展示
 *
 * 4 种视图模式（可切换）：
 * 1. 📐 全部架构 — 展示应用/逻辑/数据/基础设施四层
 * 2. 🖥️ 应用架构 — 独立展示，内部按 entry/router/controller/view 子层分组
 * 3. 🧩 逻辑架构 — 独立展示，业务模块优先，再按 service/domain/manager 分组
 * 4. 🗄️ 数据架构 — 独立展示，内部按 entity/repository/dao/schema 子层分组
 *
 * 分类策略：
 * - AI 节点（properties.source === 'ai'）优先按 metadata 字段（archLayer/dataLayer/moduleType/tags）分类
 * - 扫描器节点用严格的源代码路径匹配，仅纳入真正的源文件
 * - 噪声节点（.md / 配置 / 资源文件）不参与架构分层展示
 */

import { useMemo, useState } from 'react';

interface LayerNode {
  id: string;
  type: string;
  label: string;
  path?: string;
  properties?: Record<string, any>;
}

interface LayerEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface Props {
  nodes: LayerNode[];
  edges: LayerEdge[];
  onNodeClick?: (node: LayerNode) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
}

type ViewMode = 'all' | 'application' | 'logic' | 'data';

// ── 顶层架构层定义 ────────────────────────────────
interface ArchLayer {
  key: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  desc: string;
}

const ARCH_LAYERS: ArchLayer[] = [
  { key: 'application', label: '应用架构', icon: '🖥️', color: '#e67e22', bg: 'rgba(230, 126, 34, 0.06)', desc: '入口 · 路由 · 控制器 · 视图' },
  { key: 'logic', label: '逻辑架构', icon: '🧩', color: '#4a5cf7', bg: 'rgba(74, 92, 247, 0.06)', desc: '业务模块 · 服务 · 领域模型' },
  { key: 'data', label: '数据架构', icon: '🗄️', color: '#27ae60', bg: 'rgba(39, 174, 96, 0.06)', desc: '实体 · DAO · Repository · 数据库' },
  { key: 'infra', label: '基础设施', icon: '🔧', color: '#7f8c8d', bg: 'rgba(127, 140, 141, 0.06)', desc: '配置 · 工具 · 依赖 · 文档' },
];

// ── 源代码扩展名（仅这些被视为源代码节点）──────
const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte',
  '.java', '.kt', '.scala',
  '.py',
  '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.php', '.swift',
]);

// ── 辅助函数 ──────────────────────────────────────

/** 是否为 AI 分析产出的节点 */
function isAiNode(n: LayerNode): boolean {
  return n.properties?.source === 'ai' || n.properties?.source === 'CLAUDE.ai';
}

/** 获取节点的 tags（同时兼容 n.tags 和 n.properties.tags）*/
function getTags(n: LayerNode): string[] {
  return (n as any).tags || n.properties?.tags || [];
}

/** 是否为噪声节点（md / 配置 / 资源文件，不参与架构分层）*/
function isNoiseNode(n: LayerNode): boolean {
  // AI 节点不视为噪声（即使原本是 md，AI 已将其转化为概念/模块）
  if (isAiNode(n)) return false;
  const p = (n.path || '').toLowerCase();
  const ext = (n.properties?.ext as string || '').toLowerCase();
  const name = n.label.toLowerCase();

  // .md / 文档文件
  if (/\.(md|markdown|txt|rst|adoc|tex)$/.test(p) || ['.md', '.markdown', '.txt', '.rst'].includes(ext)) return true;
  // 纯配置文件（json/yaml/toml/ini/properties/env/conf）
  if (/\.(json|yaml|yml|toml|ini|conf|env|properties|xml)$/.test(p) ||
      ['.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.env', '.properties', '.xml'].includes(ext)) {
    // 但 package.json/pom.xml 这类依赖描述符仍可能被 ORM 层识别，保留判断
    if (n.type === 'dependency') return false;
    return true;
  }
  // 资源/静态文件
  if (/\.(png|jpg|jpeg|gif|svg|ico|webp|bmp|css|scss|less|woff|woff2|ttf|eot|otf|mp3|mp4|wav|webm)$/.test(p)) return true;
  // 锁文件 / 编辑器配置 / 构建产物
  if (/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.gitignore|\.npmrc|\.editorconfig|\.eslintrc|\.prettierrc|tsconfig|vite\.config|webpack\.config|babel\.config|jest\.config)/i.test(name)) return true;
  // 顶层概念/技术节点（来自 CLAUDE.md）保留，不视为噪声
  if (n.type === 'tech' || n.type === 'concept') return false;
  return false;
}

/** 是否为源代码文件节点 */
function isSourceCodeNode(n: LayerNode): boolean {
  const p = (n.path || '').toLowerCase();
  const ext = (n.properties?.ext as string || '').toLowerCase();
  // 有源代码扩展名
  if (SOURCE_EXTS.has(ext) || SOURCE_EXTS.has(p.slice(p.lastIndexOf('.')))) return true;
  // module / directory 节点也视为可分类
  if (n.type === 'module' || n.type === 'directory') return true;
  // dependency 节点可被数据架构层（ORM）识别
  if (n.type === 'dependency') return true;
  return false;
}

// ── 子层定义（每种架构视图内部的细分层）──────────
interface SubLayer {
  key: string;
  label: string;
  icon: string;
  match: (n: LayerNode) => boolean;
}

// 应用架构子层
const APP_SUBLAYERS: SubLayer[] = [
  {
    key: 'entry', label: '应用入口', icon: '🚀',
    match: (n) => {
      if (n.properties?.archLayer === 'entry') return true;
      const path = (n.path || '').toLowerCase();
      const name = n.label.toLowerCase();
      if (/application\.(java|kt|groovy)$/.test(path)) return true;
      if (/^index\.(js|ts)$/.test(name) && /src\/?$/.test(path.replace(/\/[^/]+$/, ''))) return true;
      if (/main|bootstrap|app\.start|launch/i.test(name) && /\.(java|kt|js|ts|py|go)$/.test(path)) return true;
      return false;
    },
  },
  {
    key: 'router', label: '路由层', icon: '🛣️',
    match: (n) => {
      if (n.properties?.archLayer === 'router') return true;
      const path = (n.path || '').toLowerCase();
      const name = n.label.toLowerCase();
      if (/\/(router|routers|route|routes)\//.test(path)) return true;
      if (/\b(router|route)\b/i.test(name) && /\.(java|kt|ts|js|py|go)$/.test(path)) return true;
      return false;
    },
  },
  {
    key: 'controller', label: '控制器层', icon: '🎮',
    match: (n) => {
      if (n.properties?.archLayer === 'controller') return true;
      const path = (n.path || '').toLowerCase();
      const name = n.label.toLowerCase();
      if (/\/(controller|controllers|api|apis|endpoint|endpoints|handler|servlet|action)\//.test(path)) return true;
      if (/\b(controller|endpoint|handler|servlet|action)\b/i.test(name) && /\.(java|kt|ts|js|py|go|cs|rb|php)$/.test(path)) return true;
      return false;
    },
  },
  {
    key: 'view', label: '视图层', icon: '👁️',
    match: (n) => {
      if (n.properties?.archLayer === 'view') return true;
      const path = (n.path || '').toLowerCase();
      const ext = (n.properties?.ext as string || '').toLowerCase();
      if (/\/(view|views|page|pages|component|components|template|templates|frontend|web|ui)\//.test(path)) return true;
      if (/\.(vue|jsx|svelte|html|ejs|hbs)$/.test(path) || ['.vue', '.jsx', '.svelte', '.html', '.ejs', '.hbs'].includes(ext)) return true;
      if (/\.(tsx)$/.test(path) && !/\/(utils|util|lib|hooks|hook|api|service|store)\//.test(path)) return true;
      return false;
    },
  },
];

// 逻辑架构子层 — 业务模块放第一位（核心展示）
const LOGIC_SUBLAYERS: SubLayer[] = [
  {
    key: 'business-module', label: '业务模块', icon: '📦',
    match: (n) => {
      // AI 标记的业务模块优先
      const moduleType = n.properties?.moduleType;
      const tags = getTags(n);
      if (moduleType === 'core' || moduleType === 'business') return true;
      if (tags.includes('business') || tags.includes('sub-module')) return true;
      // 中文业务模块名
      if (/系统管理|用户管理|权限管理|角色管理|菜单管理|字典管理|组织管理|部门管理|报表管理|流程管理|订单管理|客户管理|产品管理|项目管理|任务管理|审批管理|合同管理|支付管理|通知管理|消息管理|商品管理|库存管理|仓储管理|采购管理|销售管理|财务管理|人事管理|考勤管理|薪酬管理|资产管理/.test(n.label)) return true;
      // 扫描器节点：仅识别明显的业务模块目录
      const name = n.label.toLowerCase();
      if (n.type === 'module' && /^(order|customer|product|user|auth|payment|invoice|approval|report|notification|inventory|warehouse|purchase|sale|finance|hr|attendance|payroll|asset|business|biz)$/.test(name)) return true;
      return false;
    },
  },
  {
    key: 'service', label: '服务层', icon: '⚙️',
    match: (n) => {
      const path = (n.path || '').toLowerCase();
      const name = n.label.toLowerCase();
      if (/\/(service|services|facade|delegate)\//.test(path)) return true;
      if (/\b(service|facade|delegate)\b/i.test(name) && /\.(java|kt|ts|js|py|go|cs|rb|php)$/.test(path)) return true;
      if (n.type === 'module' && /^(service|services|facade)$/.test(name)) return true;
      return false;
    },
  },
  {
    key: 'domain', label: '领域层', icon: '🌐',
    match: (n) => {
      const path = (n.path || '').toLowerCase();
      const name = n.label.toLowerCase();
      if (/\/(domain|biz|business)\//.test(path)) return true;
      if (n.type === 'module' && /^(domain|biz|business)$/.test(name)) return true;
      return false;
    },
  },
  {
    key: 'manager', label: '管理层', icon: '📋',
    match: (n) => {
      const path = (n.path || '').toLowerCase();
      const name = n.label.toLowerCase();
      if (/\/(manager|managers|impl|bo)\//.test(path)) return true;
      if (/\b(manager)\b/i.test(name) && /\.(java|kt|ts|js|py|go|cs|rb|php)$/.test(path)) return true;
      if (n.type === 'module' && /^(manager|impl|bo)$/.test(name)) return true;
      return false;
    },
  },
  {
    key: 'workflow', label: '流程/任务', icon: '🔄',
    match: (n) => {
      const path = (n.path || '').toLowerCase();
      const name = n.label.toLowerCase();
      if (/\/(workflow|process|task|job)\//.test(path)) return true;
      if (n.type === 'module' && /^(workflow|process|task|job)$/.test(name)) return true;
      if (/流程|审批|工单|任务/.test(n.label)) return true;
      return false;
    },
  },
];

// 数据架构子层
const DATA_SUBLAYERS: SubLayer[] = [
  {
    key: 'datasource', label: '数据源', icon: '🔌',
    match: (n) => {
      if (n.properties?.dataLayer === 'datasource') return true;
      const name = n.label.toLowerCase();
      if (/datasource|connection|pool|druid|hikari|dbcp/i.test(name)) return true;
      if (n.type === 'dependency' && /druid|hikari|dbcp|c3p0|tomcat-jdbc/i.test(name)) return true;
      return false;
    },
  },
  {
    key: 'schema', label: 'Schema/SQL', icon: '📜',
    match: (n) => {
      if (n.properties?.dataLayer === 'schema') return true;
      const path = (n.path || '').toLowerCase();
      const ext = (n.properties?.ext as string || '').toLowerCase();
      if (/\.(sql|db)$/.test(path) || ext === '.sql') return true;
      if (/\/(migration|migrations|schema|sql|db)\//.test(path)) return true;
      return false;
    },
  },
  {
    key: 'entity', label: '实体层', icon: '🏗️',
    match: (n) => {
      if (n.properties?.dataLayer === 'entity') return true;
      const tags = getTags(n);
      if (tags.includes('data') || tags.includes('database') || tags.includes('table')) return true;
      const path = (n.path || '').toLowerCase();
      const name = n.label.toLowerCase();
      if (/\/(entity|entities|model|models|pojo|domain\.model)\//.test(path)) return true;
      if (/\b(entity|model|pojo)\b/i.test(name) && /\.(java|kt|ts|js|py|go)$/.test(path)) return true;
      return false;
    },
  },
  {
    key: 'dao', label: '数据访问层', icon: '🔍',
    match: (n) => {
      if (n.properties?.dataLayer === 'dao' || n.properties?.dataLayer === 'repository') return true;
      const path = (n.path || '').toLowerCase();
      const name = n.label.toLowerCase();
      if (/\/(repository|repositories|dao|mapper|daos|mappers)\//.test(path)) return true;
      if (/\b(repository|mapper|dao)\b/i.test(name) && /\.(java|kt|ts|js|py|go)$/.test(path)) return true;
      return false;
    },
  },
  {
    key: 'orm', label: 'ORM/数据库依赖', icon: '📚',
    match: (n) => {
      const name = n.label.toLowerCase();
      if (n.type === 'dependency' && /mysql|postgresql|sqlite|mongodb|redis|mybatis|jpa|hibernate|typeorm|prisma|sequelize|jdbc|elasticsearch|clickhouse|oracle|sqlserver|mariadb|influxdb|cassandra|neo4j/i.test(name)) return true;
      if (n.properties?.ormFramework) return true;
      return false;
    },
  },
];

// ── 主分类函数（AI 优先 + 多级推断）──
function classifyNodeMain(n: LayerNode): string {
  // AI 节点：多级推断分类
  if (isAiNode(n)) {
    return classifyAiNode(n);
  }

  // 噪声节点：归入基础设施层（兜底）
  if (isNoiseNode(n)) return 'infra';

  // 扫描器节点：必须是源代码/module/directory/dependency 才参与分层
  if (!isSourceCodeNode(n)) return 'infra';

  // 数据架构层（严格路径匹配）
  for (const sl of DATA_SUBLAYERS) {
    if (sl.match(n)) return 'data';
  }
  // 应用架构层
  for (const sl of APP_SUBLAYERS) {
    if (sl.match(n)) return 'application';
  }
  // 逻辑架构层
  for (const sl of LOGIC_SUBLAYERS) {
    if (sl.match(n)) return 'logic';
  }
  // 基础设施层（兜底）
  return 'infra';
}

/**
 * AI 节点分类 — 多级推断策略
 *
 * 核心原则：AI 分析的模块以业务功能概念为主
 * - moduleType=core/business → 业务模块（logic）
 * - archLayer=entry/router/controller/view → 应用架构（application）
 * - dataLayer=entity/repository/dao/schema/datasource → 数据架构（data）
 * - 其余有业务含义的 → logic，不要误归入 infra
 *
 * Level 1: metadata 字段（archLayer/dataLayer/moduleType）— 最精确
 * Level 2: tags（business→logic, application→app, data→data）
 * Level 3: 节点 type（module→logic, database→data, api→application）
 * Level 4: 节点名称关键词
 * Level 5: description 关键词推断
 * Level 6: AI 节点兜底 → logic（业务模块），扫描器节点兜底 → infra
 */
function classifyAiNode(n: LayerNode): string {
  const archLayer = n.properties?.archLayer;
  const dataLayer = n.properties?.dataLayer;
  const moduleType = n.properties?.moduleType;
  const tags = getTags(n);
  const name = n.label || '';
  const nameLower = name.toLowerCase();
  const desc = (n.properties?.description || '').toLowerCase();
  const entType = (n.properties?.originalType || n.type || '').toLowerCase();

  // ── Level 1: metadata 字段 ──
  // 业务模块（moduleType=core/business → 归入逻辑架构）
  if (moduleType === 'core' || moduleType === 'business') return 'logic';
  // 数据架构（只有明确的数据层类型才归入）
  if (dataLayer && ['entity', 'repository', 'dao', 'mapper', 'schema', 'datasource'].includes(dataLayer)) return 'data';
  // 数据架构（archLayer=service/domain/manager/workflow 且有 dataLayer → 数据层，否则逻辑层）
  if (dataLayer && archLayer && ['service', 'domain', 'manager', 'workflow'].includes(archLayer)) {
    // service+数据标记 → 还是看具体 dataLayer
    if (['entity', 'repository', 'dao', 'schema'].includes(dataLayer)) return 'data';
    return 'logic';
  }
  // 应用架构（明确标注应用层 entry/router/controller/view）
  if (archLayer && ['entry', 'router', 'controller', 'view'].includes(archLayer)) return 'application';
  // 逻辑架构（service/domain/manager/workflow 但无 dataLayer → 纯逻辑架构）
  if (archLayer && ['service', 'domain', 'manager', 'workflow'].includes(archLayer)) return 'logic';
  // 基础设施
  if (moduleType === 'infra' || moduleType === 'common') return 'infra';

  // ── Level 2: tags ──
  if (tags.includes('data') || tags.includes('database') || tags.includes('table')) return 'data';
  if (tags.includes('application') || tags.includes('api')) return 'application';
  if (tags.includes('business') || tags.includes('sub-module')) return 'logic';

  // ── Level 3: 节点 type ──
  if (entType === 'database' || entType === 'entity' || entType === 'repository' ||
      entType === 'dao' || entType === 'mapper' || entType === 'model') return 'data';
  if (entType === 'api' || entType === 'route' || entType === 'controller' ||
      entType === 'endpoint' || entType === 'handler' || entType === 'view' ||
      entType === 'component') return 'application';
  if (entType === 'module' || entType === 'service' || entType === 'manager' ||
      entType === 'facade' || entType === 'domain') return 'logic';

  // ── Level 4: 节点名称关键词 ──
  // 数据架构关键词
  if (/\b(entity|model|pojo|repository|repo|dao|mapper|table|schema|database|datasource)\b/i.test(nameLower)) return 'data';
  if (/实体|数据模型|数据表|仓储|数据访问|数据源|数据库/.test(name)) return 'data';
  // 应用架构关键词
  if (/\b(controller|endpoint|api|route|router|view|page|component|application|servlet|handler|action)\b/i.test(nameLower)) return 'application';
  if (/控制器|路由|视图|页面|组件|入口|应用/.test(name)) return 'application';
  // 逻辑架构关键词
  if (/\b(service|domain|manager|facade|workflow|process|task|job|business|biz)\b/i.test(nameLower)) return 'logic';
  if (/系统管理|用户管理|权限管理|角色管理|菜单管理|字典管理|组织管理|部门管理|报表管理|流程管理|订单管理|客户管理|产品管理|项目管理|任务管理|审批管理|合同管理|支付管理|通知管理|消息管理|商品管理|库存管理|采购管理|销售管理|财务管理|人事管理|考勤管理|薪酬管理|资产管理|服务|业务|领域|流程|任务/.test(name)) return 'logic';

  // ── Level 5: description 关键词推断 ──
  if (/\b(entity|model|table|database|data|schema|repository|dao|mapper)\b/i.test(desc)) return 'data';
  if (/数据|实体|表结构|字段|数据库|仓储/.test(desc)) return 'data';
  if (/\b(controller|api|route|endpoint|view|page|request|response)\b/i.test(desc)) return 'application';
  if (/控制器|接口|路由|视图|页面|请求|响应/.test(desc)) return 'application';
  if (/\b(service|business|module|domain|logic|workflow|task)\b/i.test(desc)) return 'logic';
  if (/服务|业务|模块|流程|任务/.test(desc)) return 'logic';

  // ── Level 6: 兜底 — AI 节点归入逻辑架构（不归入 infra）──
  // AI 分析产出的节点通常有业务意义，不应被淹没在基础设施层
  return 'logic';
}

// ── 子层分类函数（用于独立架构视图）──
function classifySubLayer(n: LayerNode, subLayers: SubLayer[]): string | null {
  // AI 节点优先用 metadata 字段直接映射子层
  if (isAiNode(n)) {
    const archLayer = n.properties?.archLayer;
    const dataLayer = n.properties?.dataLayer;
    // archLayer 直接匹配子层 key
    if (archLayer) {
      const matched = subLayers.find((sl) => sl.key === archLayer);
      if (matched) return matched.key;
    }
    // dataLayer 直接匹配子层 key（repository→dao 兼容）
    if (dataLayer) {
      const matched = subLayers.find((sl) => sl.key === dataLayer || (dataLayer === 'repository' && sl.key === 'dao'));
      if (matched) return matched.key;
    }
  }
  // 常规匹配
  for (const sl of subLayers) {
    if (sl.match(n)) return sl.key;
  }
  // AI 节点兜底：基于名称关键词匹配子层
  if (isAiNode(n)) {
    const name = n.label.toLowerCase();
    for (const sl of subLayers) {
      // 业务模块子层特殊处理
      if (sl.key === 'business-module') {
        if (/系统管理|用户管理|权限管理|报表管理|流程管理|订单|客户|产品|项目|任务|审批|合同|支付|通知|消息|商品|库存|采购|销售|财务|人事|考勤|薪酬|资产/.test(n.label)) return sl.key;
      }
      // 其他子层基于名称关键词
      const keyTerms: Record<string, string[]> = {
        'entry': ['application', 'main', 'bootstrap', 'launch', '入口', '启动'],
        'router': ['router', 'route', '路由'],
        'controller': ['controller', 'endpoint', 'handler', 'servlet', 'action', '控制器', '接口'],
        'view': ['view', 'page', 'component', 'template', '视图', '页面', '组件'],
        'service': ['service', 'facade', 'delegate', '服务'],
        'domain': ['domain', 'biz', 'business', '领域', '业务'],
        'manager': ['manager', 'impl', 'bo', '管理'],
        'workflow': ['workflow', 'process', 'task', 'job', '流程', '任务'],
        'entity': ['entity', 'model', 'pojo', '实体', '数据模型'],
        'dao': ['repository', 'mapper', 'dao', '仓储', '数据访问'],
        'schema': ['schema', 'sql', 'migration', '表结构'],
        'datasource': ['datasource', 'connection', 'pool', '数据源'],
      };
      const terms = keyTerms[sl.key];
      if (terms && terms.some((t) => name.includes(t.toLowerCase()))) return sl.key;
    }
  }
  return null;
}

// ── 组件 ──────────────────────────────────────────
export function LayeredView({ nodes, edges, onNodeClick, onOpenFile }: Props) {
  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');

  // 过滤掉 project 根节点；噪声节点不参与分层但仍可归入 infra
  const validNodes = useMemo(() => nodes.filter(n => n.type !== 'project'), [nodes]);

  // 统计 AI 节点数（用于提示用户是否做过 AI 分析）
  const aiNodeCount = useMemo(() => validNodes.filter(isAiNode).length, [validNodes]);

  // 主分类（全部架构视图用）
  const { mainLayerMap, nodeMainLayer } = useMemo(() => {
    const map: Record<string, LayerNode[]> = {};
    const n2l: Record<string, string> = {};
    for (const layer of ARCH_LAYERS) map[layer.key] = [];
    for (const n of validNodes) {
      const lk = classifyNodeMain(n);
      n2l[n.id] = lk;
      if (!map[lk]) map[lk] = [];
      map[lk].push(n);
    }
    return { mainLayerMap: map, nodeMainLayer: n2l };
  }, [validNodes]);

  // 应用架构子层分组
  const appSubGroups = useMemo(() => {
    const groups: Record<string, LayerNode[]> = {};
    for (const sl of APP_SUBLAYERS) groups[sl.key] = [];
    const appNodes = validNodes.filter(n => classifyNodeMain(n) === 'application');
    for (const n of appNodes) {
      const slKey = classifySubLayer(n, APP_SUBLAYERS) || 'view';
      if (!groups[slKey]) groups[slKey] = [];
      groups[slKey].push(n);
    }
    return groups;
  }, [validNodes]);

  // 逻辑架构子层分组
  const logicSubGroups = useMemo(() => {
    const groups: Record<string, LayerNode[]> = {};
    for (const sl of LOGIC_SUBLAYERS) groups[sl.key] = [];
    const logicNodes = validNodes.filter(n => classifyNodeMain(n) === 'logic');
    for (const n of logicNodes) {
      const slKey = classifySubLayer(n, LOGIC_SUBLAYERS) || 'business-module';
      if (!groups[slKey]) groups[slKey] = [];
      groups[slKey].push(n);
    }
    return groups;
  }, [validNodes]);

  // 数据架构子层分组
  const dataSubGroups = useMemo(() => {
    const groups: Record<string, LayerNode[]> = {};
    for (const sl of DATA_SUBLAYERS) groups[sl.key] = [];
    const dataNodes = validNodes.filter(n => classifyNodeMain(n) === 'data');
    for (const n of dataNodes) {
      const slKey = classifySubLayer(n, DATA_SUBLAYERS) || 'entity';
      if (!groups[slKey]) groups[slKey] = [];
      groups[slKey].push(n);
    }
    return groups;
  }, [validNodes]);

  // 层间连接
  const crossLayerEdges = useMemo(() => {
    return edges
      .map((e) => {
        const sl = nodeMainLayer[e.source];
        const tl = nodeMainLayer[e.target];
        if (!sl || !tl || sl === tl) return null;
        return { ...e, sourceLayer: sl, targetLayer: tl };
      })
      .filter(Boolean) as Array<LayerEdge & { sourceLayer: string; targetLayer: string }>;
  }, [edges, nodeMainLayer]);

  const intraLayerCount = useMemo(() => {
    const count: Record<string, number> = {};
    for (const e of edges) {
      const sl = nodeMainLayer[e.source];
      const tl = nodeMainLayer[e.target];
      if (sl && tl && sl === tl) count[sl] = (count[sl] || 0) + 1;
    }
    return count;
  }, [edges, nodeMainLayer]);

  const layerFlowStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const e of crossLayerEdges) {
      const key = `${e.sourceLayer}→${e.targetLayer}`;
      stats[key] = (stats[key] || 0) + 1;
    }
    return stats;
  }, [crossLayerEdges]);

  // 视图选项（根据有节点的层动态显示）
  const viewOptions = useMemo(() => {
    const opts: Array<{ key: ViewMode; label: string; icon: string; count: number }> = [
      { key: 'all', label: '全部架构', icon: '📐', count: validNodes.length },
    ];
    if ((mainLayerMap['application'] || []).length > 0) {
      opts.push({ key: 'application', label: '应用架构', icon: '🖥️', count: mainLayerMap['application'].length });
    }
    if ((mainLayerMap['logic'] || []).length > 0) {
      opts.push({ key: 'logic', label: '逻辑架构', icon: '🧩', count: mainLayerMap['logic'].length });
    }
    if ((mainLayerMap['data'] || []).length > 0) {
      opts.push({ key: 'data', label: '数据架构', icon: '🗄️', count: mainLayerMap['data'].length });
    }
    return opts;
  }, [validNodes, mainLayerMap]);

  if (validNodes.length === 0) {
    return (
      <div className="kg-layered-empty">
        <div className="kg-empty-icon">📊</div>
        <div>暂无图谱数据，请先构建或 AI 分析</div>
      </div>
    );
  }

  // ── 渲染节点卡片 ──
  const renderNodeCard = (n: LayerNode, color: string) => {
    const isExpanded = expandedNode === n.id;
    const outDeg = edges.filter((e) => e.source === n.id).length;
    const inDeg = edges.filter((e) => e.target === n.id).length;
    const aiTag = isAiNode(n) ? <span className="kg-ai-badge" title="AI 分析产出">AI</span> : null;
    return (
      <div
        key={n.id}
        className={`kg-layer-node${isExpanded ? ' expanded' : ''}`}
        style={{ borderLeftColor: color }}
        onClick={() => {
          setExpandedNode(isExpanded ? null : n.id);
          onNodeClick?.(n);
        }}
      >
        <div className="kg-layer-node-name">
          {aiTag}
          {n.label}
        </div>
        {n.properties?.packageName && (
          <div className="kg-layer-node-pkg">{n.properties.packageName}</div>
        )}
        {n.properties?.tableName && (
          <div className="kg-layer-node-pkg">📋 {n.properties.tableName}</div>
        )}
        {n.properties?.framework && (
          <div className="kg-layer-node-pkg">⚡ {n.properties.framework}</div>
        )}
        {n.properties?.ormFramework && (
          <div className="kg-layer-node-pkg">🔗 {n.properties.ormFramework}</div>
        )}
        {(outDeg > 0 || inDeg > 0) && (
          <div className="kg-layer-node-deg">
            {outDeg > 0 && <span title="出度">→{outDeg}</span>}
            {inDeg > 0 && <span title="入度">←{inDeg}</span>}
          </div>
        )}
        {isExpanded && (
          <div className="kg-layer-node-detail">
            {n.path && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">路径</span>
                <span className="prop-val">{n.path}</span>
              </div>
            )}
            {n.path && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">操作</span>
                <button className="kg-node-open-btn" onClick={(e) => { e.stopPropagation(); onOpenFile?.(n.path!, n.label); }} type="button" title="在编辑器中打开此文件">
                  📄 查看文件
                </button>
              </div>
            )}
            {n.properties?.moduleType && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">类型</span>
                <span className="prop-val">{n.properties.moduleType}</span>
              </div>
            )}
            {n.properties?.archLayer && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">层级</span>
                <span className="prop-val">{n.properties.archLayer}</span>
              </div>
            )}
            {n.properties?.dataLayer && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">数据层</span>
                <span className="prop-val">{n.properties.dataLayer}</span>
              </div>
            )}
            {n.properties?.features && n.properties.features.length > 0 && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">子功能</span>
                <span className="prop-val">{n.properties.features.join('、')}</span>
              </div>
            )}
            {n.properties?.endpoints && n.properties.endpoints.length > 0 && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">端点</span>
                <span className="prop-val">{n.properties.endpoints.join(', ')}</span>
              </div>
            )}
            {n.properties?.fields && n.properties.fields.length > 0 && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">字段</span>
                <span className="prop-val">{n.properties.fields.length} 个字段</span>
              </div>
            )}
            {n.properties?.indexes && n.properties.indexes.length > 0 && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">索引</span>
                <span className="prop-val">{n.properties.indexes.length} 个索引</span>
              </div>
            )}
            {n.properties?.description && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">说明</span>
                <span className="prop-val">{n.properties.description}</span>
              </div>
            )}
            {n.properties?.version && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">版本</span>
                <span className="prop-val">{n.properties.version}</span>
              </div>
            )}
            {n.properties?.comment && (
              <div className="kg-layer-node-prop">
                <span className="prop-key">注释</span>
                <span className="prop-val">{n.properties.comment}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── 渲染子层分组（独立架构视图用）──
  const renderSubLayerGroup = (subLayers: SubLayer[], groups: Record<string, LayerNode[]>, color: string, bg: string) => {
    return subLayers.map((sl) => {
      const groupNodes = groups[sl.key] || [];
      if (groupNodes.length === 0) return null; // 无节点的子层不显示
      return (
        <div key={sl.key} className="kg-sublayer-group" style={{ borderColor: color, background: bg }}>
          <div className="kg-sublayer-header" style={{ color }}>
            <span className="kg-sublayer-icon">{sl.icon}</span>
            <span className="kg-sublayer-name">{sl.label}</span>
            <span className="kg-sublayer-count">{groupNodes.length}</span>
          </div>
          <div className="kg-layer-nodes">
            {groupNodes.slice(0, 30).map((n) => renderNodeCard(n, color))}
            {groupNodes.length > 30 && (
              <div className="kg-layer-more">+{groupNodes.length - 30} 个...</div>
            )}
          </div>
        </div>
      );
    });
  };

  return (
    <div className="kg-layered-view">
      {/* 视图切换工具栏 */}
      <div className="kg-layered-toolbar">
        {viewOptions.map((opt) => (
          <button
            key={opt.key}
            className={`kg-layered-mode-btn${viewMode === opt.key ? ' active' : ''}`}
            onClick={() => setViewMode(opt.key)}
            type="button"
          >
            {opt.icon} {opt.label} <span className="kg-mode-count">({opt.count})</span>
          </button>
        ))}
        <span className="kg-layered-summary">
          {validNodes.length} 节点 · {edges.length} 关系
          {aiNodeCount > 0 ? ` · AI ${aiNodeCount}` : ' · 暂无AI分析'}
        </span>
      </div>

      {/* AI 分析提示（当没有 AI 节点时）*/}
      {aiNodeCount === 0 && (
        <div className="kg-layered-hint">
          💡 当前仅展示扫描器结果，业务功能架构需要 AI 分析。建议使用「业务模块分析」「应用架构分析」等模板进行 AI 分析后查看。
        </div>
      )}

      {/* ── 全部架构视图 ── */}
      {viewMode === 'all' && (
        <div className="kg-layered-stack">
          {ARCH_LAYERS.map((layer, idx) => {
            const layerNodes = mainLayerMap[layer.key] || [];
            const incoming = crossLayerEdges.filter((e) => e.targetLayer === layer.key).length;
            const outgoing = crossLayerEdges.filter((e) => e.sourceLayer === layer.key).length;
            return (
              <div key={layer.key} className="kg-layer-row" style={{ borderColor: layer.color, background: layer.bg }}>
                {idx > 0 && incoming > 0 && (
                  <div className="kg-layer-flow-arrow kg-flow-in">
                    <span className="kg-flow-badge kg-flow-in-badge">↓ {incoming}</span>
                  </div>
                )}
                <div className="kg-layer-header" style={{ color: layer.color }}>
                  <span className="kg-layer-icon">{layer.icon}</span>
                  <span className="kg-layer-name">{layer.label}</span>
                  <span className="kg-layer-desc">{layer.desc}</span>
                  <span className="kg-layer-count">{layerNodes.length} 节点</span>
                  {intraLayerCount[layer.key] > 0 && (
                    <span className="kg-layer-intra">🔗 {intraLayerCount[layer.key]}</span>
                  )}
                </div>
                <div className="kg-layer-nodes">
                  {layerNodes.length === 0 ? (
                    <span className="kg-layer-empty-tag">（暂无）</span>
                  ) : (
                    layerNodes.slice(0, 30).map((n) => renderNodeCard(n, layer.color))
                  )}
                  {layerNodes.length > 30 && (
                    <div className="kg-layer-more">+{layerNodes.length - 30} 个...</div>
                  )}
                </div>
                {idx < ARCH_LAYERS.length - 1 && outgoing > 0 && (
                  <div className="kg-layer-flow-arrow kg-flow-out">
                    <span className="kg-flow-badge kg-flow-out-badge">↓ {outgoing}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 应用架构独立视图 ── */}
      {viewMode === 'application' && (
        <div className="kg-layered-stack">
          <div className="kg-arch-title" style={{ color: '#e67e22' }}>
            🖥️ 应用架构 — 入口 · 路由 · 控制器 · 视图
          </div>
          {renderSubLayerGroup(APP_SUBLAYERS, appSubGroups, '#e67e22', 'rgba(230, 126, 34, 0.06)')}
        </div>
      )}

      {/* ── 逻辑架构独立视图 ── */}
      {viewMode === 'logic' && (
        <div className="kg-layered-stack">
          <div className="kg-arch-title" style={{ color: '#4a5cf7' }}>
            🧩 逻辑架构 — 业务模块 · 服务 · 领域模型
          </div>
          {renderSubLayerGroup(LOGIC_SUBLAYERS, logicSubGroups, '#4a5cf7', 'rgba(74, 92, 247, 0.06)')}
        </div>
      )}

      {/* ── 数据架构独立视图 ── */}
      {viewMode === 'data' && (
        <div className="kg-layered-stack">
          <div className="kg-arch-title" style={{ color: '#27ae60' }}>
            🗄️ 数据架构 — 实体 · DAO · Repository · 数据库
          </div>
          {renderSubLayerGroup(DATA_SUBLAYERS, dataSubGroups, '#27ae60', 'rgba(39, 174, 96, 0.06)')}
        </div>
      )}

      {/* 层间流向汇总（仅全部视图显示）*/}
      {viewMode === 'all' && Object.keys(layerFlowStats).length > 0 && (
        <div className="kg-layer-flow-summary">
          <div className="kg-layer-flow-title">🔁 层间流向</div>
          <div className="kg-layer-flow-list">
            {Object.entries(layerFlowStats)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 12)
              .map(([key, count]) => {
                const [src, tgt] = key.split('→');
                const srcLayer = ARCH_LAYERS.find((l) => l.key === src);
                const tgtLayer = ARCH_LAYERS.find((l) => l.key === tgt);
                return (
                  <div key={key} className="kg-layer-flow-item">
                    <span className="kg-flow-label" style={{ color: srcLayer?.color }}>
                      {srcLayer?.icon} {srcLayer?.label}
                    </span>
                    <span className="kg-flow-arrow-text">→</span>
                    <span className="kg-flow-label" style={{ color: tgtLayer?.color }}>
                      {tgtLayer?.icon} {tgtLayer?.label}
                    </span>
                    <span className="kg-flow-count">{count}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
