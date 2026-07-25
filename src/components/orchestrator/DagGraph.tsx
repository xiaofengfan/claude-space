/**
 * DAG 流程图可视化
 *
 * 横向布局（左→右），SVG 绘制连接线
 * - 节点状态用颜色区分（pending/running/done/failed/blocked）
 * - 节点类型用图标区分（🤖 AI 执行 / ✓ 质量门禁 / ✋ 人工审批）
 * - fallback 边用红色虚线
 * - 点击节点触发 onSelect
 * - 显示进度统计 + 图例
 */

import { useMemo } from 'react';
import type { Task, TaskStatus } from './types';
import { STATUS_COLOR, STATUS_LABEL, KIND_ICON, KIND_LABEL } from './types';

interface Props {
  tasks: Task[];
  /** 当前选中的 task id */
  selectedTaskId?: string;
  /** 选择 task 回调 */
  onSelectTask?: (taskId: string) => void;
}

// ── 节点尺寸常量 ─────────────────────────────────────
const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const LAYER_GAP_X = 80;   // 层与层之间的水平间距
const LAYER_GAP_Y = 24;   // 同层节点之间的垂直间距

interface NodePos {
  taskId: string;
  x: number;
  y: number;
  layer: number;
}

export function DagGraph({ tasks, selectedTaskId, onSelectTask }: Props) {
  // ── 拓扑分层（Kahn 变种）──────────────────────────────
  const { positions, width, height, fallbackEdges } = useMemo(() => {
    if (tasks.length === 0) {
      return { positions: new Map<string, NodePos>(), width: 0, height: 0, fallbackEdges: [] as Array<{ from: string; to: string }> };
    }

    // 计算每个节点的层级（最长路径）
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const layerCache = new Map<string, number>();

    function getLayer(id: string): number {
      if (layerCache.has(id)) return layerCache.get(id)!;
      const task = taskMap.get(id);
      if (!task) return 0;
      if (task.deps.length === 0) {
        layerCache.set(id, 0);
        return 0;
      }
      const maxDepLayer = Math.max(...task.deps.map((d) => getLayer(d)));
      const layer = maxDepLayer + 1;
      layerCache.set(id, layer);
      return layer;
    }

    tasks.forEach((t) => getLayer(t.id));

    // 按层分组
    const layers = new Map<number, string[]>();
    tasks.forEach((t) => {
      const layer = layerCache.get(t.id)!;
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer)!.push(t.id);
    });

    // 计算每个节点的位置
    const maxLayerSize = Math.max(...Array.from(layers.values()).map((l) => l.length));
    const positions = new Map<string, NodePos>();
    const layerCount = layers.size;

    layers.forEach((layer, layerIdx) => {
      const x = layerIdx * (NODE_WIDTH + LAYER_GAP_X);
      const totalHeight = layer.length * NODE_HEIGHT + (layer.length - 1) * LAYER_GAP_Y;
      const startY = 0; // 简化：每层都从 y=0 开始，让中心对齐
      layer.forEach((taskId, nodeIdx) => {
        const y = startY + nodeIdx * (NODE_HEIGHT + LAYER_GAP_Y);
        positions.set(taskId, { taskId, x, y, layer: layerIdx });
      });
    });

    const totalWidth = layerCount * NODE_WIDTH + (layerCount - 1) * LAYER_GAP_X;
    const totalHeight = maxLayerSize * NODE_HEIGHT + (maxLayerSize - 1) * LAYER_GAP_Y;

    // 收集 fallback 边（用于红色虚线）
    const fallbackEdges: Array<{ from: string; to: string }> = [];
    tasks.forEach((t) => {
      if (t.fallbackTo) {
        fallbackEdges.push({ from: t.id, to: t.fallbackTo });
      }
    });

    return { positions: positions, width: totalWidth, height: totalHeight, fallbackEdges };
  }, [tasks]);

  // ── 连接线计算 ─────────────────────────────────────
  const edges = useMemo(() => {
    const result: Array<{
      key: string;
      d: string;
      isFallback: boolean;
    }> = [];

    tasks.forEach((t) => {
      const targetPos = positions.get(t.id);
      if (!targetPos) return;
      t.deps.forEach((depId) => {
        const srcPos = positions.get(depId);
        if (!srcPos) return;
        const x1 = srcPos.x + NODE_WIDTH;
        const y1 = srcPos.y + NODE_HEIGHT / 2;
        const x2 = targetPos.x;
        const y2 = targetPos.y + NODE_HEIGHT / 2;
        const midX = (x1 + x2) / 2;
        // 三次贝塞尔曲线
        const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
        result.push({ key: `${depId}->${t.id}`, d, isFallback: false });
      });
    });

    // fallback 边（红色虚线，反向）
    fallbackEdges.forEach(({ from, to }) => {
      const srcPos = positions.get(from);
      const targetPos = positions.get(to);
      if (!srcPos || !targetPos) return;
      const x1 = srcPos.x + NODE_WIDTH / 2;
      const y1 = srcPos.y; // 顶部
      const x2 = targetPos.x + NODE_WIDTH / 2;
      const y2 = targetPos.y; // 顶部
      // 上方弧线
      const arcHeight = 40;
      const midX = (x1 + x2) / 2;
      const midY = Math.min(y1, y2) - arcHeight;
      const d = `M ${x1} ${y1} Q ${midX} ${midY}, ${x2} ${y2}`;
      result.push({ key: `fb-${from}->${to}`, d, isFallback: true });
    });

    return result;
  }, [tasks, positions, fallbackEdges]);

  // ── 进度统计 ───────────────────────────────────────
  const progress = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      pending: 0, ready: 0, running: 0, done: 0, failed: 0, blocked: 0,
    };
    tasks.forEach((t) => { counts[t.status]++; });
    const total = tasks.length;
    const isAllDone = counts.done === total && total > 0;
    const isStalled = counts.running === 0 && counts.ready === 0 && counts.pending === 0 && !isAllDone && counts.failed > 0;
    return { counts, total, isAllDone, isStalled };
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="orch-dag-empty">
        <div className="orch-hint">尚未创建编排任务</div>
      </div>
    );
  }

  const padding = 40;
  const svgWidth = width + padding * 2;
  const svgHeight = height + padding * 2 + 80; // 留出顶部图例空间

  return (
    <div className="orch-dag-container">
      {/* ── 顶部统计栏 ───────────────────────────── */}
      <div className="orch-dag-stats">
        <div className="orch-dag-progress">
          <span className="orch-dag-progress-label">进度</span>
          <div className="orch-dag-progress-bar">
            <div
              className="orch-dag-progress-fill"
              style={{ width: `${progress.total > 0 ? (progress.counts.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <span className="orch-dag-progress-text">
            {progress.counts.done} / {progress.total}
          </span>
        </div>
        <div className="orch-dag-legend">
          {(['pending', 'running', 'done', 'failed', 'blocked'] as TaskStatus[]).map((s) => (
            <span key={s} className="orch-dag-legend-item">
              <span className="orch-dag-legend-dot" style={{ background: STATUS_COLOR[s] }} />
              {STATUS_LABEL[s]}({progress.counts[s]})
            </span>
          ))}
        </div>
        <div className="orch-dag-legend">
          <span className="orch-dag-legend-item">
            <span className="orch-dag-legend-icon">🤖</span>AI 执行
          </span>
          <span className="orch-dag-legend-item">
            <span className="orch-dag-legend-icon">✓</span>质量门禁
          </span>
          <span className="orch-dag-legend-item">
            <span className="orch-dag-legend-icon">✋</span>人工审批
          </span>
          <span className="orch-dag-legend-item">
            <span className="orch-dag-legend-line" />fallback 回退
          </span>
        </div>
      </div>

      {/* ── SVG 流程图 ───────────────────────────── */}
      <div className="orch-dag-scroll">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="orch-dag-svg"
        >
          <g transform={`translate(${padding}, ${padding})`}>
            {/* 连接线 */}
            {edges.map((edge) => (
              <path
                key={edge.key}
                d={edge.d}
                fill="none"
                stroke={edge.isFallback ? '#ef4444' : '#444'}
                strokeWidth={edge.isFallback ? 1.5 : 1.5}
                strokeDasharray={edge.isFallback ? '5,3' : 'none'}
                markerEnd={edge.isFallback ? 'url(#arrow-red)' : 'url(#arrow)'}
              />
            ))}

            {/* 箭头定义 */}
            <defs>
              <marker
                id="arrow"
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L8,3 z" fill="#666" />
              </marker>
              <marker
                id="arrow-red"
                markerWidth="10"
                markerHeight="10"
                refX="8"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
              </marker>
            </defs>

            {/* 节点 */}
            {tasks.map((task) => {
              const pos = positions.get(task.id);
              if (!pos) return null;
              const color = STATUS_COLOR[task.status];
              const isSelected = selectedTaskId === task.id;
              const isRunning = task.status === 'running';
              const icon = KIND_ICON[task.kind];
              const kindLabel = KIND_LABEL[task.kind];

              return (
                <g
                  key={task.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  className={`orch-dag-node${isSelected ? ' selected' : ''}${isRunning ? ' running' : ''}`}
                  onClick={() => onSelectTask?.(task.id)}
                  style={{ cursor: onSelectTask ? 'pointer' : 'default' }}
                >
                  {/* 节点背景 */}
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    ry={6}
                    fill="var(--bg-elevated)"
                    stroke={color}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    className="orch-dag-node-rect"
                  />

                  {/* 左侧状态条 */}
                  <rect
                    width={4}
                    height={NODE_HEIGHT}
                    rx={2}
                    ry={2}
                    fill={color}
                  />

                  {/* 类型图标 */}
                  <text
                    x={14}
                    y={22}
                    fontSize={16}
                    className="orch-dag-node-icon"
                  >
                    {icon}
                  </text>

                  {/* 节点标题 */}
                  <text
                    x={36}
                    y={22}
                    fontSize={12}
                    fontWeight={600}
                    fill="var(--text-main, #e0e0e0)"
                    className="orch-dag-node-title"
                  >
                    {truncate(task.title, 12)}
                  </text>

                  {/* 节点 id + 状态 */}
                  <text
                    x={36}
                    y={40}
                    fontSize={10}
                    fill="var(--text-muted, #888)"
                    className="orch-dag-node-subtitle"
                  >
                    {task.id} · {STATUS_LABEL[task.status]}
                    {task.attempts > 0 && task.kind === 'phase' && ` · 尝试 ${task.attempts}`}
                    {task.kind === 'phase' && task.maxAttempts && task.maxAttempts > 1 && ` ↻${task.maxAttempts}`}
                  </text>

                  {/* 类型标签（右上角）*/}
                  <text
                    x={NODE_WIDTH - 8}
                    y={14}
                    fontSize={9}
                    fill="var(--text-muted, #888)"
                    textAnchor="end"
                    className="orch-dag-node-kind"
                  >
                    {kindLabel}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}
