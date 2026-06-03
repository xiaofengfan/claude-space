import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useSplitter } from '../hooks/useSplitter'

interface MarkdownEditorProps {
  content: string
  onChange: (newContent: string) => void
  theme: 'dark' | 'light'
}

export function MarkdownEditor({ content, onChange, theme }: MarkdownEditorProps) {
  const splitter = useSplitter({
    direction: 'horizontal',
    initialSize: Math.max(200, Math.floor(window.innerWidth * 0.45)),
    minSize: 200,
    maxSize: window.innerWidth - 300,
    reverse: false,
  })

  const isDark = theme === 'dark'

  return (
    <div className="markdown-editor">
      {/* Editor pane */}
      <div className="markdown-editor-pane left" style={{ width: splitter.size, flexShrink: 0 }}>
        <textarea
          className="markdown-editor-textarea"
          value={content}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder="在这里编写 Markdown..."
          style={{ color: isDark ? '#e0e0e0' : '#333' }}
        />
      </div>

      {/* Splitter */}
      <div className="splitter splitter-v" onMouseDown={splitter.onMouseDown} />

      {/* Preview pane */}
      <div className="markdown-editor-pane right markdown-preview">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '')
              const inline = !match
              return !inline ? (
                <SyntaxHighlighter
                  style={isDark ? oneDark : oneLight}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: '12px 0',
                    padding: '12px',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    borderRadius: '8px',
                  }}
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
          {content || '*（预览为空）*'}
        </ReactMarkdown>
      </div>
    </div>
  )
}
