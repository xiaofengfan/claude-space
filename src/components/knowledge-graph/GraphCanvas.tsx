import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import type { GraphEntity, GraphRelation } from '../../types/knowledgeGraph'
import { ENTITY_TYPE_CONFIG, RELATION_TYPE_CONFIG } from '../../types/knowledgeGraph'
import { runSimulation, getNodeRadius, type LayoutNode } from './graphEngine'

interface Props {
  entities: GraphEntity[]
  relations: GraphRelation[]
  selectedId: string | null
  onSelect: (id: string) => void
  highlightPath?: string[]
  highlightNeighbors?: Set<string>
  theme: 'dark' | 'light'
  layoutVersion: number
}

export function GraphCanvas(props: Props) {
  const { entities, relations, selectedId, onSelect,
    highlightPath, highlightNeighbors, theme, layoutVersion } = props

  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 900, h: 600 })
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, scale: 1 })
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null)
  const [layout, setLayout] = useState<LayoutNode[]>([])
  const [links, setLinks] = useState<{ id: string; sid: string; tid: string; color: string; dash?: string }[]>([])
  const computingRef = useRef(false)
  const prevHashRef = useRef('')

  // ── 数据哈希，检测真正的数据变化 ──
  const dataHash = useMemo(() => {
    // 用所有 entity id 的排序后的连接作为指纹，确保内容变化能被检测
    const eIds = entities.map(e => e.id).sort().join(',')
    return `${entities.length}:${relations.length}:${eIds}:${size.w}x${size.h}:${layoutVersion}`
  }, [entities, relations, size, layoutVersion])

  // ── resize ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let t: ReturnType<typeof setTimeout>
    const obs = new ResizeObserver(entries => {
      clearTimeout(t)
      t = setTimeout(() => setSize({ w: entries[0].contentRect.width, h: entries[0].contentRect.height }), 250)
    })
    obs.observe(el)
    setSize({ w: el.clientWidth || 900, h: el.clientHeight || 600 })
    return () => { obs.disconnect(); clearTimeout(t) }
  }, [])

  // ── 布局计算（仅在数据真正变化时执行）──
  useEffect(() => {
    if (entities.length === 0 || size.w < 50) return
    if (dataHash === prevHashRef.current) return
    prevHashRef.current = dataHash
    if (computingRef.current) return
    computingRef.current = true

    const tid = setTimeout(() => {
      const MAX = 400
      let ents = entities
      if (ents.length > MAX) {
        const pri = ents.filter(e => e.tags?.includes('category'))
        const rest = ents.filter(e => !e.tags?.includes('category'))
        ents = [...pri, ...rest.slice(0, MAX - pri.length)]
      }
      const result = runSimulation(ents, relations, {
        width: size.w, height: size.h,
        chargeStrength: -150, linkDistance: 80,
        collideRadius: 22, iterations: 50,
      })

      // 过滤掉坐标为 NaN 的节点（d3-force 边界情况）
      const validNodes = result.nodes.filter(n => isFinite(n.x ?? NaN) && isFinite(n.y ?? NaN))

      setLayout(validNodes)

      const nodeIds = new Set(validNodes.map(n => n.id))
      const ls = result.links
        .filter(l => {
          const sid = typeof l.source === 'object' ? (l.source as LayoutNode).id : String(l.source)
          const tid = typeof l.target === 'object' ? (l.target as LayoutNode).id : String(l.target)
          return nodeIds.has(sid) && nodeIds.has(tid)
        })
        .slice(0, 400)
        .map(l => {
          const src = (typeof l.source === 'object' ? l.source : { id: String(l.source) }) as LayoutNode
          const tgt = (typeof l.target === 'object' ? l.target : { id: String(l.target) }) as LayoutNode
          const rCfg = RELATION_TYPE_CONFIG[l.relation.type] ?? { label: l.relation.type, color: '#555' }
          return { id: l.id, sid: src.id, tid: tgt.id, color: rCfg.color, dash: rCfg.dash }
        })
      setLinks(ls)
      computingRef.current = false
    }, 50)
    return () => { computingRef.current = false; clearTimeout(tid) }
  }, [dataHash])

  // ── 缩放 ──
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.85 : 1.18
    setViewBox(prev => {
      const ns = Math.max(0.05, Math.min(8, prev.scale * delta))
      const el = containerRef.current
      if (!el) return { ...prev, scale: ns }
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const r = 1 - ns / prev.scale
      return { x: prev.x + r * mx, y: prev.y + r * my, scale: ns }
    })
  }, [])

  // ── 拖拽平移 ──
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest('.kg-node-group')) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, vx: viewBox.x, vy: viewBox.y }
  }, [viewBox])

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return
    setViewBox(prev => {
      // 屏幕像素差 ÷ 缩放比例 = 布局空间位移
      let nx = dragRef.current!.vx + (e.clientX - dragRef.current!.sx) / prev.scale
      let ny = dragRef.current!.vy + (e.clientY - dragRef.current!.sy) / prev.scale
      // 限制平移范围，防止拖出太远导致黑屏
      const maxPan = 3000
      nx = Math.max(-maxPan, Math.min(maxPan, nx))
      ny = Math.max(-maxPan, Math.min(maxPan, ny))
      return { ...prev, x: nx, y: ny }
    })
  }, [])
  const handlePanEnd = useCallback(() => { dragRef.current = null }, [])

  // ── 高亮 ──
  const highlightNodeIds = useMemo(() => {
    if (selectedId && highlightNeighbors) return highlightNeighbors
    if (highlightPath?.length) return new Set(highlightPath)
    return null
  }, [selectedId, highlightNeighbors, highlightPath])

  // ── 链接数据（通过 nodeId 定位坐标）──
  type LinkLine = { id: string; x1: number; y1: number; x2: number; y2: number; color: string; dash?: string }
  const linkLines = useMemo((): LinkLine[] => {
    if (layout.length === 0 || links.length === 0) return []
    const nodePos = new Map<string, { x: number; y: number; r: number }>()
    for (const n of layout) nodePos.set(n.id, { x: n.x!, y: n.y!, r: getNodeRadius(n.entity) })
    const result: LinkLine[] = []
    for (const l of links) {
      const s = nodePos.get(l.sid)
      const t = nodePos.get(l.tid)
      if (!s || !t) continue
      const dx = t.x - s.x
      const dy = t.y - s.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 2) continue
      const sr = s.r / dist, tr = (dist - t.r) / dist
      result.push({
        id: l.id,
        x1: s.x + dx * sr, y1: s.y + dy * sr,
        x2: s.x + dx * tr, y2: s.y + dy * tr,
        color: l.color, dash: l.dash,
      })
    }
    return result
  }, [layout, links])

  const isDark = theme === 'dark'

  // ── Viewport culling (correct formula) ──
  const vx = viewBox.x, vy = viewBox.y, s = viewBox.scale
  const W = size.w, H = size.h
  const margin = 300

  // 可见布局范围: layout_x * s + vx ∈ [0, W] → layout_x ∈ [-vx/s, (W-vx)/s]
  const lxMin = -vx / s - margin
  const lxMax = (W - vx) / s + margin
  const lyMin = -vy / s - margin
  const lyMax = (H - vy) / s + margin

  if (entities.length === 0) {
    return (
      <div ref={containerRef} className="kg-canvas" style={{ background: isDark ? 'transparent' : '#fafafa' }}>
        <div className="kg-canvas-empty">
          <div className="kg-canvas-empty-icon">🕸️</div>
          <div className="kg-canvas-empty-text">暂无图谱数据</div>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="kg-canvas" style={{ background: isDark ? 'transparent' : '#fafafa' }}>
      <svg width={W} height={H}
        onWheel={handleWheel}
        onMouseDown={handlePanStart}
        onMouseMove={handlePanMove}
        onMouseUp={handlePanEnd}
        onMouseLeave={handlePanEnd}
        style={{ cursor: dragRef.current ? 'grabbing' : 'grab', willChange: 'transform' }}
      >
        <g transform={`translate(${vx},${vy}) scale(${s})`}>

          {/* ── Links ── */}
          {linkLines.slice(0, 400).map(l => (
            <line
              key={l.id}
              x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke={l.color}
              strokeOpacity={0.25}
              strokeWidth={0.8}
              strokeDasharray={l.dash || 'none'}
            />
          ))}

          {/* ── Nodes ── */}
          {layout.map(node => {
            const nx = node.x!, ny = node.y!
            // viewport culling
            if (nx < lxMin || nx > lxMax || ny < lyMin || ny > lyMax) return null

            const e = node.entity
            const cfg = ENTITY_TYPE_CONFIG[e.type] ?? ENTITY_TYPE_CONFIG.unknown
            const r = getNodeRadius(e)
            const isSel = node.id === selectedId
            const dimmed = highlightNodeIds ? (!isSel && !highlightNodeIds.has(node.id)) : false
            const opacity = dimmed ? 0.12 : 0.85
            const isCat = e.tags?.includes('category')
            const isDb = e.type === 'database'
            const cr = r * (isCat ? 1.3 : 1)

            // ── 数据库实体 → ER 图矩形风格 ──
            if (isDb) {
              const rw = cr * 1.8  // 矩形半宽
              const rh = cr * 1.0  // 矩形半高
              return (
                <g key={node.id} transform={`translate(${nx},${ny})`}
                  style={{ cursor: 'pointer' }}
                  onClick={ev => { ev.stopPropagation(); onSelect(node.id) }}
                >
                  <rect x={-rw} y={-rh} width={rw * 2} height={rh * 2} rx={4}
                    fill={isSel ? cfg.color : (isDark ? '#0d1a0d' : '#e8f5e9')}
                    stroke={isSel ? '#fff' : cfg.color}
                    strokeWidth={isSel ? 2 : 1.2}
                    opacity={opacity}
                  />
                  <text y={rh + 11} textAnchor="middle"
                    fill={isDark ? '#aaa' : '#555'}
                    fontSize={9} opacity={opacity} fontWeight={600}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {cfg.icon} {e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name}
                  </text>
                </g>
              )
            }

            // ── 普通实体 → 圆形节点 ──
            return (
              <g key={node.id} transform={`translate(${nx},${ny})`}
                style={{ cursor: 'pointer' }}
                onClick={ev => { ev.stopPropagation(); onSelect(node.id) }}
              >
                <circle r={cr}
                  fill={isSel ? cfg.color : (isDark ? '#111' : '#f0f0f0')}
                  stroke={isSel ? '#fff' : cfg.color}
                  strokeWidth={isCat ? 2 : 1.2}
                  opacity={opacity}
                />
                <text y={1} textAnchor="middle" dominantBaseline="central"
                  fontSize={isCat ? 13 : 10} opacity={opacity}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {cfg.icon}
                </text>
                <text y={cr + 11} textAnchor="middle"
                  fill={isDark ? '#999' : '#555'}
                  fontSize={isCat ? 9 : 8} opacity={opacity}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {e.name.length > 14 ? e.name.slice(0, 13) + '…' : e.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
