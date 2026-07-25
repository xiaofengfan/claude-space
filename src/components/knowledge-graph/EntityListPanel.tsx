import { useMemo } from 'react'
import type { GraphEntity, EntityType } from '../../types/knowledgeGraph'
import { ENTITY_TYPE_CONFIG } from '../../types/knowledgeGraph'

interface Props {
  entities: GraphEntity[]
  selectedId: string | null
  onSelect: (id: string) => void
  search: string
  onSearchChange: (v: string) => void
  typeFilter: string[]
  onTypeFilterChange: (types: string[]) => void
  theme: 'dark' | 'light'
}

export function EntityListPanel({
  entities, selectedId, onSelect, search, onSearchChange,
  typeFilter, onTypeFilterChange, theme,
}: Props) {
  const isDark = theme === 'dark'

  // 所有出现在实体中的类型
  const availableTypes = useMemo(() => {
    const set = new Set<string>()
    entities.forEach(e => set.add(e.type))
    return Array.from(set).sort()
  }, [entities])

  // 过滤后的实体
  const filtered = useMemo(() => {
    let list = entities
    if (typeFilter.length > 0) {
      list = list.filter(e => typeFilter.includes(e.type))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      )
    }
    return list
  }, [entities, typeFilter, search])

  return (
    <div className="kg-left">
      {/* 类型过滤芯片 */}
      <div className="kg-type-filter">
        <button
          className={`kg-type-chip${typeFilter.length === 0 ? ' active' : ''}`}
          onClick={() => onTypeFilterChange([])}
        >全部</button>
        {availableTypes.map(type => {
          const cfg = ENTITY_TYPE_CONFIG[type as EntityType] || ENTITY_TYPE_CONFIG.unknown
          return (
            <button
              key={type}
              className={`kg-type-chip${typeFilter.includes(type) ? ' active' : ''}`}
              onClick={() => {
                if (typeFilter.includes(type)) {
                  onTypeFilterChange(typeFilter.filter(t => t !== type))
                } else {
                  onTypeFilterChange([...typeFilter, type])
                }
              }}
              title={cfg.label}
            >{cfg.icon} {type}</button>
          )
        })}
      </div>

      {/* 实体列表 */}
      <div className="kg-list">
        {filtered.length === 0 ? (
          <div className="kg-list-empty">
            {search || typeFilter.length > 0 ? '无匹配结果' : '暂无实体，点击右上角「分析」生成'}
          </div>
        ) : (
          filtered.map(entity => {
            const cfg = ENTITY_TYPE_CONFIG[entity.type] || ENTITY_TYPE_CONFIG.unknown
            const isSel = entity.id === selectedId
            return (
              <div
                key={entity.id}
                className={`kg-list-item${isSel ? ' active' : ''}`}
                onClick={() => onSelect(entity.id)}
              >
                <span className="kg-list-icon">{cfg.icon}</span>
                <span className="kg-list-name" style={{ color: isDark ? '#ccc' : '#333' }}>
                  {entity.name}
                </span>
                <span className="kg-list-type" style={{ color: cfg.color }}>{cfg.label}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
