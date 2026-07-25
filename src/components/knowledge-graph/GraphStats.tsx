import type { GraphStats, EntityType } from '../../types/knowledgeGraph'
import { ENTITY_TYPE_CONFIG } from '../../types/knowledgeGraph'

interface Props {
  stats: GraphStats | null
  theme: 'dark' | 'light'
}

export function GraphStats({ stats, theme }: Props) {
  if (!stats) return null
  const isDark = theme === 'dark'

  return (
    <div className="kg-stats-panel">
      <div className="kg-stats-row">
        <span className="kg-stat-item">
          <span className="kg-stat-value">{stats.totalEntities}</span>
          <span className="kg-stat-label">实体</span>
        </span>
        <span className="kg-stat-item">
          <span className="kg-stat-value">{stats.totalRelations}</span>
          <span className="kg-stat-label">关系</span>
        </span>
        <span className="kg-stat-item">
          <span className="kg-stat-value">{stats.connectedComponents}</span>
          <span className="kg-stat-label">连通分量</span>
        </span>
        {stats.orphanCount > 0 && (
          <span className="kg-stat-item">
            <span className="kg-stat-value" style={{ color: '#e67e22' }}>{stats.orphanCount}</span>
            <span className="kg-stat-label">孤立节点</span>
          </span>
        )}
      </div>
      {/* 类型分布微条形图 */}
      {Object.keys(stats.entityTypeCount).length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.entries(stats.entityTypeCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 8)
            .map(([type, count]) => {
              const cfg = ENTITY_TYPE_CONFIG[type as EntityType] || ENTITY_TYPE_CONFIG.unknown
              const maxCount = Math.max(...Object.values(stats.entityTypeCount))
              return (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10 }}>
                  <span style={{ fontSize: 10 }}>{cfg.icon}</span>
                  <div style={{
                    width: Math.max(4, (count / maxCount) * 30),
                    height: 6,
                    background: cfg.color,
                    borderRadius: 3,
                    opacity: 0.7,
                  }} />
                  <span style={{ color: isDark ? '#999' : '#888', fontSize: 9 }}>{count}</span>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
