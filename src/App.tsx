import { useState, useCallback, useEffect, useRef } from 'react'
import { ProjectInfo, TaskItem, ChatMessage, SessionInfo, ToolCall } from './types'
import type { AppSettingsSafe } from './types/settings'
import { MenuBar, MenuGroup } from './components/MenuBar'
import { ProjectBrowser } from './components/ProjectBrowser'
import { ProjectManagerDialog } from './components/ProjectManagerDialog'
import { ProjectNav } from './components/ProjectNav'
import { ChatPanel } from './components/ChatPanel'
import { TaskStats } from './components/TaskStats'
import { TaskPlanList } from './components/TaskPlanList'
import { TaskMonitor } from './components/TaskMonitor'
import { SessionList } from './components/SessionList'
import { SettingsDialog } from './components/SettingsDialog'
import { WelcomePage } from './components/WelcomePage'
import { ProjectSwitchDialog } from './components/ProjectSwitchDialog'
import { NewProjectDialog } from './components/NewProjectDialog'
import { PixelOffice } from './components/PixelOffice'
import { SshConnectionPanel } from './components/SshConnectionPanel'
import { RemoteFileBrowser } from './components/RemoteFileBrowser'
import { DeploymentPanel } from './components/DeploymentPanel'
import { RemoteTerminalPanel } from './components/RemoteTerminalPanel'
import { StatusBar } from './components/StatusBar'
import { ConnectionPanel } from './components/ConnectionPanel'
import { TerminalPanel } from './components/TerminalPanel'
import { GitPanel } from './components/GitPanel'
import { GitSlidePanel } from './components/GitSlidePanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { FileEditor } from './components/FileEditor'
import { FileViewerWindow } from './components/FileViewerWindow'
import { AssistantPanel } from './components/AssistantPanel'
import { useSplitter } from './hooks/useSplitter'
import { useTaskSync, ApprovalRequest } from './hooks/useTaskSync'

