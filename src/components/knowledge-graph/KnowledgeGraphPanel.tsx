/**
 * 项目图谱主面板
 *
 * 四个 Tab：
 * 1. 图谱视图 — d3-force 力导向图
 * 2. 列表视图 — 按类型分组的列表
 * 3. 查询视图 — 按类型/关键词过滤
 * 4. 分析视图 — 统计图表
 *
 * 集成 AIGraphDialog 进行 AI 智能分析，通过 onAITaskChange 回调通知右侧 AIAnalysisLog
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { GraphView } from './GraphView';
import { LayeredView } from './LayeredView';
import { DependencyGraph } from './DependencyGraph';
import { AIGraphDialog } from './AIGraphDialog';
import { parseGraphFromText } from './graphParser';
import { GRAPH_PROMPTS, mergePrompts, type GraphPrompt } from './graphPrompts';
import './knowledge-graph.css';

// ── 类型 ──────────────────────────────────────────
interface GraphNode {
  id: string;
  type: string;
  label: string;
  path?: string;
  properties: Record<string, any>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  builtAt: string;
}

interface AnalysisData {
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

/** AI 任务状态回调给父组件 */
export interface AITaskStatus {
  label: string;
  running: boolean;
  preview?: string;
  entities?: number;
  relations?: number;
  error?: string;
}

type TabId = 'graph' | 'layered' | 'dependency' | 'list' | 'query' | 'analysis';

// ── 常量 ──────────────────────────────────────────
const TYPE_ICONS: Record<string, string> = {
  project: '📦', directory: '📁', file: '📄', module: '🧩',
  dependency: '📚', tech: '🔧', concept: '💡',
};

const TYPE_LABELS: Record<string, string> = {
  project: '项目', directory: '目录', file: '文件', module: '模块',
  dependency: '依赖', tech: '技术栈', concept: '概念',
};

const TYPE_ORDER = ['project', 'module', 'directory', 'file', 'dependency', 'tech', 'concept'];

