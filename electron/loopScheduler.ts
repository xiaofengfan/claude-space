/**
 * LoopScheduler — 循环任务调度引擎
 *
 * 使用 setTimeout 链式调度（非 setInterval），每次执行完成后计算下次触发时间。
 * 防止同一 loop 并发执行，支持 pause/resume/runNow。
 */
import { ClaudeProcess } from './claudeProcess'
import fs from 'fs'
import path from 'path'
import os from 'os'

const LOOPS_FILE = path.join(os.homedir(), '.claude', 'claude-space-loops.json')
const LOOP_HISTORY_FILE = path.join(os.homedir(), '.claude', 'claude-space-loop-history.json')

export interface LoopConfig {
  id: string; name: string; prompt: string; interval: string
  enabled: boolean; createdAt: string; lastRun?: string | null; lastError?: string
}

interface LoopRun {
  id: string; loopId: string; loopName: string
  startedAt: string; completedAt?: string
  status: 'running' | 'success' | 'error'
  output?: string; error?: string; tokensUsed?: number; costUsd?: number
}

function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(m|h|d)$/)
  if (!match) return 10 * 60 * 1000  // 默认 10 分钟
  const num = parseInt(match[1], 10)
  switch (match[2]) {
    case 'm': return num * 60 * 1000
    case 'h': return num * 60 * 60 * 1000
    case 'd': return num * 24 * 60 * 60 * 1000
    default: return 10 * 60 * 1000
  }
}

type BroadcastFn = (channel: string, ...args: any[]) => void

export class LoopScheduler {
  private timers = new Map<string, NodeJS.Timeout>()
  private running = new Set<string>()  // 防止同一 loop 并发
  private broadcast: BroadcastFn
  private getCwd: () => string

  constructor(broadcast: BroadcastFn, getCwd: () => string) {
    this.broadcast = broadcast
    this.getCwd = getCwd
  }

  /** 加载持久化的 loop 列表 */
  loadLoops(): LoopConfig[] {
    try { if (fs.existsSync(LOOPS_FILE)) return JSON.parse(fs.readFileSync(LOOPS_FILE, 'utf-8')) } catch {}
    return []
  }

  /** 保存 loop 列表 */
  saveLoops(loops: LoopConfig[]): void {
    try {
      const dir = path.dirname(LOOPS_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = LOOPS_FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(loops, null, 2), 'utf-8')
      fs.renameSync(tmp, LOOPS_FILE)
    } catch {}
  }

  /** 加载执行历史 */
  loadHistory(): LoopRun[] {
    try { if (fs.existsSync(LOOP_HISTORY_FILE)) return JSON.parse(fs.readFileSync(LOOP_HISTORY_FILE, 'utf-8')) } catch {}
    return []
  }

  /** 保存执行历史（保留最近 200 条） */
  private saveHistory(runs: LoopRun[]): void {
    try {
      const dir = path.dirname(LOOP_HISTORY_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = LOOP_HISTORY_FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(runs.slice(0, 200), null, 2), 'utf-8')
      fs.renameSync(tmp, LOOP_HISTORY_FILE)
    } catch {}
  }

  /** 追加一条执行记录 */
  private appendRun(run: LoopRun): void {
    const history = this.loadHistory()
    history.unshift(run)
    this.saveHistory(history)
  }

  /** 更新执行记录 */
  private updateRun(runId: string, updates: Partial<LoopRun>): void {
    const history = this.loadHistory()
    const idx = history.findIndex(r => r.id === runId)
    if (idx >= 0) {
      history[idx] = { ...history[idx], ...updates }
      this.saveHistory(history)
    }
  }

  /** 启动所有已启用的 loop（应用启动时调用） */
  resumeAll(): void {
    const loops = this.loadLoops()
    for (const loop of loops) {
      if (loop.enabled !== false) {
        this.schedule(loop)
      }
    }
  }

