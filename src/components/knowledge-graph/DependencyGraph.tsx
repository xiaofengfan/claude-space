/**
 * 功能依赖展示图 — 直观展示模块间的依赖关系和依赖方式
 *
 * 三大维度：
 * 1. 依赖类型（边类型）：depends_on/calls/references/composes/imports/implements/extends/uses/maps_to/renders/registers/manages/defines/contains
 * 2. 节点类型：module/file/dependency/tech/concept/directory
 * 3. 依赖方式（业务分类）：API/数据库/文档/UI/配置/工具/源码（可编辑）
 *
 * 布局：
 * - 顶部工具栏：搜索 + 节点类型筛选 + 系统文件过滤开关
 * - 依赖类型筛选条：点击切换显示
 * - 依赖方式筛选条：API/数据库/文档等
 * - 主体：左模块列表 + 右依赖详情（含编辑按钮）
 * - 底部：完整依赖关系列表
 *
 * 依赖方式推断规则（基于目标节点特征）：
 * - API 依赖：目标 type=api/route，或 path 含 /api/ /controller/，或 label 含 Controller/Endpoint
 * - 数据库依赖：目标 type=database，或 path 含 /entity/ /dao/ /repository/，或 properties.dataLayer
 * - 文档依赖：目标 path 是 .md/.txt/.rst
 * - UI 依赖：目标 path 含 /view/ /component/ /page/，或扩展名 .vue/.jsx
 * - 配置依赖：目标 path 是 .json/.yaml/.toml/.xml/.properties
 * - 工具依赖：目标 path 含 /utils/ /lib/ /helper/，或 type=utility
 * - 源码依赖：默认（其他源代码节点）
 *
 * 编辑：点击依赖项的编辑按钮，弹出面板选择依赖方式 + 输入说明，保存到磁盘
 */

import { useMemo, useState, useEffect, useCallback } from 'react';

interface DepNode {
  id: string;
  type: string;
  label: string;
  path?: string;
  properties?: Record<string, any>;
}

interface DepEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
  depKind?: string;
  userEdited?: boolean;
}

interface Props {
  nodes: DepNode[];
  edges: DepEdge[];
  onNodeClick?: (node: DepNode) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  projectPath?: string;
}

// ── 依赖类型元数据 ────────────────────────────────
interface DepTypeMeta {
  key: string;
  label: string;
  icon: string;
  color: string;
  arrow: string;
  desc: string;
}

const DEP_TYPES: DepTypeMeta[] = [
  { key: 'depends_on', label: '依赖', icon: '🔗', color: '#3498db', arrow: '→', desc: 'A 依赖 B 的功能' },
  { key: 'calls', label: '调用', icon: '📞', color: '#27ae60', arrow: '⇢', desc: 'A 调用 B 的方法' },
  { key: 'references', label: '引用', icon: '📎', color: '#e67e22', arrow: '⇢', desc: 'A 引用 B 的类型/字段' },
  { key: 'composes', label: '组合', icon: '🧩', color: '#9b59b6', arrow: '▶', desc: 'A 由 B 组合而成' },
  { key: 'contains', label: '包含', icon: '📦', color: '#7f8c8d', arrow: '·', desc: 'A 包含 B' },
  { key: 'imports', label: '导入', icon: '📥', color: '#16a085', arrow: '⇢', desc: 'A 导入 B' },
  { key: 'implements', label: '实现', icon: '✅', color: '#34495e', arrow: '>', desc: 'A 实现 B 接口' },
  { key: 'extends', label: '继承', icon: '🔼', color: '#e74c3c', arrow: '→', desc: 'A 继承 B' },
  { key: 'uses', label: '使用', icon: '⚙️', color: '#95a5a6', arrow: '⇢', desc: 'A 使用 B' },
  { key: 'maps_to', label: '映射', icon: '🗺️', color: '#1abc9c', arrow: '→', desc: 'A 映射到 B' },
  { key: 'renders', label: '渲染', icon: '👁️', color: '#f39c12', arrow: '→', desc: 'A 渲染 B 视图' },
  { key: 'registers', label: '注册', icon: '📋', color: '#8e44ad', arrow: '→', desc: 'A 注册 B' },
  { key: 'manages', label: '管理', icon: '🗂️', color: '#2c3e50', arrow: '→', desc: 'A 管理 B' },
  { key: 'defines', label: '定义', icon: '📝', color: '#d35400', arrow: '→', desc: 'A 定义 B' },
  { key: 'relates_to', label: '关联', icon: '•', color: '#bdc3c7', arrow: '→', desc: 'A 关联 B' },
];

