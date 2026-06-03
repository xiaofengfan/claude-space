import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { getLanguageFromFileName } from '../utils/fileTypeUtils'

// Performance threshold: skip syntax highlighting for files larger than 100KB
const SYNTAX_HIGHLIGHT_SIZE_LIMIT = 100_000

interface FileViewerProps {
  content: string
  fileName: string
  theme: 'dark' | 'light'
}

export function FileViewer({ content, fileName, theme }: FileViewerProps) {
  const language = getLanguageFromFileName(fileName)
  const tooLarge = content.length > SYNTAX_HIGHLIGHT_SIZE_LIMIT

  if (tooLarge || !language) {
    // Plain text fallback for large files or unknown languages
    return (
      <div className={`file-viewer ${tooLarge ? 'file-viewer-large' : ''}`}>
        {tooLarge && (
          <div className="file-viewer-large-notice">
            ⚠️ 文件较大 ({formatSize(content.length)})，已跳过语法高亮以保持性能
          </div>
        )}
        <pre><code>{content}</code></pre>
      </div>
    )
  }

  return (
    <div className="file-viewer">
      <SyntaxHighlighter
        language={language}
        style={theme === 'dark' ? oneDark : oneLight}
        showLineNumbers
        wrapLines
        customStyle={{
          margin: 0,
          padding: '16px',
          fontSize: '13px',
          lineHeight: '1.5',
          borderRadius: 0,
          background: theme === 'dark' ? '#141428' : '#fafafa',
        }}
        lineNumberStyle={{
          minWidth: '3em',
          paddingRight: '1em',
          color: theme === 'dark' ? '#555' : '#bbb',
          userSelect: 'none',
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