export default function App() {
  const searchParams = new URLSearchParams(window.location.search)
  const urlProject = searchParams.get('project')
  const isFileViewer = searchParams.get('fileViewer') === '1'
  const viewerFilePath = searchParams.get('filePath') || ''
  const viewerFileName = searchParams.get('fileName') || ''

  // File viewer window: simplified layout
  if (isFileViewer && viewerFilePath) {
    return <FileViewerWindow
      filePath={viewerFilePath}
      fileName={viewerFileName}
      projectPath={urlProject || undefined}
    />
  }

const DEFAULT_TEAM = [
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

  const [theme, setThemeState] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('claude-space-theme') as 'dark' | 'light') || 'dark'
  )
  const [leftView, setLeftView] = useState<'files' | 'sessions' | 'docs' | 'git'>('files')
  const [rightView, setRightView] = useState<'tasks' | 'office' | 'connection' | 'plan' | 'assistant' | 'ssh' | 'remote-files' | 'deploy'>('tasks')
  const [showSettings, setShowSettings] = useState(false)
  const [showProjectManager, setShowProjectManager] = useState(false)
  const [pendingProject, setPendingProject] = useState<ProjectInfo | null>(null)
  const [showGitPanel, setShowGitPanel] = useState(false)
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)

  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [activeProject, setActiveProject] = useState<ProjectInfo | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [claudeRunning, setClaudeRunning] = useState(false)
  const [claudeConnected, setClaudeConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [team, setTeam] = useState<any[]>([])
  const [statusInfo, setStatusInfo] = useState({ model: '', tokens: 0, cost: 0 })
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>()
  // ── 活跃会话管理 + 名称持久化 ──
  const [activeSessions, setActiveSessions] = useState<Array<{ id: string; name: string; running?: boolean; connected?: boolean }>>([])
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({})

  // 加载持久化的会话名
  useEffect(() => {
    window.electronAPI.loadSessionNames?.().then(names => {
      if (names && Object.keys(names).length > 0) setSessionNames(names)
    }).catch(() => {})
  }, [])

  function saveSessionName(sessionId: string, name: string) {
    setSessionNames(prev => {
      const next = { ...prev, [sessionId]: name }
      window.electronAPI.saveSessionNames?.(next).catch(() => {})
      return next
    })
  }

  function getOrCreateSession(sid: string): string {
    setActiveSessions(prev => {
      if (prev.find(s => s.id === sid)) return prev
      const existingName = sessionNames[sid] || ''
      return [...prev, { id: sid, name: existingName || getDefaultSessionName(prev.length) }]
    })
    return sid
  }

  function ensureCurrentSession(): string {
    if (currentSessionId) {
      getOrCreateSession(currentSessionId)
      return currentSessionId
    }
    // No session yet — create one and switch to it
    const id = 'session_' + Date.now().toString(36)
    setCurrentSessionId(id)
    setActiveSessions(prev => [...prev, { id, name: getDefaultSessionName(prev.length) }])
    return id
  }

  function getDefaultSessionName(count: number): string {
    return `会话 ${count + 1}`
  }

  function autoNameSession(sessionId: string, message: string) {
    const clean = message.replace(/@\S+/g, '').trim()
    if (!clean || clean.length < 3) return
    const name = clean.length > 24 ? clean.slice(0, 24) + '...' : clean
    // Always update with the first meaningful message
    setActiveSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name } : s))
    saveSessionName(sessionId, name)
  }

  function createNewSession() {
    const id = 'session_' + Date.now().toString(36)
    setActiveSessions(prev => [...prev, { id, name: getDefaultSessionName(prev.length) }])
    setMessages([])
    setStreamingText('')
    setCurrentSessionId(id)
  }

  function switchToSession(sessionId: string) {
    setCurrentSessionId(sessionId)
    // 加入活跃列表
    getOrCreateSession(sessionId)
    // Load session messages from history
    window.electronAPI.getSessionTranscript?.(sessionId).then(t => {
      if (t?.events?.length) {
        const msgs = t.events.filter((e: any) => e.type === 'user' || e.type === 'assistant')
          .map((e: any) => parseSessionMessage(e))
          .filter((m: ChatMessage | null): m is ChatMessage => m !== null && !!m.content)
        if (msgs.length > 0) setMessages(msgs)
        else { setMessages([]); setStreamingText('') }
      } else { setMessages([]); setStreamingText('') }
    }).catch(() => { setMessages([]); setStreamingText('') })
    // 切换终端
    if (activeProject) {
      window.electronAPI.terminalStart({
        cwd: activeProject.path,
        sessionId: sessionId,
        autoApproval: autoApprovalRef.current,
      }).then(() => setTerminalReady(true)).catch(() => {})
    }
  }

  function deleteSession(sessionId: string) {
    window.electronAPI.sessionStop?.(sessionId)
    setActiveSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId)
      if (sessionId === currentSessionId) {
        if (next.length > 0) {
          setCurrentSessionId(next[0].id)
          switchToSession(next[0].id)
        } else {
          setCurrentSessionId(undefined)
          setMessages([])
          setStreamingText('')
        }
      }
      return next
    })
  }

  // 获取会话显示名（优先持久化名）
  function getSessionDisplayName(sessionId: string): string {
    const active = activeSessions.find(s => s.id === sessionId)
    if (active?.name && !active.name.startsWith('会话 ')) return active.name
    if (sessionNames[sessionId]) return sessionNames[sessionId]
    return active?.name || sessionId.slice(0, 12) + '...'
  }
  const [appSettings, setAppSettings] = useState<AppSettingsSafe | null>(null)
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null)
  const [monitorEvents, setMonitorEvents] = useState<any[]>([])
  // ── 文件标签系统 ──
  interface FileTab { id: string; path: string; name: string; isDirty?: boolean }
  const [fileTabs, setFileTabs] = useState<FileTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const openFile = activeTabId ? fileTabs.find(t => t.id === activeTabId) || null : null
  const [groupChatMode, setGroupChatMode] = useState(false)
  const [chatMode, setChatMode] = useState<'chat' | 'terminal' | 'editor' | 'remote-terminal'>('chat')
  const [terminalReady, setTerminalReady] = useState(false)
  const [terminalClaudeRunning, setTerminalClaudeRunning] = useState(false)
  const [sshStatus, setSshStatus] = useState<{ serverId: string | null; status: string; error: string }>({ serverId: null, status: 'disconnected', error: '' })

  const leftSplitter = useSplitter({ direction: 'horizontal', initialSize: 260, minSize: 180, maxSize: 420 })
  const rightSplitter = useSplitter({ direction: 'horizontal', initialSize: 340, minSize: 280, maxSize: 560, reverse: true })

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('claude-space-theme', theme)
  }, [theme])

  // Init
  useEffect(() => {
    loadTasks(); loadTeam(); loadSettings()
    if (urlProject) {
      const p: ProjectInfo = { name: urlProject.split(/[/\\]/).pop() || urlProject, path: urlProject, description: '', techStack: '', sessions: 0, modifiedAt: new Date().toISOString() }
      handleSelectProject(p)
    }
  }, [])

  const loadProjectsForDialog = async () => {
    try { setProjects(await window.electronAPI.scanProjects()) } catch (_e) { /* silent */ }
  }
  const loadTasks = async () => {
    try { setTasks(await window.electronAPI.loadTasks()) } catch (_e) { /* silent */ }
  }
  const loadTeam = async () => {
    try {
      const saved = await window.electronAPI.loadTeam?.()
      if (saved?.length) setTeam(saved)
    } catch (_e) { /* silent */ }
  }
  const handleTeamChange = async (newTeam: any[]) => {
    setTeam(newTeam)
    try { await window.electronAPI.saveTeam?.(newTeam) } catch (_e) { /* silent */ }
  }
  const loadSettings = async () => {
    try {
      const s = await window.electronAPI.loadSettings()
      setAppSettings(s)
      if (s?.defaultGroupChat) setGroupChatMode(true)
    } catch (_e) { /* silent */ }
  }
  const handleSaveSettings = useCallback(async (newSettings: AppSettingsSafe) => {
    setAppSettings(newSettings)
    try { await window.electronAPI.saveSettings(newSettings) } catch (_e) { /* silent */ }
  }, [])
  const loadSessions = async (projectPath?: string) => {
    try { setSessions(await window.electronAPI.listSessions(projectPath)) } catch (_e) { /* silent */ }
  }

  const handleSelectProject = useCallback(async (project: ProjectInfo) => {
    // 同一项目不重复清空消息，防止会话丢失
    const isSameProject = activeProjectRef.current?.path === project.path
    setActiveProject(project)
    if (!isSameProject) {
      setMessages([])
      setStreamingText('')
    }
    setLeftView('files')  // 默认显示完整文件树
    // 切换项目 → 重置所有团队状态为 idle
    setTeam(prev => {
      const base = prev.length ? prev : DEFAULT_TEAM
      return base.map(e => ({ ...e, status: 'idle' as const }))
    })
    try { setSessions(await window.electronAPI.listSessions(project.path)) } catch (_e) { /* silent */ }
    if (!isSameProject) {
      try {
        const recent = await window.electronAPI.getRecentSession?.(project.path)
        if (recent?.messages?.length) {
          const msgs = recent.messages
            .filter((m: any) => m.type === 'user' || m.type === 'assistant')
            .map((m: any) => parseSessionMessage(m))
            .filter((m: ChatMessage | null): m is ChatMessage => m !== null && !!m.content)
          if (msgs.length > 0) setMessages(msgs)
          if (recent?.sessionId) setCurrentSessionId(recent.sessionId)
        }
      } catch (_e) { /* silent */ }
    }

    // 自动启动终端 + Claude（后台，不切换视图）
    try {
      const recent = await window.electronAPI.getRecentSession?.(project.path)
      await window.electronAPI.terminalStart({
        cwd: project.path,
        sessionId: recent?.sessionId,
        autoApproval: autoApprovalRef.current,
      })
      setTerminalReady(true)
    } catch { /* 非关键 */ }
  }, [])

  // 解析会话历史消息 — 保留 tool_use/tool_result/thinking 结构
  function getFileTabIcon(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase()
    const map: Record<string, string> = {
      ts:'🔷',tsx:'⚛️',js:'🟨',jsx:'⚛️',css:'🎨',scss:'🎨',
      html:'🌐',md:'📝',json:'📋',yaml:'⚙️',yml:'⚙️',
      py:'🐍',java:'☕',xml:'📰',sql:'🗄️',sh:'💻',txt:'📄',
    }
    return map[ext || ''] || '📄'
  }

  function parseSessionMessage(m: any): ChatMessage | null {
    if (!m.message?.content) return null
    const blocks: any[] = Array.isArray(m.message.content)
      ? m.message.content
      : [{ type: 'text', text: String(m.message.content) }]

    let textContent = ''
    let thinking = ''
    const toolCalls: ToolCall[] = []
    const pendingTools = new Map<string, ToolCall>()

    for (const block of blocks) {
      if (block.type === 'text') {
        textContent += (textContent ? '\n' : '') + (block.text || '')
      } else if (block.type === 'thinking') {
        thinking += (thinking ? '\n' : '') + (block.thinking || '')
      } else if (block.type === 'tool_use') {
        const tool: ToolCall = {
          id: block.id || Math.random().toString(36),
          name: block.name || 'unknown',
          input: block.input || {},
          isComplete: false,
        }
        pendingTools.set(tool.id, tool)
        toolCalls.push(tool)
      } else if (block.type === 'tool_result') {
        const toolUseId = (block as any).tool_use_id
        if (toolUseId) {
          const existing = pendingTools.get(toolUseId)
          if (existing) {
            existing.result = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content)
            existing.isComplete = true
          }
        }
      }
    }

    return {
      id: m.uuid || Math.random().toString(36),
      role: m.type === 'user' ? 'user' : 'assistant',
      content: textContent,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      timestamp: Date.now() - 1000,
    }
  }

  const handleSwitchProject = useCallback(async (project: ProjectInfo) => {
    handleSelectProject(project)
  }, [handleSelectProject])

  const handleNewProject = useCallback(async () => {
    setShowNewProjectDialog(true)
  }, [])

  const handleCreateProject = useCallback(async (name: string) => {
    const res = await window.electronAPI.newProject?.(name)
    if (!res) throw new Error('无法连接到主进程')
    if (res.error) throw new Error(res.error)
    if (!res.canceled && res.path) {
      const p: ProjectInfo = {
        name: res.name || res.path.split(/[/\\]/).pop() || '',
        path: res.path,
        description: '',
        techStack: '',
        sessions: 0,
        modifiedAt: new Date().toISOString()
      }
      handleSelectProject(p)
    }
  }, [handleSelectProject])

  const handleTasksChange = useCallback(async (updater: TaskItem[] | ((prev: TaskItem[]) => TaskItem[])) => {
    setTasks(prev => {
      const newTasks = typeof updater === 'function' ? updater(prev) : updater
      window.electronAPI.saveTasks(newTasks).catch(() => {})
      return newTasks
    })
  }, [])

  const autoApproval = appSettings?.autoApproval ?? false
  const autoApprovalRef = useRef(autoApproval)
  autoApprovalRef.current = autoApproval  // 保持 ref 最新，防止 useCallback 闭包过期
  const activeProjectRef = useRef(activeProject)
  activeProjectRef.current = activeProject

  // @mention 处理：创建任务 + 更新办公室员工状态
  const handleMentionAgent = useCallback((agentName: string, content: string) => {
    const currentTeam = team.length ? team : DEFAULT_TEAM
    const cleanContent = content.replace(/@\S+/g, '').trim()

    // @all → 全员通知
    if (agentName === 'all') {
      currentTeam.forEach((emp: any, i: number) => {
        setTimeout(() => {
          const newTask: TaskItem = {
            id: `all_${Date.now().toString(36)}_${i}`,
            title: cleanContent ? `💬 @all→${emp.name}: ${cleanContent.slice(0, 30)}` : `💬 @all→${emp.name}`,
            description: content, status: 'todo', category: 'task',
            agentType: emp.agentType, projectPath: activeProject?.path,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          }
          setTasks(prev => [...prev, newTask])
          setMessages(prev => [...prev, {
            id: `all_${Date.now()}_${i}`,
            role: 'assistant' as const,
            content: `📢 **${emp.name}** 收到全员通知`,
            timestamp: Date.now(), agentIcon: emp.icon || '👤', agentName: emp.name,
          }])
        }, i * 150)
      })
      return
    }

    // 单个@员工
    const emp = currentTeam.find((e: any) =>
      e.name === agentName || e.role === agentName ||
      e.name.includes(agentName) || agentName.includes(e.name))
    if (!emp) return
    const taskTitle = cleanContent.length > 40 ? cleanContent.slice(0, 40) + '...' : cleanContent
    const newTask: TaskItem = {
      id: 'mention_' + Date.now().toString(36),
      title: cleanContent ? `💬 @${emp.name}: ${taskTitle}` : `💬 @${emp.name} 已指派`,
      description: content, status: 'todo', category: 'task',
      agentType: emp.agentType, projectPath: activeProject?.path,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    setTasks(prev => [...prev, newTask])
    setMessages(prev => [...prev, {
      id: 'confirm_' + Date.now().toString(36),
      role: 'assistant' as const,
      content: cleanContent ? `📋 **${emp.name}** 收到：${cleanContent.slice(0, 60)}` : `📋 **${emp.name}** 收到`,
      timestamp: Date.now(), agentIcon: emp.icon || '👤', agentName: emp.name,
    }])
  }, [team, activeProject])

  // ── 群聊：多智能体消息发送 ─────────────────────────
  const handleAgentSendGroup = useCallback(async (content: string, targetNames: string[]) => {
    if (!activeProject) return
    const currentTeam = team.length ? team : DEFAULT_TEAM
    const rawContent = content.replace(/@\S+/g, '').trim()

    // Match targets from team
    // @all → expand to all team members
    let resolvedNames = targetNames
    if (targetNames.includes('all') || targetNames.includes('全员')) {
      resolvedNames = currentTeam.map((e: any) => e.name)
    }

    const teamTargets = resolvedNames.map(mentionName => {
      const emp = currentTeam.find((e: any) =>
        e.name === mentionName || e.role === mentionName ||
        e.name.includes(mentionName) || mentionName.includes(e.name))
      if (!emp) return null
      return {
        agentId: emp.id,
        agentType: emp.agentType || 'CodeExplorer',
        agentName: emp.name,
        agentIcon: emp.icon || '🤖',
        agentColor: emp.color || '#888',
        modelId: emp.modelId,  // 逐智能体模型绑定
      }
    }).filter(Boolean) as Array<{
      agentId: string; agentType: string; agentName: string
      agentIcon: string; agentColor: string; modelId?: string
    }>

    if (teamTargets.length === 0) return
    const groupId = 'group_' + Date.now().toString(36)

    // Build persona prompts for each agent
    const personaContents = teamTargets.map(t => {
      let prompt = ''
      // Use personas from the personas module (imported inline for simplicity)
      const personaMap: Record<string, string> = {
        Coordinator: `[ROLE: 项目协调者 — ${t.agentName}]\n你是项目协调者，负责统筹协调和任务分解。回复简洁有条理，用列表形式。`,
        Architect: `[ROLE: 系统架构师 — ${t.agentName}]\n你是系统架构师，负责技术方案设计和架构评审。先给整体思路，再给具体方案和利弊分析。`,
        Implementer: `[ROLE: 高级开发工程师 — ${t.agentName}]\n你是高级开发工程师，负责代码实现。写代码前先说明方案，严格遵循项目现有规范。`,
        SecurityReviewer: `[ROLE: 安全审查员 — ${t.agentName}]\n你是安全审查员，按严重程度分类报告漏洞，引用具体漏洞类型，给出修复代码。`,
        CodeExplorer: `[ROLE: 代码探索者 — ${t.agentName}]\n你是代码探索者，分析代码并给出文件路径和行号，解释逻辑和数据流。`,
      }
      prompt = personaMap[t.agentType] || personaMap['CodeExplorer']
      return { agentId: t.agentId, prompt }
    })

    // Create user message
    const userMsg: ChatMessage = {
      id: 'u_' + Date.now().toString(36),
      role: 'user', content,
      timestamp: Date.now(),
      agentIcon: '👑', agentName: '控制人',
      groupId,
    }

    // Create placeholder messages for each target agent
    const placeholders: ChatMessage[] = teamTargets.map(a => ({
      id: `a_${a.agentId}_${Date.now().toString(36)}`,
      role: 'assistant' as const, content: '',
      timestamp: Date.now(), isStreaming: true,
      agentIcon: a.agentIcon, agentName: a.agentName,
      agentType: a.agentType, agentId: a.agentId,
      agentColor: a.agentColor, groupId,
    }))

    setMessages(prev => [...prev, userMsg, ...placeholders])

    // Send to main process
    try {
      await window.electronAPI.agentSendGroup({
        groupId,
        content: rawContent,
        targets: teamTargets,
        personaContents,
        projectPath: activeProject.path,
        modelId: appSettings?.activeModelId || undefined,
        autoApproval: true, // group chat always auto-approves for now
      })
    } catch (e) {
      console.error('agentSendGroup error:', e)
    }
  }, [activeProject, team, appSettings])

  // Real-time task sync from Claude events
  useTaskSync({
    tasks,
    onTasksChange: handleTasksChange,
    activeProjectPath: activeProject?.path,
    onApproval: setPendingApproval,
    autoApproval,
    onActivityStart: () => {
      // Claude 开始执行工具时，自动切换到看板让用户看到实时进度
      setRightView('tasks')
    },
    onMonitorEvent: (evt) => setMonitorEvents(prev => [evt, ...prev].slice(0, 100)),
    onTaskComplete: (title: string) => {
      const resultMsg: ChatMessage = {
        id: 'complete_' + Date.now().toString(36),
        role: 'assistant',
        content: `✅ 任务完成：${title?.slice(0, 80)}`,
        timestamp: Date.now(),
        agentIcon: '🤖',
        agentName: 'Claude',
      }
      setMessages(prev => [...prev, resultMsg])
    },
  })

  const handleApprove = useCallback(async (approvalId: string, optionIndex: number) => {
    const approval = pendingApproval
    if (!approval) return

    // Send permission response to Claude stdin
    const isStderrPrompt = approval.toolName === 'PermissionPrompt'
    const isToolPermission = approval.toolName && approval.toolName !== 'AskUserQuestion' && approval.toolName !== 'PermissionPrompt'

    if (isStderrPrompt) {
      // stderr-based permission prompt: send y/n directly
      const response = optionIndex === 0 ? 'y\n' : 'n\n'
      window.electronAPI.claudeWriteStdin?.(response)
    } else if (isToolPermission) {
      // Tool permission: option 0=allow once, 1=always allow, 2=deny
      if (optionIndex === 0) {
        window.electronAPI.claudeWriteStdin?.('y\n')
      } else if (optionIndex === 1) {
        window.electronAPI.claudeWriteStdin?.('a\n')  // 'a' = always allow in Claude Code
      } else {
        window.electronAPI.claudeWriteStdin?.('n\n')
      }
    }

    // Mark approval task as done
    const updated = tasks.map(t =>
      t.id === approvalId ? { ...t, status: 'done' as const, updatedAt: new Date().toISOString() } : t
    )
    handleTasksChange(updated)

    // Log approval
    window.electronAPI.approvalLog?.({
      timestamp: new Date().toISOString(),
      question: approval.question,
      optionChosen: approval.options[optionIndex]?.label || '已选择',
      auto: false,
      modelId: appSettings?.activeModelId || undefined,
    })
    setPendingApproval(null)
  }, [pendingApproval, tasks, handleTasksChange, appSettings])

  const handleDismissApproval = useCallback((approvalId: string) => {
    const approval = pendingApproval

    // Send deny to Claude stdin
    if (approval?.toolName && approval.toolName !== 'AskUserQuestion') {
      window.electronAPI.claudeWriteStdin?.('n\n')
    }

    const updated = tasks.map(t =>
      t.id === approvalId ? { ...t, status: 'done' as const, updatedAt: new Date().toISOString() } : t
    )
    handleTasksChange(updated)
    if (approval) {
      window.electronAPI.approvalLog?.({
        timestamp: new Date().toISOString(),
        question: approval.question,
        optionChosen: '已忽略/超时',
        auto: false,
        modelId: appSettings?.activeModelId || undefined,
      })
    }
    setPendingApproval(null)
  }, [tasks, handleTasksChange, pendingApproval, appSettings])

  const openProjectManager = useCallback(() => {
    loadProjectsForDialog()
    setShowProjectManager(true)
  }, [])

  const handleToggleClaude = useCallback(async () => {
    if (claudeRunning) {
      await window.electronAPI.stopClaude()
      setClaudeRunning(false)
      setClaudeConnected(false)
    }
  }, [claudeRunning])

  // 切换到终端模式（终端已在后台运行）
  const handleSwitchToTerminal = useCallback(() => {
    setChatMode('terminal')
  }, [])

  // 切换回 Chat 模式
  const handleSwitchToChat = useCallback(() => {
    setChatMode('chat')
  }, [])

  // 文件打开/关闭（多标签）
  const handleOpenFile = useCallback((filePath: string, fileName: string) => {
    setFileTabs(prev => {
      const existing = prev.find(t => t.path === filePath)
      if (existing) {
        setActiveTabId(existing.id)
        return prev
      }
      const tabId = 'tab_' + Date.now().toString(36)
      setActiveTabId(tabId)
      return [...prev, { id: tabId, path: filePath, name: fileName }]
    })
    setChatMode('editor')
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    setFileTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId)
      const next = prev.filter(t => t.id !== tabId)
      if (next.length === 0) {
        setActiveTabId(null)
        setChatMode('chat')
      } else if (activeTabId === tabId) {
        const newIdx = Math.min(idx, next.length - 1)
        setActiveTabId(next[newIdx]?.id || null)
      }
      return next
    })
  }, [activeTabId])

  const handleCloseFile = useCallback(() => {
    if (activeTabId) handleCloseTab(activeTabId)
  }, [activeTabId, handleCloseTab])

  const handleOpenFileInNewWindow = useCallback(() => {
    const currentFile = activeTabId ? fileTabs.find(t => t.id === activeTabId) : null
    if (currentFile) {
      window.electronAPI.openFileInNewWindow({
        filePath: currentFile.path,
        fileName: currentFile.name,
        projectPath: activeProject?.path,
      })
    }
  }, [fileTabs, activeTabId, activeProject])

  // 重新启动终端中的 Claude
  const handleRestartTerminalClaude = useCallback(async () => {
    await window.electronAPI.terminalRestart()
    setTerminalClaudeRunning(true)
  }, [])

  // 终端写入
  const handleTerminalInput = useCallback((data: string) => {
    window.electronAPI.terminalInput(data)
  }, [])

  // Chat 发消息 → 终端 PTY
  const handleTerminalSendForChat = useCallback(async (content: string) => {
    window.electronAPI.terminalInput(content)
  }, [])

  // Chat 模式需要 Claude 运行时，重启终端 Claude
  const handleLaunchClaudeForChat = useCallback(async () => {
    // 确保终端已启动
    const status = await window.electronAPI.terminalStatus?.()
    if (!status?.running) {
      // 终端未运行 → 启动终端（会自动启动 Claude）
      await window.electronAPI.terminalStart({
        cwd: activeProject?.path,
        sessionId: currentSessionId,
        autoApproval: autoApprovalRef.current,
      })
    } else if (!status.claudeRunning) {
      // 终端在运行但 Claude 已退出 → 重启 Claude
      await window.electronAPI.terminalRestart?.()
    }
    setTerminalClaudeRunning(true)
  }, [activeProject?.path, currentSessionId, autoApproval])

  // 监听终端状态事件
  useEffect(() => {
    const cleanup = window.electronAPI.onTerminalStatus?.((status: any) => {
      if (status.claudeRunning !== undefined) {
        setTerminalClaudeRunning(status.claudeRunning)
      }
      if (status.running !== undefined) {
        setClaudeRunning(status.running)
      }
      if (status.connected) {
        setClaudeConnected(true)
      }
    })
    return () => cleanup?.()
  }, [])

  // 办公室员工状态与智能体活动同步
  useEffect(() => {
    const toolToAgentType: Record<string, string> = {
      Bash: 'Implementer', Write: 'Implementer', Edit: 'Implementer',
      Read: 'CodeExplorer', Glob: 'CodeExplorer', Grep: 'CodeExplorer',
      WebFetch: 'CodeExplorer', WebSearch: 'CodeExplorer',
      Agent: 'Coordinator', Workflow: 'Coordinator',
      TaskCreate: 'Coordinator', TaskUpdate: 'Coordinator',
      AskUserQuestion: 'Coordinator',
    }
    // Track tool_use_id → agentType to properly decrement on tool_result
    const activeToolIds = new Map<string, string>()

    function computeAgentActiveCounts(): Map<string, number> {
      const counts = new Map<string, number>()
      for (const agentType of activeToolIds.values()) {
        counts.set(agentType, (counts.get(agentType) || 0) + 1)
      }
      return counts
    }

    function syncTeamStatus() {
      const activeCounts = computeAgentActiveCounts()
      setTeam(prev => {
        const base = prev.length ? prev : DEFAULT_TEAM
        return base.map(e => ({
          ...e,
          status: activeCounts.has(e.agentType) ? 'busy' as const : 'idle' as const,
        }))
      })
    }

    const unsubClaude = window.electronAPI.onClaudeEvent((event: any) => {
      // 进程启动 → 全部闲置（新 session 重置所有状态）
      if (event.type === 'system' && event.subtype === 'init') {
        activeToolIds.clear()
        setTeam(prev => {
          const base = prev.length ? prev : DEFAULT_TEAM
          return base.map(e => ({ ...e, status: 'idle' as const }))
        })
        return
      }
      // 进程关闭 → 全部闲置
      if (event.type === 'close') {
        activeToolIds.clear()
        setTeam(prev => {
          const base = prev.length ? prev : DEFAULT_TEAM
          return base.map(e => ({ ...e, status: 'idle' as const }))
        })
        return
      }
      // assistant 事件 → tool_use 增加活跃计数，tool_result 减少
      if (event.type === 'assistant' && event.message?.content) {
        let changed = false
        for (const block of event.message.content) {
          if (block.type === 'tool_use' && block.id) {
            const agentType = toolToAgentType[block.name] || 'Implementer'
            activeToolIds.set(block.id, agentType)
            changed = true
          }
          if (block.type === 'tool_result') {
            const toolUseId = (block as any).tool_use_id
            if (toolUseId && activeToolIds.has(toolUseId)) {
              activeToolIds.delete(toolUseId)
              changed = true
            }
          }
        }
        if (changed) syncTeamStatus()
      }
      // user 事件 (replay) — 也可能包含 tool_result
      if (event.type === 'user' && event.message?.content) {
        let changed = false
        for (const block of event.message.content) {
          if (block.type === 'tool_result') {
            const toolUseId = (block as any).tool_use_id
            if (toolUseId && activeToolIds.has(toolUseId)) {
              activeToolIds.delete(toolUseId)
              changed = true
            }
          }
        }
        if (changed) syncTeamStatus()
      }
      // result → 所有工具完成
      if (event.type === 'result') {
        activeToolIds.clear()
        setTeam(prev => {
          const base = prev.length ? prev : DEFAULT_TEAM
          return base.map(e => ({ ...e, status: 'idle' as const }))
        })
      }
    })

    // ── 群聊 AgentPool 状态同步到 team ──
    // 按 agentType 追踪活跃子智能体数量（支持同类型多个智能体并发）
    const activeAgentTypes = new Map<string, number>()

    function syncAgentTeamStatus() {
      setTeam(prev => {
        const base = prev.length ? prev : DEFAULT_TEAM
        return base.map(e => ({
          ...e,
          status: (activeAgentTypes.get(e.agentType) || 0) > 0 ? 'busy' as const : 'idle' as const,
        }))
      })
    }

    // Agent 状态更新（启动/连接/错误）
    const unsubAgentStatus = window.electronAPI.onAgentStatusUpdate?.((data: any) => {
      if (data.running && data.agentType) {
        // 智能体启动 → 增加计数
        const count = activeAgentTypes.get(data.agentType) || 0
        activeAgentTypes.set(data.agentType, count + 1)
        syncAgentTeamStatus()
      } else if (!data.running && data.agentType) {
        // 智能体停止 → 减少计数（但不低于 0，因为 agent:close 才是权威的清理事件）
        // 这里保持现有计数不变，交由 agent:close 处理清理
      }
    })

    // Agent 关闭 → 减少计数 + 同步状态
    const unsubAgentClose = window.electronAPI.onAgentClose?.((data: any) => {
      if (data.agentType) {
        const count = Math.max(0, (activeAgentTypes.get(data.agentType) || 0) - 1)
        if (count <= 0) {
          activeAgentTypes.delete(data.agentType)
        } else {
          activeAgentTypes.set(data.agentType, count)
        }
        syncAgentTeamStatus()
      }
    })

    // Agent 事件（system/init → 智能体初始化确认）
    const unsubAgentEvent = window.electronAPI.onAgentEvent?.((taggedEvent: any) => {
      if (taggedEvent.type === 'system' && taggedEvent.subtype === 'init' && taggedEvent.agentType) {
        // 智能体初始化确认 → 确保计数至少为 1
        if (!activeAgentTypes.has(taggedEvent.agentType)) {
          activeAgentTypes.set(taggedEvent.agentType, 1)
          syncAgentTeamStatus()
        }
      }
    })

    return () => {
      unsubClaude?.()
      unsubAgentStatus?.()
      unsubAgentClose?.()
      unsubAgentEvent?.()
    }
  }, [])

  // Model config
  const activeModelConfig = appSettings?.models?.find(m => m.id === appSettings.activeModelId) || null
  const modelList = appSettings?.models || []

  const handleModelChange = useCallback(async (modelId: string) => {
    if (!appSettings) return
    const updated = { ...appSettings, activeModelId: modelId || null }
    setAppSettings(updated)
    try { await window.electronAPI.saveSettings(updated) } catch (_e) { /* silent */ }
  }, [appSettings])

  // Menu
  const menus: MenuGroup[] = [
    {
      label: '文件', items: [
        { label: '新建会话', shortcut: 'Ctrl+N', action: () => createNewSession() },
        { label: '选择项目...', shortcut: 'Ctrl+O', action: openProjectManager },
        { label: '新建项目...', shortcut: 'Ctrl+Shift+N', action: handleNewProject },
        { divider: true, label: '' },
        { label: '设置', shortcut: 'Ctrl+,', action: () => setShowSettings(true) },
        { divider: true, label: '' },
        { label: '退出', shortcut: 'Alt+F4', action: () => window.electronAPI.closeWindow() },
      ],
    },
    {
      label: '项目', items: [
        { label: '管理项目...', shortcut: 'Ctrl+Shift+P', action: openProjectManager },
        ...(activeProject ? [
          { divider: true, label: '' },
          { label: `当前项目: ${activeProject.name}`, disabled: true },
          { label: '返回首页', action: () => { setActiveProject(null); setMessages([]); setCurrentSessionId(undefined) } },
        ] : []),
      ],
    },
    {
      label: '视图', items: [
        { label: '项目文件', shortcut: 'Ctrl+1', action: () => setLeftView('files') },
        { label: '会话历史', shortcut: 'Ctrl+2', action: () => { if (activeProject) loadSessions(activeProject.path); setLeftView('sessions') } },
        { label: '项目文档', shortcut: 'Ctrl+3', action: () => setLeftView('docs') },
        ...(activeProject ? [
          { divider: true, label: '' },
          { label: '任务看板', shortcut: 'Ctrl+4', action: () => setRightView('tasks') },
          { label: '办公室视图', shortcut: 'Ctrl+6', action: () => setRightView('office') },
        ] : []),
      ],
    },
    {
      label: '主题', items: [
        { label: `🌙 暗色 ${theme === 'dark' ? '✓' : ''}`, action: () => setThemeState('dark') },
        { label: `☀️ 亮色 ${theme === 'light' ? '✓' : ''}`, action: () => setThemeState('light') },
      ],
    },
    {
      label: 'AI', items: [
        { label: '停止当前会话', shortcut: 'Esc', action: () => window.electronAPI.stopClaude() },
        { divider: true, label: '' },
        { label: `Model: ${statusInfo.model || '默认'}`, disabled: true },
        { label: `Tokens: ${statusInfo.tokens.toLocaleString()}`, disabled: true },
      ],
    },
    {
      label: '调试', items: [
        { label: '开发者工具', shortcut: 'F12', action: () => window.electronAPI.on?.('toggle-devtools', () => {}) },
        ...(activeProject ? [
          { divider: true, label: '' },
          { label: '任务面板', shortcut: 'Ctrl+4', action: () => setRightView('tasks') },
          { label: '任务计划', shortcut: 'Ctrl+5', action: () => setRightView('plan') },
          { label: '连接管理', shortcut: 'Ctrl+7', action: () => setRightView('connection') },
        ] : []),
      ],
    },
    {
      label: 'SSH', items: [
        { label: 'SSH 远程连接', shortcut: 'Ctrl+8', action: () => setRightView('ssh') },
        { divider: true, label: '' },
        { label: '🌐 远程终端', action: () => setChatMode('remote-terminal') },
        { label: '📁 远程文件浏览', action: () => setRightView('remote-files') },
        { label: '🚀 项目部署', action: () => setRightView('deploy') },
      ],
    },
    { label: '关于', items: [{ label: 'Claude Space v1.1.1', disabled: true }] },
  ]

  const noProject = !activeProject

  return (
    <div className="app">
      <MenuBar menus={menus} onOpenProjectManager={openProjectManager} theme={theme}
        onThemeToggle={() => setThemeState(t => t === 'dark' ? 'light' : 'dark')}
        onGitToggle={() => activeProject && setShowGitPanel(v => !v)} />

      {noProject ? (
        <WelcomePage
          onSelectProject={openProjectManager}
          onNewProject={handleNewProject}
          onQuickOpen={async (project) => {
            const p: ProjectInfo = { ...project, description: '', techStack: '', sessions: 0, modifiedAt: new Date().toISOString() }
            handleSelectProject(p)
          }}
        />
      ) : (
        <>
          <ProjectNav project={activeProject} leftView={leftView} onLeftViewChange={(v) => setLeftView(v as 'files' | 'sessions' | 'docs' | 'git')} onGitClick={() => setShowGitPanel(v => !v)} />
          <div className="app-body">
            <aside className="sidebar left-sidebar" style={{ width: leftSplitter.size }}>
              <div className="sidebar-tabs">
                <button className={leftView === 'files' ? 'active' : ''} onClick={() => setLeftView('files')}>📁 项目</button>
                <button className={leftView === 'sessions' ? 'active' : ''} onClick={() => { loadSessions(activeProject.path); setLeftView('sessions') }}>💬 会话</button>
                <button className={leftView === 'docs' ? 'active' : ''} onClick={() => setLeftView('docs')}>📝 文档</button>
                <button className={leftView === 'git' ? 'active' : ''} onClick={() => setLeftView('git')}>⎇ Git</button>
              </div>
              {leftView === 'files' && (
                <ProjectBrowser projects={projects} activeProject={activeProject} onSelect={handleSwitchProject} onRefresh={() => {}} mode="files" onOpenFile={handleOpenFile} projectPath={activeProject?.path} />
              )}
              {leftView === 'sessions' && (
                <SessionList
                  sessions={sessions}
                  activeProject={activeProject}
                  activeSessionId={currentSessionId}
                  activeSessions={activeSessions}
                  sessionNames={sessionNames}
                  onSelectSession={(sid) => switchToSession(sid)}
                  onNewSession={createNewSession}
                  onDeleteSession={deleteSession}
                />
              )}
              {leftView === 'docs' && (
                <ProjectBrowser projects={projects} activeProject={activeProject} onSelect={handleSwitchProject} onRefresh={() => {}} mode="docs" onOpenFile={handleOpenFile} projectPath={activeProject?.path} />
              )}
              {leftView === 'git' && (
                <GitPanel projectPath={activeProject?.path} />
              )}
            </aside>

            <div className="splitter splitter-h" onMouseDown={leftSplitter.onMouseDown} />

            <main className="main-area">
              {/* ── 模式切换栏 ─────────────────────────── */}
              <div className="mode-switch-bar">
                <div className="mode-switch-tabs">
                  <button
                    className={`mode-switch-btn ${chatMode === 'chat' ? 'active' : ''}`}
                    onClick={handleSwitchToChat}
                  >💬 Chat</button>
                  <button
                    className={`mode-switch-btn ${chatMode === 'terminal' ? 'active' : ''}`}
                    onClick={handleSwitchToTerminal}
                  >🖥️ Terminal</button>
                  <button
                    className={`mode-switch-btn ${chatMode === 'remote-terminal' ? 'active' : ''}`}
                    onClick={() => setChatMode('remote-terminal')}
                  >🌐 远程终端</button>
                </div>
                {/* ── 文件标签栏 ── */}
                {fileTabs.length > 0 && (
                  <div className="file-tab-bar">
                    {fileTabs.map(tab => (
                      <div
                        key={tab.id}
                        className={`file-tab ${tab.id === activeTabId && chatMode === 'editor' ? 'active' : ''}`}
                        onClick={() => { setChatMode('editor'); setActiveTabId(tab.id) }}
                        title={tab.path}
                      >
                        <span className="file-tab-icon">{getFileTabIcon(tab.name)}</span>
                        <span className="file-tab-name">{tab.name}</span>
                        {tab.isDirty && <span className="file-tab-dirty">●</span>}
                        <span className="file-tab-close" onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id) }}>×</span>
                      </div>
                    ))}
                  </div>
                )}
                <span className="mode-switch-hint">
                  {chatMode === 'chat' ? '结构化富 UI 模式'
                    : chatMode === 'terminal' ? '原生 CLI 终端模式 — 与 Chat 同步'
                    : '文件编辑模式'}
                </span>
              </div>

              {/* ── Chat 模式 ──────────────────────────── */}
              {chatMode === 'chat' && (
                <ChatPanel messages={messages} streamingText={streamingText} activeProject={activeProject}
                  sessionId={currentSessionId} onSessionIdChange={setCurrentSessionId}
                  onMessagesChange={setMessages} onStreamingText={setStreamingText}
                  onClaudeRunning={setClaudeRunning} onClaudeConnected={setClaudeConnected} onStatusInfo={setStatusInfo}
                  sessions={sessions}
                  models={modelList} activeModelId={appSettings?.activeModelId || null} onModelChange={handleModelChange}
                  // 终端模式相关（Chat ↔ Terminal 互通）
                  terminalMode={false}
                  onTerminalSend={handleTerminalSendForChat}
                  terminalClaudeRunning={terminalClaudeRunning}
                  onLaunchClaudeForChat={handleLaunchClaudeForChat}
                  onSelectSession={async (sid) => {
                    setCurrentSessionId(sid)
                    try { const t = await window.electronAPI.getSessionTranscript(sid)
                      if (t?.events?.length) setMessages(t.events.filter((e: any) => e.type === 'user' || e.type === 'assistant').map((e: any) => parseSessionMessage(e)).filter((m: ChatMessage | null): m is ChatMessage => m !== null && !!m.content))
                    } catch (_e) { /* silent */ }
                  }}
                  autoApproval={autoApproval}
                  onAutoApprovalChange={async (v) => {
                    if (!appSettings) return
                    const updated = { ...appSettings, autoApproval: v }
                    setAppSettings(updated)
                    await window.electronAPI.saveSettings(updated)
                  }}
                  onMentionAgent={handleMentionAgent}
                  groupChatMode={groupChatMode}
                  onGroupChatModeChange={async (v: boolean) => {
                    setGroupChatMode(v)
                    if (appSettings) {
                      const updated = { ...appSettings, defaultGroupChat: v }
                      setAppSettings(updated)
                      await window.electronAPI.saveSettings(updated)
                    }
                  }}
                  team={(team.length ? team : DEFAULT_TEAM).map((e: any) => ({
                    agentId: e.id, name: e.name, role: e.role,
                    agentType: e.agentType, icon: e.icon || '👤', color: e.color || '#888',
                  }))}
                  onAgentSendGroup={handleAgentSendGroup}
                  sessionName={currentSessionId ? getSessionDisplayName(currentSessionId) : undefined}
                  onMessageSent={(sid, content) => {
                    setCurrentSessionId(prev => prev || sid)
                    getOrCreateSession(sid)
                    autoNameSession(sid, content)
                  }}
                />
              )}

              {/* ── Terminal 模式 ──────────────────────── */}
              {chatMode === 'terminal' && (
                <TerminalPanel
                  cwd={activeProject?.path}
                  sessionId={currentSessionId}
                  visible={chatMode === 'terminal'}
                  theme={theme}
                  onTerminalData={handleTerminalInput}
                />
              )}

              {/* ── Remote Terminal 模式 ────────────────── */}
              {chatMode === 'remote-terminal' && (
                <RemoteTerminalPanel
                  sshStatus={sshStatus}
                  visible={chatMode === 'remote-terminal'}
                  theme={theme}
                />
              )}

              {/* ── Editor 模式 ──────────────────────── */}
              {chatMode === 'editor' && openFile && (
                <FileEditor
                  filePath={openFile.path}
                  fileName={openFile.name}
                  theme={theme}
                  onClose={handleCloseFile}
                  onOpenInNewWindow={handleOpenFileInNewWindow}
                />
              )}
            </main>

            <div className="splitter splitter-h" onMouseDown={rightSplitter.onMouseDown} />

            <aside className="sidebar right-sidebar" style={{ width: rightSplitter.size }}>
              <div className="sidebar-tabs">
                <button className={rightView === 'tasks' ? 'active' : ''} onClick={() => setRightView('tasks')}>
                  📊 看板
                  {(() => {
                    const pendingCount = tasks.filter(t => {
                      if (t.status === 'done') return false
                      if (t.projectPath && t.projectPath !== activeProject?.path) return false
                      return true
                    }).length
                    const runningCount = monitorEvents.filter(e => e.status === 'running').length
                    const total = pendingCount + runningCount
                    if (total === 0) return null
                    return <span style={{
                      marginLeft: 4, background: '#6c8cff', color: '#fff',
                      fontSize: 9, padding: '1px 5px', borderRadius: 8,
                      fontWeight: 600, lineHeight: '14px', display: 'inline-block',
                      minWidth: 16, textAlign: 'center',
                    }}>{total}</span>
                  })()}
                </button>
                <button className={rightView === 'plan' ? 'active' : ''} onClick={() => setRightView('plan')}>📋 计划</button>
                <button className={rightView === 'office' ? 'active' : ''} onClick={() => setRightView('office')}>🏢 办公室</button>
                <button className={rightView === 'connection' ? 'active' : ''} onClick={() => setRightView('connection')}>🔗 连接</button>
                <button className={rightView === 'assistant' ? 'active' : ''} onClick={() => setRightView('assistant')}>🤖 助手</button>
                <button className={rightView === 'ssh' ? 'active' : ''} onClick={() => setRightView('ssh')}>🔌 SSH</button>
              </div>
              {rightView === 'tasks' && (
                <div className="right-panel-scroll">
                  <TaskStats tasks={tasks.filter(t => !t.projectPath || t.projectPath === activeProject?.path)} />
                  <div className="section-divider" />
                  <TaskMonitor embedded events={monitorEvents} />
                  <div className="section-divider" />
                  <InlineTaskBoard tasks={tasks} onTasksChange={handleTasksChange} activeProject={activeProject} />
                </div>
              )}
              {rightView === 'plan' && (
                <div className="right-panel-scroll">
                  <TaskPlanList
                    tasks={tasks}
                    activeProject={activeProject}
                    onTasksChange={handleTasksChange}
                  />
                </div>
              )}
              {rightView === 'office' && <PixelOffice activeProject={activeProject} tasks={tasks} team={team.length ? team : DEFAULT_TEAM} onTeamChange={handleTeamChange} availableModels={appSettings?.models?.map(m => ({ id: m.id, name: m.name, provider: m.provider })) || []} />}
              {rightView === 'connection' && (
                <div className="right-panel-scroll">
                  <ConnectionPanel
                    settings={appSettings}
                    claudeRunning={claudeRunning}
                    claudeConnected={claudeConnected}
                    activeSessionId={currentSessionId}
                    activeModelId={appSettings?.activeModelId || null}
                  />
                </div>
              )}
              {rightView === 'assistant' && (
                <AssistantPanel
                  theme={theme}
                  models={appSettings?.models}
                  activeModelId={appSettings?.activeModelId}
                  activeProjectPath={activeProject?.path}
                  autoApproval={autoApproval}
                />
              )}
              {rightView === 'ssh' && (
                <div className="right-panel-scroll">
                  <SshConnectionPanel
                    settings={appSettings}
                    sshStatus={sshStatus}
                    onSshStatusChange={setSshStatus}
                    onOpenRemoteTerminal={() => setChatMode('remote-terminal')}
                    onBrowseRemoteFiles={() => setRightView('remote-files')}
                  />
                  <div className="section-divider" />
                  <DeploymentPanel
                    settings={appSettings}
                    sshStatus={sshStatus}
                    activeProject={activeProject}
                    onSettingsChange={handleSaveSettings}
                  />
                </div>
              )}
              {rightView === 'remote-files' && (
                <div className="right-panel-scroll">
                  <RemoteFileBrowser
                    sshStatus={sshStatus}
                    settings={appSettings}
                  />
                </div>
              )}
              {rightView === 'deploy' && (
                <div className="right-panel-scroll">
                  <DeploymentPanel
                    settings={appSettings}
                    sshStatus={sshStatus}
                    activeProject={activeProject}
                    onSettingsChange={handleSaveSettings}
                  />
                </div>
              )}
            </aside>
          </div>
        </>
      )}

      <StatusBar claudeRunning={claudeRunning} claudeConnected={claudeConnected} model={statusInfo.model} tokens={statusInfo.tokens} cost={statusInfo.cost} projectPath={activeProject?.path} onToggleClaude={handleToggleClaude} />

      {showProjectManager && <ProjectManagerDialog onClose={() => setShowProjectManager(false)}
        onSelectProject={async (path: string) => {
          const p: ProjectInfo = { name: path.split(/[/\\]/).pop() || path, path, description: '', techStack: '', sessions: 0, modifiedAt: new Date().toISOString() }
          if (activeProject) {
            setPendingProject(p)
          } else {
            handleSelectProject(p)
          }
        }} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} settings={appSettings} onSettingsChange={handleSaveSettings} />}
      {showNewProjectDialog && <NewProjectDialog onClose={() => setShowNewProjectDialog(false)} onCreate={handleCreateProject} />}
      <ApprovalDialog
        approval={pendingApproval}
        onApprove={handleApprove}
        onDismiss={handleDismissApproval}
      />
      {showGitPanel && activeProject && (
        <GitSlidePanel projectPath={activeProject.path} onClose={() => setShowGitPanel(false)} />
      )}
      {pendingProject && activeProject && (
        <ProjectSwitchDialog
          currentProject={activeProject}
          newProject={{ name: pendingProject.name, path: pendingProject.path }}
          onLoadInCurrent={async () => {
            await window.electronAPI.stopClaude()
            handleSelectProject(pendingProject)
            setPendingProject(null)
          }}
          onOpenInNew={() => {
            window.electronAPI.openProjectInNewWindow(pendingProject.path)
            setPendingProject(null)
          }}
          onCancel={() => setPendingProject(null)}
        />
      )}
    </div>
  )
}

