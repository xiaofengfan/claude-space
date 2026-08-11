/**
 * 图谱视图 — 使用 d3-force 力导向布局 + SVG 渲染
 *
 * 功能：
 * - 力导向自动布局
 * - 节点拖拽
 * - 缩放/平移
 * - 按类型着色
 * - hover 显示标签
 * - 点击节点回调
 */

import { useEffect, useRef, useState } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';

// ── 类型 ──────────────────────────────────────────
interface GraphNodeData {
  id: string;
  type: string;
  label: string;
  path?: string;
  properties?: Record<string, any>;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdgeData {
  id: string;
  source: string | GraphNodeData;
  target: string | GraphNodeData;
  type: string;
}

interface Props {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  onNodeClick?: (node: GraphNodeData) => void;
}

// ── 节点类型颜色映射 ──────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  project: '#6c8cff',
  directory: '#5a6d7e',
  file: '#7ee787',
  module: '#f0883e',
  dependency: '#d2a8ff',
  tech: '#ffa657',
  concept: '#ff7b72',
};

const TYPE_ICONS: Record<string, string> = {
  project: '📦', directory: '📁', file: '📄', module: '🧩',
  dependency: '📚', tech: '🔧', concept: '💡',
};

const TYPE_LABELS: Record<string, string> = {
  project: '项目', directory: '目录', file: '文件', module: '模块',
  dependency: '依赖', tech: '技术栈', concept: '概念',
};

