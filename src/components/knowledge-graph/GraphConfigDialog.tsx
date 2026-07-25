import { useState, useEffect, useCallback } from 'react'
import type { GraphAnalysisConfig } from '../../types/knowledgeGraph'
import { DEFAULT_GRAPH_CONFIG } from '../../types/knowledgeGraph'

interface Props {
  theme: 'dark' | 'light'
  projectPath: string
  onClose: () => void
  onSave: (config: GraphAnalysisConfig) => void
}

export function GraphConfigDialog({ theme, projectPath, onClose, onSave }: Props) {
  const isDark = theme === 'dark'
  const [config, setConfig] = useState<GraphAnalysisConfig>({ ...DEFAULT_GRAPH_CONFIG })
  const [loading, setLoading] = useState(true)

  // 字符串集合的输入态
  const [excludeDirs, setExcludeDirs] = useState('')
  const [excludeFiles, setExcludeFiles] = useState('')
  const [excludeExtensions, setExcludeExtensions] = useState('')
  const [excludeKeywords, setExcludeKeywords] = useState('')
  const [includeDirs, setIncludeDirs] = useState('')

  useEffect(() => {
    window.electronAPI.graphConfigLoad(projectPath).then(r => {
      if (r.success && r.config) {
        const cfg = r.config
        setConfig(cfg)
        setExcludeDirs(cfg.excludeDirs.join(', '))
        setExcludeFiles(cfg.excludeFiles.join(', '))
        setExcludeExtensions(cfg.excludeExtensions.join(', '))
        setExcludeKeywords(cfg.excludeContentKeywords.join(', '))
        setIncludeDirs(cfg.includeDirs.join(', '))
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [projectPath])

  const handleSave = useCallback(async () => {
    const finalConfig: GraphAnalysisConfig = {
      ...config,
      excludeDirs: excludeDirs.split(',').map(s => s.trim()).filter(Boolean),
      excludeFiles: excludeFiles.split(',').map(s => s.trim()).filter(Boolean),
      excludeExtensions: excludeExtensions.split(',').map(s => s.trim()).filter(s => s.startsWith('.')).filter(Boolean),
      excludeContentKeywords: excludeKeywords.split(',').map(s => s.trim()).filter(Boolean),
      includeDirs: includeDirs.split(',').map(s => s.trim()).filter(Boolean),
    }
    await window.electronAPI.graphConfigSave(projectPath, finalConfig)
    onSave(finalConfig)
  }, [config, excludeDirs, excludeFiles, excludeExtensions, excludeKeywords, includeDirs, projectPath, onSave])

  const sectionTitle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: isDark ? '#ddd' : '#444',
    marginBottom: 6, marginTop: 14,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11, color: isDark ? '#999' : '#777', display: 'block', marginBottom: 3,
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px', fontSize: 12,
    background: isDark ? '#1a1a1a' : '#fafafa',
    border: '1px solid var(--border)', borderRadius: 4,
    color: isDark ? '#e0e0e0' : '#333', outline: 'none',
    boxSizing: 'border-box',
  }

  const checkboxLabel: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
    color: isDark ? '#ccc' : '#444', cursor: 'pointer', padding: '3px 0',
  }

  if (loading) {
    return (
      <div className="dialog-overlay" onClick={onClose}>
        <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 520 }}>
          <div className="dialog-header"><h2>⚙️ 分析配置</h2></div>
          <div className="dialog-body" style={{ textAlign: 'center', padding: 40, color: '#666' }}>加载中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <h2>⚙️ 分析配置</h2>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>

        <div className="dialog-body" style={{ overflowY: 'auto', flex: 1 }}>
          {/* ── Include dirs ── */}
          <div style={sectionTitle}>📁 包含目录（空=全部）</div>
          <label style={labelStyle}>仅分析这些目录下的内容，逗号分隔</label>
          <input style={inputStyle} value={includeDirs} onChange={e => setIncludeDirs(e.target.value)}
            placeholder="例如: src, electron, public" />

          {/* ── Exclude dirs ── */}
          <div style={sectionTitle}>🚫 排除目录</div>
          <label style={labelStyle}>不会扫描这些目录，逗号分隔，支持 * 通配符</label>
          <input style={inputStyle} value={excludeDirs} onChange={e => setExcludeDirs(e.target.value)}
            placeholder="例如: node_modules, .git, dist, *.log" />

          {/* ── Exclude files ── */}
          <div style={sectionTitle}>📄 排除文件</div>
          <label style={labelStyle}>不会包含这些文件，逗号分隔，支持 * 通配符</label>
          <input style={inputStyle} value={excludeFiles} onChange={e => setExcludeFiles(e.target.value)}
            placeholder="例如: *.log, *.lock, *.map, *.min.js" />

          {/* ── Exclude extensions ── */}
          <div style={sectionTitle}>🔤 排除扩展名</div>
          <label style={labelStyle}>不会分析这些后缀的文件（以 . 开头）</label>
          <input style={inputStyle} value={excludeExtensions} onChange={e => setExcludeExtensions(e.target.value)}
            placeholder="例如: .log, .svg, .png, .woff" />

          {/* ── Content keywords ── */}
          <div style={sectionTitle}>🔍 内容关键词过滤</div>
          <label style={labelStyle}>包含这些关键词的文件将被排除（前2000字符扫描）</label>
          <input style={inputStyle} value={excludeKeywords} onChange={e => setExcludeKeywords(e.target.value)}
            placeholder="例如: console.log, debugger, TODO" />

          {/* ── Toggles ── */}
          <div style={sectionTitle}>⚙️ 分析选项</div>
          <div style={{ marginTop: 4 }}>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={config.includeTests} onChange={e => setConfig({ ...config, includeTests: e.target.checked })} />
              🧪 包含测试目录 (test/tests/spec/e2e)
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={config.includeNodeModules} onChange={e => setConfig({ ...config, includeNodeModules: e.target.checked })} />
              📦 包含 node_modules（会很慢！）
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={config.includeHidden} onChange={e => setConfig({ ...config, includeHidden: e.target.checked })} />
              🔒 包含隐藏目录（. 开头）
            </label>
            <label style={checkboxLabel}>
              <input type="checkbox" checked={config.analyzeContent} onChange={e => setConfig({ ...config, analyzeContent: e.target.checked })} />
              📝 分析文件内容（检测 import 关系，较慢）
            </label>
          </div>

          {/* ── Max depth ── */}
          <div style={sectionTitle}>📏 扫描深度</div>
          <input
            type="number" value={config.maxDepth} min={1} max={10}
            onChange={e => setConfig({ ...config, maxDepth: Number(e.target.value) })}
            style={{ ...inputStyle, width: 80 }}
          />
        </div>

        <div className="dialog-footer" style={{ flexShrink: 0, display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => {
            setExcludeDirs(DEFAULT_GRAPH_CONFIG.excludeDirs.join(', '))
            setExcludeFiles(DEFAULT_GRAPH_CONFIG.excludeFiles.join(', '))
            setExcludeExtensions(DEFAULT_GRAPH_CONFIG.excludeExtensions.join(', '))
            setExcludeKeywords(DEFAULT_GRAPH_CONFIG.excludeContentKeywords.join(', '))
            setIncludeDirs(DEFAULT_GRAPH_CONFIG.includeDirs.join(', '))
            setConfig({ ...DEFAULT_GRAPH_CONFIG })
          }}>🔄 恢复默认</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-cancel" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave}>💾 保存并重新分析</button>
        </div>
      </div>
    </div>
  )
}
