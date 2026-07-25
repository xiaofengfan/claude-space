/**
 * IPC 注册模块 — 注册 knowledge-graph:v1: 前缀的 IPC handler
 *
 * 提供 4 个接口：
 * - build(repoPath): 构建/刷新图谱
 * - get(repoPath): 获取图谱数据
 * - query(repoPath, filter): 按类型/关键词查询
 * - analyze(repoPath): 统计分析
 */

import { ipcMain } from 'electron';
import { buildGraph } from './graphBuilder';
import { KG_CHANNELS } from './types';
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  QueryFilter,
  AnalysisResult,
  IpcResponse,
  NodeType,
  EdgeType,
} from './types';

// ── 内存缓存（按 repoPath）──────────────────────────
const graphCache = new Map<string, KnowledgeGraph>();

// ── 辅助函数 ──────────────────────────────────────
function ok<T>(data: T): IpcResponse<T> {
  return { ok: true, data };
}

function fail(error: string): IpcResponse<never> {
  return { ok: false, error };
}

function wrap<T>(fn: () => Promise<T> | T): Promise<IpcResponse<T>> {
  return Promise.resolve(fn())
    .then((data) => ok(data))
    .catch((e) => fail(e?.message || String(e)));
}

// ── 查询逻辑 ──────────────────────────────────────
function queryGraph(graph: KnowledgeGraph, filter: QueryFilter): { nodes: GraphNode[]; edges: GraphEdge[] } {
  let nodes = graph.nodes;

  if (filter.type) {
    nodes = nodes.filter((n) => n.type === filter.type);
  }

  if (filter.keyword) {
    const kw = filter.keyword.toLowerCase();
    nodes = nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(kw) ||
        (n.path || '').toLowerCase().includes(kw) ||
        JSON.stringify(n.properties).toLowerCase().includes(kw),
    );
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => nodeIds.has(e.source) || nodeIds.has(e.target),
  );

  return { nodes, edges };
}

// ── 分析逻辑 ──────────────────────────────────────
function analyzeGraph(graph: KnowledgeGraph): AnalysisResult {
  const nodesByType: Record<string, number> = {};
  const edgesByType: Record<string, number> = {};
  const techStack: string[] = [];
  const largestDirs: Array<{ path: string; fileCount: number }> = [];

  for (const node of graph.nodes) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;

    if (node.type === 'tech') {
      techStack.push(node.label);
    }
  }

  for (const edge of graph.edges) {
    edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
  }

  // 统计每个目录包含的文件数
  const dirFileCount: Record<string, number> = {};
  for (const edge of graph.edges) {
    if (edge.type === 'contains' && edge.target.startsWith('file:')) {
      dirFileCount[edge.source] = (dirFileCount[edge.source] || 0) + 1;
    }
  }

  // 排序取前10
  const dirEntries = Object.entries(dirFileCount)
    .map(([id, count]) => {
      const node = graph.nodes.find((n) => n.id === id);
      return { path: node?.label || id, fileCount: count };
    })
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 10);

  // 依赖列表
  const deps = graph.nodes
    .filter((n) => n.type === 'dependency')
    .map((n) => ({ name: n.label, version: n.properties?.version || '' }));

  return {
    totalNodes: graph.nodes.length,
    totalEdges: graph.edges.length,
    nodesByType,
    edgesByType,
    topDependencies: deps.slice(0, 20),
    techStack,
    fileCount: nodesByType['file'] || 0,
    moduleCount: nodesByType['module'] || 0,
    largestDirs: dirEntries,
  };
}