  /** 调度一个 loop */
  schedule(loop: LoopConfig): void {
    this.unschedule(loop.id)  // 先取消旧定时器
    const ms = parseInterval(loop.interval)
    const timer = setTimeout(() => {
      this.executeLoop(loop.id)
    }, ms)
    this.timers.set(loop.id, timer)
  }

  /** 取消调度 */
  unschedule(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
  }

  /** 立即执行 loop */
  async runNow(id: string): Promise<void> {
    this.unschedule(id)
    await this.executeLoop(id)
  }

  /** 暂停 loop */
  pause(id: string): void {
    this.unschedule(id)
  }

  /** 停止并移除所有定时器 */
  stopAll(): void {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.running.clear()
  }

  /** 核心：执行一个 loop 的 prompt */
  private async executeLoop(loopId: string): Promise<void> {
    // 防并发
    if (this.running.has(loopId)) return
    const loops = this.loadLoops()
    const loop = loops.find(l => l.id === loopId)
    if (!loop || loop.enabled === false) return

    const runId = 'looprun_' + Date.now().toString(36)
    const run: LoopRun = {
      id: runId, loopId: loop.id, loopName: loop.name,
      startedAt: new Date().toISOString(), status: 'running',
    }
    this.appendRun(run)
    this.running.add(loopId)
    this.broadcast('loop:status', { loopId: loop.id, runId, status: 'running', loopName: loop.name })

    // 更新 lastRun
    loop.lastRun = run.startedAt
    delete loop.lastError
    this.saveLoops(loops)

    return new Promise<void>((resolve) => {
      const proc = new ClaudeProcess({
        cwd: this.getCwd(),
        permissionMode: 'auto',
      })

      let outputText = ''
      let tokensUsed = 0
      let costUsd = 0
      let hasError = false

      proc.on('event', (event: any) => {
        // 收集流式内容
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              outputText += block.text
              this.broadcast('loop:output', { loopId: loop.id, runId, text: block.text })
            }
          }
        }
        // 收集用量信息
        if (event.type === 'result') {
          if (event.usage) {
            tokensUsed = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
          }
          if (event.total_cost_usd) costUsd = event.total_cost_usd
          if (event.is_error) hasError = true
          // 提取最终结果
          const resultText = typeof event.result === 'string'
            ? event.result
            : JSON.stringify(event.result)
          if (resultText && resultText.length < 5000) {
            outputText = outputText || resultText
          }
        }
      })

      proc.on('stderr', (text: string) => {
        this.broadcast('loop:output', { loopId: loop.id, runId, text: `[stderr] ${text}` })
      })

      // 发送提示词，启动 Claude 进程
      proc.sendPrompt(loop.prompt)

      proc.on('close', (code: number | null) => {
        this.running.delete(loopId)
        const completedAt = new Date().toISOString()

        // 更新 loop 状态
        const loops = this.loadLoops()
        const lo = loops.find(l => l.id === loopId)
        if (lo) {
          lo.lastRun = completedAt
          if (code !== 0 || hasError) {
            lo.lastError = outputText?.slice(0, 200) || `exit code ${code}`
          } else {
            delete lo.lastError
          }
          this.saveLoops(loops)
        }

        // 更新执行记录
        this.updateRun(runId, {
          status: code === 0 && !hasError ? 'success' : 'error',
          completedAt,
          output: outputText.slice(0, 2000),
          error: code !== 0 ? `exit code ${code}` : hasError ? 'Claude 执行错误' : undefined,
          tokensUsed,
          costUsd,
        })

        this.broadcast('loop:status', {
          loopId: loop.id, runId, status: code === 0 && !hasError ? 'success' : 'error',
          loopName: loop.name, error: code !== 0 ? `exit code ${code}` : '',
        })

        // 重新调度（使用最新状态）
        const refreshed = this.loadLoops().find(l => l.id === loopId)
        if (refreshed && refreshed.enabled !== false) {
          this.schedule(refreshed)
        }
        resolve()
      })
    })
  }
}
