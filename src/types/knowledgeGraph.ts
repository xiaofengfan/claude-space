/** 知识图谱 — 实体类型 */
export type EntityType =
  | 'module'
  | 'file'
  | 'class'
  | 'function'
  | 'interface'
  | 'type'
  | 'route'
  | 'api'
  | 'concept'
  | 'pattern'
  | 'dependency'
  | 'database'
  | 'config'
  | 'test'
  | 'script'
  | 'unknown'

/** 知识图谱 — 关系类型 */
export type RelationType =
  | 'imports'
  | 'exports'
  | 'extends'
  | 'implements'
  | 'contains'
  | 'depends_on'
  | 'calls'
  | 'defines'
  | 'composes'
  | 'relates_to'
  | 'inherits'
  | 'implements_interface'
  | 'uses'
  | 'references'
  | 'configures'

/** 图谱中的实体节点 */
export interface GraphEntity {
  id: string
  name: string
  type: EntityType
  description: string
  filePath?: string
  lineNumber?: number
  tags: string[]
  metadata?: Record<string, any>
  // 布局缓存
  fx?: number | null
  fy?: number | null
  createdAt: string
  updatedAt: string
}

/** 图谱中的关系边 */
export interface GraphRelation {
  id: string
  sourceId: string
  targetId: string
  type: RelationType
  label?: string
  weight?: number
  metadata?: Record<string, any>
}

/** 完整知识图谱数据 */
export interface KnowledgeGraph {
  projectPath: string
  entities: GraphEntity[]
  relations: GraphRelation[]
  updatedAt: string
}

/** 分析配置 — 控制扫描范围和内容过滤 */
export interface GraphAnalysisConfig {
  /** 包含的顶层目录（空 = 全部） */
  includeDirs: string[]
  /** 排除的目录名/glob 模式 */
  excludeDirs: string[]
  /** 排除的文件名/glob 模式 */
  excludeFiles: string[]
  /** 排除包含这些关键词的文件 */
  excludeContentKeywords: string[]
  /** 排除的文件扩展名 */
  excludeExtensions: string[]
  /** 最大扫描深度 */
  maxDepth: number
  /** 是否包含测试目录 */
  includeTests: boolean
  /** 是否包含 node_modules */
  includeNodeModules: boolean
  /** 是否包含隐藏目录（. 开头） */
  includeHidden: boolean
  /** 是否扫描文件内容（检查 import 等做关系推断） */
  analyzeContent: boolean
  /** 自定义图谱分析模板（按项目持久化，与内置 GRAPH_PROMPTS 合并使用） */
  customPrompts?: Array<{
    id: string
    label: string
    icon: string
    description: string
    systemPrompt: string
    builtin?: boolean
  }>
}

/** 默认分析配置 */
export const DEFAULT_GRAPH_CONFIG: GraphAnalysisConfig = {
  includeDirs: [],
  excludeDirs: [
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
    '__pycache__', '.cache', '.vscode', '.idea', 'coverage',
    'tmp', 'temp', '.turbo', '.swc', 'target', 'vendor',
  ],
  excludeFiles: [
    '*.log', '*.lock', '*.map', '*.d.ts', '*.min.js', '*.min.css',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  ],
  excludeContentKeywords: [
    'console.log', 'console.debug', 'console.error',
    'debugger', 'TODO', 'FIXME',
  ],
  excludeExtensions: [
    '.log', '.lock', '.map', '.d.ts', '.min.js', '.min.css',
    '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2',
  ],
  maxDepth: 5,
  includeTests: false,
  includeNodeModules: false,
  includeHidden: false,
  analyzeContent: false,
  customPrompts: [],
}

/** 图谱查询参数 */
export interface GraphQuery {
  search?: string
  entityTypes?: EntityType[]
  relationTypes?: RelationType[]
  tags?: string[]
}

/** 图谱统计信息 */
export interface GraphStats {
  totalEntities: number
  totalRelations: number
  entityTypeCount: Record<string, number>
  relationTypeCount: Record<string, number>
  orphanCount: number           // 孤立节点数
  connectedComponents: number   // 连通分量数
}

/** 实体类型配置（用于 UI 展示） */
export const ENTITY_TYPE_CONFIG: Record<EntityType, { label: string; icon: string; color: string }> = {
  module:       { label: '模块',       icon: '📦', color: '#4a5cf7' },
  file:         { label: '文件',       icon: '📄', color: '#6c8cff' },
  class:        { label: '类',         icon: '🏷️', color: '#e67e22' },
  function:     { label: '函数',       icon: '⚡',  color: '#f1c40f' },
  interface:    { label: '接口',       icon: '🔌', color: '#2ecc71' },
  type:         { label: '类型',       icon: '📋', color: '#1abc9c' },
  route:        { label: '路由',       icon: '🌐', color: '#3498db' },
  api:          { label: 'API',        icon: '🔗', color: '#9b59b6' },
  concept:      { label: '概念',       icon: '💡', color: '#e74c3c' },
  pattern:      { label: '模式',       icon: '🧩', color: '#95a5a6' },
  dependency:   { label: '依赖',       icon: '📎', color: '#34495e' },
  database:     { label: '数据库',     icon: '🗄️', color: '#27ae60' },
  config:       { label: '配置',       icon: '⚙️', color: '#7f8c8d' },
  test:         { label: '测试',       icon: '🧪', color: '#2c3e50' },
  script:       { label: '脚本',       icon: '📜', color: '#f39c12' },
  unknown:      { label: '未知',       icon: '❓', color: '#95a5a6' },
}

/** 关系类型配置 */
export const RELATION_TYPE_CONFIG: Record<RelationType, { label: string; color: string; dash?: string }> = {
  imports:            { label: '导入',     color: '#6c8cff' },
  exports:            { label: '导出',     color: '#2ecc71' },
  extends:            { label: '继承',     color: '#e67e22' },
  implements:         { label: '实现',     color: '#9b59b6' },
  contains:           { label: '包含',     color: '#3498db' },
  depends_on:         { label: '依赖',     color: '#e74c3c', dash: '5,3' },
  calls:              { label: '调用',     color: '#f1c40f' },
  defines:            { label: '定义',     color: '#1abc9c' },
  composes:           { label: '组合',     color: '#95a5a6' },
  relates_to:         { label: '关联',     color: '#7f8c8d', dash: '3,3' },
  inherits:           { label: '继承',     color: '#e67e22' },
  implements_interface: { label: '实现接口', color: '#9b59b6' },
  uses:               { label: '使用',     color: '#f1c40f' },
  references:         { label: '引用',     color: '#6c8cff', dash: '4,2' },
  configures:         { label: '配置',     color: '#7f8c8d', dash: '3,3' },
}
