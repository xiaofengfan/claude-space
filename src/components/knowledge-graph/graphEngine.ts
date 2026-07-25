/**
 * 知识图谱力导向布局引擎
 * 基于 d3-force 计算节点位置，不依赖 DOM
 */
import {
  forceSimulation,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceLink,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import type { GraphEntity, GraphRelation } from '../../types/knowledgeGraph'

/** 布局后的节点 */
export interface LayoutNode extends SimulationNodeDatum {
  id: string
  entity: GraphEntity
  /** 是否为组节点（可展开） */
  isGroup?: boolean
  /** 子节点数 */
  childCount?: number
}

/** 布局后的边 */
export interface LayoutLink extends SimulationLinkDatum<LayoutNode> {
  id: string
  relation: GraphRelation
}

/** 布局结果 */
export interface LayoutResult {
  nodes: LayoutNode[]
  links: LayoutLink[]
}

/** 布局选项 */
export interface LayoutOptions {
  width: number
  height: number
  /** 节点间斥力强度 */
  chargeStrength?: number
  /** 链接弹簧距离 */
  linkDistance?: number
  /** 碰撞半径 */
  collideRadius?: number
  /** 向 x 中心聚集强度 */
  centerStrength?: number
  /** 迭代次数 */
  iterations?: number
}

const DEFAULT_OPTIONS: LayoutOptions = {
  width: 800,
  height: 600,
  chargeStrength: -300,
  linkDistance: 120,
  collideRadius: 30,
  centerStrength: 0.1,
  iterations: 120,
}

/** 实体类型 → 节点半径 */
export function getNodeRadius(entity: GraphEntity): number {
  switch (entity.type) {
    case 'module':
    case 'concept':
      return 28
    case 'file':
      return 22
    case 'class':
    case 'interface':
      return 20
    case 'function':
    case 'route':
    case 'api':
      return 16
    default:
      return 14
  }
}

/**
 * 运行力导向布局模拟
 */
export function runSimulation(
  entities: GraphEntity[],
  relations: GraphRelation[],
  options: Partial<LayoutOptions> = {}
): LayoutResult {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const width = opts.width
  const height = opts.height
  const chargeStrength = opts.chargeStrength!
  const linkDistance = opts.linkDistance!
  const collideRadius = opts.collideRadius!
  const centerStrength = opts.centerStrength!
  const iterations = opts.iterations!

  // 构建节点
  const nodeMap = new Map<string, GraphEntity>()
  for (const e of entities) {
    nodeMap.set(e.id, e)
  }

  const nodes: LayoutNode[] = entities
    .filter(e => e.type !== 'unknown') // 过滤未知类型
    .map(e => ({
      id: e.id,
      entity: e,
      // 保留之前固定的位置
      fx: e.fx ?? undefined,
      fy: e.fy ?? undefined,
    } as LayoutNode))

  const nodeIds = new Set(nodes.map(n => n.id))

  // 构建边（过滤掉节点不存在的边）
  const links: LayoutLink[] = relations
    .filter(r => nodeIds.has(r.sourceId) && nodeIds.has(r.targetId))
    .map(r => ({
      id: r.id,
      relation: r,
      source: r.sourceId,
      target: r.targetId,
    } as LayoutLink))

  // 创建力模拟
  const simulation = forceSimulation(nodes)
    .force('charge', forceManyBody().strength(chargeStrength))
    .force('center', forceCenter(width / 2, height / 2).strength(centerStrength))
    .force('collide', forceCollide(collideRadius))
    .force('link', forceLink(links).distance(linkDistance).id((d: any) => d.id))
    .force('x', forceX(width / 2).strength(0.05))
    .force('y', forceY(height / 2).strength(0.05))
    .stop()

  // 迭代计算
  simulation.tick(iterations)

  return { nodes, links }
}

/**
 * 计算图谱统计信息
 */
export function computeGraphStats(entities: GraphEntity[], relations: GraphRelation[]) {
  const entityTypeCount: Record<string, number> = {}
  const relationTypeCount: Record<string, number> = {}

  for (const e of entities) {
    entityTypeCount[e.type] = (entityTypeCount[e.type] || 0) + 1
  }
  for (const r of relations) {
    relationTypeCount[r.type] = (relationTypeCount[r.type] || 0) + 1
  }

  // 计算孤立节点（没有关联任何边的节点）
  const connectedIds = new Set<string>()
  for (const r of relations) {
    connectedIds.add(r.sourceId)
    connectedIds.add(r.targetId)
  }
  const orphanCount = entities.filter(e => !connectedIds.has(e.id)).length

  // 计算连通分量数（简单实现：BFS）
  const adj = new Map<string, string[]>()
  for (const r of relations) {
    if (!adj.has(r.sourceId)) adj.set(r.sourceId, [])
    if (!adj.has(r.targetId)) adj.set(r.targetId, [])
    adj.get(r.sourceId)!.push(r.targetId)
    adj.get(r.targetId)!.push(r.sourceId)
  }
  const visited = new Set<string>()
  let components = 0
  const allIds = entities.map(e => e.id)
  for (const id of allIds) {
    if (!visited.has(id)) {
      components++
      const queue = [id]
      while (queue.length > 0) {
        const cur = queue.pop()!
        if (visited.has(cur)) continue
        visited.add(cur)
        const neighbors = adj.get(cur) || []
        for (const n of neighbors) queue.push(n)
      }
    }
  }

  return {
    totalEntities: entities.length,
    totalRelations: relations.length,
    entityTypeCount,
    relationTypeCount,
    orphanCount,
    connectedComponents: components,
  }
}

/**
 * 用 BFS 找两个节点间的最短路径
 */
export function findShortestPath(
  entities: GraphEntity[],
  relations: GraphRelation[],
  sourceId: string,
  targetId: string
): string[] {
  if (sourceId === targetId) return [sourceId]
  const adj = new Map<string, string[]>()
  for (const r of relations) {
    if (!adj.has(r.sourceId)) adj.set(r.sourceId, [])
    if (!adj.has(r.targetId)) adj.set(r.targetId, [])
    adj.get(r.sourceId)!.push(r.targetId)
    adj.get(r.targetId)!.push(r.sourceId)
  }
  const visited = new Set<string>([sourceId])
  const prev = new Map<string, string | null>([[sourceId, null]])
  const queue = [sourceId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const neighbors = adj.get(cur) || []
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n)
        prev.set(n, cur)
        if (n === targetId) {
          // 重建路径
          const path: string[] = []
          let node: string | null = targetId
          while (node !== null) {
            path.unshift(node)
            node = prev.get(node) || null
          }
          return path
        }
        queue.push(n)
      }
    }
  }
  return [] // 无路径
}