// ── 注册入口 ──────────────────────────────────────
export function registerKnowledgeGraphIpc(): void {
  // 构建/刷新图谱
  ipcMain.handle(KG_CHANNELS.BUILD, async (_event, repoPath: string) => {
    return wrap(async () => {
      let graph = await buildGraph(repoPath);
      // 构建后合并磁盘 AI 数据（保留之前的 AI 分析结果）
      graph = await loadDiskAiData(repoPath, graph);
      graphCache.set(repoPath, graph);
      console.log(`[knowledge-graph:ipc] 图谱构建完成: ${graph.nodes.length} 节点, ${graph.edges.length} 边 (${repoPath})`);
      return { builtAt: graph.builtAt, nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
    });
  });

  // 获取图谱数据
  ipcMain.handle(KG_CHANNELS.GET, async (_event, repoPath: string) => {
    return wrap(async () => {
      const graph = graphCache.get(repoPath);
      if (!graph) {
        // 未构建过则自动构建 + 合并磁盘 AI 数据
        let newGraph = await buildGraph(repoPath);
        newGraph = await loadDiskAiData(repoPath, newGraph);
        graphCache.set(repoPath, newGraph);
        return newGraph;
      }
      return graph;
    });
  });

  // 查询
  ipcMain.handle(KG_CHANNELS.QUERY, async (_event, repoPath: string, filter: QueryFilter) => {
    return wrap(async () => {
      let graph = graphCache.get(repoPath);
      if (!graph) {
        let newGraph = await buildGraph(repoPath);
        newGraph = await loadDiskAiData(repoPath, newGraph);
        graphCache.set(repoPath, newGraph);
        graph = newGraph;
      }
      return queryGraph(graph, filter);
    });
  });

  // 分析
  ipcMain.handle(KG_CHANNELS.ANALYZE, async (_event, repoPath: string) => {
    return wrap(async () => {
      let graph = graphCache.get(repoPath);
      if (!graph) {
        let newGraph = await buildGraph(repoPath);
        newGraph = await loadDiskAiData(repoPath, newGraph);
        graphCache.set(repoPath, newGraph);
        graph = newGraph;
      }
      return analyzeGraph(graph);
    });
  });

  // 合并 AI 分析结果到图谱缓存 + 磁盘文件
  // 修复点：
  // 1. AI 实体使用确定性 ID `ai:${name}`，避免重复分析产生重复节点
  // 2. AI 关系映射用 rel.source/rel.target（不是 sourceId/targetId），匹配 graphPrompts.ts 的输出格式
  // 3. 保存 rel.label 和自动推断 depKind
  // 4. 统一磁盘格式：entities={id,name,type,filePath,tags,metadata,source} relations={id,sourceId,targetId,type,label,depKind}
  // 5. mergeAi 自己写磁盘，前端不再重复磁盘合
  ipcMain.handle(
    KG_CHANNELS.MERGE_AI,
    async (_event, repoPath: string, aiData: { entities: any[]; relations: any[] }) => {
      return wrap(async () => {
        // 获取或构建基础图谱
        let graph = graphCache.get(repoPath);
        if (!graph) {
          graph = await buildGraph(repoPath);
          graphCache.set(repoPath, graph);
        }

        const existingNodeIds = new Set(graph.nodes.map((n) => n.id));
        const existingEdgeIds = new Set(graph.edges.map((e) => e.id));
        const addedNodes: GraphNode[] = [];
        const addedEdges: GraphEdge[] = [];

        // ── 实体 → 节点（确定性 ID：ai:${name}）──
        const entityIdToNodeId = new Map<string, string>();
        // 同时构建磁盘格式的 entities
        const diskEntitiesToAdd: any[] = [];

        for (const ent of aiData.entities || []) {
          // 修复：用 ent.name 生成确定性 ID，避免随机 ID 导致重复节点
          const entName = ent.name || '未命名';
          const nodeId = ent.id || `ai:${entName}`;
          entityIdToNodeId.set(ent.id, nodeId);
          entityIdToNodeId.set(entName, nodeId);

          if (existingNodeIds.has(nodeId)) {
            // 节点已存在，但仍可能需要更新 metadata
            continue;
          }

          const nodeType = aiEntityTypeToNodeType(ent.type);
          addedNodes.push({
            id: nodeId,
            type: nodeType,
            label: entName,
            path: ent.filePath || ent.path,
            properties: {
              description: ent.description || '',
              tags: ent.tags || [],
              source: 'ai',
              analyzedAt: new Date().toISOString(),
              originalType: ent.type || '',  // 保存 AI 原始类型，供分类推断
              ...(ent.metadata || {}),
            },
          });
          existingNodeIds.add(nodeId);

          // 磁盘格式（与 Sidebar 读取格式一致）
          diskEntitiesToAdd.push({
            id: nodeId,
            name: entName,
            type: ent.type || 'module',
            description: ent.description || '',
            tags: ent.tags || [],
            filePath: ent.filePath || ent.path || '',
            metadata: { ...(ent.metadata || {}), analyzedAt: new Date().toISOString() },
            source: 'ai',
          });
        }

        // ── 关系 → 边（修复：用 rel.source/rel.target 匹配 AI 输出格式）──
        const diskRelationsToAdd: any[] = [];

        for (const rel of aiData.relations || []) {
          // 修复：AI 输出的是 rel.source/rel.target（实体名），不是 sourceId/targetId
          const sourceKey = rel.sourceId || rel.source;
          const targetKey = rel.targetId || rel.target;
          const sourceId = entityIdToNodeId.get(sourceKey) || sourceKey;
          const targetId = entityIdToNodeId.get(targetKey) || targetKey;
          const edgeType = aiRelationTypeToEdgeType(rel.type);
          const edgeId = `${sourceId}-${edgeType}-${targetId}`;

          if (existingEdgeIds.has(edgeId)) continue;
          // 仅当两端节点都存在时才添加边
          if (!existingNodeIds.has(sourceId) || !existingNodeIds.has(targetId)) continue;

          // 推断 depKind（依赖方式分类：api/database/doc/ui/config/tool/source）
          const targetNode = addedNodes.find((n) => n.id === targetId) ||
            graph.nodes.find((n) => n.id === targetId);
          const depKind = inferDepKindFromNode(targetNode);

          addedEdges.push({
            id: edgeId,
            source: sourceId,
            target: targetId,
            type: edgeType,
            label: rel.label || '',
            depKind,
          });
          existingEdgeIds.add(edgeId);

          // 磁盘格式（与 Sidebar 读取格式一致：sourceId/targetId）
          diskRelationsToAdd.push({
            id: edgeId,
            sourceId,
            targetId,
            type: edgeType,
            label: rel.label || '',
            depKind,
            source: 'ai',
          });
        }

        // 合并到图谱内存缓存
        const mergedGraph: KnowledgeGraph = {
          nodes: [...graph.nodes, ...addedNodes],
          edges: [...graph.edges, ...addedEdges],
          builtAt: new Date().toISOString(),
        };
        graphCache.set(repoPath, mergedGraph);

        // ── 统一写磁盘（与 Sidebar/update_edge 读取的格式一致）──
        try {
          const fs = await import('fs');
          const path = await import('path');
          const graphDir = path.join(repoPath, '.trae-kg');
          const graphFile = path.join(graphDir, 'graph-data.json');
          if (!fs.existsSync(graphDir)) fs.mkdirSync(graphDir, { recursive: true });

          // 读取现有磁盘数据（与 Sidebar 一致的格式）
          let diskData: any = { projectPath: repoPath, entities: [], relations: [], updatedAt: new Date().toISOString() };
          if (fs.existsSync(graphFile)) {
            try {
              diskData = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
              if (!diskData.entities) diskData.entities = [];
              if (!diskData.relations) diskData.relations = [];
            } catch {
              // 磁盘文件损坏，覆盖
            }
          }

          // 去重合并 entities（按 id）
          const entIds = new Set(diskData.entities.map((e: any) => e.id));
          for (const ent of diskEntitiesToAdd) {
            if (!entIds.has(ent.id)) {
              diskData.entities.push(ent);
              entIds.add(ent.id);
            }
          }
          // 去重合并 relations（按 id）
          const relIds = new Set(diskData.relations.map((r: any) => r.id));
          for (const rel of diskRelationsToAdd) {
            if (!relIds.has(rel.id)) {
              diskData.relations.push(rel);
              relIds.add(rel.id);
            }
          }

          diskData.updatedAt = new Date().toISOString();
          fs.writeFileSync(graphFile, JSON.stringify(diskData, null, 2), 'utf-8');
          console.log(`[knowledge-graph:ipc] 磁盘写入: +${diskEntitiesToAdd.length} entities, +${diskRelationsToAdd.length} relations`);
        } catch (e) {
          console.warn('[knowledge-graph:ipc] mergeAi 写磁盘失败:', e);
        }

        console.log(
          `[knowledge-graph:ipc] AI 合并完成: +${addedNodes.length} 节点, +${addedEdges.length} 边 (总计 ${mergedGraph.nodes.length} 节点, ${mergedGraph.edges.length} 边)`,
        );

        return {
          addedNodes: addedNodes.length,
          addedEdges: addedEdges.length,
          totalNodes: mergedGraph.nodes.length,
          totalEdges: mergedGraph.edges.length,
        };
      });
    },
  );

  // ── 编辑依赖关系（更新 type/label/depKind）──
  // 同时更新内存缓存和磁盘文件 graph-data.json
  ipcMain.handle(
    KG_CHANNELS.UPDATE_EDGE,
    async (_event, repoPath: string, edgeId: string, patch: Partial<GraphEdge>) => {
      return wrap(async () => {
        let graph = graphCache.get(repoPath);
        if (!graph) {
          // 缓存 miss：构建 + 合并磁盘 AI 数据
          let newGraph = await buildGraph(repoPath);
          newGraph = await loadDiskAiData(repoPath, newGraph);
          graphCache.set(repoPath, newGraph);
          graph = newGraph;
        }
        const edge = graph.edges.find((e) => e.id === edgeId);
        if (!edge) {
          throw new Error(`Edge not found: ${edgeId}`);
        }
        // 应用补丁
        if (patch.type) (edge as any).type = patch.type;
        if (patch.label !== undefined) edge.label = patch.label;
        if (patch.depKind !== undefined) edge.depKind = patch.depKind;
        edge.userEdited = true;

        // 同步写回磁盘文件（如果存在）
        try {
          const fs = await import('fs');
          const path = await import('path');
          const graphDir = path.join(repoPath, '.trae-kg');
          const graphFile = path.join(graphDir, 'graph-data.json');
          if (!fs.existsSync(graphDir)) fs.mkdirSync(graphDir, { recursive: true });
          // 读取磁盘数据，合并后写回
          let diskData: any = { projectPath: repoPath, entities: [], relations: [], updatedAt: new Date().toISOString() };
          if (fs.existsSync(graphFile)) {
            diskData = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
          }
          if (!diskData.relations) diskData.relations = [];
          // 更新磁盘上对应的 relation
          const rels = diskData.relations;
          const relIdx = rels.findIndex((r: any) => r.id === edgeId);
          if (relIdx >= 0) {
            rels[relIdx].type = edge.type;
            rels[relIdx].label = edge.label;
            rels[relIdx].depKind = edge.depKind;
            rels[relIdx].userEdited = true;
          } else {
            // 磁盘上没有则追加
            rels.push({
              id: edge.id,
              sourceId: edge.source,
              targetId: edge.target,
              type: edge.type,
              label: edge.label,
              depKind: edge.depKind,
              userEdited: true,
            });
          }
          diskData.updatedAt = new Date().toISOString();
          fs.writeFileSync(graphFile, JSON.stringify(diskData, null, 2), 'utf-8');
        } catch (e) {
          console.warn('[knowledge-graph:ipc] 写回磁盘失败:', e);
        }

        console.log(`[knowledge-graph:ipc] Edge 已更新: ${edgeId}`);
        return { success: true };
      });
    },
  );

  // ── 删除依赖关系 ──
  ipcMain.handle(
    KG_CHANNELS.DELETE_EDGE,
    async (_event, repoPath: string, edgeId: string) => {
      return wrap(async () => {
        let graph = graphCache.get(repoPath);
        if (!graph) {
          let newGraph = await buildGraph(repoPath);
          newGraph = await loadDiskAiData(repoPath, newGraph);
          graphCache.set(repoPath, newGraph);
          graph = newGraph;
        }
        const idx = graph.edges.findIndex((e) => e.id === edgeId);
        if (idx < 0) {
          throw new Error(`Edge not found: ${edgeId}`);
        }
        graph.edges.splice(idx, 1);
        // 同步删除磁盘
        try {
          const fs = await import('fs');
          const path = await import('path');
          const graphFile = path.join(repoPath, '.trae-kg', 'graph-data.json');
          if (fs.existsSync(graphFile)) {
            const diskData = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
            if (diskData.relations) {
              diskData.relations = diskData.relations.filter((r: any) => r.id !== edgeId);
              diskData.updatedAt = new Date().toISOString();
              fs.writeFileSync(graphFile, JSON.stringify(diskData, null, 2), 'utf-8');
            }
          }
        } catch (e) {
          console.warn('[knowledge-graph:ipc] 删除磁盘边失败:', e);
        }
        console.log(`[knowledge-graph:ipc] Edge 已删除: ${edgeId}`);
        return { success: true };
      });
    },
  );

  // ── 新增依赖关系 ──
  ipcMain.handle(
    KG_CHANNELS.ADD_EDGE,
    async (_event, repoPath: string, edge: { source: string; target: string; type: string; label?: string; depKind?: string }) => {
      return wrap(async () => {
        let graph = graphCache.get(repoPath);
        if (!graph) {
          let newGraph = await buildGraph(repoPath);
          newGraph = await loadDiskAiData(repoPath, newGraph);
          graphCache.set(repoPath, newGraph);
          graph = newGraph;
        }
        const edgeId = `${edge.source}-${edge.type}-${edge.target}`;
        if (graph.edges.find((e) => e.id === edgeId)) {
          throw new Error('Edge already exists');
        }
        const newEdge: GraphEdge = {
          id: edgeId,
          source: edge.source,
          target: edge.target,
          type: edge.type as EdgeType,
          label: edge.label,
          depKind: edge.depKind,
          userEdited: true,
        };
        graph.edges.push(newEdge);
        // 同步写磁盘
        try {
          const fs = await import('fs');
          const path = await import('path');
          const graphDir = path.join(repoPath, '.trae-kg');
          const graphFile = path.join(graphDir, 'graph-data.json');
          if (!fs.existsSync(graphDir)) fs.mkdirSync(graphDir, { recursive: true });
          let diskData: any = { projectPath: repoPath, entities: [], relations: [], updatedAt: new Date().toISOString() };
          if (fs.existsSync(graphFile)) {
            diskData = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
          }
          if (!diskData.relations) diskData.relations = [];
          diskData.relations.push({
            id: edgeId,
            sourceId: edge.source,
            targetId: edge.target,
            type: edge.type,
            label: edge.label,
            depKind: edge.depKind,
            userEdited: true,
          });
          diskData.updatedAt = new Date().toISOString();
          fs.writeFileSync(graphFile, JSON.stringify(diskData, null, 2), 'utf-8');
        } catch (e) {
          console.warn('[knowledge-graph:ipc] 写磁盘边失败:', e);
        }
        console.log(`[knowledge-graph:ipc] Edge 已新增: ${edgeId}`);
        return { success: true, edgeId };
      });
    },
  );

  console.log('[knowledge-graph:ipc] 已注册 8 个 IPC handler');
}

// ── AI 实体/关系类型 → 图谱节点/边类型映射 ──────────────
function aiEntityTypeToNodeType(entityType: string): NodeType {
  // 修正：保留更多原义，避免全部归入 concept
  const map: Record<string, NodeType> = {
    module: 'module',
    file: 'file',
    dependency: 'dependency',
    concept: 'concept',
    pattern: 'concept',
    class: 'concept',
    function: 'concept',
    interface: 'concept',
    type: 'concept',
    route: 'module',        // 路由作为模块节点
    api: 'module',          // API 作为模块节点
    database: 'module',     // 数据库作为模块节点
    config: 'file',         // 配置作为文件节点
    test: 'file',           // 测试作为文件节点
    script: 'file',         // 脚本作为文件节点
    // 新增：保留 service/controller/entity/repository 等原义类型为 module
    service: 'module',
    controller: 'module',
    entity: 'module',
    repository: 'module',
    model: 'module',
    dao: 'module',
    mapper: 'module',
    view: 'module',
    component: 'module',
    endpoint: 'module',
    handler: 'module',
    manager: 'module',
    facade: 'module',
    unknown: 'concept',
  };
  return map[entityType?.toLowerCase()] || 'concept';
}

function aiRelationTypeToEdgeType(relType: string): EdgeType {
  // 保留 AI 关系原义，不再压缩到 imports
  // 修正前：calls/references/extends/implements/composes 都被压缩成 imports，丢失语义
  const map: Record<string, EdgeType> = {
    imports: 'imports',
    contains: 'contains',
    depends_on: 'depends_on',
    composes: 'composes',
    uses: 'uses',
    calls: 'calls',
    references: 'references',
    extends: 'extends',
    implements: 'implements',
    defines: 'defines',
    maps_to: 'maps_to',
    renders: 'renders',
    registers: 'registers',
    manages: 'manages',
    // 同义词归一
    inherits: 'extends',
    implements_interface: 'implements',
    exports: 'defines',
    configures: 'uses',
    relates_to: 'relates_to',
  };
  // 未知关系类型不再回退到 imports，改为 relates_to 保留原义
  return map[relType] || 'relates_to';
}

/**
 * 推断依赖方式分类（depKind）：api/database/doc/ui/config/tool/source
 * 与前端 DependencyGraph.tsx 的 inferDepKind 保持一致
 */
function inferDepKindFromNode(node: GraphNode | undefined): string {
  if (!node) return 'source';
  const p = (node.path || '').toLowerCase();
  const label = (node.label || '').toLowerCase();
  const props = node.properties || {};
  const ext = (props.ext as string || '').toLowerCase();
  const tags: string[] = props.tags || [];

  // API 依赖
  if (node.type === 'api' || node.type === 'route') return 'api';
  if (props.archLayer === 'controller' || props.archLayer === 'router') return 'api';
  if (/\/(api|apis|controller|controllers|endpoint|endpoints|handler|servlet)\//.test(p)) return 'api';
  if (/\b(controller|endpoint|api)\b/i.test(label) && /\.(java|kt|ts|js|py|go)$/.test(p)) return 'api';
  if (props.endpoints && props.endpoints.length > 0) return 'api';

  // 数据库依赖
  if (node.type === 'database') return 'database';
  if (props.dataLayer) return 'database';
  if (/\/(entity|entities|model|models|pojo|repository|repositories|dao|mapper|mappers|migration|schema|sql)\//.test(p)) return 'database';
  if (tags.includes('data') || tags.includes('database') || tags.includes('table')) return 'database';
  if (/\b(entity|model|repository|mapper|dao)\b/i.test(label)) return 'database';

  // 文档依赖
  if (/\.(md|markdown|txt|rst|adoc|tex|pdf|doc|docx)$/.test(p)) return 'doc';
  if (['.md', '.markdown', '.txt', '.rst', '.adoc'].includes(ext)) return 'doc';
  if (node.type === 'concept' && props.source === 'CLAUDE.md') return 'doc';

  // UI 依赖
  if (props.archLayer === 'view') return 'ui';
  if (/\/(view|views|page|pages|component|components|template|templates|frontend|web|ui)\//.test(p)) return 'ui';
  if (['.vue', '.jsx', '.svelte', '.html', '.ejs', '.hbs'].includes(ext)) return 'ui';
  if (/\.(vue|jsx|svelte|html)$/.test(p)) return 'ui';

  // 配置依赖
  if (/\.(json|yaml|yml|toml|ini|conf|env|properties|xml)$/.test(p)) return 'config';
  if (['.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.env', '.properties', '.xml'].includes(ext)) return 'config';
  if (/\/(config|configs|configuration|settings)\//.test(p)) return 'config';

  // 工具依赖
  if (/\/(utils|util|lib|libs|helper|helpers|common|shared)\//.test(p)) return 'tool';
  if (node.type === 'dependency' && /lodash|underscore|moment|dayjs|axios|fetch|ramda|rxjs|immutable|validator|joi|zod/i.test(label)) return 'tool';

  // 默认源码
  return 'source';
}

/**
 * 从磁盘 graph-data.json 加载 AI 分析结果并合并到扫描器图谱
 * 用于应用重启后 graphCache 丢失时恢复 AI 数据
 */
async function loadDiskAiData(repoPath: string, graph: KnowledgeGraph): Promise<KnowledgeGraph> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const graphFile = path.join(repoPath, '.trae-kg', 'graph-data.json');
    if (!fs.existsSync(graphFile)) return graph;

    const diskData = JSON.parse(fs.readFileSync(graphFile, 'utf-8'));
    const diskEntities: any[] = diskData.entities || [];
    const diskRelations: any[] = diskData.relations || [];

    const existingNodeIds = new Set(graph.nodes.map((n) => n.id));
    const existingEdgeIds = new Set(graph.edges.map((e) => e.id));
    const addedNodes: GraphNode[] = [];
    const addedEdges: GraphEdge[] = [];

    // entities → nodes
    for (const ent of diskEntities) {
      const nodeId = ent.id || `ai:${ent.name}`;
      if (existingNodeIds.has(nodeId)) continue;

      const nodeType = aiEntityTypeToNodeType(ent.type);
      addedNodes.push({
        id: nodeId,
        type: nodeType,
        label: ent.name || '未命名',
        path: ent.filePath || ent.path || '',
        properties: {
          description: ent.description || '',
          tags: ent.tags || [],
          source: ent.source || 'ai',
          analyzedAt: ent.metadata?.analyzedAt || new Date().toISOString(),
          ...(ent.metadata || {}),
        },
      });
      existingNodeIds.add(nodeId);
    }

    // relations → edges（磁盘格式是 sourceId/targetId）
    for (const rel of diskRelations) {
      const sourceId = rel.sourceId || rel.source;
      const targetId = rel.targetId || rel.target;
      const edgeType = aiRelationTypeToEdgeType(rel.type);
      const edgeId = rel.id || `${sourceId}-${edgeType}-${targetId}`;

      if (existingEdgeIds.has(edgeId)) continue;
      if (!existingNodeIds.has(sourceId) || !existingNodeIds.has(targetId)) continue;

      addedEdges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
        type: edgeType,
        label: rel.label || '',
        depKind: rel.depKind,
        userEdited: rel.userEdited,
      });
      existingEdgeIds.add(edgeId);
    }

    if (addedNodes.length > 0 || addedEdges.length > 0) {
      console.log(`[knowledge-graph:ipc] 从磁盘恢复 AI 数据: +${addedNodes.length} 节点, +${addedEdges.length} 边`);
      return {
        nodes: [...graph.nodes, ...addedNodes],
        edges: [...graph.edges, ...addedEdges],
        builtAt: graph.builtAt,
      };
    }
    return graph;
  } catch (e) {
    console.warn('[knowledge-graph:ipc] 从磁盘加载 AI 数据失败:', e);
    return graph;
  }
}
