/**
 * 图谱分析模板管理器
 * 嵌入 UnifiedTemplateManagerDialog 的"图谱分析模板" tab
 * 支持列表 + 编辑（内置只读，自定义可增删改）
 */

import { useState, useEffect, useCallback } from 'react'
import { GRAPH_PROMPTS, mergePrompts, genPromptId, type GraphPrompt } from './graphPrompts'
import type { GraphAnalysisConfig } from '../../types/knowledgeGraph'

interface Props {
  theme: 'dark' | 'light'
  projectPath: string
}

const ICON_CHOICES = ['🔭', '🧩', '🌊', '🔗', '📊', '🐛', '⚡', '🏗', '📦', '🔧', '🎨', '📚']

export function GraphPromptManager({ theme, projectPath }: Props) {
  const [prompts, setPrompts] = useState<GraphPrompt[]>(GRAPH_PROMPTS)
  const [config, setConfig] = useState<GraphAnalysisConfig | null>(null)
  const [selectedId, setSelectedId] = useState<string>(GRAPH_PROMPTS[0]?.id || '')
  const [editing, setEditing] = useState<GraphPrompt | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')

  // 加载项目级配置（含 customPrompts）
  const loadConfig = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    setError('')
    try {
      const res = await window.electronAPI.graphConfigLoad(projectPath)
      if (res?.success && res.config) {
        setConfig(res.config)
        const custom = (res.config.customPrompts || []).map(p => ({ ...p, builtin: false }))
        const merged = mergePrompts(GRAPH_PROMPTS, custom)
        setPrompts(merged)
        if (!selectedId && merged[0]) setSelectedId(merged[0].id)
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [projectPath, selectedId])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // 保存自定义模板到项目配置
  const saveCustomPrompts = useCallback(async (next: GraphPrompt[]) => {
    if (!projectPath || !config) return
    setSaving(true)
    setError('')
    try {
      const customOnly = next.filter(p => !p.builtin)
      const newConfig: GraphAnalysisConfig = { ...config, customPrompts: customOnly }
      const res = await window.electronAPI.graphConfigSave(projectPath, newConfig)
      if (!res?.success) {
        setError(res?.error || '保存失败')
        return
      }
      setConfig(newConfig)
      setPrompts(mergePrompts(GRAPH_PROMPTS, customOnly))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }, [projectPath, config])

  // 新建自定义模板
  const handleNew = () => {
    const id = genPromptId()
    const newPrompt: GraphPrompt = {
      id,
      label: '新分析模板',
      icon: '📊',
      description: '描述这个分析模板的用途',
      systemPrompt: '请按以下 JSON 格式输出：\n{\n  "entities": [],\n  "relations": []\n}\n',
      builtin: false,
    }
    setEditing(newPrompt)
    setSelectedId(id)
  }

  // 另存为自定义（基于内置模板复制）
  const handleDuplicate = (src: GraphPrompt) => {
    const id = genPromptId()
    setEditing({
      ...src,
      id,
      label: src.label + ' (副本)',
      builtin: false,
    })
    setSelectedId(id)
  }

  // 保存编辑
  const handleSaveEdit = () => {
    if (!editing) return
    if (!editing.label.trim()) {
      setError('模板名称不能为空')
      return
    }
    if (!editing.systemPrompt.trim()) {
      setError('分析指令不能为空')
      return
    }
    const exists = prompts.find(p => p.id === editing.id)
    let next: GraphPrompt[]
    if (exists) {
      // 直接更新原模板（内置编辑后立即生效，同一 id + 标记 builtin=false 转自定义）
      next = prompts.map(p => p.id === editing.id ? { ...editing, builtin: false } : p)
    } else {
      // 新建
      next = [...prompts, editing]
    }
    setPrompts(next)
    setEditing(null)
    saveCustomPrompts(next)
  }

  // 删除自定义模板
  const handleDelete = (id: string) => {
    const target = prompts.find(p => p.id === id)
    if (!target || target.builtin) return
    if (!confirm(`确认删除模板「${target.label}」？`)) return
    const next = prompts.filter(p => p.id !== id)
    setPrompts(next)
    if (selectedId === id) setSelectedId(next[0]?.id || '')
    saveCustomPrompts(next)
  }

  const selected = prompts.find(p => p.id === selectedId)

  return (
    <div className="graph-prompt-manager">
      {/* 工具栏 */}
      <div className="gpm-toolbar">
        <div className="gpm-toolbar-left">
          <span className="gpm-count">共 {prompts.length} 个模板</span>
          <span className="gpm-count-builtin">（内置 {prompts.filter(p => p.builtin).length} · 自定义 {prompts.filter(p => !p.builtin).length}）</span>
        </div>
        <div className="gpm-toolbar-right">
          <button className="gpm-btn gpm-btn-primary" onClick={handleNew} disabled={saving}>
            ➕ 新建模板
          </button>
          <button className="gpm-btn" onClick={loadConfig} disabled={loading || saving}>
            {loading ? '⏳ 加载中' : '🔄 刷新'}
          </button>
        </div>
      </div>

      {error && <div className="gpm-error">⚠ {error}</div>}

      <div className="gpm-body">
        {/* 左侧：模板列表 */}
        <div className="gpm-list">
          <div className="gpm-list-header">内置模板（只读）</div>
          {prompts.filter(p => p.builtin).map(p => (
            <div
              key={p.id}
              className={`gpm-list-item ${selectedId === p.id ? 'active' : ''}`}
              onClick={() => { setSelectedId(p.id); setEditing(null) }}
            >
              <span className="gpm-item-icon">{p.icon}</span>
              <div className="gpm-item-info">
                <div className="gpm-item-label">{p.label}</div>
                <div className="gpm-item-desc">{p.description}</div>
              </div>
              <button
                className="gpm-item-action"
                title="另存为自定义"
                onClick={(e) => { e.stopPropagation(); handleDuplicate(p) }}
              >
                📋
              </button>
            </div>
          ))}
          <div className="gpm-list-header">自定义模板</div>
          {prompts.filter(p => !p.builtin).length === 0 ? (
            <div className="gpm-list-empty">暂无自定义模板，点击右上角"新建模板"</div>
          ) : (
            prompts.filter(p => !p.builtin).map(p => (
              <div
                key={p.id}
                className={`gpm-list-item ${selectedId === p.id ? 'active' : ''}`}
                onClick={() => { setSelectedId(p.id); setEditing(null) }}
              >
                <span className="gpm-item-icon">{p.icon}</span>
                <div className="gpm-item-info">
                  <div className="gpm-item-label">{p.label}</div>
                  <div className="gpm-item-desc">{p.description}</div>
                </div>
                <button
                  className="gpm-item-action danger"
                  title="删除"
                  onClick={(e) => { e.stopPropagation(); handleDelete(p.id) }}
                >
                  🗑
                </button>
              </div>
            ))
          )}
        </div>

        {/* 右侧：详情/编辑 */}
        <div className="gpm-detail">
          {editing ? (
            <>
              <div className="gpm-detail-header">
                <span className="gpm-detail-title">{'✏️ ' + (editing.label || '新模板')}</span>
                <span className="gpm-badge">自定义</span>
              </div>
              <div className="gpm-form">
                <div className="gpm-form-row">
                  <label className="gpm-form-label">模板名称</label>
                  <input
                    type="text"
                    className="gpm-form-input"
                    value={editing.label}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    placeholder="例如：模块依赖深度分析"
                  />
                </div>
                <div className="gpm-form-row">
                  <label className="gpm-form-label">图标</label>
                  <div className="gpm-icon-picker">
                    {ICON_CHOICES.map(ic => (
                      <button
                        key={ic}
                        className={`gpm-icon-btn ${editing.icon === ic ? 'active' : ''}`}
                        onClick={() => setEditing({ ...editing, icon: ic })}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="gpm-form-row">
                  <label className="gpm-form-label">描述</label>
                  <input
                    type="text"
                    className="gpm-form-input"
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder="简要描述模板用途"
                  />
                </div>
                <div className="gpm-form-row">
                  <label className="gpm-form-label">分析指令（System Prompt）</label>
                  <textarea
                    className="gpm-form-textarea"
                    value={editing.systemPrompt}
                    onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
                    placeholder="发给 Claude 的分析指令，要求结构化 JSON 输出"
                    rows={12}
                  />
                  <div className="gpm-form-hint">
                    提示：指令中应明确要求 AI 按固定 JSON 格式输出，包含 entities 和 relations 字段
                  </div>
                </div>
              </div>
              <div className="gpm-detail-actions">
                <button className="gpm-btn gpm-btn-primary" onClick={handleSaveEdit} disabled={saving}>
                  {saving ? '⏳ 保存中' : '💾 保存'}
                </button>
                <button className="gpm-btn" onClick={() => setEditing(null)}>取消</button>
              </div>
            </>
          ) : selected ? (
            <>
              <div className="gpm-detail-header">
                <span className="gpm-detail-title">{selected.icon + ' ' + selected.label}</span>
                {selected.builtin ? (
                  <span className="gpm-badge builtin">内置</span>
                ) : (
                  <span className="gpm-badge">自定义</span>
                )}
              </div>
              <div className="gpm-form">
                <div className="gpm-form-row">
                  <label className="gpm-form-label">描述</label>
                  <div className="gpm-form-readonly">{selected.description}</div>
                </div>
                <div className="gpm-form-row">
                  <label className="gpm-form-label">分析指令</label>
                  <pre className="gpm-form-prompt">{selected.systemPrompt || '（空指令，需用户填入）'}</pre>
                </div>
              </div>
              <div className="gpm-detail-actions">
                {editing ? (
                  <>
                    <button className="gpm-btn gpm-btn-primary" onClick={handleSaveEdit} disabled={saving}>
                      {saving ? '⏳ 保存中' : '💾 保存'}
                    </button>
                    <button className="gpm-btn" onClick={() => setEditing(null)}>取消</button>
                  </>
                ) : (
                  <>
                    <button className="gpm-btn gpm-btn-primary" onClick={() => setEditing(selected)}>
                      ✏️ 编辑
                    </button>
                    <button className="gpm-btn" onClick={() => handleDuplicate(selected)}>
                      📋 另存为自定义
                    </button>
                    {!selected.builtin && (
                      <button className="gpm-btn gpm-btn-danger" onClick={() => handleDelete(selected.id)}>
                        🗑 删除
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="gpm-empty">请选择左侧模板查看详情</div>
          )}
        </div>
      </div>
    </div>
  )
}
