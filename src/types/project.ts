/** 智能体角色类型 */
export type AgentType = 'Coordinator' | 'Architect' | 'Implementer' | 'SecurityReviewer' | 'CodeExplorer'

/** 团队成员（像素办公室 + 智能体面板） */
export interface TeamMember {
  id: string
  name: string
  role: string
  skills: string
  agentType: AgentType
  status: 'working' | 'busy' | 'idle' | 'away'
  color: string
}

export interface ProjectInfo {
  name: string
  path: string
  description: string
  techStack: string
  sessions: number
  modifiedAt: string
}

export interface SessionInfo {
  sessionId: string
  projectPath: string
  modifiedAt: string
  size?: number
}

export interface TaskItem {
  id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'done'
  category?: 'task' | 'approval' | 'tool'
  agentType?: string
  toolCallId?: string
  projectPath?: string
  createdAt: string
  updatedAt: string
}
