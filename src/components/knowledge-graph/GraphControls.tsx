interface Props {
  search: string
  onSearchChange: (v: string) => void
  onAnalyze: () => void
  onShowImport: () => void
  analyzing: boolean
  hasEntities: boolean
  onLayoutChange?: (layout: string) => void
  onToggleStats?: () => void
  showStats?: boolean
}

export function GraphControls({ search, onSearchChange, onAnalyze, onShowImport, analyzing, hasEntities }: Props) {
  return (
    <div className="kg-toolbar">
      <input
        type="text"
        className="kg-toolbar-search"
        placeholder="🔍 搜索实体..."
        value={search}
        onChange={e => onSearchChange(e.target.value)}
      />
      <div className="kg-toolbar-sep" />
      <button
        className="kg-toolbar-btn analyze"
        onClick={onAnalyze}
        disabled={analyzing}
        title="扫描项目文件结构生成图谱"
      >
        {analyzing ? '⏳ 分析中...' : '🔍 分析'}
      </button>
      {hasEntities && (
        <button
          className="kg-toolbar-btn"
          onClick={onShowImport}
          title="从 Claude 会话导入分析结果"
        >
          📥 导入
        </button>
      )}
    </div>
  )
}
