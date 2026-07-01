import { useState, useEffect, useMemo } from 'react'
import type { SkillScanResult, MarketSource } from '../types/skill'

interface MarketItem {
  id: string; name: string; description: string; version: string; author: string
  category: string; icon: string; downloads: number; rating: number; tags: string[]; url: string; source?: string
}
interface SkillManifest {
  name: string; description: string; version: string; author: string; category: string; tags: string
  icon: string; level: string; enabled: boolean; created: string; updated: string; fileName: string; filePath: string
}
interface Props {
  theme: 'dark' | 'light'; onInstall: (item: MarketItem) => Promise<void>; onClose: () => void
  installedNames: string[]; onRefreshInstalled?: () => void
}

const CATS = [
  { id: 'all', label: '全部', icon: '📋' }, { id: 'code-review', label: '代码审查', icon: '🔍' }, { id: 'security', label: '安全', icon: '🛡️' },
  { id: 'conventions', label: '规范', icon: '📏' }, { id: 'documentation', label: '文档', icon: '📝' }, { id: 'api-design', label: 'API', icon: '🔌' },
  { id: 'git', label: 'Git', icon: '📦' }, { id: 'testing', label: '测试', icon: '🧪' }, { id: 'performance', label: '性能', icon: '⚡' },
]

export function SkillMarketplace({ theme, onInstall, onClose, installedNames, onRefreshInstalled }: Props) {
  const [items, setItems] = useState<MarketItem[]>([]); const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null); const [category, setCategory] = useState('all'); const [search, setSearch] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [marketTab, setMarketTab] = useState<'local' | 'remote' | 'files'>('local')
  const [marketSources, setMarketSources] = useState<MarketSource[]>([]); const [localPaths, setLocalPaths] = useState<string[]>([])
  const [loadingLocal, setLoadingLocal] = useState(false); const [scanningAll, setScanningAll] = useState(false)
  const [marketSkills, setMarketSkills] = useState<MarketItem[]>([]); const [autoScanning, setAutoScanning] = useState(false)
  const [showAddSource, setShowAddSource] = useState(false); const [showMarketConfig, setShowMarketConfig] = useState(false)
  const [newSourceName, setNewSourceName] = useState(''); const [newSourceUrl, setNewSourceUrl] = useState('')
  const [editingSource, setEditingSource] = useState<string | null>(null); const [editName, setEditName] = useState(''); const [editUrl, setEditUrl] = useState('')
  const [scanSourceName, setScanSourceName] = useState('')
  const [winSize, setWinSize] = useState({ w: 800, h: 600 }); const [maximized, setMaximized] = useState(false)
  const [showSelectDialog, setShowSelectDialog] = useState(false); const [scannedSkills, setScannedSkills] = useState<SkillScanResult[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); const [installingBatch, setInstallingBatch] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null); const [selectedDetail, setSelectedDetail] = useState<MarketItem | null>(null)
  const [installHistory, setInstallHistory] = useState<{ date: string; name: string }[]>([])
  const [localSkills, setLocalSkills] = useState<SkillManifest[]>([]); const [uninstalling, setUninstalling] = useState<string | null>(null)
  const [showCreateSkill, setShowCreateSkill] = useState(false); const [createName, setCreateName] = useState(''); const [createDesc, setCreateDesc] = useState('')
  const [createCategory, setCreateCategory] = useState('general'); const [createIcon, setCreateIcon] = useState('📦'); const [createContent, setCreateContent] = useState('')
  const [slideEditMode, setSlideEditMode] = useState(false); const [slideEditContent, setSlideEditContent] = useState('')
  const [remoteSource, setRemoteSource] = useState<string>('all')
  const [loadingRemote, setLoadingRemote] = useState(false)
  const isDark = theme === 'dark'

  useEffect(() => {
    function u() { setWinSize({ w: Math.max(600, Math.floor(window.innerWidth * 0.75)), h: Math.max(400, Math.floor(window.innerHeight * 0.65)) }) }
    u(); window.addEventListener('resize', u); return () => window.removeEventListener('resize', u)
  }, [])
  useEffect(() => { loadMarketplace(); loadLocalSkills(); loadMarketConfig() }, [])

  async function loadMarketConfig() {
    try { const r = await window.electronAPI.skillGetMarketConfig?.(); if (r?.success && r.config) { if (r.config.marketplaces) setMarketSources(r.config.marketplaces); if (r.config.localPaths) setLocalPaths(r.config.localPaths); return r.config } } catch {}
    return null
  }
  async function loadLocalSkills() { try { const r = await window.electronAPI.skillList?.(); if (r?.success) setLocalSkills(r.skills || []) } catch {} }
  async function loadMarketplace() { setLoading(true); setError(null); try { const r = await window.electronAPI.skillMarketplaceList(); if (r?.success) setItems(r.items || []); else setError(r?.error || '加载失败') } catch (e: any) { setError(e?.message || '加载失败') }; setLoading(false) }

  // ── 远程市场：选择来源并扫描 ─────────────────────
  async function handleSelectSource(sourceName: string) {
    setRemoteSource(sourceName)
    if (sourceName === 'all') return
    setLoadingRemote(true)
    try {
      const r = await window.electronAPI.skillMarketplaceScan?.()
      if (r?.success && r.skills) {
        const filtered = r.skills.filter((s: any) => s.sourceName === sourceName)
        const mapped = filtered.map((s: any) => ({ id: s.name, name: s.name, description: s.description, version: s.version, author: s.author, category: s.category, icon: s.icon, tags: [s.category], downloads: 0, rating: 0, url: s.sourceUrl || '', source: s.sourceName || '远程市场' }))
        setMarketSkills(mapped)
      }
    } catch {}
    setLoadingRemote(false)
  }

  async function handleLoadToLocal(item: MarketItem) {
    setInstalling(item.id)
    try {
      // Read the raw skill content from the repo cache
      const r = await window.electronAPI.skillRead?.(item.id)
      if (r?.success) {
        await window.electronAPI.skillInstall({ name: item.id, content: r.content })
        loadLocalSkills(); onRefreshInstalled?.()
        setMarketTab('local')
      } else {
        // Fallback: try batch install with just this one
        await window.electronAPI.skillInstallBatch?.({ skills: [{ name: item.id, content: '' }] })
      }
    } catch (e: any) { setError(e?.message || '加载失败') }
    setInstalling(null)
  }

  // ── 本地市场：安装到项目 ────────────────────────
  async function handleInstallToProject(item: MarketItem) {
    setInstalling(item.id)
    try { await onInstall(item); recordInstall(item.name); loadLocalSkills() } catch (e: any) { setError(e?.message || '安装失败') }
    setInstalling(null)
  }

  const allItems = useMemo(() => { const seen = new Set<string>(); const merged: MarketItem[] = []; for (const item of [...items, ...marketSkills]) { if (!seen.has(item.name)) { seen.add(item.name); merged.push(item) } }; return merged }, [items, marketSkills])
  const remoteFiltered = useMemo(() => {
    let list = marketSkills
    if (remoteSource !== 'all') list = list.filter(i => i.source === remoteSource)
    if (category !== 'all') list = list.filter(i => i.category === category)
    if (search) { const q = search.toLowerCase(); list = list.filter(i => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)) }
    return list
  }, [marketSkills, remoteSource, category, search])

  const localFiltered = useMemo(() => {
    let list = localSkills
    if (search) { const q = search.toLowerCase(); list = list.filter(i => i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q)) }
    return list
  }, [localSkills, search])

  const stats = useMemo(() => { const today = new Date().toISOString().slice(0, 10); const todayAdded = installHistory.filter(h => h.date === today).length; const bySource: Record<string, number> = {}; for (const item of allItems) { const src = item.source || '未知'; bySource[src] = (bySource[src] || 0) + 1 }; return { total: allItems.length, installed: installedNames.length, todayAdded, bySource } }, [allItems, installedNames, installHistory])
  const localStats = useMemo(() => ({ total: localSkills.length, projectInstalled: installedNames.filter(n => localSkills.some(s => s.name === n)).length }), [localSkills, installedNames])

  function recordInstall(name: string) { try { const h = JSON.parse(localStorage.getItem('cs-skill-install-history') || '[]'); h.push({ date: new Date().toISOString().slice(0, 10), name }); localStorage.setItem('cs-skill-install-history', JSON.stringify(h)); setInstallHistory(h) } catch {} }

  async function handleUninstall(name: string) { if (!confirm('确定从本地仓库删除技能 "' + name + '"？')) return; setUninstalling(name); try { const r = await window.electronAPI.skillUninstall?.(name); if (r?.success) { loadLocalSkills(); onRefreshInstalled?.() } } catch {}; setUninstalling(null) }
  async function handleLoadLocal() { setLoadingLocal(true); try { const r = await window.electronAPI.skillLoadFromLocal?.(); if (!r?.success) { alert(r?.error || '加载失败'); setLoadingLocal(false); return }; const skills = r.skills || []; if (skills.length === 0) { alert('所选目录中未发现有效的技能文件'); setLoadingLocal(false); return }; setScannedSkills(skills); setSelectedIds(new Set(skills.map(s => s.name))); setBatchError(null); setShowSelectDialog(true) } catch (e: any) { alert(e.message) }; setLoadingLocal(false) }
  async function handleScanDir(dir?: string) { setLoadingLocal(true); try { const r = dir ? await (window.electronAPI as any).skillLoadFromLocalDir?.(dir) : await window.electronAPI.skillLoadFromLocal?.(); if (!r?.success) { alert(r?.error || '加载失败'); setLoadingLocal(false); return }; const skills: SkillScanResult[] = r.skills || []; if (skills.length === 0) { alert('所选目录中未发现有效的技能文件'); setLoadingLocal(false); return }; setScannedSkills(skills); setSelectedIds(new Set(skills.map(s => s.name))); setBatchError(null); setShowSelectDialog(true) } catch (e: any) { alert(e.message) }; setLoadingLocal(false) }
  async function handleAddLocalDir() { try { const r = await window.electronAPI.skillLoadFromLocal?.(); if (r?.success && r.skills && r.skills.length > 0) { setScannedSkills(r.skills); setSelectedIds(new Set(r.skills.map(s => s.name))); setBatchError(null); await loadMarketConfig(); alert('扫描到 ' + r.skills.length + ' 个技能') } } catch (e: any) { alert(e.message) } }
  async function handleRemoveLocalDir(dir: string) { if (!confirm('从配置中移除该目录？')) return; try { const cfg = await window.electronAPI.skillGetMarketConfig?.(); if (cfg?.success && cfg.config?.localPaths) { cfg.config.localPaths = cfg.config.localPaths.filter((p: string) => p !== dir); await window.electronAPI.skillSaveMarketConfig?.(cfg.config); loadMarketConfig() } } catch {} }
  async function handleScanAll() { setScanningAll(true); try { const r = await window.electronAPI.skillMarketplaceScan?.(); if (r?.success && r.skills && r.skills.length > 0) { setScannedSkills(r.skills); setSelectedIds(new Set(r.skills.map(s => s.name))); setBatchError(null); setScanSourceName(''); setShowSelectDialog(true) } else if (r?.success) alert('所有配置市场中未发现新技能') } catch (e: any) { alert(e.message) }; setScanningAll(false) }
  async function handleAddMarketplace() { if (!newSourceName.trim() || !newSourceUrl.trim()) { alert('请输入名称和 URL'); return }; try { const r = await window.electronAPI.skillMarketplaceSourceAdd?.({ name: newSourceName.trim(), url: newSourceUrl.trim(), enabled: true, autoScan: true }); if (r?.success) { setShowAddSource(false); setNewSourceName(''); setNewSourceUrl(''); loadMarketConfig() } else alert(r?.error || '添加失败') } catch (e: any) { alert(e.message) } }
  async function handleCreateSkill() {
    if (!createName.trim()) { alert('技能名称不能为空'); return }
    const fm = '---\nname: ' + createName.trim() + '\ndescription: ' + (createDesc.trim() || 'A custom skill') + '\nversion: 1.0.0\nauthor: local\ncategory: ' + createCategory + "\nicon: '" + createIcon + "'\ntags: " + createCategory + '\nlevel: global\nenabled: true\ncreated: ' + new Date().toISOString().slice(0, 10) + '\nupdated: ' + new Date().toISOString().slice(0, 10) + '\n---\n\n' + (createContent || '# ' + createName.trim() + '\n\n## Description\n' + (createDesc.trim() || 'No description'))
    try { const r = await window.electronAPI.skillInstall({ name: createName.trim(), content: fm }); if (r?.success) { setShowCreateSkill(false); setCreateName(''); setCreateDesc(''); setCreateContent(''); loadLocalSkills(); onRefreshInstalled?.() } else alert(r?.error || '创建失败') } catch (e: any) { alert(e.message) }
  }
  async function handleStartEdit(name: string) { try { const r = await window.electronAPI.skillRead?.(name); if (r?.success) { setSlideEditContent(r.content); setSlideEditMode(true) } else alert(r?.error || '读取失败') } catch {} }
  async function handleSaveEdit(name: string) { try { const r = await window.electronAPI.skillInstall({ name, content: slideEditContent }); if (r?.success) { setSlideEditMode(false); loadLocalSkills(); onRefreshInstalled?.() } else alert(r?.error || '保存失败') } catch (e: any) { alert(e.message) } }
  async function handleRemoveSource(url: string) { if (!confirm('确定移除该市场源？')) return; try { const r = await window.electronAPI.skillMarketplaceSourceRemove?.(url); if (r?.success) loadMarketConfig() } catch {} }
  async function handleToggleSource(url: string, updates: Partial<MarketSource>) { try { await window.electronAPI.skillMarketplaceSourceUpdate?.(url, updates); loadMarketConfig() } catch {} }
  async function handleSaveEditSource(origUrl: string) { if (!editName.trim() || !editUrl.trim()) { alert('名称和 URL 不能为空'); return }; try { await window.electronAPI.skillMarketplaceSourceAdd?.({ name: editName.trim(), url: editUrl.trim(), enabled: true, autoScan: true }); if (editUrl.trim() !== origUrl) await window.electronAPI.skillMarketplaceSourceRemove?.(origUrl); setEditingSource(null); loadMarketConfig() } catch (e: any) { alert(e.message) } }
  function startEdit(src: MarketSource) { setEditingSource(src.url); setEditName(src.name); setEditUrl(src.url) }
  function toggleSelect(n: string) { setSelectedIds(prev => { const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next }) }
  function toggleSelectAll() { selectedIds.size === scannedSkills.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(scannedSkills.map(s => s.name))) }
  async function handleBatchInstall() {
    if (selectedIds.size === 0) return; setInstallingBatch(true); setBatchError(null)
    try { const selected = scannedSkills.filter(s => selectedIds.has(s.name)); const r = await window.electronAPI.skillInstallBatch?.({ skills: selected.map(s => ({ name: s.name, content: s.content })) }); if (r?.success) { selected.forEach(s => recordInstall(s.name)); setShowSelectDialog(false); loadLocalSkills(); onRefreshInstalled?.() } else if (r?.errors && r.errors.length > 0) setBatchError('部分安装失败 (' + (r.count ?? 0) + ' 成功): ' + r.errors.map((e: any) => e.name).join(', ')); else setBatchError(r?.error || '安装失败') } catch (e: any) { setBatchError(e?.message || '批量安装失败') }; setInstallingBatch(false)
  }

  const winW = maximized ? window.innerWidth - 40 : winSize.w; const winH = maximized ? window.innerHeight - 40 : winSize.h
  const TABS: Record<string, string> = { local: '💻 本地市场', remote: '🌐 远程市场', files: '📂 本地文件' }

  return (<>
    <div className="dialog-overlay" onClick={onClose}>
      <div className={'dialog' + (maximized ? ' maximized' : '')} onClick={e => e.stopPropagation()}
        style={{ width: winW, height: winH, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="dialog-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {Object.keys(TABS).map(key => (
              <button key={key} className={'sk-mkt-tab' + (marketTab === key ? ' active' : '')} onClick={() => setMarketTab(key as 'local' | 'remote' | 'files')}>{TABS[key]}</button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: isDark ? '#666' : '#999', marginLeft: 8 }}>{marketTab === 'local' ? localSkills.length + ' 个本地技能' : ''}</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => { loadMarketplace(); loadLocalSkills() }} disabled={loading}>🔄 刷新</button>
          {marketTab === 'remote' && <button className="btn btn-sm" onClick={() => setShowMarketConfig(v => !v)} style={{ marginLeft: 4 }} title="市场源配置">⚙️</button>}
          <button className="btn btn-sm" onClick={() => setMaximized(v => !v)} style={{ marginLeft: 4 }}>{maximized ? '⤡' : '⤢'}</button>
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>

        {marketTab === 'remote' ? (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div className="sk-mkt-stats">
              <div className="sk-mkt-stat-item"><span className="sk-mkt-stat-num">{marketSkills.length}</span><span className="sk-mkt-stat-label">远程技能</span></div>
              <div className="sk-mkt-stat-item"><span className="sk-mkt-stat-num">{installedNames.length}</span><span className="sk-mkt-stat-label">项目已安装</span></div>
              <div className="sk-mkt-stat-divider" />
              {marketSources.filter(s => s.enabled).map(s => (
                <div key={s.url} className={'sk-mkt-stat-source' + (remoteSource === s.name ? ' active' : '')} onClick={() => handleSelectSource(s.name)}
                  style={{ cursor: 'pointer', background: remoteSource === s.name ? 'var(--bg-surface)' : 'transparent' }}>
                  <span className="sk-mkt-stat-source-name">{s.name}</span>
                </div>
              ))}
              <div className={'sk-mkt-stat-source' + (remoteSource === 'all' ? ' active' : '')} onClick={() => { setRemoteSource('all'); setMarketSkills([]) }}
                style={{ cursor: 'pointer', background: remoteSource === 'all' ? 'var(--bg-surface)' : 'transparent' }}>
                <span className="sk-mkt-stat-source-name">📋 全部</span>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="sk-mkt-toolbar">
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', width: '100%' }}>
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索远程技能..." className="sk-mkt-search" style={{ flex: 1 }} />
                  {remoteSource !== 'all' && <span style={{ fontSize: 11, color: isDark ? '#888' : '#999' }}>来源: {remoteSource}</span>}
                </div>
                <div className="sk-mkt-cats">{CATS.map(c => (<button key={c.id} className={'sk-mkt-cat' + (category === c.id ? ' active' : '')} onClick={() => setCategory(c.id)}>{c.icon} {c.label}</button>))}</div>
              </div>
              <div className="sk-mkt-grid">
                {loadingRemote ? <div className="empty-hint" style={{ padding: 40 }}>扫描中...</div>
                  : remoteFiltered.length === 0 ? <div className="empty-hint" style={{ padding: 40 }}>{remoteSource === 'all' ? '请从左侧选择一个远程市场源' : '该市场暂无技能数据'}</div>
                  : remoteFiltered.map(item => (<div key={item.id} className="sk-mkt-card">
                      <div className="sk-mkt-card-icon">{item.icon || '📦'}</div>
                      <div className="sk-mkt-card-body"><div className="sk-mkt-card-name">{item.name}{item.source && <span className="sk-mkt-source-badge">{item.source}</span>}</div><div className="sk-mkt-card-desc">{item.description}</div><div className="sk-mkt-card-meta"><span>v{item.version}</span><span> · {item.author}</span></div></div>
                      <button className="btn btn-sm" onClick={() => handleLoadToLocal(item)} disabled={installing === item.id} style={{ flexShrink: 0 }}>
                        {installing === item.id ? '加载中...' : '📥 加载到本地'}
                      </button>
                    </div>))}
              </div>
            </div>
          </div>

        ) : marketTab === 'local' ? (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            <div className="sk-mkt-stats">
              <div className="sk-mkt-stat-item"><span className="sk-mkt-stat-num">{localStats.total}</span><span className="sk-mkt-stat-label">本地技能仓库</span></div>
              <div className="sk-mkt-stat-item"><span className="sk-mkt-stat-num">{localStats.projectInstalled}</span><span className="sk-mkt-stat-label">已安装到项目</span></div>
              <div className="sk-mkt-stat-divider" /><div style={{ fontSize: 10, color: isDark ? '#888' : '#999', padding: '4px 6px' }}>~/.claude/skills/</div>
              <div className="sk-mkt-stat-divider" />
              <div className="sk-mkt-stat-source" style={{ fontSize: 10, color: isDark ? '#888' : '#999', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span>💡 提示:</span>
                <span>从远程市场加载技能到本地仓库后，</span>
                <span>再点击「安装到项目」使其在当前</span>
                <span>项目中生效。</span>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="sk-mkt-toolbar">
                <div style={{ display: 'flex', gap: 4, width: '100%' }}>
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 搜索本地技能..." className="sk-mkt-search" style={{ flex: 1 }} />
                  <button className="btn btn-sm" onClick={() => setShowCreateSkill(true)}>➕ 新建技能</button>
                </div>
              </div>
              <div className="sk-mkt-grid">
                {localSkills.length === 0 ? (<div className="empty-hint" style={{ padding: 40, textAlign: 'center' }}><div style={{ fontSize: 24, opacity: 0.3, marginBottom: 8 }}>💻</div>本地技能仓库为空<div style={{ fontSize: 10, marginTop: 6, color: isDark ? '#666' : '#999' }}>从「远程市场」加载技能或「新建技能」</div></div>)
                  : localFiltered.map(s => {
                    const isProjectInstalled = installedNames.includes(s.name)
                    return (<div key={s.name} className="sk-mkt-card">
                      <div className="sk-mkt-card-icon">{s.icon || '📦'}</div>
                      <div className="sk-mkt-card-body"><div className="sk-mkt-card-name">/{s.name}{!s.enabled && <span style={{ fontSize: 9, color: '#f0a040', marginLeft: 4 }}>(已禁用)</span>}</div><div className="sk-mkt-card-desc">{s.description}</div><div className="sk-mkt-card-meta"><span>v{s.version}</span><span> · {s.author}</span>{isProjectInstalled && <span style={{ color: '#3fb950', marginLeft: 4 }}>✅ 项目已安装</span>}</div></div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                        {isProjectInstalled
                          ? <span style={{ fontSize: 10, color: '#3fb950' }}>✅ 已安装</span>
                          : <button className="btn btn-sm" onClick={() => handleInstallToProject({ id: s.name, name: s.name, description: s.description || '', version: s.version, author: s.author, category: s.category, icon: s.icon, tags: [], downloads: 0, rating: 0, url: '' })} disabled={installing === s.name} style={{ color: '#58a6ff' }}>
                              {installing === s.name ? '安装中...' : '📥 安装到项目'}
                            </button>
                        }
                        <button className="btn-icon" onClick={() => handleUninstall(s.name)} disabled={uninstalling === s.name} style={{ fontSize: 12, opacity: 0.4, padding: '2px 4px' }} title="从本地删除">🗑️</button>
                      </div>
                    </div>)
                  })}
              </div>
            </div>
          </div>

        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 16 }}>
            <div className="kn-section" style={{ flexShrink: 0 }}>
              <div className="kn-section-title">📂 技能文件夹配置</div>
              <p style={{ fontSize: 11, color: isDark ? '#888' : '#999', marginBottom: 12 }}>添加本地文件夹，系统将递归扫描其中的技能文件</p>
              <button className="btn btn-sm" onClick={handleAddLocalDir} disabled={loadingLocal}>{loadingLocal ? '扫描中...' : '➕ 添加文件夹'}</button>
            </div>
            {localPaths.length > 0 ? (<div className="sk-mkt-source-list" style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>{localPaths.map(dir => (
              <div key={dir} className="sk-mkt-source-item" style={{ padding: '8px 10px', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span style={{ fontSize: 11, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={dir}>📁 {dir}</span><button className="btn btn-sm" onClick={() => handleScanDir(dir)} style={{ fontSize: 10 }}>🔍 扫描</button><button className="btn btn-sm" onClick={() => handleRemoveLocalDir(dir)} style={{ fontSize: 10, color: '#ff5050' }}>🗑️</button></div>
              </div>
            ))}</div>) : (<div className="empty-hint" style={{ padding: 24, textAlign: 'center' }}>暂未配置技能文件夹</div>)}
            {scannedSkills.length > 0 && (<div className="sk-mkt-local-results" style={{ flexShrink: 0, marginTop: 8 }}>
              <div className="kn-section" style={{ flexShrink: 0 }}><div className="kn-section-title" style={{ display: 'flex', alignItems: 'center' }}><span>📋 扫描结果</span><span style={{ fontSize: 10, color: isDark ? '#888' : '#999', marginLeft: 8, fontWeight: 400 }}>已选 {selectedIds.size}/{scannedSkills.length}</span></div></div>
              <div className="sk-mkt-results-list" style={{ maxHeight: 200 }}>{scannedSkills.map(s => (<div key={s.name} className={'sk-select-item' + (selectedIds.has(s.name) ? ' selected' : '')} onClick={() => toggleSelect(s.name)}><input type="checkbox" className="sk-select-checkbox" checked={selectedIds.has(s.name)} onChange={() => toggleSelect(s.name)} onClick={e => e.stopPropagation()} /><span className="sk-select-item-icon">{s.icon || '📦'}</span><div className="sk-select-item-info"><div className="sk-select-item-name">/{s.name}</div><div className="sk-select-item-desc">{s.description}</div><div className="sk-select-item-meta">v{s.version} · {s.author} · {s.category}</div></div></div>))}</div>
              <div className="dialog-footer" style={{ flexShrink: 0 }}>{batchError && <span style={{ fontSize: 11, color: '#ff5050', flex: 1 }}>{batchError}</span>}<button className="btn btn-sm" onClick={toggleSelectAll}>{selectedIds.size === scannedSkills.length ? '取消全选' : '全选'}</button><button className="btn btn-primary btn-sm" onClick={handleBatchInstall} disabled={selectedIds.size === 0 || installingBatch}>{installingBatch ? '安装中...' : '📥 安装选中 (' + selectedIds.size + ')'}</button></div>
            </div>)}
          </div>
        )}
      </div>
    </div>

    {/* ── 创建技能对话框 ──────────────────────────── */}
    {showCreateSkill && (
      <div className="dialog-overlay" onClick={() => setShowCreateSkill(false)} style={{ zIndex: 1200 }}>
        <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 520, maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
          <div className="dialog-header"><h2>➕ 创建新技能</h2><div style={{ flex: 1 }} /><button onClick={() => setShowCreateSkill(false)} className="dialog-close">✕</button></div>
          <div className="dialog-body" style={{ overflow: 'auto' }}>
            <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 3, color: 'var(--accent-text)' }}>名称 *</label><input type="text" value={createName} onChange={e => setCreateName(e.target.value)} placeholder="my-skill-name" style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} /></div>
            <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 3, color: 'var(--accent-text)' }}>描述</label><input type="text" value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="技能描述" style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} /></div>
            <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 3, color: 'var(--accent-text)' }}>分类</label><input type="text" value={createCategory} onChange={e => setCreateCategory(e.target.value)} placeholder="general" style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} /></div>
            <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 3, color: 'var(--accent-text)' }}>图标 (emoji)</label><input type="text" value={createIcon} onChange={e => setCreateIcon(e.target.value)} placeholder="📦" style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} /></div>
            <div style={{ marginBottom: 10 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 3, color: 'var(--accent-text)' }}>Markdown 内容</label><textarea value={createContent} onChange={e => setCreateContent(e.target.value)} placeholder="技能指令内容..." rows={8} style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace', resize: 'vertical' }} /></div>
          </div>
          <div className="dialog-footer"><button className="btn btn-sm" onClick={() => setShowCreateSkill(false)}>取消</button><button className="btn btn-primary btn-sm" onClick={handleCreateSkill} disabled={!createName.trim()}>创建技能</button></div>
        </div>
      </div>
    )}

    {/* ── 市场配置对话框 ──────────────────────────── */}
    {showMarketConfig && (
      <div className="dialog-overlay" onClick={() => setShowMarketConfig(false)} style={{ zIndex: 1200 }}>
        <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: '50vw', height: '50vh', display: 'flex', flexDirection: 'column' }}>
          <div className="dialog-header"><h2>🔗 市场源配置 🌐 全局</h2><div style={{ flex: 1 }} /><button className="btn btn-sm" onClick={handleScanAll} disabled={scanningAll} style={{ fontSize: 10, marginRight: 4 }}>{scanningAll ? '扫描中...' : '🔄 扫描全部'}</button><button className="btn btn-sm" onClick={() => { setShowAddSource(true); setShowMarketConfig(false) }} style={{ fontSize: 10, marginRight: 4 }}>➕ 添加市场</button><button onClick={() => setShowMarketConfig(false)} className="dialog-close">✕</button></div>
          <div className="dialog-body" style={{ padding: '8px 16px' }}>
            {marketSources.length === 0 ? <div className="empty-hint" style={{ padding: 24 }}>暂未配置技能市场源</div> : marketSources.map(src => (
              <div key={src.url} className="sk-mkt-source-item" style={{ marginBottom: 6, padding: '8px 10px' }}>
                {editingSource === src.url ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}><input type="text" value={editName} onChange={e => setEditName(e.target.value)} placeholder="名称" style={{ width: '100%', padding: '4px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} /><input type="text" value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="URL" style={{ width: '100%', padding: '4px 8px', fontSize: 11, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }} /><div style={{ display: 'flex', gap: 4 }}><button className="btn btn-sm" onClick={() => handleSaveEditSource(src.url)} style={{ fontSize: 10 }}>💾 保存</button><button className="btn btn-sm" onClick={() => setEditingSource(null)} style={{ fontSize: 10 }}>取消</button></div></div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, minWidth: 90 }}>{src.enabled ? '✅' : '⏸️'} {src.name}</span>
                    <span style={{ fontSize: 10, color: isDark ? '#888' : '#999', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.url.replace(/^https?:\/\//, '').replace(/\.git$/, '')}</span>
                    <label className="sk-mkt-toggle"><input type="checkbox" checked={src.enabled} onChange={e => handleToggleSource(src.url, { enabled: e.target.checked })} /><span>启用</span></label>
                    <label className="sk-mkt-toggle"><input type="checkbox" checked={src.autoScan} onChange={e => handleToggleSource(src.url, { autoScan: e.target.checked })} /><span>自动</span></label>
                    <button className="btn btn-sm" onClick={() => startEdit(src)} style={{ fontSize: 10, padding: '2px 6px' }}>✏️</button>
                    <button className="btn btn-sm" onClick={() => handleRemoveSource(src.url)} style={{ fontSize: 10, padding: '2px 6px', color: '#ff5050' }}>🗑️</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    {showAddSource && (
      <div className="dialog-overlay" onClick={() => setShowAddSource(false)} style={{ zIndex: 1200 }}>
        <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 440 }}>
          <div className="dialog-header"><h2>➕ 添加技能市场</h2><button onClick={() => setShowAddSource(false)} className="dialog-close">✕</button></div>
          <div className="dialog-body"><div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 4, color: isDark ? '#aaa' : '#666' }}>名称</label><input type="text" value={newSourceName} onChange={e => setNewSourceName(e.target.value)} placeholder="我的技能市场" style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} /></div><div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, display: 'block', marginBottom: 4, color: isDark ? '#aaa' : '#666' }}>Git 仓库 URL</label><input type="text" value={newSourceUrl} onChange={e => setNewSourceUrl(e.target.value)} placeholder="https://github.com/user/skills-repo.git" style={{ width: '100%', padding: '5px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} /></div></div>
          <div className="dialog-footer"><button className="btn btn-sm" onClick={() => setShowAddSource(false)}>取消</button><button className="btn btn-primary btn-sm" onClick={handleAddMarketplace} disabled={!newSourceName.trim() || !newSourceUrl.trim()}>确认添加</button></div>
        </div>
      </div>
    )}

    {showSelectDialog && (
      <div className="dialog-overlay" onClick={() => setShowSelectDialog(false)} style={{ zIndex: 1200 }}>
        <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: Math.min(560, winW - 40), maxHeight: Math.min(500, winH - 80), display: 'flex', flexDirection: 'column' }}>
          <div className="dialog-header"><h2>{scanSourceName || '📂 选择要安装的技能'}</h2><span style={{ fontSize: 11, color: isDark ? '#999' : '#999', marginLeft: 8 }}>已选 {selectedIds.size}/{scannedSkills.length}</span><div style={{ flex: 1 }} /><button onClick={() => setShowSelectDialog(false)} className="dialog-close">✕</button></div>
          <div className="dialog-body" style={{ padding: 0 }}><div className="sk-select-list">{scannedSkills.map(s => (<div key={s.name} className={'sk-select-item' + (selectedIds.has(s.name) ? ' selected' : '')} onClick={() => toggleSelect(s.name)}><input type="checkbox" className="sk-select-checkbox" checked={selectedIds.has(s.name)} onChange={() => toggleSelect(s.name)} onClick={e => e.stopPropagation()} /><span className="sk-select-item-icon">{s.icon || '📦'}</span><div className="sk-select-item-info"><div className="sk-select-item-name">/{s.name}</div><div className="sk-select-item-desc">{s.description}</div><div className="sk-select-item-meta">v{s.version} · {s.author} · {s.category}</div></div></div>))}</div></div>
          <div className="dialog-footer">{batchError && <span style={{ fontSize: 11, color: '#ff5050', flex: 1 }}>{batchError}</span>}<button className="btn btn-sm" onClick={toggleSelectAll}>{selectedIds.size === scannedSkills.length ? '取消全选' : '全选'}</button><button className="btn btn-sm" onClick={() => setShowSelectDialog(false)}>取消</button><button className="btn btn-primary btn-sm" onClick={handleBatchInstall} disabled={selectedIds.size === 0 || installingBatch}>{installingBatch ? '安装中...' : '📥 安装选中 (' + selectedIds.size + ')'}</button></div>
        </div>
      </div>
    )}
  </>)
}
