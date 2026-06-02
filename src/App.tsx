import { useState, useCallback, useEffect, useRef } from 'react'
import { ProjectInfo, TaskItem, ChatMessage, SessionInfo } from './types'
import type { AppSettingsSafe } from './types/settings'
import { MenuBar, MenuGroup } from './components/MenuBar'
import { ProjectBrowser } from './components/ProjectBrowser'
import { ProjectManagerDialog } from './components/ProjectManagerDialog'
import { ProjectNav } from './components/ProjectNav'
import { ChatPanel } from './components/ChatPanel'
import { TaskStats } from './components/TaskStats'
import { TaskMonitor } from './components/TaskMonitor'
import { SessionList } from './components/SessionList'
import { SettingsDialog } from './components/SettingsDialog'
import { WelcomePage } from './components/WelcomePage'
import { ProjectSwitchDialog } from './components/ProjectSwitchDialog'
import { PixelOffice } from './components/PixelOffice'
import { StatusBar } from './components/StatusBar'
import { ConnectionPanel } from './components/ConnectionPanel'
import { TerminalPanel } from './components/TerminalPanel'
import { GitPanel } from './components/GitPanel'
import { GitSlidePanel } from './components/GitSlidePanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { useSplitter } from './hooks/useSplitter'
import { useTaskSync, ApprovalRequest } from './hooks/useTaskSync'

