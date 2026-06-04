import { ClaudeProcess, ClaudeProcessOptions } from './claudeProcess'
import { EventEmitter } from 'events'

// ── Types ────────────────────────────────────────────────

export interface AgentInstance {
  agentId: string
  agentType: string
  agentName: string
  agentIcon: string
  agentColor: string
  process: ClaudeProcess
  status: 'idle' | 'running' | 'error'
  sessionId?: string
  lastResponse?: string
  modelId?: string  // per-agent model binding
}

export interface AgentTaggedEvent {
  agentId: string
  agentType: string
  agentName: string
  agentIcon: string
  agentColor: string
  // Original Claude event fields
  type: string
  subtype?: string
  message?: any
  result?: string
  session_id?: string
  total_cost_usd?: number
  duration_ms?: number
  usage?: any
  [key: string]: any
}

interface QueuedMessage {
  agentId: string
  content: string
  context: string  // previous agent responses
}

// ── AgentPool ────────────────────────────────────────────

export class AgentPool extends EventEmitter {
  private agents: Map<string, AgentInstance> = new Map()
  private queue: QueuedMessage[] = []
  private processing = false
  private maxConcurrent: number = 3  // 并行执行最多3个智能体
  private activeCount = 0
  private personaContents: Map<string, string> = new Map()  // stored for queue continuation
  private agentTimeouts: Map<string, NodeJS.Timeout> = new Map()
  private readonly AGENT_TIMEOUT_MS = 120_000  // 单个智能体超时 2 分钟
  private readonly AGENT_START_TIMEOUT_MS = 30_000  // 启动超时 30 秒

  // Global options passed to all Claude processes
  private globalOptions: {
    cwd?: string; model?: string; apiKey?: string; baseUrl?: string
    permissionMode?: 'auto' | 'manual'
  } = {}

  setGlobalOptions(opts: typeof this.globalOptions): void {
    this.globalOptions = { ...this.globalOptions, ...opts }
  }

  // Inject settings loader from main.ts (can't import circularly)
  private _loadSettings?: () => any
  setSettingsLoader(fn: () => any): void {
    this._loadSettings = fn
  }

