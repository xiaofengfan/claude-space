import { useState, useEffect, useCallback, useRef } from 'react'
import type { RuleItem, RuleTemplate } from '../types/rules'
import { RULE_TEMPLATES } from '../constants/ruleTemplates'
import { RuleTemplatePicker } from './RuleTemplatePicker'

interface Props {
  activeProjectPath: string | undefined
  theme: 'dark' | 'light'
  /** 点击规则文件 → 在主编辑区打开（复用 FileEditor） */
  onOpenFile?: (filePath: string, fileName: string) => void
}

// ── 常量 ──────────────────────────────────────────
const RULE_EXTENSIONS = ['.md', '.json', '.yaml', '.yml', '.txt', '.toml', '.rules']
const CLAUDE_MD = 'CLAUDE.md'
const SETTINGS_JSON = 'settings.json'
const CLAUDE_DIR = '.claude'
const RULES_SUBDIR = 'rules'

function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}

function extname(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function getIcon(name: string): string {
  if (name === CLAUDE_MD) return '📄'
  if (name === SETTINGS_JSON) return '⚙️'
  const ext = extname(name)
  if (ext === '.json') return '📦'
  if (ext === '.yaml' || ext === '.yml') return '📑'
  if (ext === '.toml') return '⚙️'
  if (ext === '.rules') return '📜'
  return '📋'
}

function isTextRuleFile(name: string): boolean {
  const ext = extname(name)
  return RULE_EXTENSIONS.includes(ext) || name === CLAUDE_MD || name === SETTINGS_JSON
}

export function ContentRulesPanel({ activeProjectPath, theme, onOpenFile }: Props) {
  const [rules, setRules] = useState<RuleItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [pendingCreateFileName, setPendingCreateFileName] = useState('')
  const [pendingCreateSubdir, setPendingCreateSubdir] = useState(RULES_SUBDIR)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const templateIdRef = useRef<string | null>(null)

  const isDark = theme === 'dark'

  // ── 发现规则文件 ──────────────────────────────────
  const discoverRules = useCallback(async () => {
    if (!activeProjectPath) { setRules([]); return }
    const found: RuleItem[] = []

    // CLAUDE.md
    const claudeMdPath = joinPath(activeProjectPath, CLAUDE_MD)
    try {
      const result = await window.electronAPI.readFile(claudeMdPath)
      found.push({ name: CLAUDE_MD, path: claudeMdPath, type: 'claude-md', locked: true, size: result.success ? result.size : undefined, isNew: !result.success })
    } catch {
      found.push({ name: CLAUDE_MD, path: claudeMdPath, type: 'claude-md', locked: true, isNew: true })
    }

    // .claude/ 目录
    try {
      const scanResult = await window.electronAPI.scanDirectory(joinPath(activeProjectPath, CLAUDE_DIR))
      if (scanResult && Array.isArray(scanResult) && scanResult.length > 0) {
        for (const node of scanResult) {
          if (node.type !== 'file') continue
          if (node.name === SETTINGS_JSON) {
            found.push({ name: SETTINGS_JSON, path: node.path, type: 'settings', locked: true })
            continue
          }
          if (isTextRuleFile(node.name)) {
            found.push({ name: node.name, path: node.path, type: 'custom-rule', locked: false })
          }
        }
        // rules/ 递归
        for (const node of scanResult) {
          if (node.type !== 'directory' || node.name !== RULES_SUBDIR) continue
          if (node.children && Array.isArray(node.children)) {
            const flatten = (items: any[], prefix: string) => {
              for (const child of items) {
                if (child.type === 'directory' && child.children) {
                  flatten(child.children, prefix + child.name + '/')
                } else if (child.type === 'file' && isTextRuleFile(child.name) && !found.some(r => r.path === child.path)) {
                  found.push({ name: prefix + child.name, path: child.path, type: 'custom-rule', locked: false })
                }
              }
            }
            flatten(node.children, '')
          }
        }
      }
    } catch { /* .claude/ 不存在 */ }

    setRules(found)
  }, [activeProjectPath])

  useEffect(() => { discoverRules(); setShowCreateForm(false); setError(null) }, [discoverRules])

  // ── 打开规则 → 主编辑区 ───────────────────────────
  function handleOpenRule(rule: RuleItem) {
    // CLAUDE.md 不存在（isNew）→ 先创建
    if (rule.isNew) {
      openCreateForClaudeMd()
      return
    }
    onOpenFile?.(rule.path, rule.name)
  }

  function openCreateForClaudeMd() {
    setPendingCreateFileName(CLAUDE_MD)
    setPendingCreateSubdir('') // 根目录
    setShowCreateForm(true)
  }

  // ── 删除 ──────────────────────────────────────────
  async function handleDelete(rule: RuleItem) {
    if (rule.locked) return
    if (!confirm(`确定删除规则 "${rule.name}"？`)) return
    try {
      const r = await window.electronAPI.deleteFile(rule.path)
      if (r.success) await discoverRules()
      else setError(r.error || '删除失败')
    } catch (err: any) { setError(err?.message || '删除失败') }
  }

  // ── 新建 ──────────────────────────────────────────
  function openBlankCreate() { setPendingCreateFileName(''); setPendingCreateSubdir(RULES_SUBDIR); setShowCreateForm(true) }

  function handleTemplateSelect(template: RuleTemplate) {
    setShowTemplatePicker(false); templateIdRef.current = template.id
    setPendingCreateFileName(''); setPendingCreateSubdir(RULES_SUBDIR); setShowCreateForm(true)
  }

  async function handleCreateRule() {
    if (!pendingCreateFileName.trim() || !activeProjectPath) return
    const fileName = pendingCreateFileName.trim()

    // CLAUDE.md 特殊处理：创建在项目根目录
    const actualDirPath = pendingCreateSubdir === ''
      ? activeProjectPath
      : joinPath(activeProjectPath, pendingCreateSubdir)

    const filePath = joinPath(actualDirPath, fileName)
    if (rules.some(r => r.path === filePath) && !confirm(`规则 "${fileName}" 已存在，是否覆盖？`)) return

    setIsLoading(true); setError(null)
    try {
      let content = ''
      if (templateIdRef.current) {
        const tpl = RULE_TEMPLATES.find(t => t.id === templateIdRef.current)
        if (tpl) content = tpl.content
        templateIdRef.current = null
      }
      const result = await window.electronAPI.createFile({ dirPath: actualDirPath, fileName, content })
      if (result.success && result.filePath) {
        setShowCreateForm(false); setPendingCreateFileName(''); await discoverRules()
        // 创建后自动在主编辑区打开
        onOpenFile?.(result.filePath, fileName)
      } else setError(result.error || '创建失败')
    } catch (err: any) { setError(err?.message || '创建失败') }
    finally { setIsLoading(false) }
  }

  // ── 无项目 ────────────────────────────────────────
  if (!activeProjectPath) {
    return (
      <div className="content-rules-empty">
        <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
          <path d="M3 1L2 2v12l1 1h10l1-1V5l-4-4H3zm7 1.41L12.59 5H10V2.41zM3 15V3h6v3l1 1h3v8H3zm4-1h2v-2h2v-2h-2V8H7v2H5v2h2v2z" fillRule="evenodd" clipRule="evenodd" />
        </svg>
        <span>请先选择一个项目</span>
      </div>
    )
  }

  // ── 渲染：纯规则浏览器列表 ─────────────────────────
  return (
    <div className="content-rules-list-view">
      {/* 工具栏 */}
      <div className="content-rules-toolbar">
        <button className="btn btn-sm" onClick={openBlankCreate} title="新建空白规则">+ 新建</button>
        <button className="btn btn-sm" onClick={() => setShowTemplatePicker(true)} title="从模板库选择">📚 模板</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: isDark ? '#666' : '#999' }}>{rules.length} 个文件</span>
      </div>

      {/* 规则列表 */}
      <div className="content-rules-scroll-list">
        {error && <div className="content-rules-error">{error}</div>}
        {rules.length === 0 ? (
          <div className="empty-hint" style={{ padding: 24, textAlign: 'center', fontSize: 12 }}>
            暂无规则文件
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={openBlankCreate}>+ 新建规则</button>
            </div>
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.path}
              className="content-rules-list-item"
              onClick={() => handleOpenRule(rule)}
              title={rule.isNew ? '点击创建 CLAUDE.md' : `打开 ${rule.name}`}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{getIcon(rule.name)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {rule.name}
                  {rule.isNew && <span style={{ fontSize: 9, color: '#f0a040', marginLeft: 4 }}>NEW</span>}
                </div>
                {rule.size !== undefined && (
                  <div style={{ fontSize: 10, color: isDark ? '#666' : '#999' }}>
                    {rule.size < 1024 ? `${rule.size} B` : `${(rule.size / 1024).toFixed(0)} KB`}
                  </div>
                )}
              </div>
              {rule.locked && <span style={{ fontSize: 10, opacity: 0.4, flexShrink: 0 }}>🔒</span>}
              {!rule.locked && (
                <button className="btn-icon" onClick={e => { e.stopPropagation(); handleDelete(rule) }}
                  style={{ fontSize: 12, opacity: 0.4, padding: '0 4px', flexShrink: 0 }}>🗑️</button>
              )}
            </div>
          ))
        )}
      </div>

      {/* 模板选择弹窗 */}
      {showTemplatePicker && <RuleTemplatePicker theme={theme} onSelect={handleTemplateSelect} onClose={() => setShowTemplatePicker(false)} />}

      {/* 新建规则弹窗 */}
      {showCreateForm && (
        <div className="dialog-overlay" onClick={() => { setShowCreateForm(false); templateIdRef.current = null }}>
          <div className="dialog" onClick={e => e.stopPropagation()} style={{ width: 380 }}>
            <div className="dialog-header">
              <h2>📝 新建规则</h2>
              <button onClick={() => { setShowCreateForm(false); templateIdRef.current = null }} className="dialog-close">✕</button>
            </div>
            <div className="dialog-body" style={{ padding: 16 }}>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>文件名称</label>
                <input type="text" className="input" value={pendingCreateFileName} onChange={e => setPendingCreateFileName(e.target.value)}
                  placeholder="my-rule.md" autoFocus onKeyDown={e => { if (e.key === 'Enter') handleCreateRule() }}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 6, color: isDark ? '#e0e0e0' : '#333', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {/* CLAUDE.md 放根目录，其余可选位置 */}
              {pendingCreateFileName !== CLAUDE_MD && (
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: isDark ? '#aaa' : '#666', display: 'block', marginBottom: 4 }}>存放位置</label>
                  <select value={pendingCreateSubdir} onChange={e => setPendingCreateSubdir(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', fontSize: 12, background: isDark ? '#1a1a1a' : '#fafafa', border: '1px solid var(--border)', borderRadius: 6, color: isDark ? '#e0e0e0' : '#333', outline: 'none', cursor: 'pointer' }}>
                    <option value=".claude/rules">.claude/rules/ （规则目录）</option>
                    <option value=".claude">.claude/ （配置目录）</option>
                  </select>
                </div>
              )}
              {pendingCreateFileName === CLAUDE_MD && (
                <div style={{ fontSize: 10, color: isDark ? '#888' : '#999', marginBottom: 6 }}>创建在项目根目录</div>
              )}
              {templateIdRef.current && <div style={{ fontSize: 10, color: isDark ? '#888' : '#999', marginBottom: 6 }}>📚 来源：{RULE_TEMPLATES.find(t => t.id === templateIdRef.current)?.name}</div>}
              {error && <div style={{ color: '#ff5050', fontSize: 11, marginBottom: 6 }}>{error}</div>}
            </div>
            <div className="dialog-footer" style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => { setShowCreateForm(false); templateIdRef.current = null }}>取消</button>
              <button className="btn btn-primary" onClick={handleCreateRule} disabled={!pendingCreateFileName.trim() || isLoading}>
                {isLoading ? '创建中...' : '创建并编辑'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
