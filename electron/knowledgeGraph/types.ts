/**
 * AI 图谱模块 — 类型定义与 IPC 通道常量
 *
 * 将 AI 对项目的解析、知识构建以图谱形式持久化，支持列表/图谱展示、查询、分析。
 */

// ── 节点类型 ──────────────────────────────────────
export type NodeType =
  | 'project'    // 项目根
  | 'directory'  // 目录
  | 'file'       // 源文件
  | 'module'     // 子模块（含 package.json 的子目录）
  | 'dependency' // 外部依赖包
  | 'tech'       // 技术栈条目
  | 'concept';   // 概念/知识（来自 CLAUDE.md 或 AI 解析）

// ── 边类型 ──────────────────────────────────────
// 扫描器生成的边类型（5 种基础类型）+ AI 分析扩展类型
export type EdgeType =
  // 扫描器基础类型
  | 'contains'    // A 包含 B（目录→文件）
  | 'depends_on'  // A 依赖 B（项目→依赖包）
  | 'describes'   // A 描述 B（CLAUDE.md→技术栈）
  | 'imports'     // A 引用 B（文件→文件）
  | 'uses_tech'   // A 使用技术 B（项目→技术栈）
  // AI 分析扩展类型（保留原义，不再压缩）
  | 'calls'        // A 调用 B 的方法
  | 'references'    // A 引用 B 的类型/字段
  | 'composes'      // A 由 B 组合而成
  | 'extends'       // A 继承 B
  | 'implements'    // A 实现 B 接口
  | 'uses'          // A 使用 B
  | 'maps_to'       // A 映射到 B（路由→控制器）
  | 'renders'       // A 渲染 B 视图
  | 'registers'     // A 注册 B
  | 'manages'       // A 管理 B（Repository→Entity）
  | 'defines'       // A 定义 B
  | 'relates_to';   // AI 识别的其他关系

// ── 图谱数据结构 ──────────────────────────────────
export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  path?: string;
  properties: Record<string, any>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  /** 关系说明（AI label 或用户标注）*/
  label?: string;
  /** 依赖方式分类（用户可编辑）：api/database/doc/ui/config/tool/source/other */
  depKind?: string;
  /** 是否用户手动编辑过 */
  userEdited?: boolean;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  builtAt: string;
}

// ── 查询/分析 ──────────────────────────────────────
export interface QueryFilter {
  type?: NodeType;
  keyword?: string;
}

export interface AnalysisResult {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
  topDependencies: Array<{ name: string; version: string }>;
  techStack: string[];
  fileCount: number;
  moduleCount: number;
  largestDirs: Array<{ path: string; fileCount: number }>;
}

// ── IPC 通道 ──────────────────────────────────────
export const KG_CHANNELS = {
  BUILD: 'knowledge-graph:v1:build',
  GET: 'knowledge-graph:v1:get',
  QUERY: 'knowledge-graph:v1:query',
  ANALYZE: 'knowledge-graph:v1:analyze',
  MERGE_AI: 'knowledge-graph:v1:merge-ai',
  UPDATE_EDGE: 'knowledge-graph:v1:update-edge',
  DELETE_EDGE: 'knowledge-graph:v1:delete-edge',
  ADD_EDGE: 'knowledge-graph:v1:add-edge',
} as const;

export type IpcResponse<T> = { ok: true; data: T } | { ok: false; error: string };
