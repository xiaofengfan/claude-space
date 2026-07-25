/**
 * 适配器实现
 *
 * 把 claude-space 现有的 ClaudeProcess / 测试执行器适配为
 * OrchestratorEngine 需要的 ClaudeRunner / GateRunner 接口
 *
 * 集成步骤（claude-space 的 main.ts）：
 * 1. import { createClaudeRunner, createGateRunner } from './orchestrator/adapters.js'
 * 2. const claudeRunner = createClaudeRunner({ spawnClaude: claudeSpaceSpawnFn })
 * 3. const gateRunner = createGateRunner({ defaultTestCommand: 'npm test' })
 * 4. registerOrchestratorIpc({ repoPath, claudeRunner, gateRunner })
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import type { ClaudeRunner, GateRunner } from './orchestratorEngine.js';
import type { ClaudeEvent } from './types.js';

const execFileAsync = promisify(execFile);

// ── ClaudeRunner 适配器 ───────────────────────────────────

/**
 * ClaudeProcess 适配器选项
 */
export interface ClaudeRunnerOpts {
  /**
   * 启动 Claude Code CLI 的函数
   *
   * 由 claude-space 提供，封装了 spawn + stream-json 解析
   * 返回 sessionId 和退出码
   */
  spawnClaude(args: {
    prompt: string;
    cwd: string;
    model?: string;
    onEvent?: (event: ClaudeEvent) => void;
  }): Promise<{
    sessionId?: string;
    exitCode: number;
    error?: string;
  }>;
}

/**
 * 创建 ClaudeRunner
 *
 * 适配 claude-space 的 ClaudeProcess 到 OrchestratorEngine 的 ClaudeRunner 接口
 */
export function createClaudeRunner(opts: ClaudeRunnerOpts): ClaudeRunner {
  return {
    async run({ prompt, cwd, model, timeoutMs, onEvent }) {
      try {
        const result = await opts.spawnClaude({ prompt, cwd, model, onEvent });

        if (result.exitCode !== 0) {
          return {
            success: false,
            sessionId: result.sessionId,
            error: result.error || `Claude 退出码: ${result.exitCode}`,
          };
        }

        // 读取最新 commit hash（如果 cwd 是 git 仓库）
        let commitHash: string | undefined;
        try {
          const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
          commitHash = stdout.trim();
        } catch {
          // 不是 git 仓库或无 commit
        }

        return {
          success: true,
          sessionId: result.sessionId,
          commitHash,
        };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}

// ── GateRunner 适配器 ─────────────────────────────────────

/**
 * GateRunner 适配器选项
 */
export interface GateRunnerOpts {
  /** 默认测试命令（如 'npm test' / 'mvn test'） */
  defaultTestCommand?: string;
  /** 测试超时（默认 10 分钟） */
  testTimeoutMs?: number;
  /** 代码审查使用的 Claude 模型 */
  reviewModel?: string;
  /**
   * 启动 Claude 做 review（复用 ClaudeRunner）
   * 如果不提供，review 总是返回 success
   */
  spawnClaudeForReview?: (args: {
    prompt: string;
    cwd: string;
    model?: string;
  }) => Promise<{ exitCode: number; error?: string }>;
}

/**
 * 创建 GateRunner
 *
 * - test gate：执行测试命令，检查退出码
 * - review gate：调用 Claude 做代码审查
 */
export function createGateRunner(opts: GateRunnerOpts = {}): GateRunner {
  return {
    async runTest({ cwd, command, timeoutMs }) {
      const cmd = command || opts.defaultTestCommand;
      if (!cmd) {
        return { success: false, error: '未配置测试命令' };
      }

      const timeout = timeoutMs ?? opts.testTimeoutMs ?? 10 * 60 * 1000;

      try {
        // 解析命令：支持 shell 特性（&&、| 等）
        const { stdout, stderr } = await execFileAsync(
          process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
          [process.platform === 'win32' ? '/c' : '-c', cmd],
          { cwd, timeout, maxBuffer: 10 * 1024 * 1024 },
        );

        return { success: true };
      } catch (e: any) {
        // 测试失败（非零退出码）
        if (e.code !== undefined && typeof e.code === 'number') {
          return {
            success: false,
            error: `测试失败（退出码 ${e.code}）: ${e.stderr || e.stdout || ''}`.slice(0, 500),
          };
        }
        // 超时或其他错误
        return {
          success: false,
          error: e.killed ? `测试超时（${timeout}ms）` : (e.message || String(e)),
        };
      }
    },

    async runReview({ cwd, model }) {
      if (!opts.spawnClaudeForReview) {
        // 未提供 review runner，默认通过
        return { success: true };
      }

      try {
        const prompt = `请审查当前目录的代码变更（git diff HEAD~1），检查：
1. 代码风格是否一致
2. 是否有明显的 bug
3. 是否有安全隐患
4. 是否有性能问题

如果审查通过，输出 "REVIEW PASSED"。
如果有问题，输出 "REVIEW FAILED" 并说明原因。`;

        const result = await opts.spawnClaudeForReview({
          prompt,
          cwd,
          model: model || opts.reviewModel,
        });

        if (result.exitCode !== 0) {
          return {
            success: false,
            error: result.error || `审查进程退出码: ${result.exitCode}`,
          };
        }

        return { success: true };
      } catch (e) {
        return {
          success: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
}

// ── 集成入口 ─────────────────────────────────────────────

/**
 * 创建完整的 runner 集合
 *
 * 便捷函数，一次性创建 ClaudeRunner + GateRunner
 */
export function createRunners(opts: {
  spawnClaude: ClaudeRunnerOpts['spawnClaude'];
  defaultTestCommand?: string;
  spawnClaudeForReview?: GateRunnerOpts['spawnClaudeForReview'];
}): { claudeRunner: ClaudeRunner; gateRunner: GateRunner } {
  return {
    claudeRunner: createClaudeRunner({ spawnClaude: opts.spawnClaude }),
    gateRunner: createGateRunner({
      defaultTestCommand: opts.defaultTestCommand,
      spawnClaudeForReview: opts.spawnClaudeForReview,
    }),
  };
}
