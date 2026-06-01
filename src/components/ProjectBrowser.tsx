import { useState, useEffect, useMemo } from 'react'
import { ProjectInfo } from '../types/project'

interface FileNode {
  name: string; path: string; type: 'file' | 'directory'; children?: FileNode[]
}

const DOC_EXTENSIONS = ['.md', '.markdown', '.docx', '.xlsx', '.xls', '.pdf', '.txt', '.json', '.yaml', '.yml']

export function ProjectBrowser({
  projects, activeProject, onSelect, onRefresh, mode,
}: {
  projects: ProjectInfo[]; activeProject: ProjectInfo | null
  onSelect: (p: ProjectInfo) => void; onRefresh: () => void
  mode: 'projects' | 'files' | 'docs'
}) {
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (activeProject?.path) {
      loadFileTree(activeProject.path)
    } else {
      setFileTree([])
    }
  }, [activeProject?.path])

  async function loadFileTree(dirPath: string) {
    setLoading(true)
    try {
      if (!window.electronAPI?.scanDirectory) {
        console.error('scanDirectory not available on electronAPI')
        setFileTree([])
        setLoading(false)
        return
      }
      const result = await window.electronAPI.scanDirectory(dirPath)
      if (result && Array.isArray(result)) setFileTree(result)
      else setFileTree([])
    } catch (e) { console.error('loadFileTree error:', e); setFileTree([]) }
    setLoading(false)
  }

  // Filter documents: MD, DOCX, XLSX, PDF, etc.
  const docsTree = useMemo(() => {
    if (mode !== 'docs') return []
    return filterDocFiles(fileTree)
  }, [fileTree, mode])

  async function handleOpenFile() {
    if (!window.electronAPI?.openFileDialog) return
    const result = await window.electronAPI.openFileDialog()
    if (result && !result.canceled && result.filePath) {
      try {
        const res = await window.electronAPI.readFile(result.filePath)
        if (res?.success && res.content) {
          alert('文件内容:\n' + res.content.slice(0, 2000))
        }
      } catch (e) { console.error(e) }
    }
  }

  async function handleOpenDocFile(filePath: string) {
    try {
      const res = await window.electronAPI.readFile(filePath)
      if (res?.success && res.content) {
        alert('文件内容:\n' + res.content.slice(0, 2000))
      }
    } catch (e) { console.error(e) }
  }

  function handleOpenFolder() {
    if (activeProject) {
      window.electronAPI.openProjectFolder(activeProject.path)
    }
  }

  // ── Project view: only show selected project ───
  if (mode === 'projects') {
    return (
      <div className="project-browser">
        <div className="project-browser-header">
          <span>当前项目</span>
          <button onClick={() => activeProject && loadFileTree(activeProject.path)} className="icon-btn" title="刷新">🔄</button>
        </div>
        {activeProject ? (
          <div className="project-current">
            <div className="project-card active">
              <div className="project-card-name">📂 {activeProject.name}</div>
              <div className="project-card-meta">
                <span>{activeProject.techStack || '项目'}</span>
                <span>{activeProject.sessions || 0} 会话</span>
              </div>
              <div className="project-card-path">{activeProject.path}</div>
            </div>
            {/* Auto-load file tree */}
            <div className="project-file-tree">
              <div className="project-file-tree-label">📄 项目文件</div>
              <div className="file-tree">
                {fileTree.length > 0 ? (
                  <FileTreeNodes nodes={fileTree} depth={0} onOpenFile={handleOpenDocFile} />
                ) : (
                  <div className="empty-hint" style={{ fontSize: 11, padding: 8 }}>
                    {loading ? '加载中...' : '点击 🔄 加载文件树'}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="empty-hint">未选择项目</div>
        )}
      </div>
    )
  }

  // ── Full file tree (all files) + project info ─
  if (mode === 'files') {
    return (
      <div className="project-browser">
        {activeProject && (
          <div className="project-info-bar">
            <div className="project-info-name">📂 {activeProject.name}</div>
            <div className="project-info-path">{activeProject.path}</div>
            <div className="project-info-actions">
              <button className="project-info-btn" onClick={() => loadFileTree(activeProject.path)} title="刷新">🔄</button>
            </div>
          </div>
        )}
        <div className="file-tree">
          {loading ? <div className="empty-hint">加载中...</div>
            : fileTree.length > 0 ? <FileTreeNodes nodes={fileTree} depth={0} onOpenFile={handleOpenDocFile} />
            : <div className="empty-hint">{activeProject ? '加载文件树...' : '选择项目自动加载'}</div>}
        </div>
      </div>
    )
  }

  // ── Documents view ─────────────────────────────
  return (
    <div className="project-browser docs-browser">
      <div className="docs-toolbar">
        <button className="docs-toolbar-btn" onClick={handleOpenFile} title="打开文件">📂 打开</button>
        <button className="docs-toolbar-btn" onClick={handleOpenFolder} title="打开文件夹">📁 文件夹</button>
        <button className="docs-toolbar-btn" onClick={() => activeProject && loadFileTree(activeProject.path)} title="刷新">🔄 刷新</button>
      </div>
      <div className="file-tree">
        {loading ? (
          <div className="empty-hint">加载中...</div>
        ) : docsTree.length > 0 ? (
          <FileTreeNodes nodes={docsTree} depth={0} />
        ) : (
          <div className="empty-hint">
            {activeProject ? '暂无文档文件\n(.md .docx .xlsx .pdf .txt)' : '选择项目后自动加载'}
          </div>
        )}
      </div>
    </div>
  )
}

// ── File tree ──────────────────────────────────────

function FileTreeNodes({ nodes, depth, onOpenFile }: { nodes: FileNode[]; depth: number; onOpenFile?: (path: string) => void }) {
  return <div className="file-tree-nodes">{nodes.map(node => <FileTreeNode key={node.path} node={node} depth={depth} onOpenFile={onOpenFile} />)}</div>
}

function FileTreeNode({ node, depth, onOpenFile }: { node: FileNode; depth: number; onOpenFile?: (path: string) => void }) {
  const [expanded, setExpanded] = useState(depth < 2)
  const icon = node.type === 'directory' ? (expanded ? '📂' : '📁') : getFileIcon(node.name)

  return (
    <div className="file-tree-item">
      <div className="file-tree-row" style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => {
          if (node.type === 'directory') setExpanded(!expanded)
          else onOpenFile?.(node.path)
        }}>
        <span className="file-tree-icon">{icon}</span>
        <span className="file-tree-name">{node.name}</span>
      </div>
      {expanded && node.children && node.children.length > 0 && (
        <FileTreeNodes nodes={node.children} depth={depth + 1} />
      )}
    </div>
  )
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    md: '📝', markdown: '📝', docx: '📘', doc: '📘', xlsx: '📊', xls: '📊',
    pdf: '📕', txt: '📄', json: '📋', yaml: '⚙️', yml: '⚙️',
    ts: '🔷', tsx: '⚛️', js: '🟨', jsx: '⚛️',
    css: '🎨', html: '🌐', py: '🐍', java: '☕', xml: '📰',
    png: '🖼️', jpg: '🖼️', svg: '🖼️',
  }
  return map[ext || ''] || '📄'
}

// Filter tree to only document files
function filterDocFiles(nodes: FileNode[]): FileNode[] {
  return nodes
    .map(node => {
      if (node.type === 'directory') {
        const children = node.children ? filterDocFiles(node.children) : []
        return children.length > 0 ? { ...node, children } : null
      }
      const ext = '.' + (node.name.split('.').pop()?.toLowerCase() || '')
      return DOC_EXTENSIONS.includes(ext) ? node : null
    })
    .filter(Boolean) as FileNode[]
}
