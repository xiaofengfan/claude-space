import type { TeamMember } from '../types/project'

/** 默认团队（像素办公室 9 人配置） */
export const DEFAULT_TEAM: TeamMember[] = [
  { id: 'pm', name: '王经理', role: '项目经理', skills: '进度管理', agentType: 'Coordinator', status: 'working', color: '#4a7cf7' },
  { id: 'po', name: '李产品', role: '产品经理', skills: '需求分析', agentType: 'Coordinator', status: 'working', color: '#7c5cbf' },
  { id: 'arch', name: '张架构', role: '架构师', skills: '系统设计', agentType: 'Architect', status: 'busy', color: '#e05555' },
  { id: 'senior', name: '赵工', role: '高级工程师', skills: '核心开发', agentType: 'Implementer', status: 'working', color: '#3d8b5e' },
  { id: 'dev1', name: '钱开发', role: '开发工程师', skills: '前后端', agentType: 'Implementer', status: 'working', color: '#e89030' },
  { id: 'dev2', name: '孙开发', role: '开发工程师', skills: '前端组件', agentType: 'Implementer', status: 'idle', color: '#3a9cc0' },
  { id: 'qa', name: '周测试', role: '测试工程师', skills: '自动化测试', agentType: 'SecurityReviewer', status: 'idle', color: '#b05090' },
  { id: 'review', name: '吴审查', role: '代码审查', skills: '代码审计', agentType: 'SecurityReviewer', status: 'busy', color: '#d07040' },
  { id: 'claude', name: 'Claude', role: 'AI 助手', skills: '代码生成、问题分析、架构设计、全栈开发', agentType: 'CodeExplorer', status: 'working', color: '#d97706' },
]