const DEFAULT_TYPE_META: DepTypeMeta = {
  key: 'other', label: '其他', icon: '•', color: '#bdc3c7', arrow: '→', desc: '其他关系',
};

function getDepTypeMeta(type: string): DepTypeMeta {
  return DEP_TYPES.find((t) => t.key === type) || { ...DEFAULT_TYPE_META, key: type };
}

// ── 依赖方式分类（业务维度）──────────────────────
interface DepKindMeta {
  key: string;
  label: string;
  icon: string;
  color: string;
  desc: string;
  /** 推断函数：根据目标节点特征判断是否属于此依赖方式 */
  infer: (target: DepNode | undefined) => boolean;
}

const DEP_KINDS: DepKindMeta[] = [
  {
    key: 'api', label: 'API', icon: '🌐', color: '#3498db', desc: 'API 接口依赖',
    infer: (n) => {
      if (!n) return false;
      const p = (n.path || '').toLowerCase();
      const label = n.label.toLowerCase();
      if (n.type === 'api' || n.type === 'route') return true;
      if (n.properties?.archLayer === 'controller' || n.properties?.archLayer === 'router') return true;
      if (/\/(api|apis|controller|controllers|endpoint|endpoints|handler|servlet)\//.test(p)) return true;
      if (/\b(controller|endpoint|api)\b/i.test(label) && /\.(java|kt|ts|js|py|go)$/.test(p)) return true;
      if (n.properties?.endpoints && n.properties.endpoints.length > 0) return true;
      return false;
    },
  },
  {
    key: 'database', label: '数据库', icon: '🗄️', color: '#27ae60', desc: '数据库/数据访问依赖',
    infer: (n) => {
      if (!n) return false;
      const p = (n.path || '').toLowerCase();
      const label = n.label.toLowerCase();
      if (n.type === 'database') return true;
      if (n.properties?.dataLayer) return true;
      if (/\/(entity|entities|model|models|pojo|repository|repositories|dao|mapper|mappers|migration|schema|sql)\//.test(p)) return true;
      const tags = n.properties?.tags || [];
      if (tags.includes('data') || tags.includes('database') || tags.includes('table')) return true;
      if (/\b(entity|model|repository|mapper|dao)\b/i.test(label)) return true;
      return false;
    },
  },
  {
    key: 'doc', label: '文档', icon: '📄', color: '#f39c12', desc: '文档依赖',
    infer: (n) => {
      if (!n) return false;
      const p = (n.path || '').toLowerCase();
      const ext = (n.properties?.ext as string || '').toLowerCase();
      if (/\.(md|markdown|txt|rst|adoc|tex|pdf|doc|docx)$/.test(p)) return true;
      if (['.md', '.markdown', '.txt', '.rst', '.adoc'].includes(ext)) return true;
      if (n.type === 'concept' && n.properties?.source === 'CLAUDE.md') return true;
      return false;
    },
  },
  {
    key: 'ui', label: 'UI', icon: '👁️', color: '#9b59b6', desc: '视图/UI 组件依赖',
    infer: (n) => {
      if (!n) return false;
      const p = (n.path || '').toLowerCase();
      const ext = (n.properties?.ext as string || '').toLowerCase();
      if (n.properties?.archLayer === 'view') return true;
      if (/\/(view|views|page|pages|component|components|template|templates|frontend|web|ui)\//.test(p)) return true;
      if (['.vue', '.jsx', '.svelte', '.html', '.ejs', '.hbs'].includes(ext)) return true;
      if (/\.(vue|jsx|svelte|html)$/.test(p)) return true;
      return false;
    },
  },
  {
    key: 'config', label: '配置', icon: '⚙️', color: '#95a5a6', desc: '配置文件依赖',
    infer: (n) => {
      if (!n) return false;
      const p = (n.path || '').toLowerCase();
      const ext = (n.properties?.ext as string || '').toLowerCase();
      if (/\.(json|yaml|yml|toml|ini|conf|env|properties|xml)$/.test(p)) return true;
      if (['.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.env', '.properties', '.xml'].includes(ext)) return true;
      if (/\/(config|configs|configuration|settings)\//.test(p)) return true;
      return false;
    },
  },
  {
    key: 'tool', label: '工具', icon: '🔧', color: '#16a085', desc: '工具/辅助库依赖',
    infer: (n) => {
      if (!n) return false;
      const p = (n.path || '').toLowerCase();
      const label = n.label.toLowerCase();
      if (/\/(utils|util|lib|libs|helper|helpers|common|shared)\//.test(p)) return true;
      if (n.type === 'dependency' && /lodash|underscore|moment|dayjs|axios|fetch|ramda|rxjs|immutable|fast-json-parse|validator|joi|zod/i.test(label)) return true;
      return false;
    },
  },
  {
    key: 'source', label: '源码', icon: '📦', color: '#34495e', desc: '源代码依赖（默认）',
    infer: () => true, // 默认归入源码
  },
];

const DEFAULT_KIND_KEY = 'source';

/** 推断依赖方式：优先使用用户编辑值，否则按规则推断 */
function inferDepKind(edge: DepEdge, target: DepNode | undefined): string {
  if (edge.depKind) return edge.depKind;
  for (const k of DEP_KINDS) {
    if (k.key === DEFAULT_KIND_KEY) continue;
    if (k.infer(target)) return k.key;
  }
  return DEFAULT_KIND_KEY;
}

function getDepKindMeta(key: string): DepKindMeta {
  return DEP_KINDS.find((k) => k.key === key) || DEP_KINDS[DEP_KINDS.length - 1];
}

// ── 节点类型元数据 ────────────────────────────────
interface NodeTypeMeta {
  key: string;
  label: string;
  icon: string;
  color: string;
}

const NODE_TYPES: NodeTypeMeta[] = [
  { key: 'module', label: '模块', icon: '🧩', color: '#6c8cff' },
  { key: 'file', label: '文件', icon: '📄', color: '#95a5a6' },
  { key: 'dependency', label: '依赖包', icon: '📚', color: '#e67e22' },
  { key: 'tech', label: '技术栈', icon: '🔧', color: '#27ae60' },
  { key: 'concept', label: '概念', icon: '💡', color: '#9b59b6' },
  { key: 'directory', label: '目录', icon: '📁', color: '#7f8c8d' },
];

// ── 系统文件/目录过滤规则 ────────────────────────
const SYSTEM_FILE_PATTERNS = [
  /\/node_modules\//i,
  /\/\.git\//i,
  /\/dist\//i,
  /\/build\//i,
  /\/target\//i,
  /\/\.next\//i,
  /\/\.cache\//i,
  /\/coverage\//i,
  /\/__pycache__\//i,
  /\/\.gradle\//i,
  /\/\.mvn\//i,
  /\/bin\//i,
  /\/obj\//i,
];

const SYSTEM_FILE_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.gitignore', '.npmrc', '.editorconfig', '.eslintrc', '.eslintrc.js', '.eslintrc.json',
  '.prettierrc', '.prettierrc.js', 'tsconfig.json',
]);

function isSystemFile(n: DepNode): boolean {
  const p = (n.path || '').toLowerCase();
  if (SYSTEM_FILE_PATTERNS.some((re) => re.test(p))) return true;
  if (SYSTEM_FILE_NAMES.has(n.label.toLowerCase())) return true;
  // 锁文件、构建配置
  if (/^(vite\.config|webpack\.config|babel\.config|jest\.config|rollup\.config)\./i.test(n.label)) return true;
  return false;
}

// ── 辅助函数 ──
function isAiNode(n?: DepNode | null): boolean {
  if (!n) return false;
  return n.properties?.source === 'ai' || n.properties?.source === 'CLAUDE.ai';
}

// ── 组件 ──────────────────────────────────────────
export function DependencyGraph({ nodes, edges, onNodeClick, onOpenFile, projectPath }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [searchKw, setSearchKw] = useState('');
  const [depTab, setDepTab] = useState<'modules' | 'relations'>('modules');
  // 节点类型筛选（多选）：默认只显示模块（业务功能模块），隐藏文件/目录等细节
  const [enabledNodeTypes, setEnabledNodeTypes] = useState<Set<string>>(new Set(['module', 'tech', 'concept', 'dependency']));
  const [hideContains, setHideContains] = useState(true);
  const [hideSystemFiles, setHideSystemFiles] = useState(true);
  const [showAllRelations, setShowAllRelations] = useState(false);
  // 编辑面板
  const [editingEdge, setEditingEdge] = useState<DepEdge | null>(null);
  const [editKind, setEditKind] = useState<string>('');
  const [editLabel, setEditLabel] = useState('');
  const [editType, setEditType] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // 1. 节点过滤：按节点类型 + 系统文件 + 搜索
  const validNodes = useMemo(() => {
    return nodes.filter((n) => {
      if (n.type === 'project') return false;
      if (!enabledNodeTypes.has(n.type)) return false;
      if (hideSystemFiles && isSystemFile(n)) return false;
      return true;
    });
  }, [nodes, enabledNodeTypes, hideSystemFiles]);

  // 2. 边过滤：按类型 + 依赖方式
  const nodeMap = useMemo(() => {
    const m = new Map<string, DepNode>();
    for (const n of validNodes) m.set(n.id, n);
    return m;
  }, [validNodes]);

  const validEdges = useMemo(() => {
    let list = edges.filter((e) => {
      // 两端节点必须可见
      if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) return false;
      if (hideContains && e.type === 'contains') return false;
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (kindFilter !== 'all') {
        const target = nodeMap.get(e.target);
        const kind = inferDepKind(e, target);
        if (kind !== kindFilter) return false;
      }
      return true;
    });
    return list;
  }, [edges, nodeMap, hideContains, typeFilter, kindFilter]);

  // 3. 节点出度/入度
  const nodeDegMap = useMemo(() => {
    const map = new Map<string, { outDeg: number; inDeg: number; total: number }>();
    for (const n of validNodes) map.set(n.id, { outDeg: 0, inDeg: 0, total: 0 });
    for (const e of validEdges) {
      const s = map.get(e.source);
      const t = map.get(e.target);
      if (s) { s.outDeg++; s.total++; }
      if (t) { t.inDeg++; t.total++; }
    }
    return map;
  }, [validNodes, validEdges]);

  // 4. 模块列表
  const moduleList = useMemo(() => {
    let list = validNodes.map((n) => ({ node: n, deg: nodeDegMap.get(n.id) || { outDeg: 0, inDeg: 0, total: 0 } }));
    if (searchKw.trim()) {
      const kw = searchKw.toLowerCase();
      list = list.filter(({ node }) =>
        node.label.toLowerCase().includes(kw) ||
        (node.path || '').toLowerCase().includes(kw)
      );
    }
    list.sort((a, b) => b.deg.total - a.deg.total);
    return list;
  }, [validNodes, nodeDegMap, searchKw]);

  // 5. 统计
  const typeStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const e of validEdges) stats[e.type] = (stats[e.type] || 0) + 1;
    return stats;
  }, [validEdges]);

  const kindStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const e of validEdges) {
      const target = nodeMap.get(e.target);
      const kind = inferDepKind(e, target);
      stats[kind] = (stats[kind] || 0) + 1;
    }
    return stats;
  }, [validEdges, nodeMap]);

  const nodeTypeStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const n of nodes) {
      if (n.type === 'project') continue;
      stats[n.type] = (stats[n.type] || 0) + 1;
    }
    return stats;
  }, [nodes]);

  // 6. 选中节点的依赖
  const selectedDeps = useMemo(() => {
    if (!selectedNodeId) return null;
    const outgoing = validEdges.filter((e) => e.source === selectedNodeId);
    const incoming = validEdges.filter((e) => e.target === selectedNodeId);
    const groupBy = (list: DepEdge[], direction: 'out' | 'in') => {
      const byKind: Record<string, Array<{ edge: DepEdge; node: DepNode | undefined; kind: string }>> = {};
      for (const e of list) {
        const otherId = direction === 'out' ? e.target : e.source;
        const node = nodeMap.get(otherId);
        const kind = inferDepKind(e, direction === 'out' ? node : nodeMap.get(e.source));
        if (!byKind[kind]) byKind[kind] = [];
        byKind[kind].push({ edge: e, node, kind });
      }
      return byKind;
    };
    return {
      outgoing,
      incoming,
      outByKind: groupBy(outgoing, 'out'),
      inByKind: groupBy(incoming, 'in'),
    };
  }, [selectedNodeId, validEdges, nodeMap]);

  // 7. 完整关系列表
  const relationList = useMemo(() => {
    let list = validEdges.map((e) => ({
      edge: e,
      source: nodeMap.get(e.source),
      target: nodeMap.get(e.target),
      kind: inferDepKind(e, nodeMap.get(e.target)),
    }));
    if (searchKw.trim()) {
      const kw = searchKw.toLowerCase();
      list = list.filter(({ source, target, edge }) =>
        (source?.label || '').toLowerCase().includes(kw) ||
        (target?.label || '').toLowerCase().includes(kw) ||
        edge.type.toLowerCase().includes(kw) ||
        (edge.label || '').toLowerCase().includes(kw)
      );
    }
    if (!showAllRelations) list = list.slice(0, 50);
    return list;
  }, [validEdges, nodeMap, searchKw, showAllRelations]);

  // ── 编辑保存 ──
  const openEditPanel = useCallback((edge: DepEdge) => {
    const target = nodeMap.get(edge.target);
    const currentKind = edge.depKind || inferDepKind(edge, target);
    setEditingEdge(edge);
    setEditKind(currentKind);
    setEditLabel(edge.label || '');
    setEditType(edge.type);
    setEditError(null);
  }, [nodeMap]);

  const closeEditPanel = useCallback(() => {
    setEditingEdge(null);
    setEditError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingEdge || !projectPath) {
      setEditError('缺少 projectPath 或 edge');
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const patch: { type?: string; label?: string; depKind?: string } = {};
      if (editType !== editingEdge.type) patch.type = editType;
      if (editLabel !== (editingEdge.label || '')) patch.label = editLabel;
      if (editKind !== (editingEdge.depKind || '')) patch.depKind = editKind;
      const res = await window.electronAPI.graphUpdateEdge(projectPath, editingEdge.id, patch);
      if (!res?.ok) {
        throw new Error(res?.error || '保存失败');
      }
      // 本地同步更新边对象（因为父组件传入的 edges 是同一个引用）
      editingEdge.type = editType as any;
      editingEdge.label = editLabel;
      editingEdge.depKind = editKind;
      editingEdge.userEdited = true;
      setEditingEdge(null);
    } catch (e: any) {
      setEditError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [editingEdge, editType, editLabel, editKind, projectPath]);

  const deleteEdge = useCallback(async () => {
    if (!editingEdge || !projectPath) return;
    if (!confirm('确认删除此依赖关系？')) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await window.electronAPI.graphDeleteEdge(projectPath, editingEdge.id);
      if (!res?.ok) throw new Error(res?.error || '删除失败');
      setEditingEdge(null);
    } catch (e: any) {
      setEditError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }, [editingEdge, projectPath]);

  // 空状态
  if (nodes.length === 0) {
    return (
      <div className="kg-layered-empty">
        <div className="kg-empty-icon">🔗</div>
        <div>暂无图谱数据，请先构建或 AI 分析</div>
      </div>
    );
  }

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;

  // 切换节点类型
  const toggleNodeType = (key: string) => {
    setEnabledNodeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      // 至少保留一个
      if (next.size === 0) next.add(key);
      return next;
    });
  };

  // ── 渲染依赖方式分组 ──
  const renderKindGroup = (
    title: string,
    byKind: Record<string, Array<{ edge: DepEdge; node: DepNode | undefined; kind: string }>>,
    direction: 'out' | 'in',
  ) => {
    const keys = Object.keys(byKind);
    if (keys.length === 0) return null;
    // 按 DEP_KINDS 顺序排序
    const sortedKeys = keys.sort((a, b) => {
      const ai = DEP_KINDS.findIndex((k) => k.key === a);
      const bi = DEP_KINDS.findIndex((k) => k.key === b);
      return ai - bi;
    });
    return (
      <div className="kg-dep-group">
        <div className="kg-dep-group-title">{title}</div>
        {sortedKeys.map((k) => {
          const meta = getDepKindMeta(k);
          const items = byKind[k] || [];
          return (
            <div key={k} className="kg-dep-kind-block" style={{ borderColor: meta.color }}>
              <div className="kg-dep-kind-header" style={{ color: meta.color }}>
                <span className="kg-dep-kind-icon">{meta.icon}</span>
                <span className="kg-dep-kind-label">{meta.label}</span>
                <span className="kg-dep-kind-count">{items.length}</span>
                <span className="kg-dep-kind-desc" title={meta.desc}>{meta.desc}</span>
              </div>
              <div className="kg-dep-kind-items">
                {items.map(({ edge, node }) => {
                  const typeMeta = getDepTypeMeta(edge.type);
                  return (
                    <div key={edge.id} className="kg-dep-item">
                      <span className="kg-dep-item-arrow" style={{ color: typeMeta.color }} title={typeMeta.desc}>
                        {direction === 'out' ? '→' : '←'} {typeMeta.icon}
                      </span>
                      <span className="kg-dep-item-name" onClick={() => node && setSelectedNodeId(node.id)}>
                        {node?.label || (direction === 'out' ? edge.target : edge.source)}
                      </span>
                      {node?.type === 'module' && <span className="kg-dep-item-tag">模块</span>}
                      {isAiNode(node) && <span className="kg-ai-badge">AI</span>}
                      {edge.userEdited && <span className="kg-dep-edited-tag" title="用户已编辑">✏️</span>}
                      {edge.label && <span className="kg-dep-item-label" title={edge.label}>{edge.label}</span>}
                      <button
                        className="kg-dep-item-edit"
                        onClick={() => openEditPanel(edge)}
                        title="编辑依赖方式"
                        type="button"
                      >✏️</button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="kg-dep-view">
      {/* 顶部工具栏 */}
      <div className="kg-dep-toolbar">
        <input
          className="kg-dep-search"
          placeholder="搜索模块名/路径..."
          value={searchKw}
          onChange={(e) => setSearchKw(e.target.value)}
        />
        <label className="kg-dep-toggle">
          <input type="checkbox" checked={hideContains} onChange={(e) => setHideContains(e.target.checked)} />
          <span>隐藏包含关系</span>
        </label>
        <label className="kg-dep-toggle">
          <input type="checkbox" checked={hideSystemFiles} onChange={(e) => setHideSystemFiles(e.target.checked)} />
          <span>隐藏系统文件</span>
        </label>
        <span className="kg-dep-summary">
          {validNodes.length}/{nodes.length} 节点 · {validEdges.length}/{edges.length} 关系
        </span>
      </div>

      {/* 节点类型筛选（多选 chips）*/}
      <div className="kg-dep-nodetype-bar">
        <span className="kg-dep-bar-label">节点类型:</span>
        {NODE_TYPES.map((t) => {
          const enabled = enabledNodeTypes.has(t.key);
          const count = nodeTypeStats[t.key] || 0;
          if (count === 0) return null;
          return (
            <button
              key={t.key}
              className={`kg-dep-nodetype-chip${enabled ? ' active' : ''}`}
              style={enabled ? { background: t.color + '22', borderColor: t.color, color: t.color } : {}}
              onClick={() => toggleNodeType(t.key)}
              type="button"
            >
              {t.icon} {t.label} ({count})
            </button>
          );
        })}
      </div>

      {/* 依赖类型筛选 */}
      <div className="kg-dep-type-legend">
        <span className="kg-dep-bar-label">依赖类型:</span>
        <button
          className={`kg-dep-type-btn${typeFilter === 'all' ? ' active' : ''}`}
          onClick={() => setTypeFilter('all')}
          type="button"
        >
          全部 ({validEdges.length})
        </button>
        {DEP_TYPES.map((t) => {
          const count = typeStats[t.key] || 0;
          if (count === 0) return null;
          return (
            <button
              key={t.key}
              className={`kg-dep-type-btn${typeFilter === t.key ? ' active' : ''}`}
              style={typeFilter === t.key ? { background: t.color + '22', borderColor: t.color, color: t.color } : {}}
              onClick={() => setTypeFilter(t.key)}
              type="button"
              title={t.desc}
            >
              {t.icon} {t.label} ({count})
            </button>
          );
        })}
      </div>

      {/* 依赖方式筛选（业务维度：API/数据库/文档/UI/配置/工具/源码）*/}
      <div className="kg-dep-kind-legend">
        <span className="kg-dep-bar-label">依赖方式:</span>
        <button
          className={`kg-dep-kind-btn${kindFilter === 'all' ? ' active' : ''}`}
          onClick={() => setKindFilter('all')}
          type="button"
        >
          全部 ({validEdges.length})
        </button>
        {DEP_KINDS.map((k) => {
          const count = kindStats[k.key] || 0;
          if (count === 0) return null;
          return (
            <button
              key={k.key}
              className={`kg-dep-kind-btn${kindFilter === k.key ? ' active' : ''}`}
              style={kindFilter === k.key ? { background: k.color + '22', borderColor: k.color, color: k.color } : {}}
              onClick={() => setKindFilter(k.key)}
              type="button"
              title={k.desc}
            >
              {k.icon} {k.label} ({count})
            </button>
          );
        })}
      </div>

      {/* 主体：左列表 + 右详情 */}
      <div className="kg-dep-main">
        {/* 左栏：Tab 切换（模块列表 / 依赖关系列表） */}
        <div className="kg-dep-left-col">
          {/* Tab 切换栏 */}
          <div className="kg-dep-tab-bar">
            <button
              className={`kg-dep-tab-btn${depTab === 'modules' ? ' active' : ''}`}
              onClick={() => setDepTab('modules')}
              type="button"
            >📦 模块列表（{moduleList.length}）</button>
            <button
              className={`kg-dep-tab-btn${depTab === 'relations' ? ' active' : ''}`}
              onClick={() => setDepTab('relations')}
              type="button"
            >📋 依赖关系列表（{validEdges.length}）</button>
          </div>

          {/* ── 模块列表 ──────────────────────────────── */}
          {depTab === 'modules' && (
          <div className="kg-dep-list-panel">
            {moduleList.slice(0, 200).map(({ node, deg }) => {
              const isSelected = node.id === selectedNodeId;
              const aiTag = isAiNode(node) ? <span className="kg-ai-badge">AI</span> : null;
              const typeMeta = NODE_TYPES.find((t) => t.key === node.type);
              return (
                <div
                  key={node.id}
                  className={`kg-dep-module-item${isSelected ? ' selected' : ''}`}
                  onClick={() => setSelectedNodeId(isSelected ? null : node.id)}
                >
                  <div className="kg-dep-module-name">
                    {typeMeta && <span className="kg-dep-module-typeicon" style={{ color: typeMeta.color }}>{typeMeta.icon}</span>}
                    {aiTag}
                    {node.label}
                  </div>
                  <div className="kg-dep-module-deg">
                    {deg.outDeg > 0 && <span className="deg-out" title="出度（依赖谁）">→{deg.outDeg}</span>}
                    {deg.inDeg > 0 && <span className="deg-in" title="入度（被谁依赖）">←{deg.inDeg}</span>}
                    {deg.total === 0 && <span className="deg-none">无依赖</span>}
                  </div>
                </div>
              );
            })}
            {moduleList.length > 200 && (
              <div className="kg-dep-module-more">+{moduleList.length - 200} 个（请搜索）</div>
            )}
            {moduleList.length === 0 && (
              <div className="kg-dep-module-more">无匹配模块</div>
            )}
          </div>
          )}

          {/* ── 依赖关系列表 ──────────────────────────── */}
          {depTab === 'relations' && (
          <div className="kg-dep-list-panel">
            {validEdges.length > 50 && (
              <div className="kg-dep-relation-header">
                <button className="kg-dep-relation-toggle" onClick={() => setShowAllRelations(!showAllRelations)} type="button">
                  {showAllRelations ? '收起' : `展开全部 (${validEdges.length})`}
                </button>
              </div>
            )}
            {relationList.length === 0 ? (
              <div className="kg-dep-relation-empty">无匹配关系</div>
            ) : (
              relationList.map(({ edge, source, target, kind }) => {
                const typeMeta = getDepTypeMeta(edge.type);
                const kindMeta = getDepKindMeta(kind);
                return (
                  <div key={edge.id} className="kg-dep-relation-item">
                    <span className="kg-dep-rel-source" onClick={() => source && setSelectedNodeId(source.id)} title={source?.path}>
                      {source?.label || edge.source}
                    </span>
                    <span className="kg-dep-rel-arrow" style={{ color: typeMeta.color }} title={typeMeta.desc}>
                      {typeMeta.icon} {typeMeta.arrow}
                      <span className="kg-dep-rel-type">{typeMeta.label}</span>
                    </span>
                    <span className="kg-dep-rel-target" onClick={() => target && setSelectedNodeId(target.id)} title={target?.path}>
                      {target?.label || edge.target}
                    </span>
                    <span className="kg-dep-rel-kind" style={{ color: kindMeta.color }} title={kindMeta.desc}>
                      {kindMeta.icon} {kindMeta.label}
                    </span>
                    {edge.userEdited && <span className="kg-dep-edited-tag" title="用户已编辑">✏️</span>}
                    {edge.label && <span className="kg-dep-rel-label">{edge.label}</span>}
                    <button
                      className="kg-dep-rel-edit"
                      onClick={() => openEditPanel(edge)}
                      title="编辑依赖方式"
                      type="button"
                    >✏️</button>
                  </div>
                );
              })
            )}
          </div>
          )}
        </div>

        {/* 右栏：选中模块的依赖详情（始终显示） */}
        <div className="kg-dep-detail">
          {!selectedNode ? (
            <div className="kg-dep-detail-empty">
              <div className="kg-empty-icon">👈</div>
              <div>点击左侧模块查看其依赖关系</div>
              <div className="kg-empty-hint">
                依赖方式分类：🌐 API · 🗄️ 数据库 · 📄 文档 · 👁️ UI · ⚙️ 配置 · 🔧 工具 · 📦 源码
                <br />
                点击依赖项右侧 ✏️ 可编辑依赖方式
              </div>
            </div>
          ) : (
            <>
              <div className="kg-dep-detail-header">
                <span className="kg-dep-detail-name">{selectedNode.label}</span>
                {isAiNode(selectedNode) && <span className="kg-ai-badge">AI</span>}
                <span className="kg-dep-detail-type">{selectedNode.type}</span>
                <button className="kg-dep-detail-close" onClick={() => setSelectedNodeId(null)} type="button">✕</button>
              </div>
              {selectedNode.path && (
                <div className="kg-dep-detail-path">
                  <span>{selectedNode.path}</span>
                  <button className="kg-node-open-btn" onClick={() => onOpenFile?.(selectedNode.path!, selectedNode.label)} type="button" title="在编辑器中打开此文件" style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px' }}>
                    📄 查看
                  </button>
                </div>
              )}
              {selectedNode.properties?.description && (
                <div className="kg-dep-detail-desc">{selectedNode.properties.description}</div>
              )}

              {selectedDeps && (
                <div className="kg-dep-detail-body">
                  {selectedDeps.outgoing.length === 0 && selectedDeps.incoming.length === 0 && (
                    <div className="kg-dep-detail-empty">
                      <div className="kg-empty-icon">🚫</div>
                      <div>该模块暂无依赖关系</div>
                    </div>
                  )}
                  {renderKindGroup('依赖的模块（出向）', selectedDeps.outByKind, 'out')}
                  {renderKindGroup('被依赖的模块（入向）', selectedDeps.inByKind, 'in')}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 编辑面板（弹窗）*/}
      {editingEdge && (
        <div className="kg-dep-edit-overlay" onClick={closeEditPanel}>
          <div className="kg-dep-edit-panel" onClick={(e) => e.stopPropagation()}>
            <div className="kg-dep-edit-header">
              <span className="kg-dep-edit-title">✏️ 编辑依赖关系</span>
              <button className="kg-dep-edit-close" onClick={closeEditPanel} type="button">✕</button>
            </div>
            <div className="kg-dep-edit-body">
              <div className="kg-dep-edit-info">
                <span className="kg-dep-edit-source">{nodeMap.get(editingEdge.source)?.label || editingEdge.source}</span>
                <span className="kg-dep-edit-arrow">→</span>
                <span className="kg-dep-edit-target">{nodeMap.get(editingEdge.target)?.label || editingEdge.target}</span>
              </div>

              <div className="kg-dep-edit-field">
                <label className="kg-dep-edit-label">依赖类型</label>
                <select className="kg-dep-edit-select" value={editType} onChange={(e) => setEditType(e.target.value)}>
                  {DEP_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.icon} {t.label}（{t.desc}）
                    </option>
                  ))}
                </select>
              </div>

              <div className="kg-dep-edit-field">
                <label className="kg-dep-edit-label">依赖方式（业务分类）</label>
                <div className="kg-dep-edit-kindgrid">
                  {DEP_KINDS.map((k) => (
                    <button
                      key={k.key}
                      className={`kg-dep-edit-kindbtn${editKind === k.key ? ' active' : ''}`}
                      style={editKind === k.key ? { background: k.color + '22', borderColor: k.color, color: k.color } : {}}
                      onClick={() => setEditKind(k.key)}
                      type="button"
                      title={k.desc}
                    >
                      {k.icon} {k.label}
                    </button>
                  ))}
                </div>
                <div className="kg-dep-edit-kinddesc">
                  {getDepKindMeta(editKind).desc}
                </div>
              </div>

              <div className="kg-dep-edit-field">
                <label className="kg-dep-edit-label">关系说明（可选）</label>
                <input
                  className="kg-dep-edit-input"
                  placeholder="例如：通过 REST API 调用用户服务"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                />
              </div>

              {editError && (
                <div className="kg-dep-edit-error">⚠️ {editError}</div>
              )}
            </div>
            <div className="kg-dep-edit-footer">
              <button
                className="kg-dep-edit-btn kg-dep-edit-btn-danger"
                onClick={deleteEdge}
                disabled={saving}
                type="button"
              >🗑 删除</button>
              <div className="kg-dep-edit-footer-right">
                <button className="kg-dep-edit-btn" onClick={closeEditPanel} disabled={saving} type="button">取消</button>
                <button className="kg-dep-edit-btn kg-dep-edit-btn-primary" onClick={saveEdit} disabled={saving} type="button">
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