function InlineTaskBoard({ tasks, onTasksChange, activeProject }: { tasks: TaskItem[]; onTasksChange: (t: TaskItem[]) => void; activeProject: ProjectInfo | null }) {
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const filtered = activeProject ? tasks.filter(t => !t.projectPath || t.projectPath === activeProject.path) : tasks
  const pending = filtered.filter(t => t.status !== 'done')
  const approvals = pending.filter(t => t.category === 'approval')
  const regular = pending.filter(t => t.category !== 'approval')

  const markDone = (taskId: string) => {
    onTasksChange(tasks.map(x => x.id === taskId ? { ...x, status: 'done' as const, updatedAt: new Date().toISOString() } : x))
  }

  return (
    <div className="task-board-inline">
      <div className="task-inline-header">
        <span>📋 待处理 ({pending.length})</span>
        <button className="icon-btn" onClick={() => {
          const title = prompt('任务标题:')
          if (title) onTasksChange([...tasks, { id: Date.now().toString(36), title, description: '', status: 'todo', category: 'task', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }])
        }}>+</button>
      </div>

      {/* Approvals section */}
      {approvals.length > 0 && (
        <div className="task-inline-section">
          <div className="task-inline-section-header">🔔 待审批 ({approvals.length})</div>
          {approvals.slice(0, 3).map(t => (
            <div key={t.id} className="task-inline-item approval">
              <span>🔔</span>
              <span className="task-inline-title">{t.title}</span>
              <span className="task-badge approval-badge">审批</span>
            </div>
          ))}
        </div>
      )}

      {/* Regular tasks */}
      {regular.slice(0, 6).map(t => (
        <div key={t.id} className="task-inline-item">
          <span>{t.status === 'in_progress' ? '🔵' : '⚪'}</span>
          <span className="task-inline-title">{t.title}</span>
          <span className={`task-status-label task-status-${t.status}`}>
            {t.status === 'todo' ? '待处理' : t.status === 'in_progress' ? '进行中' : '已完成'}
          </span>
          {t.category === 'tool' && <span className="task-badge tool-badge">工具</span>}
          <button className="icon-btn" onClick={() => markDone(t.id)}>✓</button>
        </div>
      ))}

      {pending.length === 0 && (
        <div className="empty-hint" style={{ textAlign: 'center', padding: '16px 12px', lineHeight: 1.8 }}>
          <div style={{ fontSize: 13, color: '#888' }}>💡 暂无待处理任务</div>
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
            Claude 执行工具时会自动创建任务<br/>
            或点击右上角 + 手动创建
          </div>
        </div>
      )}
    </div>
  )
}
