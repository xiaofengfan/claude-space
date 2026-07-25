/**
 * @deprecated 已被统一编辑器 TemplateEditor 取代
 *
 * 原简单模式模板管理对话框。其「阶段管理」与「详细信息设置」能力
 * 已融合进 src/components/orchestrator/TemplateEditor.tsx。
 *
 * 本文件不再被任何模块 import，仅保留作为兼容入口与回滚参考。
 * 底层执行依赖的 window.electronAPI.workflowRun 也已废弃，
 * 所有模板应改走 window.orchestrator.create / createWithTemplate。
 */
import { useState, useEffect, useCallback } from 'react'

interface Phase {
  name: string; type: 'single' | 'parallel' | 'loop'; prompt: string; model: string
}
interface Template {
  id: string; name: string; description: string; icon: string; phases: Phase[]; projectPath?: string
}

const DEFAULT_TEMPLATES: Template[] = [
  { id: 'single-module', name: '单模块开发', description: 'plan → code → review → test', icon: '📦', phases: [
    { name: '需求分析', type: 'single', prompt: '分析需求文档，输出技术方案和模块划分', model: 'sonnet' },
    { name: '代码实现', type: 'single', prompt: '根据技术方案编写完整代码实现', model: 'sonnet' },
    { name: '代码审查', type: 'single', prompt: '审查代码的正确性、性能、安全性', model: 'opus' },
    { name: '测试验证', type: 'single', prompt: '编写并运行测试用例，确保覆盖率达标', model: 'sonnet' },
  ]},
  { id: 'multi-module', name: '多模块并行', description: 'plan → code(并行) → review → merge → test', icon: '🧩', phases: [
    { name: '模块规划', type: 'single', prompt: '分析需求，拆分模块，定义接口契约', model: 'opus' },
    { name: '并行开发', type: 'parallel', prompt: '按模块划分并行实现各功能', model: 'sonnet' },
    { name: '代码审查', type: 'parallel', prompt: '并行审查各模块代码', model: 'opus' },
    { name: '集成合并', type: 'single', prompt: '合并所有模块，解决冲突', model: 'opus' },
    { name: '集成测试', type: 'single', prompt: '运行集成测试并修复失败项', model: 'sonnet' },
  ]},
  { id: 'code-audit', name: '代码审计', description: 'scan → review(并行) → report', icon: '🔍', phases: [
    { name: '代码扫描', type: 'single', prompt: '扫描项目所有源代码文件', model: 'sonnet' },
    { name: '并行审查', type: 'parallel', prompt: '按模块并行审查代码安全性和质量', model: 'opus' },
    { name: '报告生成', type: 'single', prompt: '汇总审计结果，生成修复建议报告', model: 'sonnet' },
  ]},
  { id: 'migration', name: '迁移重构', description: 'analyze → transform(并行) → verify', icon: '🔄', phases: [
    { name: '代码分析', type: 'single', prompt: '分析现有代码结构和依赖关系', model: 'opus' },
    { name: '并行转换', type: 'parallel', prompt: '按模块并行执行代码转换', model: 'sonnet' },
    { name: '验证测试', type: 'single', prompt: '验证转换后代码的正确性和性能', model: 'sonnet' },
  ]},
  { id: 'bug-sweep', name: 'Bug 批量修复', description: 'analyze → fix(并行) → verify', icon: '🐛', phases: [
    { name: 'Bug 分析', type: 'single', prompt: '分析项目找出所有潜在 Bug', model: 'opus' },
    { name: '并行修复', type: 'parallel', prompt: '按模块并行修复 Bug', model: 'sonnet' },
    { name: '验证确认', type: 'single', prompt: '验证修复的正确性', model: 'sonnet' },
  ]},
  { id: 'ci-monitor', name: 'CI 监控', description: '循环检查 CI 状态 → 修复', icon: '⚡', phases: [
    { name: 'CI 检查', type: 'loop', prompt: '循环检查 CI 构建状态，失败时自动修复并重试', model: 'sonnet' },
  ]},
]

const PHASE_TYPES = [
  { id: 'single', label: '单阶段' }, { id: 'parallel', label: '并行阶段' }, { id: 'loop', label: '循环阶段' },
]
const MODELS = [
  { id: 'sonnet', label: 'Sonnet (快速)' }, { id: 'opus', label: 'Opus (深度)' },
]