  /** Get or create an agent instance */
  getOrCreateAgent(opts: {
    agentId: string; agentType: string; agentName: string
    agentIcon?: string; agentColor?: string
    sessionId?: string; modelId?: string  // per-agent model
  }): AgentInstance {
    const existing = this.agents.get(opts.agentId)
    if (existing) {
      existing.sessionId = opts.sessionId || existing.sessionId
      existing.modelId = opts.modelId || existing.modelId
      return existing
    }

    // Resolve model config — per-agent overrides global
    let modelOpts = {
      model: this.globalOptions.model,
      apiKey: this.globalOptions.apiKey,
      baseUrl: this.globalOptions.baseUrl,
    }
    if (opts.modelId) {
      try {
        const raw = this._loadSettings?.()
        const cfg = raw?.models?.find((m: any) => m.id === opts.modelId)
        if (cfg) {
          modelOpts = {
            model: cfg.model || modelOpts.model,
            apiKey: cfg.apiKey || modelOpts.apiKey,
            baseUrl: cfg.baseUrl || modelOpts.baseUrl,
          }
        }
      } catch { /* fall back to global */ }
    }

    const procOpts: ClaudeProcessOptions = {
      cwd: this.globalOptions.cwd,
      sessionId: opts.sessionId,
      model: modelOpts.model,
      apiKey: modelOpts.apiKey,
      baseUrl: modelOpts.baseUrl,
      permissionMode: this.globalOptions.permissionMode || 'auto',
    }

    const process = new ClaudeProcess(procOpts)
    const agent: AgentInstance = {
      agentId: opts.agentId,
      agentType: opts.agentType,
      agentName: opts.agentName,
      agentIcon: opts.agentIcon || '🤖',
      agentColor: opts.agentColor || '#888',
      process,
      status: 'idle',
      sessionId: opts.sessionId,
    }

    // Clear any existing timeout for this agent
    const clearAgentTimeout = () => {
      const t = this.agentTimeouts.get(agent.agentId)
      if (t) { clearTimeout(t); this.agentTimeouts.delete(agent.agentId) }
    }

    // Forward Claude events with agent tagging
    process.on('event', (rawEvent) => {
      const tagged: AgentTaggedEvent = {
        agentId: agent.agentId,
        agentType: agent.agentType,
        agentName: agent.agentName,
        agentIcon: agent.agentIcon,
        agentColor: agent.agentColor,
        ...rawEvent,
      }
      this.emit('agent-event', tagged)

      // Capture session_id from init event → extend timeout to full AGENT_TIMEOUT_MS
      if (rawEvent.type === 'system' && rawEvent.subtype === 'init' && rawEvent.session_id) {
        agent.sessionId = rawEvent.session_id
        clearAgentTimeout()
        // Replace start timeout with full execution timeout
        this.agentTimeouts.set(agent.agentId, setTimeout(() => {
          console.log('[agentPool] agent timeout:', agent.agentId, agent.agentName)
          this.handleAgentTimeout(agent.agentId)
        }, this.AGENT_TIMEOUT_MS))
      }

      // Capture final response text from result event
      if (rawEvent.type === 'result' && rawEvent.subtype === 'success') {
        agent.lastResponse = rawEvent.result || ''
      }
    })

    process.on('close', (code) => {
      clearAgentTimeout()
      agent.status = 'idle'
      this.activeCount--
      this.emit('agent-close', { agentId: agent.agentId, code })

      // Process next in queue
      this.processNext()
    })

    process.on('status', (s) => {
      agent.status = s.running ? 'running' : 'idle'
      this.emit('agent-status-update', {
        agentId: agent.agentId,
        agentType: agent.agentType,
        agentName: agent.agentName,
        ...s,
      })
    })

    process.on('error', (err) => {
      clearAgentTimeout()
      agent.status = 'error'
      this.activeCount--
      this.emit('agent-error', { agentId: agent.agentId, agentType: agent.agentType, agentName: agent.agentName, error: err.message })
      this.processNext()
    })

    // Forward stderr for debugging agent issues
    process.on('stderr', (text: string) => {
      this.emit('agent-stderr', { agentId: agent.agentId, agentType: agent.agentType, agentName: agent.agentName, text })
    })

    // Forward permission prompts from agents
    process.on('permission-prompt', (prompt: { text: string; timestamp: number }) => {
      this.emit('agent-permission-prompt', { agentId: agent.agentId, agentType: agent.agentType, agentName: agent.agentName, ...prompt })
    })

    this.agents.set(opts.agentId, agent)
    return agent
  }