/** 格式化构建/更新时间，显示为相对时间 + 精确时间 */
function formatBuiltTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  let relative: string;
  if (diffMin < 1) relative = '刚刚';
  else if (diffMin < 60) relative = `${diffMin}分钟前`;
  else if (diffMin < 1440) relative = `${Math.floor(diffMin / 60)}小时前`;
  else relative = `${Math.floor(diffMin / 1440)}天前`;

  // 精确到秒
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${relative} (${hh}:${mm}:${ss})`;
}

// ── 组件 ──────────────────────────────────────────
interface Props {
  theme: 'dark' | 'light';
  projectPath: string;
  onAITaskChange?: (task: AITaskStatus) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
}

export function KnowledgeGraphPanel({ theme, projectPath, onAITaskChange, onOpenFile }: Props) {
  const [tab, setTab] = useState<TabId>('graph');
  const [graph, setGraph] = useState<KnowledgeGraphData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showAIDialog, setShowAIDialog] = useState(false);

  // 自定义 prompts（按项目加载，与内置 GRAPH_PROMPTS 合并后传给 AIGraphDialog）
  const [customPrompts, setCustomPrompts] = useState<GraphPrompt[]>([]);
  const mergedPrompts: GraphPrompt[] = useMemo(
    () => mergePrompts(GRAPH_PROMPTS, customPrompts),
    [customPrompts]
  );

  // 查询状态
  const [queryType, setQueryType] = useState<string>('');
  const [queryKeyword, setQueryKeyword] = useState('');
  const [queryResults, setQueryResults] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);

  // 列表展开状态
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // 加载图谱
  const loadGraph = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError('');
    try {
      const kgApi = (window as any).knowledgeGraph;
      if (!kgApi) {
        setError('window.knowledgeGraph API 未注册');
        setLoading(false);
        return;
      }
      const res = await kgApi.get(projectPath);
      if (res?.ok && res.data) {
        setGraph(res.data);
      } else {
        setError(res?.error || '获取图谱失败');
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      console.error('[kg] loadGraph failed:', e);
    }
    setLoading(false);
  }, [projectPath]);

  // 加载项目级自定义 prompts（与 graphConfig 一起持久化）
  const loadCustomPrompts = useCallback(async () => {
    if (!projectPath) return;
    try {
      const res = await window.electronAPI.graphConfigLoad(projectPath);
      if (res?.success && res.config) {
        const custom = (res.config.customPrompts || []).map(p => ({ ...p, builtin: false }));
        setCustomPrompts(custom);
      }
    } catch (e) {
      console.warn('[kg] loadCustomPrompts failed:', e);
    }
  }, [projectPath]);

  // 打开 AI 对话框前刷新自定义 prompts
  const handleOpenAIDialog = useCallback(async () => {
    await loadCustomPrompts();
    setShowAIDialog(true);
  }, [loadCustomPrompts]);

  // 删除自定义模板
  const handleDeletePrompt = useCallback(async (promptId: string) => {
    if (!projectPath) return;
    try {
      // 读取当前配置
      const res = await window.electronAPI.graphConfigLoad(projectPath);
      if (!res?.success) return;
      const cfg: any = res.config || {};
      const current = (cfg.customPrompts || []).filter((p: any) => p.id !== promptId);
      cfg.customPrompts = current;
      await window.electronAPI.graphConfigSave(projectPath, cfg);
      // 更新本地状态
      setCustomPrompts(current.map((p: any) => ({ ...p, builtin: false })));
    } catch (e) {
      console.warn('[kg] deletePrompt failed:', e);
    }
  }, [projectPath]);

  // 初次加载时也加载一次 customPrompts
  useEffect(() => {
    loadCustomPrompts();
  }, [loadCustomPrompts]);

  // 构建图谱
  const handleBuild = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    setError('');
    try {
      const kgApi = (window as any).knowledgeGraph;
      if (!kgApi) {
        setError('window.knowledgeGraph API 未注册');
        setLoading(false);
        return;
      }
      const res = await kgApi.build(projectPath);
      if (res?.ok) {
        await loadGraph();
        // 同时加载分析数据
        const anaRes = await kgApi.analyze(projectPath);
        if (anaRes?.ok && anaRes.data) setAnalysis(anaRes.data);
      } else {
        setError(res?.error || '构建图谱失败');
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      console.error('[kg] build failed:', e);
    }
    setLoading(false);
  }, [projectPath, loadGraph]);

  // 首次加载
  useEffect(() => {
    if (projectPath) {
      loadGraph();
    } else {
      setGraph(null);
      setAnalysis(null);
    }
  }, [projectPath]);

  // 加载分析数据（切换到分析 Tab 时）
  useEffect(() => {
    if (tab === 'analysis' && projectPath && !analysis) {
      const kgApi = (window as any).knowledgeGraph;
      if (!kgApi) return;
      kgApi.analyze(projectPath).then((res: any) => {
        if (res?.ok && res.data) {
          setAnalysis(res.data);
        } else {
          console.error('[kg] analyze failed:', res?.error);
        }
      }).catch((e: any) => console.error('[kg] analyze error:', e));
    }
  }, [tab, projectPath, analysis]);

  // 执行查询
  const handleQuery = useCallback(async () => {
    if (!projectPath) return;
    try {
      const res = await (window as any).knowledgeGraph.query(projectPath, {
        type: queryType || undefined,
        keyword: queryKeyword.trim() || undefined,
      });
      if (res?.ok && res.data) {
        setQueryResults(res.data);
      }
    } catch (e) {
      console.error('[kg] query failed:', e);
    }
  }, [projectPath, queryType, queryKeyword]);

  // 自动查询（输入变化时防抖）
  useEffect(() => {
    if (tab !== 'query' || !projectPath) return;
    const timer = setTimeout(handleQuery, 300);
    return () => clearTimeout(timer);
  }, [tab, projectPath, queryType, queryKeyword, handleQuery]);

  // ── AI 分析：调用独立 Claude 进程执行真正的 AI 图谱分析 ──
  const handleAIExecute = useCallback(async (prompt: string, label: string) => {
    // 通知父组件：任务开始运行
    onAITaskChange?.({ label, running: true, preview: '正在启动 AI 分析...' });

    // 订阅进度更新（实时显示 AI 输出预览）
    const unsubProgress = (window as any).electronAPI.onGraphAiProgress?.((progress: any) => {
      if (progress.stage === 'init') {
        onAITaskChange?.({ label, running: true, preview: 'AI 已连接，正在分析项目...' });
      } else if (progress.stage === 'thinking') {
        onAITaskChange?.({ label, running: true, preview: progress.preview || 'AI 分析中...' });
      }
    });

    try {
      // 调用专用 graph:ai-analyze IPC（独立 Claude 进程，不污染 ChatPanel）
      const r = await window.electronAPI.graphAiAnalyze({ projectPath, prompt });
      unsubProgress?.();

      if (r?.success && r.result) {
        // 解析 AI 返回的 JSON 图谱数据
        const parsed = parseGraphFromText(r.result, projectPath);
        if (parsed && parsed.entities.length > 0) {
          const kgApi = (window as any).knowledgeGraph;

          // 1) 合并到图谱内存缓存（nodes/edges 格式，供 Panel 图谱视图使用）
          if (kgApi?.mergeAi) {
            const mergeRes = await kgApi.mergeAi(projectPath, {
              entities: parsed.entities,
              relations: parsed.relations,
            });
            if (mergeRes?.ok && mergeRes.data) {
              onAITaskChange?.({
                label,
                running: false,
                entities: mergeRes.data.addedNodes,
                relations: mergeRes.data.addedEdges,
                preview: `分析完成：新增 ${mergeRes.data.addedNodes} 实体 · ${mergeRes.data.addedEdges} 关系（总计 ${mergeRes.data.totalNodes} 节点）`,
              });
            } else {
              onAITaskChange?.({
                label,
                running: false,
                entities: parsed.entities.length,
                relations: parsed.relations.length,
                preview: `分析完成：${parsed.entities.length} 实体 · ${parsed.relations.length} 关系`,
              });
            }
          }

          // 2) mergeAi 已统一写磁盘（与 Sidebar 读取格式一致），无需前端重复磁盘合

          // 3) 重新加载图谱和分析数据
          await loadGraph();
          if (kgApi) {
            const anaRes = await kgApi.analyze(projectPath);
            if (anaRes?.ok && anaRes.data) setAnalysis(anaRes.data);
          }
        } else {
          // 解析失败：AI 返回了内容但未提取到有效实体
          onAITaskChange?.({
            label,
            running: false,
            error: 'AI 返回内容中未提取到有效实体，请尝试其他分析模板',
          });
        }
      } else {
        // 分析失败
        onAITaskChange?.({
          label,
          running: false,
          error: r?.error || 'AI 分析失败',
        });
      }
    } catch (e: any) {
      unsubProgress?.();
      onAITaskChange?.({
        label,
        running: false,
        error: e?.message || String(e),
      });
      console.error('[kg] AI analyze failed:', e);
    }
  }, [projectPath, onAITaskChange, loadGraph]);

  // ── AI 分析：从粘贴文本导入结果 ──
  const handleImportFromText = useCallback(async (text: string): Promise<{ entities: number; relations: number } | null> => {
    const parsed = parseGraphFromText(text, projectPath);
    if (parsed && parsed.entities.length > 0) {
      const kgApi = (window as any).knowledgeGraph;
      // 1) 合并到图谱内存缓存 + 磁盘文件（mergeAi 统一处理）
      if (kgApi?.mergeAi) {
        await kgApi.mergeAi(projectPath, {
          entities: parsed.entities,
          relations: parsed.relations,
        });
      }
      // 2) mergeAi 已统一写磁盘，无需前端重复磁盘合
      // 通知父组件：任务完成
      onAITaskChange?.({
        label: 'AI 图谱分析',
        running: false,
        entities: parsed.entities.length,
        relations: parsed.relations.length,
        preview: `导入完成：${parsed.entities.length} 实体 · ${parsed.relations.length} 关系`,
      });
      // 重新加载图谱以反映新数据
      await loadGraph();
      if (kgApi) {
        const anaRes = await kgApi.analyze(projectPath);
        if (anaRes?.ok && anaRes.data) setAnalysis(anaRes.data);
      }
      return { entities: parsed.entities.length, relations: parsed.relations.length };
    }
    // 解析失败
    onAITaskChange?.({
      label: 'AI 图谱分析',
      running: false,
      error: '解析失败：未提取到有效实体',
    });
    return null;
  }, [projectPath, onAITaskChange, loadGraph]);

  // 节点按类型分组
  const groupedNodes = useMemo(() => {
    if (!graph) return {};
    const groups: Record<string, GraphNode[]> = {};
    for (const node of graph.nodes) {
      const type = node.type;
      if (!groups[type]) groups[type] = [];
      groups[type].push(node);
    }
    return groups;
  }, [graph]);

  // 没有项目时
  if (!projectPath) {
    return (
      <div className="kg-panel">
        <div className="kg-empty">
          <div className="kg-empty-icon">🧠</div>
          <div className="kg-empty-text">请先选择一个项目</div>
          <div className="kg-empty-hint">选择项目后将自动解析项目图谱</div>
        </div>
      </div>
    );
  }

  // 空图谱
  if (!graph && !loading) {
    return (
      <div className="kg-panel">
        <div className="kg-empty">
          <div className="kg-empty-icon">🧠</div>
          <div className="kg-empty-text">尚未构建项目图谱</div>
          <div className="kg-empty-hint">点击下方按钮扫描项目结构、依赖和技术栈</div>
          {error && (
            <div style={{ color: '#ef4444', fontSize: 11, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 4, margin: '8px 0', maxWidth: 400 }}>
              ⚠️ {error}
            </div>
          )}
          <button className="kg-build-btn" onClick={handleBuild} type="button">
            🔨 构建图谱
          </button>
        </div>
      </div>
    );
  }

  if (loading && !graph) {
    return (
      <div className="kg-panel">
        <div className="kg-empty">
          <div className="kg-empty-icon">⏳</div>
          <div className="kg-empty-text">正在构建项目图谱...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kg-panel">
      {/* 工具栏 */}
      <div className="kg-toolbar">
        <span className="kg-toolbar-title">🕸️ 项目图谱</span>
        <button className="kg-build-btn" onClick={handleBuild} disabled={loading} type="button">
          {loading ? '⏳ 构建中...' : '🔄 刷新'}
        </button>
        <button
          className="kg-build-btn"
          onClick={handleOpenAIDialog}
          type="button"
        >
          🤖 AI 分析
        </button>
        <span className="kg-toolbar-info">
          {graph ? `${graph.nodes.length} 节点 · ${graph.edges.length} 边` : ''}
          {graph?.builtAt && (
            <span className="kg-toolbar-time">
               · 🕐 <time dateTime={graph.builtAt} title={new Date(graph.builtAt).toLocaleString()}>
                {formatBuiltTime(graph.builtAt)}
              </time>
            </span>
          )}
        </span>
      </div>

      {/* Tab 切换 */}
      <div className="kg-tabs">
        <button className={`kg-tab${tab === 'graph' ? ' active' : ''}`} onClick={() => setTab('graph')} type="button">🔬 图谱</button>
        <button className={`kg-tab${tab === 'layered' ? ' active' : ''}`} onClick={() => setTab('layered')} type="button">🏗️ 分层</button>
        <button className={`kg-tab${tab === 'dependency' ? ' active' : ''}`} onClick={() => setTab('dependency')} type="button">🔗 依赖图</button>
        <button className={`kg-tab${tab === 'list' ? ' active' : ''}`} onClick={() => setTab('list')} type="button">📋 列表</button>
        <button className={`kg-tab${tab === 'query' ? ' active' : ''}`} onClick={() => setTab('query')} type="button">🔍 查询</button>
        <button className={`kg-tab${tab === 'analysis' ? ' active' : ''}`} onClick={() => setTab('analysis')} type="button">📊 分析</button>
      </div>

      {/* 内容区 */}
      <div className="kg-content">
        {/* ── 图谱视图 ──────────────────────────────── */}
        {tab === 'graph' && graph && (
          <>
            <GraphView
              nodes={graph.nodes}
              edges={graph.edges}
              onNodeClick={(node) => setSelectedNode(node as any)}
            />
            {selectedNode && (
              <div className="kg-node-detail">
                <div className="kg-node-detail-header">
                  <span className="kg-node-detail-title">
                    {TYPE_ICONS[selectedNode.type]} {selectedNode.label}
                  </span>
                  <button className="kg-node-detail-close" onClick={() => setSelectedNode(null)} type="button">✕</button>
                </div>
                <div className="kg-node-detail-prop">
                  <span className="kg-node-detail-prop-key">类型</span>
                  <span className="kg-node-detail-prop-val">{TYPE_LABELS[selectedNode.type] || selectedNode.type}</span>
                </div>
                {selectedNode.path && (
                  <div className="kg-node-detail-prop">
                    <span className="kg-node-detail-prop-key">路径</span>
                    <span className="kg-node-detail-prop-val">{selectedNode.path}</span>
                  </div>
                )}
                {selectedNode.path && (
                  <div className="kg-node-detail-prop">
                    <span className="kg-node-detail-prop-key">操作</span>
                    <button
                      className="kg-node-open-btn"
                      onClick={() => onOpenFile?.(selectedNode.path!, selectedNode.label)}
                      type="button"
                      title="在编辑器中打开此文件"
                    >
                      📄 查看文件
                    </button>
                  </div>
                )}
                {Object.entries(selectedNode.properties || {}).map(([key, val]) => (
                  <div className="kg-node-detail-prop" key={key}>
                    <span className="kg-node-detail-prop-key">{key}</span>
                    <span className="kg-node-detail-prop-val">{String(val)}</span>
                  </div>
                ))}
                {/* AI 节点展示分析时间 */}
                {selectedNode.properties?.source === 'ai' && selectedNode.properties?.analyzedAt && (
                  <div className="kg-node-detail-prop">
                    <span className="kg-node-detail-prop-key">分析时间</span>
                    <span className="kg-node-detail-prop-val">
                      {new Date(selectedNode.properties.analyzedAt).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── 分层视图 ─────────────────────────────── */}
        {tab === 'layered' && graph && (
          <LayeredView
            nodes={graph.nodes}
            edges={graph.edges}
            onNodeClick={(node) => setSelectedNode(node as any)}
            onOpenFile={onOpenFile}
          />
        )}

        {/* ── 依赖图视图 ─────────────────────────────── */}
        {tab === 'dependency' && graph && (
          <DependencyGraph
            nodes={graph.nodes}
            edges={graph.edges}
            onNodeClick={(node) => setSelectedNode(node as any)}
            projectPath={projectPath}
            onOpenFile={onOpenFile}
          />
        )}

        {/* ── 列表视图 ──────────────────────────────── */}
        {tab === 'list' && graph && (
          <div className="kg-list-container">
            {TYPE_ORDER.map((type) => {
              const list = groupedNodes[type] || [];
              if (list.length === 0) return null;
              const isCollapsed = collapsedGroups.has(type);
              return (
                <div key={type} className="kg-list-group">
                  <div
                    className="kg-list-group-header"
                    onClick={() => {
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(type)) next.delete(type);
                        else next.add(type);
                        return next;
                      });
                    }}
                  >
                    <span>{isCollapsed ? '▶' : '▼'}</span>
                    <span>{TYPE_ICONS[type]} {TYPE_LABELS[type] || type}</span>
                    <span className="kg-list-group-count">{list.length}</span>
                  </div>
                  {!isCollapsed && list.slice(0, 100).map((node) => (
                    <div
                      key={node.id}
                      className="kg-list-item"
                      onClick={() => { setTab('graph'); setSelectedNode(node); }}
                    >
                      <span className="kg-list-item-icon">{TYPE_ICONS[type]}</span>
                      <span className="kg-list-item-label">{node.label}</span>
                      {node.properties?.language && (
                        <span className="kg-list-item-meta">{node.properties.language}</span>
                      )}
                      {node.properties?.lines != null && node.properties.lines > 0 && (
                        <span className="kg-list-item-meta">{node.properties.lines}行</span>
                      )}
                      {node.properties?.version && (
                        <span className="kg-list-item-meta">v{node.properties.version.replace(/[\^~]/, '')}</span>
                      )}
                    </div>
                  ))}
                  {list.length > 100 && (
                    <div className="kg-list-item" style={{ opacity: 0.5, cursor: 'default' }}>
                      <span className="kg-list-item-label">... 还有 {list.length - 100} 项</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── 查询视图 ──────────────────────────────── */}
        {tab === 'query' && (
          <div className="kg-query-container">
            <div className="kg-query-controls">
              <select
                className="kg-query-select"
                value={queryType}
                onChange={(e) => setQueryType(e.target.value)}
              >
                <option value="">全部类型</option>
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>{TYPE_ICONS[t]} {TYPE_LABELS[t]}</option>
                ))}
              </select>
              <input
                className="kg-query-input"
                type="text"
                placeholder="搜索节点名称、路径..."
                value={queryKeyword}
                onChange={(e) => setQueryKeyword(e.target.value)}
              />
            </div>
            <div className="kg-query-results">
              {queryResults && queryResults.nodes.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#666', fontSize: 12 }}>无匹配结果</div>
              ) : (
                queryResults?.nodes.map((node) => (
                  <div
                    key={node.id}
                    className="kg-query-result-item"
                    onClick={() => { setTab('graph'); setSelectedNode(node); }}
                  >
                    <span>{TYPE_ICONS[node.type]}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {node.label}
                    </span>
                    <span style={{ fontSize: 9, color: '#666' }}>{TYPE_LABELS[node.type] || node.type}</span>
                  </div>
                ))
              )}
            </div>
            {queryResults && (
              <div style={{ fontSize: 10, color: '#666', textAlign: 'right' }}>
                {queryResults.nodes.length} 个结果 · {queryResults.edges.length} 条关系
              </div>
            )}
          </div>
        )}

        {/* ── 分析视图 ──────────────────────────────── */}
        {tab === 'analysis' && (
          <div className="kg-analysis-container">
            {analysis ? (
              <>
                {/* 核心统计 */}
                <div className="kg-analysis-section">
                  <div className="kg-analysis-section-title">📊 核心统计</div>
                  <div className="kg-analysis-stats">
                    <div className="kg-analysis-stat">
                      <div className="kg-analysis-stat-num">{analysis.totalNodes}</div>
                      <div className="kg-analysis-stat-label">总节点</div>
                    </div>
                    <div className="kg-analysis-stat">
                      <div className="kg-analysis-stat-num">{analysis.totalEdges}</div>
                      <div className="kg-analysis-stat-label">总关系</div>
                    </div>
                    <div className="kg-analysis-stat">
                      <div className="kg-analysis-stat-num">{analysis.fileCount}</div>
                      <div className="kg-analysis-stat-label">源文件</div>
                    </div>
                  </div>
                </div>

                {/* 节点分布 */}
                <div className="kg-analysis-section">
                  <div className="kg-analysis-section-title">📁 节点分布</div>
                  {Object.entries(analysis.nodesByType)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => {
                      const max = Math.max(...Object.values(analysis.nodesByType));
                      const pct = max > 0 ? (count / max) * 100 : 0;
                      return (
                        <div key={type} className="kg-analysis-bar">
                          <span className="kg-analysis-bar-label">
                            {TYPE_ICONS[type]} {TYPE_LABELS[type] || type}
                          </span>
                          <div className="kg-analysis-bar-track">
                            <div className="kg-analysis-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="kg-analysis-bar-num">{count}</span>
                        </div>
                      );
                    })}
                </div>

                {/* 技术栈 */}
                {analysis.techStack.length > 0 && (
                  <div className="kg-analysis-section">
                    <div className="kg-analysis-section-title">🔧 技术栈</div>
                    <div className="kg-analysis-dep-list">
                      {analysis.techStack.map((tech) => (
                        <span key={tech} className="kg-analysis-dep-chip">{tech}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 依赖列表 */}
                {analysis.topDependencies.length > 0 && (
                  <div className="kg-analysis-section">
                    <div className="kg-analysis-section-title">📚 依赖 ({analysis.topDependencies.length})</div>
                    <div className="kg-analysis-dep-list">
                      {analysis.topDependencies.map((dep) => (
                        <span key={dep.name} className="kg-analysis-dep-chip">
                          {dep.name}
                          {dep.version && <span className="kg-analysis-dep-ver">{dep.version}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 最大目录 */}
                {analysis.largestDirs.length > 0 && (
                  <div className="kg-analysis-section">
                    <div className="kg-analysis-section-title">📂 文件最多的目录</div>
                    {analysis.largestDirs.map((dir) => {
                      const max = analysis.largestDirs[0]?.fileCount || 1;
                      const pct = (dir.fileCount / max) * 100;
                      return (
                        <div key={dir.path} className="kg-analysis-bar">
                          <span className="kg-analysis-bar-label">{dir.path}</span>
                          <div className="kg-analysis-bar-track">
                            <div className="kg-analysis-bar-fill" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="kg-analysis-bar-num">{dir.fileCount}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="kg-empty">
                <div className="kg-empty-icon">⏳</div>
                <div className="kg-empty-text">正在分析...</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* AI 分析弹窗 */}
      {showAIDialog && (
        <AIGraphDialog
          theme={theme}
          projectPath={projectPath}
          prompts={mergedPrompts}
          onClose={() => setShowAIDialog(false)}
          onExecute={(prompt, label) => {
            setShowAIDialog(false);
            handleAIExecute(prompt, label);
          }}
          onImportFromText={(text) => handleImportFromText(text)}
          onDeletePrompt={handleDeletePrompt}
        />
      )}
    </div>
  );
}
