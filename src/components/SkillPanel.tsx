import { useState, useEffect, useCallback } from 'react'
import { SkillMarketplace } from './SkillMarketplace'

interface SkillManifest {
  name: string; description: string; version: string; author: string
  category: string; tags: string; icon: string; level: 'project' | 'global'
  enabled: boolean; created: string; updated: string; fileName: string; filePath: string
}

interface Props { theme: 'dark' | 'light' }

export function SkillPanel({ theme }: Props) {
  const [projectSkillNames, setProjectSkillNames] = useState<string[]>([])
  const [globalSkills, setGlobalSkills] = useState<SkillManifest[]>([])
  const [loading, setLoading] = useState(true)
  const [showMarket, setShowMarket] = useState(false)
  const [selected, setSelected] = useState<SkillManifest | null>(null)
  const [skillContent, setSkillContent] = useState('')
  const isDark = theme === 'dark'

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [p, g] = await Promise.all([
        window.electronAPI.skillListProject?.(),
        window.electronAPI.skillList?.()
      ])
      if (p?.success) setProjectSkillNames(p.skills || [])
      if (g?.success) setGlobalSkills(g.skills || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // Only show global skills that are in the project list
  const projectSkills = globalSkills.filter(s => projectSkillNames.includes(s.name))

  async function viewSkill(skill: SkillManifest) {
    setSelected(skill); setSkillContent('')
    try { const r = await window.electronAPI.skillRead(skill.name); if (r?.success) setSkillContent(r.content) } catch { /* ignore */ }
  }

  async function handleRemoveFromProject(name: string) {
    if (!confirm('从当前项目中移除技能 "' + name + '"？')) return
    try { const r = await window.electronAPI.skillRemoveFromProject?.(name); if (r?.success) loadData() } catch {}
  }

  async function handleClearProject() {
    if (!confirm('确定清空当前项目的所有技能？')) return
    try { const r = await window.electronAPI.skillClearProject?.(); if (r?.success) loadData() } catch {}
  }

  async function handleMarketInstall(item: any) {
    // Install from marketplace to global store first if needed, then add to project
    const isInGlobal = globalSkills.some(s => s.name === item.id)
    if (!isInGlobal) {
      const r = await window.electronAPI.skillMarketplaceInstall({ id: item.id })
      if (!r?.success) throw new Error(r?.error || '安装失败')
    }
    const r2 = await window.electronAPI.skillInstallToProject?.(item.id)
    if (!r2?.success) throw new Error(r2?.error || '添加到项目失败')
    await loadData()
  }

  return (
    <div className="content-rules-list-view">
      <div className="content-rules-toolbar">
        <span style={{ fontWeight: 600, fontSize: 12 }}>🛠️ 项目技能</span>
        <span style={{ fontSize: 10, color: isDark ? '#666' : '#999', marginLeft: 4 }}>({projectSkills.length})</span>
        <div style={{ flex: 1 }} />
        {projectSkills.length > 0 && (
          <button className="btn btn-sm" onClick={handleClearProject} style={{ fontSize: 10, color: '#ff5050' }} title="清空项目技能">🗑️</button>
        )}
        <button className="btn btn-sm" onClick={() => setShowMarket(true)} title="技能市场">🏪 市场</button>
        <button className="btn btn-sm" onClick={loadData} title="刷新">🔄</button>
      </div>

      <div className="content-rules-scroll-list">
        {loading ? (<div className="empty-hint" style={{ padding: 24 }}>加载中...</div>)
          : projectSkills.length === 0 ? (
            <div className="empty-hint" style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 24, opacity: 0.3, marginBottom: 8 }}>🛠️</div>
              当前项目未安装技能
              <div style={{ fontSize: 10, marginTop: 6, color: isDark ? '#666' : '#999' }}>
                点击「🏪 市场」→ 在「本地市场」中找到技能 → 点击「安装到项目」
              </div>
            </div>
          ) : projectSkills.map(s => (
            <div key={s.name} className={'content-rules-list-item' + (selected?.name === s.name ? ' selected' : '')}
              onClick={() => viewSkill(s)}>
              <span style={{ fontSize: 16 }}>{s.icon || '📦'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  /{s.name}
                  {!s.enabled && <span style={{ fontSize: 9, color: '#f0a040', marginLeft: 4 }}>(已禁用)</span>}
                </div>
                <div style={{ fontSize: 10, color: isDark ? '#666' : '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.description}
                </div>
              </div>
              {(!selected || selected.name !== s.name) && (
                <button className="btn-icon" onClick={e => { e.stopPropagation(); handleRemoveFromProject(s.name) }}
                  style={{ fontSize: 12, opacity: 0.4, padding: '0 4px' }} title="从项目移除">✕</button>
              )}
            </div>
          ))}
      </div>

      {selected && (
        <div className="content-rules-detail" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="content-rules-navbar">
            <button className="btn-icon" onClick={() => setSelected(null)} style={{ fontSize: 16 }}>←</button>
            <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected.icon} /{selected.name}
            </span>
            <span style={{ fontSize: 9, color: isDark ? '#666' : '#999' }}>v{selected.version}</span>
            <button className="btn btn-sm" onClick={() => handleRemoveFromProject(selected.name)} style={{ marginLeft: 4, color: '#ff5050' }}>从项目移除</button>
          </div>
          <div className="content-rules-viewport">
            <div className="rule-viewer" style={{ fontSize: 11, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: isDark ? '#ccc' : '#333' }}>
              {skillContent ? skillContent.replace(/^---[\s\S]*?---\n*/m, '').trim() : '(空)'}
            </div>
          </div>
        </div>
      )}

      {showMarket && (
        <SkillMarketplace
          theme={theme}
          onInstall={handleMarketInstall}
          onClose={() => setShowMarket(false)}
          installedNames={projectSkillNames}
          onRefreshInstalled={loadData}
        />
      )}
    </div>
  )
}