interface Props {
  theme: 'dark' | 'light'
  activeProjectPath?: string
  onClose: () => void
}

export function TemplateManagerDialog({ theme, activeProjectPath, onClose }: Props) {
  const [winSize, setWinSize] = useState({ w: 1200, h: 750 })
  const [templates, setTemplates] = useState<Template[]>(() => {
    try { const saved = localStorage.getItem('cs-workflow-templates'); return saved ? JSON.parse(saved) : DEFAULT_TEMPLATES } catch { return DEFAULT_TEMPLATES }
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editTmpl, setEditTmpl] = useState<Template | null>(null)
  const [runningWf, setRunningWf] = useState<string | null>(null)
  const [projects, setProjects] = useState<string[]>([])
  const isDark = theme === 'dark'

  // 窗口80%尺寸
  useEffect(() => {
    function update() {
      setWinSize({
        w: Math.max(900, Math.floor(window.innerWidth * 0.8)),
        h: Math.max(600, Math.floor(window.innerHeight * 0.8)),
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => { loadProjects() }, [])

  function saveTemplates(tmpls: Template[]) {
    setTemplates(tmpls)
    localStorage.setItem('cs-workflow-templates', JSON.stringify(tmpls))
  }

  async function loadProjects() {
    try {
      const r = await window.electronAPI.scanProjects()
      if (Array.isArray(r)) setProjects(r.map((p: any) => p.path))
    } catch {}
  }

  async function handleRunWorkflow(template: Template) {
    if (!template.phases || template.phases.length === 0) { alert('该模板没有阶段，无法运行'); return }
    setRunningWf(template.id)
    try {
      const r = await window.electronAPI.workflowRun?.({
        templateId: template.id,
        name: template.name,
        phases: template.phases.map(p => ({ name: p.name, type: p.type, prompt: p.prompt, model: p.model })),
      })
      if (!r?.success) alert(r?.error || '启动失败')
    } catch {}
    setRunningWf(null)
  }

  function selectTemplate(t: Template) {
    setSelectedId(t.id)
    setEditTmpl(JSON.parse(JSON.stringify(t)))
  }

  function saveEditor() {
    if (!editTmpl) return
    if (!editTmpl.name.trim()) { alert('请输入模板名称'); return }
    const idx = templates.findIndex(t => t.id === editTmpl.id)
    if (idx >= 0) {
      const next = [...templates]; next[idx] = editTmpl; saveTemplates(next)
    } else {
      saveTemplates([...templates, editTmpl])
    }
    setSelectedId(editTmpl.id)
  }

  function deleteTemplate(id: string) {
    if (!confirm('删除此模板？')) return
    saveTemplates(templates.filter(t => t.id !== id))
    if (selectedId === id) { setSelectedId(null); setEditTmpl(null) }
  }

  function newTemplate() {
    const t: Template = {
      id: 'custom-' + Date.now().toString(36),
      name: '', description: '', icon: '📦',
      phases: [{ name: '阶段 1', type: 'single', prompt: '', model: 'sonnet' }],
    }
    setSelectedId(t.id)
    setEditTmpl(t)
  }

  function updatePhase(pi: number, field: string, val: any) {
    if (!editTmpl) return
    const p = { ...editTmpl }; (p.phases[pi] as any)[field] = val; setEditTmpl(p)
  }
  function addPhase() {
    if (!editTmpl) return
    setEditTmpl({ ...editTmpl, phases: [...editTmpl.phases, { name: '阶段 ' + (editTmpl.phases.length + 1), type: 'single', prompt: '', model: 'sonnet' }] })
  }
  function removePhase(pi: number) {
    if (!editTmpl || editTmpl.phases.length <= 1) return
    const p = { ...editTmpl }; p.phases.splice(pi, 1); setEditTmpl(p)
  }
  function movePhase(pi: number, dir: number) {
    if (!editTmpl) return
    const ni = pi + dir
    if (ni < 0 || ni >= editTmpl.phases.length) return
    const p = { ...editTmpl }; [p.phases[pi], p.phases[ni]] = [p.phases[ni], p.phases[pi]]; setEditTmpl(p)
  }

  const projectTmpls = templates.filter(t => t.projectPath && activeProjectPath && t.projectPath === activeProjectPath)
  const libTmpls = templates.filter(t => !t.projectPath || !activeProjectPath || t.projectPath !== activeProjectPath)
  const selected = editTmpl

  const SIDEBAR_STYLE: React.CSSProperties = {
    padding: '8px 10px', cursor: 'pointer', borderRadius: 6, fontSize: 12,
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3,
    transition: 'background 0.1s',
  }

  return (
    <div className="dialog-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: winSize.w, height: winSize.h, display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>

        {/* ── 头部 ─────────────────────────────────── */}
        <div className="dialog-header" style={{ flexShrink: 0, padding: '10px 16px' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>📋 工作流模板</span>
          <span style={{ fontSize: 11, color: isDark ? '#666' : '#999', marginLeft: 8 }}>{templates.length} 个模板</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={newTemplate} style={{ fontSize: 10, marginRight: 8 }}>➕ 新建模板</button>
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>

        {/* ── 主体：左列表 + 右编辑 ─────────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ── 左侧：模板清单 ─────────────────────── */}
          <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* 当前项目 */}
            {activeProjectPath && projectTmpls.length > 0 && (
              <div style={{ flexShrink: 0, padding: '8px 12px 4px' }}>
                <div style={{ fontSize: 10, color: isDark ? '#888' : '#999', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>📌 当前项目</span>
                  <span style={{ fontSize: 9, opacity: 0.6 }}>({projectTmpls.length})</span>
                </div>
              </div>
            )}
            {activeProjectPath && projectTmpls.map(t => (
              <div
                key={t.id}
                style={{ ...SIDEBAR_STYLE, padding: '6px 12px', background: selectedId === t.id ? (isDark ? '#2a2a4a' : '#e8ecf8') : 'transparent' }}
                onClick={() => selectTemplate(t)}
                onMouseEnter={e => { if (selectedId !== t.id) e.currentTarget.style.background = isDark ? '#1e1e3a' : '#f0f2f8' }}
                onMouseLeave={e => { if (selectedId !== t.id) e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{t.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: isDark ? '#888' : '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</div>
                </div>
              </div>
            ))}

            {/* 分割线 */}
            {activeProjectPath && projectTmpls.length > 0 && libTmpls.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 12px' }} />
            )}

            {/* 模版库 */}
            <div style={{ flexShrink: 0, padding: '8px 12px 4px' }}>
              <div style={{ fontSize: 10, color: isDark ? '#888' : '#999', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>📚 模版库</span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>({libTmpls.length})</span>
              </div>
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
              {libTmpls.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: isDark ? '#555' : '#bbb' }}>所有模板已关联到当前项目</div>
              ) : libTmpls.map(t => (
                <div
                  key={t.id}
                  style={{ ...SIDEBAR_STYLE, padding: '6px 12px', background: selectedId === t.id ? (isDark ? '#2a2a4a' : '#e8ecf8') : 'transparent' }}
                  onClick={() => selectTemplate(t)}
                  onMouseEnter={e => { if (selectedId !== t.id) e.currentTarget.style.background = isDark ? '#1e1e3a' : '#f0f2f8' }}
                  onMouseLeave={e => { if (selectedId !== t.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{t.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                    <div style={{ fontSize: 10, color: isDark ? '#888' : '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── 右侧：编辑器 ─────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {!selected ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexDirection: 'column', color: isDark ? '#555' : '#bbb' }}>
                <span style={{ fontSize: 40, opacity: 0.3 }}>📋</span>
                <span style={{ fontSize: 12 }}>从左侧选择一个模板开始编辑</span>
                <button className="btn btn-sm" onClick={newTemplate} style={{ fontSize: 10, marginTop: 4 }}>➕ 新建模板</button>
              </div>
            ) : (
              <>
                {/* 编辑工具栏 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>✏️ {selected.name || '未命名模板'}</span>
                  <span style={{ fontSize: 10, color: isDark ? '#888' : '#999' }}>{selected.phases.length} 阶段</span>
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-sm" onClick={() => handleRunWorkflow(selected)} disabled={runningWf === selected.id} style={{ fontSize: 10 }}>
                    {runningWf === selected.id ? '...' : '🚀 运行'}
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={saveEditor} style={{ fontSize: 10 }}>💾 保存</button>
                  <button className="btn btn-sm" onClick={() => deleteTemplate(selected.id)} style={{ fontSize: 10, color: '#ff5050' }}>🗑️ 删除</button>
                </div>

                {/* 编辑内容 */}
                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                  {/* 左侧：基本信息 */}
                  <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRight: '1px solid var(--border)', overflow: 'auto' }}>
                    <div>
                      <label style={{ fontSize: 10, display: 'block', marginBottom: 2, color: isDark ? '#aaa' : '#666' }}>图标</label>
                      <input type="text" value={selected.icon} onChange={e => setEditTmpl({ ...selected, icon: e.target.value })} placeholder="📦"
                        style={{ width: '100%', padding: '4px 8px', fontSize: 14, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, display: 'block', marginBottom: 2, color: isDark ? '#aaa' : '#666' }}>名称</label>
                      <input type="text" value={selected.name} onChange={e => setEditTmpl({ ...selected, name: e.target.value })} placeholder="模板名称"
                        style={{ width: '100%', padding: '4px 8px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, display: 'block', marginBottom: 2, color: isDark ? '#aaa' : '#666' }}>描述</label>
                      <textarea value={selected.description} onChange={e => setEditTmpl({ ...selected, description: e.target.value })} placeholder="模板功能描述" rows={3}
                        style={{ width: '100%', padding: '4px 8px', fontSize: 11, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 10, display: 'block', marginBottom: 2, color: isDark ? '#aaa' : '#666' }}>关联项目</label>
                      <select value={selected.projectPath || ''} onChange={e => setEditTmpl({ ...selected, projectPath: e.target.value || undefined })}
                        style={{ width: '100%', padding: '4px 8px', fontSize: 11, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }}>
                        <option value="">不限项目</option>
                        {projects.map((p, i) => <option key={i} value={p}>{p.split('\\').pop() || p}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* 右侧：阶段列表 */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>📋 阶段 ({selected.phases.length})</span>
                      <div style={{ flex: 1 }} />
                      <button className="btn btn-sm" onClick={addPhase} style={{ fontSize: 10 }}>➕ 添加阶段</button>
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {selected.phases.length === 0 && (
                        <div style={{ textAlign: 'center', padding: 20, fontSize: 11, color: isDark ? '#555' : '#bbb' }}>暂无阶段，点击"添加阶段"</div>
                      )}
                      {selected.phases.map((phase, pi) => (
                        <div key={pi} className="sk-mkt-source-item" style={{ padding: '10px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ fontSize: 10, color: isDark ? '#888' : '#999', minWidth: 20 }}>#{pi + 1}</span>
                            <input type="text" value={phase.name} onChange={e => updatePhase(pi, 'name', e.target.value)} placeholder="阶段名称"
                              style={{ flex: 1, padding: '3px 6px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }} />
                            <select value={phase.type} onChange={e => updatePhase(pi, 'type', e.target.value)}
                              style={{ padding: '3px 6px', fontSize: 11, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }}>
                              {PHASE_TYPES.map(pt => <option key={pt.id} value={pt.id}>{pt.label}</option>)}
                            </select>
                            <select value={phase.model} onChange={e => updatePhase(pi, 'model', e.target.value)}
                              style={{ padding: '3px 6px', fontSize: 11, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none' }}>
                              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                            </select>
                            <button className="btn-icon" onClick={() => movePhase(pi, -1)} disabled={pi === 0}
                              style={{ fontSize: 12, opacity: pi === 0 ? 0.3 : 1, padding: '2px' }}>↑</button>
                            <button className="btn-icon" onClick={() => movePhase(pi, 1)} disabled={pi === selected.phases.length - 1}
                              style={{ fontSize: 12, opacity: pi === selected.phases.length - 1 ? 0.3 : 1, padding: '2px' }}>↓</button>
                            <button className="btn-icon" onClick={() => removePhase(pi)} disabled={selected.phases.length <= 1}
                              style={{ fontSize: 12, color: '#ff5050', opacity: selected.phases.length <= 1 ? 0.3 : 1, padding: '2px' }}>✕</button>
                          </div>
                          <textarea value={phase.prompt} onChange={e => updatePhase(pi, 'prompt', e.target.value)} placeholder="该阶段的 Claude 提示词..." rows={3}
                            style={{ width: '100%', padding: '4px 8px', fontSize: 11, background: isDark ? '#161b22' : '#fff', border: '1px solid var(--border)', borderRadius: 4, color: isDark ? '#e0e0e0' : '#333', outline: 'none', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
