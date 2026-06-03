// File type routing utility — determines how to display a file based on its extension

export type FileCategory = 'markdown' | 'code' | 'text' | 'binary' | 'unknown'

// Extension to language mapping for syntax highlighting (react-syntax-highlighter Prism languages)
const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'tsx',
  '.js': 'javascript', '.jsx': 'jsx', '.mjs': 'javascript', '.cjs': 'javascript',
  '.json': 'json', '.jsonc': 'json',
  '.css': 'css', '.scss': 'scss', '.less': 'less', '.sass': 'sass',
  '.html': 'markup', '.htm': 'markup', '.xml': 'xml', '.svg': 'svg',
  '.py': 'python', '.pyw': 'python', '.pyx': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.swift': 'swift',
  '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'fish',
  '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.ini': 'ini', '.cfg': 'ini',
  '.md': 'markdown', '.markdown': 'markdown', '.mdown': 'markdown', '.mkd': 'markdown',
  '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
  '.dockerfile': 'docker', 'dockerfile': 'docker',
  '.gitignore': 'git', '.gitattributes': 'git',
  '.env': 'bash', '.editorconfig': 'editorconfig',
  '.lua': 'lua', '.rb': 'ruby', '.php': 'php',
  '.r': 'r', '.scala': 'scala', '.clj': 'clojure', '.cljs': 'clojure',
  '.proto': 'protobuf', '.prisma': 'prisma',
  '.wasm': 'wasm',
  '.cs': 'csharp', '.vb': 'vbnet',
  '.dart': 'dart',
  '.erl': 'erlang', '.ex': 'elixir', '.exs': 'elixir',
  '.hs': 'haskell',
  '.elm': 'elm',
  '.nim': 'nim',
  '.zig': 'zig',
}

// Binary extensions that should NOT be opened as text
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz',
  '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.wav', '.mp4', '.avi', '.mov', '.mkv', '.webm', '.ogg',
  '.ttf', '.otf', '.woff', '.woff2',
  '.class', '.pyc', '.o', '.obj', '.lib', '.a',
  '.db', '.sqlite', '.sqlite3', '.mdb',
  '.iso', '.img', '.vmdk', '.qcow2',
  '.psd', '.ai', '.sketch',
])

// Markdown extensions — editable with preview
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])

/**
 * Determine the file category based on file name and binary detection result.
 */
export function getFileCategory(fileName: string, isBinary?: boolean): FileCategory {
  if (isBinary) return 'binary'
  const ext = '.' + (fileName.split('.').pop()?.toLowerCase() || '')
  if (BINARY_EXTENSIONS.has(ext)) return 'binary'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (EXT_TO_LANGUAGE[ext]) return 'code'
  return 'text'
}

/**
 * Get the Prism language identifier for syntax highlighting.
 */
export function getLanguageFromFileName(fileName: string): string | undefined {
  // Handle special filenames (no extension)
  const lower = fileName.toLowerCase()
  if (lower === 'dockerfile') return 'docker'
  if (lower === 'makefile') return 'makefile'
  if (lower === '.gitignore' || lower === '.gitattributes') return 'git'

  const ext = '.' + (fileName.split('.').pop()?.toLowerCase() || '')
  return EXT_TO_LANGUAGE[ext]
}