// ── 组件 ──────────────────────────────────────────
export function GraphView({ nodes: rawNodes, edges: rawEdges, onNodeClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [simNodes, setSimNodes] = useState<GraphNodeData[]>([]);
  const [simEdges, setSimEdges] = useState<GraphEdgeData[]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [dragging, setDragging] = useState<{ id: string; startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const [panning, setPanning] = useState<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation> | null>(null);
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);

  // 初始化/更新图谱数据
  useEffect(() => {
    if (rawNodes.length === 0) {
      setSimNodes([]);
      setSimEdges([]);
      return;
    }

    // 深拷贝节点，初始化位置
    const nodes: GraphNodeData[] = rawNodes.map((n, i) => ({
      ...n,
      x: n.x ?? width / 2 + Math.cos((i / rawNodes.length) * Math.PI * 2) * 100,
      y: n.y ?? height / 2 + Math.sin((i / rawNodes.length) * Math.PI * 2) * 100,
      fx: null,
      fy: null,
    }));

    // 深拷贝边
    const edges: GraphEdgeData[] = rawEdges.map((e) => ({ ...e }));

    // 创建模拟
    const sim = forceSimulation<GraphNodeData>(nodes)
      .force('link', forceLink<GraphNodeData, GraphEdgeData>(edges)
        .id((d) => d.id)
        .distance(60)
        .strength(0.3))
      .force('charge', forceManyBody().strength(-80))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide(20))
      .alpha(0.8)
      .alphaDecay(0.02);

    sim.on('tick', () => {
      setSimNodes([...nodes]);
      setSimEdges([...edges]);
    });

    simRef.current = sim as any;

    return () => {
      sim.stop();
    };
  }, [rawNodes, rawEdges, width, height]);

  // 容器尺寸监听
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setWidth(entry.contentRect.width);
        setHeight(entry.contentRect.height);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // 节点拖拽
  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragging.startX) / transform.k;
      const dy = (e.clientY - dragging.startY) / transform.k;
      const node = simNodes.find((n) => n.id === dragging.id);
      if (node) {
        node.fx = dragging.nodeX + dx;
        node.fy = dragging.nodeY + dy;
        simRef.current?.alpha(0.3).restart();
      }
    };
    const handleUp = () => setDragging(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, simNodes, transform]);

  // 平移
  useEffect(() => {
    if (!panning) return;
    const handleMove = (e: MouseEvent) => {
      const dx = e.clientX - panning.startX;
      const dy = e.clientY - panning.startY;
      setTransform((prev) => ({ ...prev, x: panning.origX + dx, y: panning.origY + dy }));
    };
    const handleUp = () => setPanning(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [panning]);

  // 缩放
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newK = Math.max(0.1, Math.min(5, transform.k * delta));
    setTransform((prev) => ({ ...prev, k: newK }));
  };

  const handleZoom = (factor: number) => {
    const newK = Math.max(0.1, Math.min(5, transform.k * factor));
    setTransform((prev) => ({ ...prev, k: newK }));
  };

  const handleReset = () => {
    setTransform({ x: 0, y: 0, k: 1 });
    simRef.current?.alpha(0.8).restart();
  };

  // 节点半径（按类型）
  const nodeRadius = (type: string): number => {
    const sizes: Record<string, number> = {
      project: 12, module: 8, directory: 6, file: 4,
      dependency: 7, tech: 7, concept: 6,
    };
    return sizes[type] || 5;
  };

  return (
    <div className="kg-graph-container" ref={containerRef}>
      <svg
        ref={svgRef}
        className="kg-graph-svg"
        onWheel={handleWheel}
        onMouseDown={(e) => {
          if (e.button === 0 && !(e.target as SVGElement).classList.contains('kg-node-circle')) {
            setPanning({ startX: e.clientX, startY: e.clientY, origX: transform.x, origY: transform.y });
          }
        }}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* 边 */}
          {simEdges.map((edge) => {
            const source = typeof edge.source === 'string' ? simNodes.find((n) => n.id === edge.source) : edge.source as GraphNodeData;
            const target = typeof edge.target === 'string' ? simNodes.find((n) => n.id === edge.target) : edge.target as GraphNodeData;
            if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) return null;

            const isHighlighted = hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode || (typeof edge.source === 'object' && (edge.source as GraphNodeData).id === hoveredNode) || (typeof edge.target === 'object' && (edge.target as GraphNodeData).id === hoveredNode));

            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={isHighlighted ? '#6c8cff' : '#333'}
                strokeWidth={isHighlighted ? 1.5 : 0.5}
                opacity={hoveredNode && !isHighlighted ? 0.1 : 0.4}
              />
            );
          })}

          {/* 节点 */}
          {simNodes.map((node) => {
            if (node.x == null || node.y == null) return null;
            const r = nodeRadius(node.type);
            const color = TYPE_COLORS[node.type] || '#888';
            const isHovered = hoveredNode === node.id;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => onNodeClick?.(node)}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDragging({ id: node.id, startX: e.clientX, startY: e.clientY, nodeX: node.x ?? 0, nodeY: node.y ?? 0 });
                }}
              >
                <circle
                  className="kg-node-circle"
                  r={isHovered ? r + 2 : r}
                  fill={color}
                  stroke={isHovered ? '#fff' : 'none'}
                  strokeWidth={isHovered ? 1.5 : 0}
                  opacity={hoveredNode && !isHovered ? 0.3 : 1}
                />
                {(isHovered || node.type === 'project' || node.type === 'module') && (
                  <text
                    y={r + 10}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#ccc"
                    pointerEvents="none"
                    style={{ userSelect: 'none' }}
                  >
                    {node.label.length > 20 ? node.label.slice(0, 18) + '…' : node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* 控制按钮 */}
      <div className="kg-graph-controls">
        <button className="kg-graph-ctrl-btn" onClick={() => handleZoom(1.2)} title="放大" type="button">+</button>
        <button className="kg-graph-ctrl-btn" onClick={() => handleZoom(0.8)} title="缩小" type="button">−</button>
        <button className="kg-graph-ctrl-btn" onClick={handleReset} title="重置" type="button">⟲</button>
      </div>

      {/* 图例 */}
      <div className="kg-graph-legend">
        {Object.entries(TYPE_COLORS).map(([type, color]) => {
          const count = simNodes.filter((n) => n.type === type).length;
          if (count === 0) return null;
          return (
            <div key={type} className="kg-legend-item">
              <span className="kg-legend-dot" style={{ background: color }} />
              <span>{TYPE_ICONS[type]} {TYPE_LABELS[type] || type} ({count})</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
