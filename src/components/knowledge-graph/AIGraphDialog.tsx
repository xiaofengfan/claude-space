import { useState, useCallback } from 'react'
import { GRAPH_PROMPTS, type GraphPrompt } from './graphPrompts'

interface Props {
  theme: 'dark' | 'light'
  projectPath: string
  onClose: () => void
  /** 触发后台执行，dialog 立即关闭 */
  onExecute: (prompt: string, promptLabel: string) => void
  /** 粘贴模式：直接导入（支持异步） */
  onImportFromText: (text: string) => Promise<{ entities: number; relations: number } | null> | ({ entities: number; relations: number } | null)
  /** 可选：外部传入合并后的 prompts 列表（builtin+custom），未传则用 GRAPH_PROMPTS */
  prompts?: GraphPrompt[]
  /** 删除自定义模板 */
  onDeletePrompt?: (promptId: string) => void
}

export function AIGraphDialog({ theme, projectPath, onClose, onExecute, onImportFromText, prompts, onDeletePrompt }: Props) {
  const isDark = theme === 'dark'
  const allPrompts = prompts && prompts.length > 0 ? prompts : GRAPH_PROMPTS
  // 追加"自定义分析"选项作为最后一项（保持原行为：临时输入 prompt）
  const promptsWithCustom: GraphPrompt[] = [
    ...allPrompts,
    { id: '__adhoc_custom', label: '自定义分析', icon: '✏️', description: '自由输入分析指令，AI 解析后自动提取到图谱', systemPrompt: '', builtin: false },
  ]
  const [tab, setTab] = useState<'run' | 'paste'>('run')
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(allPrompts[0]?.id || null)
  const [customPrompt, setCustomPrompt] = useState('')
  const [pastedResponse, setPastedResponse] = useState('')
  const [pasteResult, setPasteResult] = useState<{ entities: number; relations: number } | null>(null)

  const selectedPrompt = promptsWithCustom.find(p => p.id === selectedPromptId)

  const handleExecute = useCallback(() => {
    const prompt = selectedPromptId === '__adhoc_custom' ? customPrompt : selectedPrompt?.systemPrompt || ''
    if (!prompt.trim()) return
    const label = selectedPromptId === '__adhoc_custom' ? '自定义分析' : (selectedPrompt?.label || 'AI 分析')
    onExecute(prompt, label)
  }, [selectedPromptId, selectedPrompt, customPrompt, onExecute])

  const handleParse = useCallback(async () => {
    if (!pastedResponse.trim()) return
    const r = await onImportFromText(pastedResponse)
    if (r) {
      setPasteResult(r)
      setTimeout(onClose, 600)
    }
  }, [pastedResponse, onImportFromText, onClose])

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', fontSize: 12,
    background: isDark ? '#1a1a1a' : '#fafafa',
    border: '1px solid var(--border)', borderRadius: 6,
    color: isDark ? '#e0e0e0' : '#333', outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}
        style={{ width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="dialog-header" style={{ flexShrink: 0 }}>
          <h2>🤖 AI 智能图谱分析</h2>
          <button className="dialog-close" onClick={onClose}>✕</button>
        </div>
        <div className="kn-tabs" style={{ flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
          <button className={`kn-tab${tab === 'run' ? ' active' : ''}`} onClick={() => setTab('run')}>🚀 执行分析</button>
          <button className={`kn-tab${tab === 'paste' ? ' active' : ''}`} onClick={() => setTab('paste')}>📋 粘贴回复</button>
        </div>
        <div className="dialog-body" style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'run' ? (
            <>
              <p style={{ fontSize: 11, color: isDark ? '#888' : '#999', marginBottom: 10 }}>
                选择分析类型，点击「执行」后将作为后台任务运行，可在右侧看板和顶部状态栏查看进度。
                {allPrompts.length > GRAPH_PROMPTS.length && (
                  <span style={{ marginLeft: 6, color: '#4caf50' }}>已加载 {allPrompts.length - GRAPH_PROMPTS.length} 个自定义模板</span>
                )}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {promptsWithCustom.map(p => (
                  <div key={p.id} onClick={() => setSelectedPromptId(p.id)} style={{
                    padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                    border: selectedPromptId === p.id ? '2px solid var(--accent)' : '2px solid var(--border)',
                    background: selectedPromptId === p.id ? (isDark ? 'rgba(108,140,255,0.08)' : 'rgba(108,140,255,0.06)') : 'transparent',
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{p.icon} {p.label}</span>
                      {!p.builtin && p.id !== '__adhoc_custom' && (
                        <>
                          <span style={{ marginLeft: 4, fontSize: 10, color: '#4caf50' }}>自定义</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeletePrompt?.(p.id); }}
                            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 11, padding: '2px 4px', borderRadius: 3, opacity: 0.6 }}
                            onMouseEnter={e => (e.target as HTMLElement).style.opacity = '1'}
                            onMouseLeave={e => (e.target as HTMLElement).style.opacity = '0.6'}
                            title="删除此模板"
                          >🗑 删除</button>
                        </>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: isDark ? '#999' : '#777' }}>{p.description}</div>
                  </div>
                ))}
              </div>
              {selectedPromptId === '__adhoc_custom' && (
                <textarea value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
                  placeholder="输入分析指令..." rows={4} style={{ ...inputStyle, marginTop: 10, resize: 'vertical', fontFamily: 'inherit' }} />
              )}
            </>
          ) : (
            <>
              <p style={{ fontSize: 11, color: isDark ? '#888' : '#999', marginBottom: 10 }}>粘贴 Claude 输出的 JSON 结果。</p>
              <textarea value={pastedResponse} onChange={e => setPastedResponse(e.target.value)}
                placeholder='粘贴 JSON（含 entities 和 relations）...' rows={12}
                style={{ ...inputStyle, fontSize: 11, fontFamily: 'Consolas, monospace', resize: 'vertical' }} />
              {pasteResult && (
                <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 4, fontSize: 12, background: isDark ? '#1a2a1a' : '#e8f5e9', color: '#4caf50' }}>
                  ✅ 已提取 {pasteResult.entities} 个实体 和 {pasteResult.relations} 个关系
                </div>
              )}
            </>
          )}
        </div>
        <div className="dialog-footer" style={{ flexShrink: 0, display: 'flex', gap: 8 }}>
          <button className="btn btn-cancel" onClick={onClose}>取消</button>
          <div style={{ flex: 1 }} />
          {tab === 'run' ? (
            <button className="btn btn-primary" onClick={handleExecute}
              disabled={!selectedPromptId && !customPrompt.trim()}
              style={{ background: '#2e7d32' }}>
              🚀 执行分析（后台）
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleParse} disabled={!pastedResponse.trim()}>
              🔍 提取到图谱
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
