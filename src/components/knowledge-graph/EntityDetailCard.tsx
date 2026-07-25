import type { GraphEntity, GraphRelation } from '../../types/knowledgeGraph'
import { ENTITY_TYPE_CONFIG, RELATION_TYPE_CONFIG } from '../../types/knowledgeGraph'

interface Props {
  entity: GraphEntity
  entities: GraphEntity[]
  relations: GraphRelation[]
  onClose: () => void
  onNavigate: (id: string) => void
  theme: 'dark' | 'light'
}

export function EntityDetailCard({ entity, entities, relations, onClose, onNavigate, theme }: Props) {
  const isDark = theme === 'dark'
  const cfg = ENTITY_TYPE_CONFIG[entity.type] || ENTITY_TYPE_CONFIG.unknown

  // 与此实体相关的关系
  const relatedRelations = relations.filter(r => r.sourceId === entity.id || r.targetId === entity.id)

  function getRelatedEntity(id: string): GraphEntity | undefined {
    return entities.find(e => e.id === id)
  }

  return (
    <div className="kg-detail-overlay">
      {/* Header */}
      <div className="kg-detail-header">
        <span className="kg-detail-icon">{cfg.icon}</span>
        <span className="kg-detail-title">{entity.name}</span>
        <button className="kg-detail-close" onClick={onClose}>✕</button>
      </div>

      {/* Body */}
      <div className="kg-detail-body">
        {/* 描述 */}
        {entity.description && (
          <div className="kg-detail-section">
            <div className="kg-detail-section-title">描述</div>
            <div className="kg-detail-desc">{entity.description}</div>
          </div>
        )}

        {/* 元数据 */}
        <div className="kg-detail-section">
          <div className="kg-detail-section-title">属性</div>
          <div className="kg-detail-meta">
            <div><span className="kg-detail-meta-key">类型:</span> {cfg.icon} {cfg.label}</div>
            {entity.filePath && <div><span className="kg-detail-meta-key">文件:</span> {entity.filePath}</div>}
            {entity.lineNumber && <div><span className="kg-detail-meta-key">行号:</span> {entity.lineNumber}</div>}
            <div><span className="kg-detail-meta-key">ID:</span> <code style={{ fontSize: 10, opacity: 0.6 }}>{entity.id}</code></div>
          </div>
        </div>

        {/* 标签 */}
        {entity.tags.length > 0 && (
          <div className="kg-detail-section">
            <div className="kg-detail-section-title">标签</div>
            <div>
              {entity.tags.map(tag => (
                <span key={tag} className="kg-detail-tag">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* 关联关系 */}
        <div className="kg-detail-section">
          <div className="kg-detail-section-title">
            关联关系 ({relatedRelations.length})
          </div>
          {relatedRelations.length === 0 ? (
            <div style={{ fontSize: 11, color: '#666', fontStyle: 'italic' }}>无关联关系</div>
          ) : (
            <ul className="kg-detail-relations">
              {relatedRelations.slice(0, 20).map(r => {
                const rCfg = RELATION_TYPE_CONFIG[r.type] || { label: r.type, color: '#888' }
                const isOutgoing = r.sourceId === entity.id
                const other = getRelatedEntity(isOutgoing ? r.targetId : r.sourceId)
                const oCfg = other ? (ENTITY_TYPE_CONFIG[other.type] || ENTITY_TYPE_CONFIG.unknown) : null
                if (!other) return null
                return (
                  <li key={r.id} className="kg-detail-relation" onClick={() => onNavigate(other.id)}>
                    <span className="kg-detail-relation-icon">{oCfg?.icon || '?'}</span>
                    <span style={{ flex: 1, fontSize: 11, color: isDark ? '#ccc' : '#555' }}>
                      {isOutgoing ? '→' : '←'} <strong>{rCfg.label}</strong> {other.name}
                    </span>
                    <span style={{ fontSize: 9, color: rCfg.color }}>{rCfg.label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* 元数据 (extra) */}
        {entity.metadata && Object.keys(entity.metadata).length > 0 && (
          <div className="kg-detail-section">
            <div className="kg-detail-section-title">额外属性</div>
            <div className="kg-detail-meta">
              {Object.entries(entity.metadata).map(([k, v]) => (
                <div key={k}><span className="kg-detail-meta-key">{k}:</span> {String(v).slice(0, 100)}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
