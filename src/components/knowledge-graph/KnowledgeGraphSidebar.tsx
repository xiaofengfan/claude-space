import { useState, useEffect, useCallback, useMemo } from 'react'
import type { GraphEntity, GraphRelation } from '../../types/knowledgeGraph'
import { ENTITY_TYPE_CONFIG, RELATION_TYPE_CONFIG } from '../../types/knowledgeGraph'
import { computeGraphStats } from './graphEngine'
import { GraphConfigDialog } from './GraphConfigDialog'
import { AIGraphDialog } from './AIGraphDialog'
import { parseGraphFromText } from './graphParser'

interface Props {
  projectPath: string
  theme: 'dark' | 'light'
  onOpenGraph: () => void
  /** 刷新触发器（值变化时重新加载图谱数据） */
  refreshTrigger?: number
}

/** 功能分类分组 */
interface CategoryGroup {
  key: string
  label: string
  icon: string
  color: string
  entities: GraphEntity[]
}

/** 实体详情弹窗 */
function EntityDetailDialog({
  entity,
  relations,
  entities,
  theme,
  onClose,
}: {
  entity: GraphEntity
  relations: GraphRelation[]
  entities: GraphEntity[]
  theme: 'dark' | 'light'
  onClose: () => void
}) {
  const isDark = theme === 'dark'
  const cfg = ENTITY_TYPE_CONFIG[entity.type] || ENTITY_TYPE_CONFIG.unknown

  // 找出与该实体相关的所有关系
  const relatedRelations = useMemo(() => {
    return relations
      .filter(r => r.sourceId === entity.id || r.targetId === entity.id)
      .map(r => {
        const source = entities.find(e => e.id === r.sourceId)
        const target = entities.find(e => e.id === r.targetId)
        const relCfg = RELATION_TYPE_CONFIG[r.type] || { label: r.type, color: '#888' }
        const direction = r.sourceId === entity.id ? 'outgoing' : 'incoming'
        const otherEntity = direction === 'outgoing' ? target : source
        return { relation: r, source, target, relCfg, direction, otherEntity }
      })
      .filter(r => r.otherEntity)
  }, [entity, relations, entities])

  const rowStyle: React.CSSProperties = {
    display: 'flex', gap: 8, padding: '6px 0',
    borderBottom: `1px solid ${isDark ? '#2a2a2a' : '#eee'}`,
    fontSize: 12,
  }
  const keyStyle: React.CSSProperties = {
    minWidth: 70, color: isDark ? '#888' : '#666', fontWeight: 600, flexShrink: 0,
  }
  const valStyle: React.CSSProperties = {
    flex: 1, color: isDark ? '#ddd' : '#333', wordBreak: 'break-all', whiteSpace: 'pre-wrap',
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}
        style={{ width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>{cfg.icon}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entity.name}
            </span>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10,
              background: cfg.color + '20', color: cfg.color, fontWeight: 600,
            }}>{cfg.label}</span>
          </h2>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div className="dialog-body" style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {/* 基本属性 */}
          {entity.description && (
            <div style={rowStyle}>
              <span style={keyStyle}>描述</span>
              <span style={valStyle}>{entity.description}</span>
            </div>
          )}
          {entity.filePath && (
            <div style={rowStyle}>
              <span style={keyStyle}>文件路径</span>
              <span style={{ ...valStyle, fontFamily: 'Consolas, monospace', fontSize: 11, color: isDark ? '#7ee787' : '#0a7d32' }}>
                {entity.filePath}
              </span>
            </div>
          )}
          {entity.lineNumber != null && (
            <div style={rowStyle}>
              <span style={keyStyle}>行号</span>
              <span style={valStyle}>{entity.lineNumber}</span>
            </div>
          )}
          {entity.tags && entity.tags.length > 0 && (
            <div style={rowStyle}>
              <span style={keyStyle}>标签</span>
              <span style={valStyle}>
                {entity.tags.map(t => (
                  <span key={t} style={{
                    display: 'inline-block', padding: '1px 6px', margin: '2px 4px 2px 0',
                    fontSize: 10, borderRadius: 3,
                    background: isDark ? '#1a1a2a' : '#eee',
                    color: isDark ? '#aac' : '#556',
                  }}>{t}</span>
                ))}
              </span>
            </div>
          )}
          {entity.metadata && Object.keys(entity.metadata).length > 0 && (
            <div style={rowStyle}>
              <span style={keyStyle}>元数据</span>
              <span style={{ ...valStyle, fontFamily: 'Consolas, monospace', fontSize: 11 }}>
                {Object.entries(entity.metadata).map(([k, v]) => (
                  <div key={k}>
                    <span style={{ color: isDark ? '#888' : '#999' }}>{k}: </span>
                    <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
              </span>
            </div>
          )}
          <div style={rowStyle}>
            <span style={keyStyle}>创建时间</span>
            <span style={valStyle}>{new Date(entity.createdAt).toLocaleString('zh-CN')}</span>
          </div>
          <div style={rowStyle}>
            <span style={keyStyle}>更新时间</span>
            <span style={valStyle}>{new Date(entity.updatedAt).toLocaleString('zh-CN')}</span>
          </div>

          {/* 相关关系 */}
          <div style={{
            marginTop: 12, padding: '8px 10px',
            background: isDark ? '#141414' : '#f5f5f5',
            borderRadius: 6, fontSize: 12, fontWeight: 600,
            color: isDark ? '#ccc' : '#555',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            🔗 相关关系 ({relatedRelations.length})
          </div>
          {relatedRelations.length === 0 ? (
            <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: '#888' }}>
              无相关关系
            </div>
          ) : (
            <div style={{ marginTop: 4 }}>
              {relatedRelations.map(({ relation, source, target, relCfg, direction, otherEntity }) => (
                <div key={relation.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 8px', margin: '2px 0', borderRadius: 3,
                  background: isDark ? '#0d0d0d' : '#fafafa',
                  fontSize: 11,
                }}>
                  {direction === 'outgoing' ? (
                    <>
                      <span style={{ color: cfg.color, fontWeight: 600 }}>→</span>
                      <span style={{
                        padding: '1px 6px', borderRadius: 3,
                        background: relCfg.color + '20', color: relCfg.color, fontSize: 10,
                      }}>{relCfg.label}</span>
                      <span style={{ flex: 1, color: isDark ? '#ddd' : '#333' }}>
                        {otherEntity?.name}
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: '#888', fontWeight: 600 }}>←</span>
                      <span style={{ flex: 1, color: isDark ? '#ddd' : '#333' }}>
                        {otherEntity?.name}
                      </span>
                      <span style={{
                        padding: '1px 6px', borderRadius: 3,
                        background: relCfg.color + '20', color: relCfg.color, fontSize: 10,
                      }}>{relCfg.label}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="dialog-footer" style={{ flexShrink: 0 }}>
          <button className="btn btn-cancel" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

export function KnowledgeGraphSidebar({ projectPath, theme, onOpenGraph, refreshTrigger }: Props) {
  const [entities, setEntities] = useState<GraphEntity[]>([])
  const [relations, setRelations] = useState<GraphRelation[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showConfig, setShowConfig] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState<GraphEntity | null>(null)
  const [sidebarTab, setSidebarTab] = useState<'modules' | 'relations'>('modules')
  const isDark = theme === 'dark'

  const loadData = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const r = await window.electronAPI.graphLoad(projectPath)
      if (r.success && r.data) {
        setEntities(r.data.entities || [])
        setRelations(r.data.relations || [])
      }
    } catch {}
    setLoading(false)
  }, [projectPath])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 外部触发刷新（AI 分析完成后 refreshTrigger 递增）
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      loadData()
    }
  }, [refreshTrigger, loadData])

  const stats = useMemo(() => {
    if (entities.length === 0) return null
    return computeGraphStats(entities, relations)
  }, [entities, relations])

  // ── 按业务模块/分类标签分组 ──
  const categoryGroups = useMemo((): CategoryGroup[] => {
    // 模块类型 → 分组配置（新模板：metadata.moduleType）
    const MODULE_TYPE_CFG: Record<string, { label: string; icon: string; color: string }> = {
      core:        { label: '核心业务', icon: '🎯', color: '#e74c3c' },
      business:    { label: '业务功能', icon: '🧩', color: '#4a5cf7' },
      infra:       { label: '基础设施', icon: '🔧', color: '#7f8c8d' },
      integration: { label: '集成模块', icon: '🔗', color: '#9b59b6' },
      common:      { label: '通用组件', icon: '📦', color: '#34495e' },
    }
    // 旧数据的 tag 分组
    const OLD_TAG_CFG: Record<string, { label: string; icon: string; color: string }> = {
      core:     { label: '核心业务',  icon: '🎯', color: '#e74c3c' },
      api:      { label: 'API/接口',  icon: '🔗', color: '#9b59b6' },
      data:     { label: '数据层',    icon: '🗄️', color: '#27ae60' },
      ui:       { label: 'UI/前端',   icon: '🎨', color: '#e67e22' },
      config:   { label: '配置',      icon: '⚙️', color: '#7f8c8d' },
      test:     { label: '测试',      icon: '🧪', color: '#2c3e50' },
      infra:    { label: '基础设施',  icon: '🔧', color: '#7f8c8d' },
      tool:     { label: '工具',      icon: '🔨', color: '#f39c12' },
      doc:      { label: '文档',      icon: '📄', color: '#95a5a6' },
      electron: { label: 'Electron',  icon: '⚡', color: '#3498db' },
    }
    const ALL_CFG: Record<string, { label: string; icon: string; color: string }> = {
      ...MODULE_TYPE_CFG,
      ...OLD_TAG_CFG,
      other: { label: '其他', icon: '📦', color: '#95a5a6' },
    }

    // 构建 contains 关系映射（子功能 → 父模块）
    const childToParentId = new Map<string, string>()
    for (const r of relations) {
      if (r.type === 'contains') childToParentId.set(r.targetId, r.sourceId)
    }

    // 为每个实体确定分组 key
    const getGroupKey = (e: GraphEntity): string => {
      // 1. 优先检查 metadata.moduleType（新模板）
      const mt = (e.metadata as any)?.moduleType as string | undefined
      if (mt && MODULE_TYPE_CFG[mt]) return mt
      // 2. 检查 tags 中的分类标签（旧数据或新模板的 business tag）
      const catTag = e.tags?.find(t => Object.keys(ALL_CFG).includes(t))
      if (catTag) return catTag === 'business' ? 'business' : catTag
      // 3. 子功能通过 contains 关系找父模块
      if (e.tags?.includes('sub-module')) {
        const parentId = childToParentId.get(e.id)
        if (parentId) {
          const parent = entities.find(en => en.id === parentId)
          if (parent) return getGroupKey(parent)
        }
      }
      return 'other'
    }

    // 分组
    const tagGroups = new Map<string, GraphEntity[]>()
    for (const e of entities) {
      const key = getGroupKey(e)
      if (!tagGroups.has(key)) tagGroups.set(key, [])
      tagGroups.get(key)!.push(e)
    }

    // 构建结果
    const result: CategoryGroup[] = []
    for (const [key, list] of tagGroups) {
      const cfg = ALL_CFG[key] || ALL_CFG.other
      result.push({
        key, label: cfg.label, icon: cfg.icon, color: cfg.color,
        entities: list.slice(0, 20),
      })
    }

    // 排序
    const order = ['core', 'business', 'api', 'data', 'ui', 'integration', 'infra', 'common', 'config', 'test', 'tool', 'doc', 'electron', 'other']
    result.sort((a, b) => {
      const ai = order.indexOf(a.key)
      const bi = order.indexOf(b.key)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
    return result
  }, [entities, relations])

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  // ── 分析（扫描项目并重建图谱数据）──
  const handleAnalyze = useCallback(async () => {
    if (!projectPath) return
    setAnalyzing(true)
    try {
      const r = await window.electronAPI.graphAnalyze(projectPath)
      if (r.success && r.data) {
        setEntities(r.data.entities || [])
        setRelations(r.data.relations || [])
        await window.electronAPI.graphSave(projectPath, r.data)
      }
    } catch {}
    setAnalyzing(false)
  }, [projectPath])

  // ── 刷新（重新加载已保存的图谱数据）──
  const handleRefresh = useCallback(() => {
    loadData()
  }, [loadData])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Action bar */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4, flexShrink: 0 }}>
        <button className="kg-toolbar-btn" onClick={handleRefresh} disabled={loading}
          style={{ flex: 1 }}
          title="重新加载已保存的图谱数据">
          {loading ? '⏳' : '🔄 刷新'}
        </button>
        <button className="kg-toolbar-btn" onClick={() => setShowAI(true)}
          title="AI 智能分析">
          🤖 AI
        </button>
        <button className="kg-toolbar-btn" onClick={() => setShowConfig(true)}
          style={{ width: 28 }}
          title="分析配置">
          ⚙
        </button>
      </div>

      {/* Tab: 模块列表 / 依赖关系列表 */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          onClick={() => setSidebarTab('modules')}
          style={{
            flex: 1, padding: '8px 6px', border: 'none', background: 'transparent',
            color: sidebarTab === 'modules' ? '#fff' : '#888', fontSize: 11, cursor: 'pointer',
            borderBottom: sidebarTab === 'modules' ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >🧩 模块列表</button>
        <button
          onClick={() => setSidebarTab('relations')}
          style={{
            flex: 1, padding: '8px 6px', border: 'none', background: 'transparent',
            color: sidebarTab === 'relations' ? '#fff' : '#888', fontSize: 11, cursor: 'pointer',
            borderBottom: sidebarTab === 'relations' ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >🔗 依赖关系</button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, justifyContent: 'space-between' }}>
            <span style={{ color: isDark ? '#aaa' : '#666' }}>
              <strong style={{ color: isDark ? '#fff' : '#222' }}>{stats.totalEntities}</strong> 实体
            </span>
            <span style={{ color: isDark ? '#aaa' : '#666' }}>
              <strong style={{ color: isDark ? '#fff' : '#222' }}>{stats.totalRelations}</strong> 关系
            </span>
            <span style={{ color: isDark ? '#aaa' : '#666' }}>
              <strong style={{ color: stats.connectedComponents > 1 ? '#e67e22' : (isDark ? '#fff' : '#222') }}>{stats.connectedComponents}</strong> 模块
            </span>
          </div>
        </div>
      )}

      {/* ── 模块列表 ────────────────────────────────── */}
      {sidebarTab === 'modules' && (
      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
        {categoryGroups.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: '#666' }}>
            {loading ? '加载中...' : '点击「⚙」配置分析选项后点「🤖 AI」分析'}
          </div>
        ) : (
          categoryGroups.map(group => {
            const isCollapsed = collapsed.has(group.key)
            return (
              <div key={group.key} style={{ marginBottom: 2 }}>
                {/* Group header */}
                <div
                  onClick={() => toggleCollapse(group.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    transition: 'background .1s',
                    fontWeight: 600, fontSize: 12,
                    color: isDark ? '#ddd' : '#444',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isDark ? '#1a1a2a' : '#f0f0f5' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <span style={{
                    fontSize: 10, transition: 'transform .2s',
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  }}>▼</span>
                  <span style={{ fontSize: 14 }}>{group.icon}</span>
                  <span style={{ flex: 1 }}>{group.label}</span>
                  <span style={{ fontSize: 10, color: '#666', padding: '1px 6px', background: isDark ? '#1a1a1a' : '#eee', borderRadius: 8 }}>
                    {group.entities.length}
                  </span>
                </div>

                {/* Group items */}
                {!isCollapsed && (
                  <div style={{ paddingLeft: 8 }}>
                    {group.entities.map(e => {
                      const cfg = ENTITY_TYPE_CONFIG[e.type as keyof typeof ENTITY_TYPE_CONFIG] || ENTITY_TYPE_CONFIG.unknown
                      const isCat = e.tags?.includes('category')
                      return (
                        <div key={e.id}
                          onClick={() => setSelectedEntity(e)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: isCat ? '3px 10px' : '3px 10px 3px 24px',
                            cursor: 'pointer',
                            borderRadius: 3, margin: '0 4px', fontSize: 11,
                            color: isCat ? (isDark ? '#ccc' : '#555') : (isDark ? '#aaa' : '#666'),
                            fontWeight: isCat ? 600 : 400,
                            transition: 'background .1s',
                          }}
                          onMouseEnter={en => { (en.currentTarget as HTMLElement).style.background = isDark ? '#222' : '#f5f5f5' }}
                          onMouseLeave={en => { (en.currentTarget as HTMLElement).style.background = 'transparent' }}
                        >
                          <span style={{ fontSize: 11, width: 16, textAlign: 'center' }}>
                            {cfg.icon}
                          </span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.name}
                          </span>
                          {isCat && (
                            <span style={{ fontSize: 8, color: cfg.color, opacity: 0.7 }}>
                              {(e.metadata as any)?.dirCount ? `${(e.metadata as any).dirCount}目录` : cfg.label}
                            </span>
                          )}
                          {!isCat && e.filePath && (
                            <span style={{ fontSize: 8, color: '#555', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {e.filePath.split('/').pop()}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      )}

      {/* Footer */}
      <div style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', fontSize: 9, color: '#555', flexShrink: 0 }}>
        {stats ? `${categoryGroups.length} 功能分类 · ${stats.totalEntities} 实体` : '—'}
      </div>

      {/* ── 依赖关系列表 ──────────────────────────── */}
      {sidebarTab === 'relations' && (
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {relations.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: '#666' }}>
            {loading ? '加载中...' : '暂无依赖关系数据'}
          </div>
        ) : (
          <div>
            {relations.map(r => {
              const source = entities.find(e => e.id === r.sourceId)
              const target = entities.find(e => e.id === r.targetId)
              const relCfg = RELATION_TYPE_CONFIG[r.type] || { label: r.type, color: '#888' }
              if (!source || !target) return null
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 8px', margin: '2px 4px', borderRadius: 3,
                  fontSize: 11, cursor: 'pointer',
                  color: isDark ? '#ccc' : '#444',
                  transition: 'background .1s',
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isDark ? '#1a1a1a' : '#f0f0f0' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                  onClick={() => setSelectedEntity(source)}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {source.name}
                  </span>
                  <span style={{
                    padding: '1px 5px', borderRadius: 3, fontSize: 9, flexShrink: 0,
                    background: relCfg.color + '20', color: relCfg.color,
                  }}>{relCfg.label}</span>
                  <span style={{ fontSize: 9, color: '#555', flexShrink: 0 }}>→</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {target.name}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      {/* Entity detail dialog */}
      {selectedEntity && (
        <EntityDetailDialog
          entity={selectedEntity}
          relations={relations}
          entities={entities}
          theme={theme}
          onClose={() => setSelectedEntity(null)}
        />
      )}

      {/* AI dialog */}
      {showAI && (
        <AIGraphDialog
          theme={theme} projectPath={projectPath}
          onClose={() => setShowAI(false)}
          onExecute={(prompt, label) => {
            setShowAI(false)
            window.electronAPI.terminalInput(prompt + '\n')
          }}
          onImportFromText={(text) => {
            const parsed = parseGraphFromText(text, projectPath)
            if (parsed && parsed.entities.length > 0) {
              setEntities(prev => { const ids = new Set(prev.map(e => e.id)); return [...prev, ...parsed!.entities.filter(e => !ids.has(e.id))] })
              setRelations(prev => { const ids = new Set(prev.map(r => r.id)); return [...prev, ...parsed!.relations.filter(r => !ids.has(r.id))] })
              return { entities: parsed.entities.length, relations: parsed.relations.length }
            }
            return null
          }}
        />
      )}

      {/* Config dialog */}
      {showConfig && (
        <GraphConfigDialog
          theme={theme}
          projectPath={projectPath}
          onClose={() => setShowConfig(false)}
          onSave={(cfg) => { setShowConfig(false); handleAnalyze() }}
        />
      )}
    </div>
  )
}
