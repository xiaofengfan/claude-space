import { useState, useEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { RuleTemplate } from '../types/rules'
import { RULE_CATEGORIES, RULE_TEMPLATES } from '../constants/ruleTemplates'

interface Props {
  theme: 'dark' | 'light'
  onSelect: (template: RuleTemplate) => void
  onClose: () => void
}

export function RuleTemplatePicker({ theme, onSelect, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<RuleTemplate['category']>('code-review')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [winSize, setWinSize] = useState({ w: 1100, h: 750 })
  const previewRef = useRef<HTMLDivElement>(null)

  // 窗口80%尺寸
  useEffect(() => {
    function update() {
      setWinSize({
        w: Math.max(800, Math.floor(window.innerWidth * 0.8)),
        h: Math.max(500, Math.floor(window.innerHeight * 0.8)),
      })
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // 自动选中分类下第一个模板
  useEffect(() => {
    const first = RULE_TEMPLATES.find((t) => t.category === activeCategory)
    setSelectedId(first?.id ?? null)
  }, [activeCategory])

  const filtered = useMemo(
    () => RULE_TEMPLATES.filter((t) => t.category === activeCategory),
    [activeCategory],
  )

  const selected = selectedId
    ? RULE_TEMPLATES.find((t) => t.id === selectedId) ?? null
    : filtered[0] ?? null

  const isDark = theme === 'dark'
  const codeStyle = isDark ? oneDark : oneLight

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog rule-tpl-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: winSize.w, height: winSize.h }}
      >
        {/* 头部 */}
        <div className="dialog-header">
          <h2>📚 规则模板库</h2>
          <span style={{ fontSize: 11, color: isDark ? '#666' : '#999', marginLeft: 8 }}>
            {RULE_TEMPLATES.length} 个模板 · 7 个分类
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="dialog-close">✕</button>
        </div>

        {/* 分类标签 */}
        <div className="rule-tpl-tabs">
          {RULE_CATEGORIES.map((cat) => {
            const count = RULE_TEMPLATES.filter((t) => t.category === cat.id).length
            return (
              <button
                key={cat.id}
                className={`rule-tpl-tab${cat.id === activeCategory ? ' active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.icon} {cat.label}
                <span style={{ marginLeft: 4, opacity: 0.6, fontSize: 10 }}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* 主体：列表 + 预览 */}
        <div className="rule-tpl-body">
          {/* 左侧模板列表 */}
          <div className="rule-tpl-list">
            {filtered.map((tpl) => (
              <div
                key={tpl.id}
                className={`rule-tpl-item${selectedId === tpl.id ? ' selected' : ''}`}
                onClick={() => setSelectedId(tpl.id)}
              >
                <div className="rule-tpl-item-name">{tpl.name}</div>
                <div className="rule-tpl-item-desc">{tpl.description}</div>
              </div>
            ))}
          </div>

          {/* 右侧预览区 */}
          <div className="rule-tpl-preview" ref={previewRef}>
            {selected ? (
              <>
                <div className="rule-tpl-preview-header">
                  <span style={{ fontWeight: 600 }}>{selected.name}</span>
                  <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8 }}>
                    {RULE_CATEGORIES.find((c) => c.id === selected.category)?.label}
                  </span>
                </div>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '')
                      const inline = !match
                      return !inline ? (
                        <SyntaxHighlighter
                          style={codeStyle}
                          language={match![1]}
                          PreTag="div"
                          customStyle={{ fontSize: 12 }}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      )
                    },
                  }}
                >
                  {selected.content}
                </ReactMarkdown>
              </>
            ) : (
              <div className="empty-hint">该分类暂无模板</div>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="rule-tpl-footer">
          <div style={{ fontSize: 11, color: isDark ? '#666' : '#999' }}>
            {selected && (
              <>
                选中：<strong style={{ color: isDark ? '#ccc' : '#333' }}>{selected.name}</strong>
                <span style={{ marginLeft: 8 }}>
                  {selected.content.split('\n').length} 行 · {(selected.content.length / 1024).toFixed(1)} KB
                </span>
              </>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>取消</button>
          <button
            className="btn btn-primary"
            onClick={() => selected && onSelect(selected)}
            disabled={!selected}
            style={{ marginLeft: 8 }}
          >
            使用此模板创建规则
          </button>
        </div>
      </div>
    </div>
  )
}
