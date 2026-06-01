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