  /** Send a message to a specific agent with persona context */
  sendToAgent(agentId: string, userContent: string, personaPrompt?: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Agent ${agentId} not found`)

    let fullContent = userContent
    if (personaPrompt) {
      fullContent = `${personaPrompt}\n\n---\n\n[USER MESSAGE]\n${userContent}`
    }

    this._doSend(agent, fullContent)
  }

  private _doSend(agent: AgentInstance, content: string): void {
    this.activeCount++
    agent.status = 'running'

    // Set startup timeout — if no init event within AGENT_START_TIMEOUT_MS, kill
    const startTimeout = setTimeout(() => {
      console.log('[agentPool] agent start timeout:', agent.agentId, agent.agentName)
      this.handleAgentTimeout(agent.agentId)
    }, this.AGENT_START_TIMEOUT_MS)
    this.agentTimeouts.set(agent.agentId, startTimeout)

    try {
      agent.process.sendPrompt(content)
    } catch (err: any) {
      const t = this.agentTimeouts.get(agent.agentId)
      if (t) { clearTimeout(t); this.agentTimeouts.delete(agent.agentId) }
      agent.status = 'error'
      this.activeCount--
      this.emit('agent-error', { agentId: agent.agentId, error: err.message })
      this.processNext()
    }
  }

  /** Handle agent timeout — kill the process and mark as error */
  private handleAgentTimeout(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (!agent || agent.status !== 'running') return

    console.log('[agentPool] killing timed-out agent:', agentId)
    agent.process.kill()
    agent.status = 'error'
    this.activeCount--
    this.emit('agent-close', { agentId, code: null })
    this.emit('agent-error', { agentId, agentType: agent.agentType, agentName: agent.agentName, error: '执行超时（超过 2 分钟）' })
    this.processNext()
  }

  /** Enqueue a group message: targets are processed sequentially */
  async sendGroup(opts: {
    targets: Array<{
      agentId: string; agentType: string; agentName: string
      agentIcon?: string; agentColor?: string; modelId?: string
    }>
    content: string
    personaContents: Map<string, string>  // agentId → persona prompt
  }): Promise<void> {
    // Create/get all agents with per-agent model config
    for (const t of opts.targets) {
      this.getOrCreateAgent({
        agentId: t.agentId,
        agentType: t.agentType,
        agentName: t.agentName,
        agentIcon: t.agentIcon,
        agentColor: t.agentColor,
        modelId: t.modelId,
      })
    }

    // Build queue: each agent gets the user content + context from prior agents
    this.queue = []
    let accumulatedContext = ''

    for (const t of opts.targets) {
      const persona = opts.personaContents.get(t.agentId) || ''
      let contextualContent = opts.content
      if (accumulatedContext) {
        contextualContent = `[CONTEXT — 其他智能体的回复]\n${accumulatedContext}\n\n---\n\n[CURRENT TASK]\n${opts.content}`
      }
      this.queue.push({
        agentId: t.agentId,
        content: contextualContent,
        context: accumulatedContext,
      })

      // Reserve space for context accumulation (will be filled after agent responds)
      accumulatedContext += `\n[${t.agentName} (${t.agentType}) 待回复...]\n`
    }

    // Start processing
    this.startProcessing(opts.personaContents)
  }

  private startProcessing(personas: Map<string, string>): void {
    if (this.processing) return
    this.personaContents = personas
    this.processing = true
    this.processNextQueued()
  }

  private processNext(): void {
    // Called after an agent completes — continue processing remaining queue items
    this.processNextQueued()
  }

  private processNextQueued(): void {
    // Fire as many agents as concurrency limit allows
    while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift()!
      const agent = this.agents.get(next.agentId)
      if (!agent) {
        console.log('[agentPool] agent not found in pool:', next.agentId)
        continue
      }

      // Build context from agents that already responded
      let contextStr = ''
      for (const [id, a] of this.agents) {
        if (a.lastResponse && id !== next.agentId) {
          contextStr += `\n[${a.agentName} (${a.agentType}) 的回复]:\n${a.lastResponse.slice(0, 2000)}\n`
        }
      }

      let fullContent = next.content
      if (contextStr) {
        fullContent = `[CONTEXT — 其他智能体已回复如下]\n${contextStr}\n\n---\n\n[CURRENT TASK — 请基于以上上下文回复]\n${next.content}`
      }

      const personaPrompt = this.personaContents.get(next.agentId)
      if (personaPrompt) {
        fullContent = `${personaPrompt}\n\n---\n\n${fullContent}`
      }

      this._doSend(agent, fullContent)
    }

    // If queue is empty and no active agents, stop processing
    if (this.queue.length === 0 && this.activeCount === 0) {
      this.processing = false
    }
  }

  /** Stop a specific agent */
  stopAgent(agentId: string): void {
    const t = this.agentTimeouts.get(agentId)
    if (t) { clearTimeout(t); this.agentTimeouts.delete(agentId) }

    const agent = this.agents.get(agentId)
    if (agent) {
      agent.process.kill()
      this.agents.delete(agentId)
      this.activeCount--
      // Remove from queue
      this.queue = this.queue.filter(q => q.agentId !== agentId)
      this.processNext()
    }
  }

  /** Stop all agents */
  stopAll(): void {
    for (const [agentId, timeout] of this.agentTimeouts) {
      clearTimeout(timeout)
    }
    this.agentTimeouts.clear()

    for (const [agentId] of this.agents) {
      try { this.agents.get(agentId)?.process.kill() } catch (_e) { /* silent */ }
    }
    this.agents.clear()
    this.queue = []
    this.processing = false
    this.activeCount = 0
  }

  /** Get status of all agents */
  getAllStatus(): Array<{
    agentId: string; agentType: string; agentName: string
    status: string; sessionId?: string
  }> {
    return Array.from(this.agents.values()).map(a => ({
      agentId: a.agentId,
      agentType: a.agentType,
      agentName: a.agentName,
      status: a.status,
      sessionId: a.sessionId,
    }))
  }
}
