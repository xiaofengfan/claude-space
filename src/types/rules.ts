export type RuleCategory =
  | 'code-review'
  | 'security'
  | 'conventions'
  | 'documentation'
  | 'api-design'
  | 'git'
  | 'testing'

export interface RuleItem {
  name: string
  path: string
  type: 'claude-md' | 'settings' | 'custom-rule'
  locked: boolean
  size?: number
  isNew?: boolean       // CLAUDE.md 标记为不存在（未创建）
  parentDir?: string    // 父目录相对路径（如 ".claude" 或 ".claude/rules"）
}

export interface RuleTemplate {
  id: string
  name: string
  category: RuleCategory
  description: string
  content: string
}
