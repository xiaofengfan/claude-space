/**
 * WorkflowEngine — 工作流执行引擎
 *
 * 按模板定义的阶段顺序执行，支持 single / parallel / loop 三种类型。
 * 每阶段完成后收集结果，广播实时日志事件。
 */
import { ClaudeProcess } from './claudeProcess'
import fs from 'fs'
import path from 'path'
import os from 'os'

const WORKFLOW_RUNS_FILE = path.join(os.homedir(), '.claude', 'claude-space-workflow-runs.json')

export interface WorkflowPhase {
  name: string; type: 'single' | 'parallel' | 'loop'; prompt: string; model: string
}

export interface WorkflowRun {
  id: string; templateId: string; name: string
  status: 'queued' | 'running' | 'success' | 'error'
  createdAt: string; completedAt?: string
  phases: WorkflowPhase[]
  phaseResults?: Array<{ name: string; status: string; output: string; tokensUsed?: number }>
  error?: string
}

type BroadcastFn = (channel: string, ...args: any[]) => void

export class WorkflowEngine {
  private broadcast: BroadcastFn
  private getCwd: () => string

  constructor(broadcast: BroadcastFn, getCwd: () => string) {
    this.broadcast = broadcast
    this.getCwd = getCwd
  }

  /** 加载所有工作流记录 */
  loadRuns(): WorkflowRun[] {
    try {
      if (fs.existsSync(WORKFLOW_RUNS_FILE)) {
        return JSON.parse(fs.readFileSync(WORKFLOW_RUNS_FILE, 'utf-8'))
      }
    } catch {}
    return []
  }

  /** 保存工作流记录 */
  private saveRuns(runs: WorkflowRun[]): void {
    try {
      const dir = path.dirname(WORKFLOW_RUNS_FILE)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = WORKFLOW_RUNS_FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(runs.slice(0, 100), null, 2), 'utf-8')
      fs.renameSync(tmp, WORKFLOW_RUNS_FILE)
    } catch {}
  }

  /** 创建并开始执行工作流 */
  async execute(opts: {
    templateId: string; name: string
    phases: WorkflowPhase[]
  }): Promise<WorkflowRun> {
    const run: WorkflowRun = {
      id: 'wf_' + Date.now().toString(36),
      templateId: opts.templateId,
      name: opts.name,
      status: 'running',
      createdAt: new Date().toISOString(),
      phases: opts.phases,
      phaseResults: [],
    }

    // 持久化初始状态
    const runs = this.loadRuns()
    runs.unshift(run)
    this.saveRuns(runs)

    this.broadcast('workflow:status', { runId: run.id, status: 'running', name: run.name })

    try {
      // 依次执行每个阶段
      for (let i = 0; i < opts.phases.length; i++) {
        const phase = opts.phases[i]
        this.broadcast('workflow:log', {
          runId: run.id, phaseIndex: i, phaseName: phase.name,
          message: `开始阶段 ${i + 1}/${opts.phases.length}: ${phase.name} (${phase.type})`,
        })

        const phaseResult = await this.executePhase(phase, run.id)
        run.phaseResults!.push(phaseResult)

        this.broadcast('workflow:log', {
          runId: run.id, phaseIndex: i, phaseName: phase.name,
          message: `阶段完成: ${phase.name} — ${phaseResult.status}`,
        })

        // 如果某阶段失败，停止后续执行
        if (phaseResult.status === 'error') {
          run.status = 'error'
          run.error = `阶段 "${phase.name}" 执行失败: ${phaseResult.output?.slice(0, 200)}`
          break
        }
      }

      if (run.status === 'running') {
        run.status = 'success'
      }
    } catch (err: any) {
      run.status = 'error'
      run.error = err.message
    }

    run.completedAt = new Date().toISOString()

    // 更新持久化
    const allRuns = this.loadRuns()
    const idx = allRuns.findIndex(r => r.id === run.id)
    if (idx >= 0) allRuns[idx] = run
    else allRuns.unshift(run)
    this.saveRuns(allRuns)

    this.broadcast('workflow:status', { runId: run.id, status: run.status, name: run.name })
    return run
  }

  /** 执行单个阶段 */
  private async executePhase(phase: WorkflowPhase, runId: string): Promise<{
    name: string; status: string; output: string; tokensUsed?: number
  }> {
    if (phase.type === 'single') {
      return this.runSinglePhase(phase, runId)
    } else if (phase.type === 'parallel') {
      return this.runParallelPhase(phase, runId)
    } else {
      // 'loop' 类型执行一次（完整循环由 scheduler 处理）
      return this.runSinglePhase(phase, runId)
    }
  }

  /** 单次 Claude 调用 */
  private runSinglePhase(phase: WorkflowPhase, _runId: string): Promise<{
    name: string; status: string; output: string; tokensUsed?: number
  }> {
    return new Promise((resolve) => {
      const proc = new ClaudeProcess({
        cwd: this.getCwd(),
        permissionMode: 'auto',
      })

      let outputText = ''
      let tokensUsed = 0
      let hasError = false

      proc.on('event', (event: any) => {
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              outputText += block.text
            }
          }
        }
        if (event.type === 'result') {
          if (event.usage) {
            tokensUsed = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
          }
          if (event.is_error) hasError = true
        }
      })

      proc.sendPrompt(phase.prompt)

      proc.on('close', (code: number | null) => {
        resolve({
          name: phase.name,
          status: code === 0 && !hasError ? 'success' : 'error',
          output: outputText.slice(0, 3000) || (code !== 0 ? `exit code ${code}` : ''),
          tokensUsed,
        })
      })
    })
  }

  /** 并行 Claude 调用（拆分为 3 个子任务） */
  private async runParallelPhase(phase: WorkflowPhase, runId: string): Promise<{
    name: string; status: string; output: string; tokensUsed?: number
  }> {
    const subPrompts = [
      `${phase.prompt}\n\n[子任务 1/3] 聚焦于规划和分析，输出你的分析和计划。`,
      `${phase.prompt}\n\n[子任务 2/3] 聚焦于具体实现，输出可执行的代码或方案。`,
      `${phase.prompt}\n\n[子任务 3/3] 聚焦于验证和审查，输出审查结果和改进建议。`,
    ]

    const results = await Promise.allSettled(
      subPrompts.map(prompt =>
        new Promise<{ output: string; tokensUsed: number }>((resolve, reject) => {
          const proc = new ClaudeProcess({
            cwd: this.getCwd(),
            permissionMode: 'auto',
          })
          let output = ''
          let tokens = 0

          proc.on('event', (event: any) => {
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) output += block.text
              }
            }
            if (event.type === 'result') {
              if (event.usage) {
                tokens = (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
              }
            }
          })
          proc.sendPrompt(prompt)
          proc.on('close', (code: number | null) => {
            if (code === 0) resolve({ output, tokensUsed: tokens })
            else reject(new Error(`exit code ${code}`))
          })
        })
      )
    )

    const outputs: string[] = []
    let totalTokens = 0
    let hasError = false
    for (const r of results) {
      if (r.status === 'fulfilled') {
        outputs.push(r.value.output)
        totalTokens += r.value.tokensUsed
      } else {
        outputs.push(`[错误: ${(r.reason as any)?.message || 'unknown'}]`)
        hasError = true
      }
    }

    return {
      name: phase.name,
      status: hasError ? 'error' : 'success',
      output: outputs.map((o, i) => `### 子任务 ${i + 1}\n${o}`).join('\n\n---\n\n'),
      tokensUsed: totalTokens,
    }
  }
}
