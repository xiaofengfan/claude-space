/**
 * 从 Claude 响应文本中解析结构化图谱数据
 * 支持 JSON 格式输出、Markdown 代码块、以及自然语言实体提取
 */
import type { GraphEntity, GraphRelation, EntityType, RelationType } from '../../types/knowledgeGraph'

interface ParsedResult {
  entities: GraphEntity[]
  relations: GraphRelation[]
  sourceText: string
}

/**
 * 尝试从 Claude 响应中提取 JSON 图谱数据
 */
export function parseGraphFromText(text: string, projectPath?: string): ParsedResult | null {
  if (!text?.trim()) return null

  // ── 1. 尝试提取 JSON 代码块 ──
  let jsonStr = ''
  const jsonBlock = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (jsonBlock) {
    jsonStr = jsonBlock[1].trim()
  } else {
    // 尝试直接匹配 JSON 对象
    const jsonMatch = text.match(/\{[\s\S]*"entities"[\s\S]*?\}/)
    if (jsonMatch) jsonStr = jsonMatch[0]
  }

  if (jsonStr) {
    try {
      const data = JSON.parse(jsonStr)
      return normalizeParsedData(data, projectPath)
    } catch {
      // JSON 解析失败，尝试修复常见问题后重试
      try {
        // 修复 trailing commas, unquoted keys 等
        const fixed = jsonStr
          .replace(/,(\s*[}\]])/g, '$1')  // 移除尾逗号
          .replace(/\n/g, ' ')            // 移除换行
        const data = JSON.parse(fixed)
        return normalizeParsedData(data, projectPath)
      } catch {
        // 仍然失败，尝试提取部分
        return extractEntitiesFromText(text, projectPath)
      }
    }
  }

  // ── 2. 无 JSON，尝试从文本中提取实体名 ──
  return extractEntitiesFromText(text, projectPath)
}

/**
 * 规范化解析的 JSON 数据
 */
function normalizeParsedData(data: any, projectPath?: string): ParsedResult {
  const now = new Date().toISOString()
  const entities: GraphEntity[] = []
  const relations: GraphRelation[] = []

  // 实体
  if (Array.isArray(data.entities)) {
    for (const e of data.entities) {
      if (!e.name) continue
      entities.push({
        id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: String(e.name).slice(0, 80),
        type: validateEntityType(e.type),
        description: String(e.description || e.desc || '').slice(0, 500),
        filePath: e.filePath || e.path || undefined,
        tags: Array.isArray(e.tags) ? e.tags.slice(0, 10) : [],
        metadata: e.metadata || (e.method ? { method: e.method, path: e.path } : undefined),
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  // 关系
  if (Array.isArray(data.relations)) {
    for (const r of data.relations) {
      const srcName = r.source || r.from || r.sourceId || ''
      const tgtName = r.target || r.to || r.targetId || ''
      if (!srcName || !tgtName) continue
      const srcEnt = entities.find(e => e.name === srcName)
      const tgtEnt = entities.find(e => e.name === tgtName)
      relations.push({
        id: `rel_ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sourceId: srcEnt?.id || srcName,
        targetId: tgtEnt?.id || tgtName,
        type: validateRelationType(r.type || r.relation),
        label: String(r.label || '').slice(0, 100),
        weight: typeof r.weight === 'number' ? r.weight : 0.5,
      })
    }
  }

  // 如果数据中有 dataFlow 字段，也提取为关系
  if (Array.isArray(data.dataFlow)) {
    for (const df of data.dataFlow) {
      if (df.path && Array.isArray(df.path) && df.path.length >= 2) {
        for (let i = 0; i < df.path.length - 1; i++) {
          relations.push({
            id: `rel_flow_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
            sourceId: String(df.path[i]),
            targetId: String(df.path[i + 1]),
            type: 'depends_on',
            label: df.description || '数据流',
            weight: 0.7,
          })
        }
      }
    }
  }

  return { entities, relations, sourceText: JSON.stringify(data).slice(0, 1000) }
}

/**
 * 从纯文本中提取可能的实体名
 */
function extractEntitiesFromText(text: string, projectPath?: string): ParsedResult | null {
  const entities: GraphEntity[] = []
  const now = new Date().toISOString()

  // ── 匹配代码文件路径（如 src/main.ts, app/controllers/user.js）──
  const filePathRe = /(?:^|\s)([a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})(?:\s|$|,|\.)/gm
  let match
  const seenPaths = new Set<string>()
  while ((match = filePathRe.exec(text)) !== null) {
    const fp = match[1]
    if (seenPaths.has(fp)) continue
    seenPaths.add(fp)

    // 推断类型
    let type: EntityType = 'file'
    const lower = fp.toLowerCase()
    if (lower.includes('controller') || lower.includes('handler') || lower.includes('router') || lower.includes('route')) type = 'api'
    else if (lower.includes('model') || lower.includes('entity') || lower.includes('schema') || lower.includes('migration') || lower.includes('repository')) type = 'database'
    else if (lower.includes('config') || lower.includes('.json') || lower.includes('.yaml') || lower.includes('.env')) type = 'config'
    else if (lower.includes('test') || lower.includes('spec')) type = 'test'
    else if (lower.includes('component') || lower.includes('.tsx') || lower.includes('.jsx') || lower.includes('.vue')) type = 'class'

    const name = fp.split('/').pop() || fp
    entities.push({
      id: `ai_ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type,
      description: `从 AI 分析中提取: ${fp}`,
      filePath: fp,
      tags: [type],
      createdAt: now,
      updatedAt: now,
    })
  }

  // ── 匹配模块/概念名（中文或英文大写开头）──
  const moduleRe = /(?:模块|服务|组件|系统)[：:]\s*(.+?)(?:[，,\n]|$)/g
  while ((match = moduleRe.exec(text)) !== null) {
    const name = match[1].trim().slice(0, 50)
    if (!name) continue
    entities.push({
      id: `ai_mod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type: 'module',
      description: `从 AI 分析中提取的模块: ${name}`,
      tags: ['module', 'ai-extracted'],
      createdAt: now,
      updatedAt: now,
    })
  }

  if (entities.length === 0) return null
  return { entities, relations: [], sourceText: text.slice(0, 500) }
}

function validateEntityType(type: string): EntityType {
  const valid: EntityType[] = ['module','file','class','function','interface','type','route','api','concept','pattern','dependency','database','config','test','script','unknown']
  return valid.includes(type as EntityType) ? (type as EntityType) : 'module'
}

function validateRelationType(type: string): RelationType {
  const valid: RelationType[] = ['imports','exports','extends','implements','contains','depends_on','calls','defines','composes','relates_to','inherits','implements_interface','uses','references','configures']
  return valid.includes(type as RelationType) ? (type as RelationType) : 'depends_on'
}
