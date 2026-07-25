/**
 * 工作流流程图组件（从 TemplateBrowser 提取，可复用）
 *
 * SVG 渲染 DAG 流程图，支持缩放/平移、节点颜色按 kind、AI 图标、back edge 红色虚线。
 */

import { useState, useMemo, useRef } from 'react';
import type { WorkflowDetail, WfNode } from './types';
import { NODE_KIND_COLOR, KIND_ICON, PHASE_CN } from './types';

interface Props {
  wf: WorkflowDetail;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}

export function WfFlowGraph({ wf, selectedNodeId, onSelectNode }: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((z) => Math.max(0.3, Math.min(3, z * delta)));
  };
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
  };
  const onMouseUp = () => { setDragging(false); dragStart.current = null; };
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // BFS 分层布局（多行横向流自动换行：左→右，超出自动换行下排）
  const layout = useMemo(() => {
    const adj = new Map<string, string[]>();
    for (const n of wf.nodes) {
      adj.set(n.id, []);
    }
    for (const e of wf.edges) {
      if (!e.isFallback) {
        adj.get(e.from)?.push(e.to);
      }
    }

    // 改进的分层：使用入度优先，确保 longest-path 分层（更紧凑）
    const layer = new Map<string, number>();
    layer.set(wf.entry, 0);
    const queue = [wf.entry];
    while (queue.length) {
      const cur = queue.shift()!;
      const curLayer = layer.get(cur) ?? 0;
      for (const nxt of adj.get(cur) ?? []) {
        // 取最长路径分层
        if (!layer.has(nxt) || (layer.get(nxt) ?? 0) < curLayer + 1) {
          layer.set(nxt, curLayer + 1);
          queue.push(nxt);
        }
      }
    }
    // 不可达节点
    let extraLayer = 0;
    for (const n of wf.nodes) {
      if (!layer.has(n.id)) {
        layer.set(n.id, ++extraLayer + 5);
      }
    }

    const byLayer = new Map<number, string[]>();
    for (const n of wf.nodes) {
      const l = layer.get(n.id) ?? 0;
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l)!.push(n.id);
    }
    const sortedLayers = Array.from(byLayer.keys()).sort((a, b) => a - b);

    const NODE_W = 132, NODE_H = 54, GAP_X = 50, GAP_Y = 16;
    const ROW_GAP = 36; // 行间距
    // 每行最大列数：超过则自动换行下排
    const MAX_LAYERS_PER_ROW = 4;

    // 将 layers 分组为多行
    const rows: number[][] = [];
    for (let i = 0; i < sortedLayers.length; i += MAX_LAYERS_PER_ROW) {
      rows.push(sortedLayers.slice(i, i + MAX_LAYERS_PER_ROW));
    }

    const pos = new Map<string, { x: number; y: number }>();
    let maxX = 0, maxY = 0;
    const PAD = 12;
    let curY = PAD;

    // 逐行布局：行内列从左到右，节点垂直居中；行高 = 该行最大节点列数
    rows.forEach((rowLayers) => {
      let maxNodes = 1;
      rowLayers.forEach(l => { maxNodes = Math.max(maxNodes, byLayer.get(l)!.length); });
      const rowHeight = maxNodes * (NODE_H + GAP_Y) - GAP_Y;

      rowLayers.forEach((l, li) => {
        const nodes = byLayer.get(l)!;
        const colHeight = nodes.length * (NODE_H + GAP_Y) - GAP_Y;
        const startY = curY + (rowHeight - colHeight) / 2;
        nodes.forEach((id, ni) => {
          const x = PAD + li * (NODE_W + GAP_X);
          const y = startY + ni * (NODE_H + GAP_Y);
          pos.set(id, { x, y });
          if (x + NODE_W > maxX) maxX = x + NODE_W;
          if (y + NODE_H > maxY) maxY = y + NODE_H;
        });
      });
      curY += rowHeight + ROW_GAP;
    });

    return { pos, maxX: maxX + PAD, maxY: maxY + PAD, NODE_W, NODE_H, ROW_GAP };
  }, [wf]);

  const nodeSummary = (n: WfNode): string => {
    if (n.kind === 'phase') return PHASE_CN[(n.phase ?? n.id).toUpperCase()] ?? n.phase ?? n.id;
    if (n.kind === 'gate') return n.gate === 'test' ? '测试门禁' : '审查门禁';
    if (n.kind === 'human-gate') return '人工审批';
    return n.kind;
  };

  return (
    <div
      className="orch-wf-graph-wrap"
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
    >
      <div className="orch-wf-graph-toolbar">
        <button className="orch-link-btn" onClick={resetView} type="button">复位</button>
        <button className="orch-link-btn" onClick={() => setZoom((z) => Math.min(3, z * 1.2))} type="button">放大 +</button>
        <button className="orch-link-btn" onClick={() => setZoom((z) => Math.max(0.3, z * 0.83))} type="button">缩小 −</button>
        <span className="orch-wf-graph-zoom">{Math.round(zoom * 100)}%</span>
      </div>
      <svg
        className="orch-wf-graph"
        viewBox={`0 0 ${layout.maxX} ${layout.maxY}`}
        preserveAspectRatio="xMinYMin meet"
        style={{
          transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
          transformOrigin: '0 0',
        }}
      >
        <defs>
          <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#888" />
          </marker>
          <marker id="wf-arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#e74c3c" />
          </marker>
        </defs>
        {/* 边 */}
        {wf.edges.map((e, i) => {
          const a = layout.pos.get(e.from);
          const b = layout.pos.get(e.to);
          if (!a || !b) return null;
          const isFallback = e.isFallback;
          const stroke = isFallback ? '#e74c3c' : '#aab';
          const marker = isFallback ? 'url(#wf-arrow-back)' : 'url(#wf-arrow)';

          if (isFallback) {
            // fallback 边：上方弧线
            const midY = Math.min(a.y, b.y) + layout.NODE_H / 2 - 36;
            const c1 = `${a.x + layout.NODE_W + 20} ${midY}`;
            const c2 = `${b.x - 20} ${midY}`;
            return (
              <path
                key={i}
                d={`M ${a.x + layout.NODE_W} ${a.y + layout.NODE_H / 2} C ${c1}, ${c2}, ${b.x} ${b.y + layout.NODE_H / 2}`}
                fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="4 3"
                markerEnd={marker}
              />
            );
          }
          // 跨行检测：目标在源左侧 或 垂直距离过大 → 弯折路径
          const isCrossRow = b.x < a.x || Math.abs(a.y - b.y) > layout.NODE_H * 1.5;
          if (isCrossRow) {
            // 从源节点底部中心 → 目标节点顶部中心，S 型曲线
            const srcX = a.x + layout.NODE_W / 2;
            const srcY = a.y + layout.NODE_H;
            const tgtX = b.x + layout.NODE_W / 2;
            const tgtY = b.y;
            const midY1 = srcY + layout.ROW_GAP / 2;
            const midY2 = tgtY - layout.ROW_GAP / 2;
            return (
              <path
                key={i}
                d={`M ${srcX} ${srcY} C ${srcX} ${midY1}, ${tgtX} ${midY2}, ${tgtX} ${tgtY}`}
                fill="none" stroke={stroke} strokeWidth="1.5"
                markerEnd={marker}
              />
            );
          }
          // 普通边（同行内）
          return (
            <g key={i}>
              <line
                x1={a.x + layout.NODE_W} y1={a.y + layout.NODE_H / 2}
                x2={b.x} y2={b.y + layout.NODE_H / 2}
                stroke={stroke} strokeWidth="1.5"
                markerEnd={marker}
              />
            </g>
          );
        })}
        {/* 节点 */}
        {wf.nodes.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p) return null;
          const color = NODE_KIND_COLOR[n.kind] ?? '#555';
          const isTerm = wf.terminals.includes(n.id);
          const isEntry = wf.entry === n.id;
          const isSelected = selectedNodeId === n.id;
          const strokeColor = isSelected ? '#6F77DD' : isEntry ? '#fff' : isTerm ? '#ffd700' : '#222';
          const strokeWidth = isSelected ? 2.5 : isEntry || isTerm ? 2 : 1;

          return (
            <g
              key={n.id}
              transform={`translate(${p.x}, ${p.y})`}
              onClick={() => onSelectNode(n.id)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                width={layout.NODE_W} height={layout.NODE_H}
                fill={color} stroke={strokeColor} strokeWidth={strokeWidth}
                rx="6"
              />
              <text x={layout.NODE_W / 2} y={20} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="600">
                {(n.title || n.id).length > 14 ? (n.title || n.id).slice(0, 13) + '…' : (n.title || n.id)}
              </text>
              <text x={layout.NODE_W / 2} y={36} textAnchor="middle" fill="#cde" fontSize="9">
                {nodeSummary(n).length > 15 ? nodeSummary(n).slice(0, 14) + '…' : nodeSummary(n)}
              </text>
              {isTerm && <text x={layout.NODE_W - 5} y={10} textAnchor="end" fill="#ffd700" fontSize="8">★</text>}
              {isEntry && <text x={layout.NODE_W - 5} y={10} textAnchor="end" fill="#5af" fontSize="8">▶</text>}
              {/* AI 图标 */}
              <text x={3} y={10} fill="#5af" fontSize="9">{KIND_ICON[n.kind]}</text>
              {/* 重试标记 */}
              {n.maxAttempts && n.maxAttempts > 1 && (
                <text x={3} y={layout.NODE_H - 3} fill="#fa5" fontSize="7">↻{n.maxAttempts}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