export default function App() {
  const urlProject = new URLSearchParams(window.location.search).get('project')

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
  const [rightView, setRightView] = useState<'tasks' | 'office' | 'connection'>('tasks')
  const [showSettings, setShowSettings] = useState(false)
  const [showProjectManager, setShowProjectManager] = useState(false)
  const [pendingProject, setPendingProject] = useState<ProjectInfo | null>(null)
  const [showGitPanel, setShowGitPanel] = useState(false)

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
  const [appSettings, setAppSettings] = useState<AppSettingsSafe | null>(null)
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null)
  const [monitorEvents, setMonitorEvents] = useState<any[]>([])
  const [chatMode, setChatMode] = useState<'chat' | 'terminal'>('chat')
  const [terminalReady, setTerminalReady] = useState(false)
  const [terminalClaudeRunning, setTerminalClaudeRunning] = useState(false)

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
    try { setProjects(await window.electronAPI.scanProjects()) } catch {}
  }
  const loadTasks = async () => {
    try { setTasks(await window.electronAPI.loadTasks()) } catch {}
  }
  const loadTeam = async () => {
    try {
      const saved = await window.electronAPI.loadTeam?.()
      if (saved?.length) setTeam(saved)
    } catch {}
  }
  const handleTeamChange = async (newTeam: any[]) => {
    setTeam(newTeam)
    try { await window.electronAPI.saveTeam?.(newTeam) } catch {}
  }
  const loadSettings = async () => {
    try {
      const s = await window.electronAPI.loadSettings()
      setAppSettings(s)
    } catch {}
  }
  const handleSaveSettings = useCallback(async (newSettings: AppSettingsSafe) => {
    setAppSettings(newSettings)
    try { await window.electronAPI.saveSettings(newSettings) } catch {}
  }, [])
  const loadSessions = async (projectPath?: string) => {
    try { setSessions(await window.electronAPI.listSessions(projectPath)) } catch {}
  }

  const handleSelectProject = useCallback(async (project: ProjectInfo) => {
    setActiveProject(project)
    setMessages([])
    setStreamingText('')
    setLeftView('files')  // 默认显示完整文件树
    try { setSessions(await window.electronAPI.listSessions(project.path)) } catch {}
    try {
      const recent = await window.electronAPI.getRecentSession?.(project.path)
      if (recent?.messages?.length) {
        const msgs = recent.messages
          .filter((m: any) => m.type === 'user' || m.type === 'assistant')
          .map((m: any) => ({ id: m.uuid || Math.random().toString(36), role: (m.type === 'user' ? 'user' as const : 'assistant' as const), content: extractContent(m), timestamp: Date.now() - 1000 }))
          .filter((m: ChatMessage) => m.content)
        if (msgs.length > 0) setMessages(msgs)
        if (recent?.sessionId) setCurrentSessionId(recent.sessionId)
      }
    } catch {}

    // 自动启动终端 + Claude（后台，不切换视图）
    try {
      const recent = await window.electronAPI.getRecentSession?.(project.path)
      await window.electronAPI.terminalStart({
        cwd: project.path,
        sessionId: recent?.sessionId,
      })
      setTerminalReady(true)
    } catch { /* 非关键 */ }
  }, [])

  function extractContent(m: any): string {
    if (!m.message?.content) return ''
    if (Array.isArray(m.message.content)) return m.message.content.map((c: any) => c.type === 'text' ? c.text : c.type === 'tool_use' ? `[🔧 ${c.name}]` : '').filter(Boolean).join('\n')
    return typeof m.message.content === 'string' ? m.message.content : ''
  }

  const handleSwitchProject = useCallback(async (project: ProjectInfo) => {
    handleSelectProject(project)
  }, [handleSelectProject])

  const handleNewProject = useCallback(async () => {
    try {
      const res = await window.electronAPI.newProject?.()
      if (res && !res.canceled && res.path) {
        const p: ProjectInfo = { name: res.name || res.path.split(/[/\\]/).pop() || '', path: res.path, description: '', techStack: '', sessions: 0, modifiedAt: new Date().toISOString() }
        handleSelectProject(p)
      }
    } catch {}
  }, [handleSelectProject])

  const handleTasksChange = useCallback(async (updater: TaskItem[] | ((prev: TaskItem[]) => TaskItem[])) => {
    setTasks(prev => {
      const newTasks = typeof updater === 'function' ? updater(prev) : updater
      window.electronAPI.saveTasks(newTasks).catch(() => {})
      return newTasks
    })
  }, [])

  const autoApproval = appSettings?.autoApproval ?? false

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

  // Real-time task sync from Claude events
  useTaskSync({
    tasks,
    onTasksChange: handleTasksChange,
    activeProjectPath: activeProject?.path,
    onApproval: setPendingApproval,
    autoApproval,
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

  // Model config
  const activeModelConfig = appSettings?.models?.find(m => m.id === appSettings.activeModelId) || null
  const modelList = appSettings?.models || []

  const handleModelChange = useCallback(async (modelId: string) => {
    if (!appSettings) return
    const updated = { ...appSettings, activeModelId: modelId || null }
    setAppSettings(updated)
    try { await window.electronAPI.saveSettings(updated) } catch {}
  }, [appSettings])

  // Menu
  const menus: MenuGroup[] = [
    {
      label: '文件', items: [
        { label: '新建会话', shortcut: 'Ctrl+N', action: () => { setMessages([]); setStreamingText(''); setCurrentSessionId(undefined) } },
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
          { label: '任务面板', shortcut: 'Ctrl+4', action: () => setRightView('tasks') },
          { label: '办公室视图', shortcut: 'Ctrl+5', action: () => setRightView('office') },
          { label: '连接管理', shortcut: 'Ctrl+6', action: () => setRightView('connection') },
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
    { label: '关于', items: [{ label: 'Claude Space v0.3.0', disabled: true }] },
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
                <ProjectBrowser projects={projects} activeProject={activeProject} onSelect={handleSwitchProject} onRefresh={() => {}} mode="files" />
              )}
              {leftView === 'sessions' && (
                <SessionList sessions={sessions} activeProject={activeProject}
                  onSelectSession={async (sid) => {
                    setCurrentSessionId(sid)
                    try { const t = await window.electronAPI.getSessionTranscript(sid)
                      if (t?.events?.length) setMessages(t.events.filter((e: any) => e.type === 'user' || e.type === 'assistant').map((e: any) => ({ id: e.uuid || Math.random().toString(36), role: (e.type === 'user' ? 'user' as const : 'assistant' as const), content: extractContent(e), timestamp: Date.now() - 1000 })).filter((m: ChatMessage) => m.content))
                    } catch {}
                  }}
                  onNewSession={() => { setMessages([]); setStreamingText(''); setCurrentSessionId(undefined) }} />
              )}
              {leftView === 'docs' && (
                <ProjectBrowser projects={projects} activeProject={activeProject} onSelect={handleSwitchProject} onRefresh={() => {}} mode="docs" />
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
                </div>
                <span className="mode-switch-hint">
                  {chatMode === 'chat' ? '结构化富 UI 模式' : '原生 CLI 终端模式 — 与 Chat 同步'}
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
                  onSelectSession={async (sid) => {
                    setCurrentSessionId(sid)
                    try { const t = await window.electronAPI.getSessionTranscript(sid)
                      if (t?.events?.length) setMessages(t.events.filter((e: any) => e.type === 'user' || e.type === 'assistant').map((e: any) => ({ id: e.uuid || Math.random().toString(36), role: (e.type === 'user' ? 'user' as const : 'assistant' as const), content: extractContent(e), timestamp: Date.now() - 1000 })).filter((m: ChatMessage) => m.content))
                    } catch {}
                  }}
                  autoApproval={autoApproval}
                  onAutoApprovalChange={async (v) => {
                    if (!appSettings) return
                    const updated = { ...appSettings, autoApproval: v }
                    setAppSettings(updated)
                    await window.electronAPI.saveSettings(updated)
                  }}
                  onMentionAgent={handleMentionAgent}
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
            </main>

            <div className="splitter splitter-h" onMouseDown={rightSplitter.onMouseDown} />

            <aside className="sidebar right-sidebar" style={{ width: rightSplitter.size }}>
              <div className="sidebar-tabs">
                <button className={rightView === 'tasks' ? 'active' : ''} onClick={() => setRightView('tasks')}>📊 任务</button>
                <button className={rightView === 'office' ? 'active' : ''} onClick={() => setRightView('office')}>🏢 办公室</button>
                <button className={rightView === 'connection' ? 'active' : ''} onClick={() => setRightView('connection')}>🔗 连接</button>
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
              {rightView === 'office' && <PixelOffice activeProject={activeProject} tasks={tasks} team={team.length ? team : DEFAULT_TEAM} onTeamChange={handleTeamChange} />}
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

      {pending.length === 0 && <p className="empty-hint">无待处理任务</p>}
    </div>
  )
}
