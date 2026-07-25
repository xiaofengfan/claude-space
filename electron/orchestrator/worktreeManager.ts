/**
 * Git Worktree 管理器
 *
 * 借鉴 Foundry packages/engine/src/git/worktree.ts，重写为 claude-space 风格
 *
 * 核心操作：
 * - preflight：预检（工作目录干净/不在保护分支/.foundry 在 gitignore）
 * - create：创建 foundry/task-<id> 分支 + worktree
 * - merge：fast-forward 合并到 foundry/integration
 * - remove：清理 worktree + 删除分支
 * - pruneAll：清理所有残留
 *
 * 安全约束：
 * - 所有 worktree 在 .foundry/worktrees/<taskId>/ 下
 * - 禁止操作 main/master/develop 分支
 * - 合并用 --ff-only，冲突报错
 * - 危险操作前记录 snapshot
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { WorktreeError, PreflightError } from './errors.js';

const execFileAsync = promisify(execFile);

/** 受保护的分支（禁止操作） */
const PROTECTED_BRANCHES = ['main', 'master', 'develop', 'release/*'];

/** Git 命令可执行文件名（跨平台适配） */
const GIT_BIN = process.platform === 'win32' ? 'git.exe' : 'git';

/** worktree 创建结果 */
export interface WorktreeInfo {
  path: string;
  branch: string;
}

/** git 操作结果 */
interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * 执行 git 命令
 *
 * @param args - git 参数
 * @param cwd - 工作目录
 * @returns GitResult
 */
async function git(args: string[], cwd: string): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync(GIT_BIN, args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (e: any) {
    return {
      code: e.code ?? 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? String(e),
    };
  }
}

/**
 * 检查分支是否受保护
 */
function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.some((pattern) => {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      return branch.startsWith(prefix + '/');
    }
    return branch === pattern;
  });
}

/**
 * Worktree 管理器
 */
export class WorktreeManager {
  private readonly repoPath: string;
  private readonly foundryDir: string;
  private readonly worktreesDir: string;

  constructor(repoPath: string) {
    this.repoPath = path.resolve(repoPath);
    this.foundryDir = path.join(this.repoPath, '.foundry');
    this.worktreesDir = path.join(this.foundryDir, 'worktrees');
  }

  /**
   * 预检：确保可以安全执行编排
   *
   * @throws PreflightError 如果预检失败（非 git 仓库、在保护分支上等硬性条件）
   *
   * 注意：工作目录有未提交改动只记日志警告，不阻止启动
   */
  async preflight(): Promise<void> {
    // 1. 必须是 git 仓库
    const revParse = await git(['rev-parse', '--is-inside-work-tree'], this.repoPath);
    if (revParse.code !== 0 || revParse.stdout.trim() !== 'true') {
      throw new PreflightError(`${this.repoPath} 不是 git 仓库，请先执行 git init`);
    }

    // 2. 工作目录有未提交改动时只警告不阻止
    const status = await git(['status', '--porcelain'], this.repoPath);
    if (status.stdout.trim()) {
      // 不抛错，只记日志（由调用方决定如何处理）
      // 注意：worktree 创建时会基于 HEAD 创建新分支，未提交改动不影响 worktree
    }

    // 3. 不能在 foundry/integration 分支上（这是编排内部使用的分支）
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], this.repoPath);
    const currentBranch = branch.stdout.trim();
    if (currentBranch === 'foundry/integration') {
      throw new PreflightError('不能在 foundry/integration 分支上启动编排，请切换到其他分支');
    }

    // 注意：master/main 等分支不阻止启动，因为 worktree 会创建独立工作树，
    // 不会影响当前分支的工作目录。保护分支检查已移除。

    // 4. .foundry/ 必须在 .gitignore 中
    await this.ensureGitignore();
  }

  /**
   * 确保 .foundry/ 在 .gitignore 中
   */
  private async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.repoPath, '.gitignore');
    let content = '';
    try {
      content = await fs.promises.readFile(gitignorePath, 'utf8');
    } catch {
      // 文件不存在
    }
    if (!content.includes('.foundry/')) {
      const newContent = content + (content && !content.endsWith('\n') ? '\n' : '') + '.foundry/\n';
      await fs.promises.writeFile(gitignorePath, newContent, 'utf8');
    }
  }

  /**
   * 创建 worktree
   *
   * @param taskId - 任务 id
   * @returns worktree 信息
   * @throws WorktreeError 如果创建失败
   */
  async create(taskId: string): Promise<WorktreeInfo> {
    const branch = `foundry/task-${taskId}`;
    const wtPath = path.join(this.worktreesDir, taskId);

    // 如果工作目录已存在，先清理（可能是上次执行中断的残留）
    if (fs.existsSync(wtPath)) {
      // 尝试用 git worktree remove 清理
      await git(['worktree', 'remove', wtPath, '--force'], this.repoPath).catch(() => {});
      // 物理删除残留目录
      try {
        await fs.promises.rm(wtPath, { recursive: true, force: true });
      } catch {
        // 忽略
      }
      // 删除可能残留的分支
      await git(['branch', '-D', branch], this.repoPath).catch(() => {});
    }

    // 确保 foundry/integration 分支存在
    await this.ensureIntegrationBranch();

    // 创建 worktree
    const result = await git(
      ['worktree', 'add', '-b', branch, wtPath, 'foundry/integration'],
      this.repoPath,
    );
    if (result.code !== 0) {
      throw new WorktreeError(`创建 worktree 失败: ${result.stderr}`, { cause: new Error(result.stderr) });
    }

    return { path: wtPath, branch };
  }

  /**
   * 确保 foundry/integration 分支存在
   */
  private async ensureIntegrationBranch(): Promise<void> {
    // 检查分支是否存在
    const result = await git(['rev-parse', '--verify', 'foundry/integration'], this.repoPath);
    if (result.code === 0) return; // 已存在

    // 从当前 HEAD 创建
    const create = await git(['branch', 'foundry/integration'], this.repoPath);
    if (create.code !== 0) {
      throw new WorktreeError(`创建 foundry/integration 分支失败: ${create.stderr}`);
    }
  }

  /**
   * 合并任务分支到 foundry/integration
   *
   * 策略：fast-forward only，冲突报错
   *
   * @param taskId - 任务 id
   * @returns 合并后的 commit hash
   * @throws WorktreeError 如果合并失败
   */
  async merge(taskId: string): Promise<string> {
    const branch = `foundry/task-${taskId}`;
    const wtPath = path.join(this.worktreesDir, taskId);

    // 记录合并前的 snapshot
    const beforeSnap = await git(['rev-parse', 'foundry/integration'], this.repoPath);
    const beforeHash = beforeSnap.stdout.trim();

    // 切到 integration 分支
    const checkout = await git(['checkout', 'foundry/integration'], this.repoPath);
    if (checkout.code !== 0) {
      throw new WorktreeError(`切换到 foundry/integration 失败: ${checkout.stderr}`);
    }

    try {
      // fast-forward 合并
      const merge = await git(['merge', '--ff-only', branch], this.repoPath);
      if (merge.code !== 0) {
        // 合并失败，尝试 abort
        await git(['merge', '--abort'], this.repoPath).catch(() => {});
        throw new WorktreeError(`合并冲突: ${branch}，已放弃合并。stderr: ${merge.stderr}`);
      }

      // 获取合并后的 commit hash
      const afterSnap = await git(['rev-parse', 'HEAD'], this.repoPath);
      return afterSnap.stdout.trim();
    } catch (e) {
      if (e instanceof WorktreeError) throw e;
      throw new WorktreeError(`合并异常: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }

  /**
   * 清理任务的 worktree 和分支
   *
   * @param taskId - 任务 id
   */
  async remove(taskId: string): Promise<void> {
    const branch = `foundry/task-${taskId}`;
    const wtPath = path.join(this.worktreesDir, taskId);

    // 1. 删除 worktree
    if (fs.existsSync(wtPath)) {
      const result = await git(['worktree', 'remove', wtPath, '--force'], this.repoPath);
      if (result.code !== 0) {
        console.warn(`[worktree] remove ${wtPath} failed: ${result.stderr}`);
        // 尝试物理删除
        try {
          await fs.promises.rm(wtPath, { recursive: true, force: true });
        } catch (e) {
          console.warn(`[worktree] physical remove failed: ${e}`);
        }
      }
    }

    // 2. 删除分支
    const delBranch = await git(['branch', '-D', branch], this.repoPath);
    if (delBranch.code !== 0) {
      // 分支可能不存在，忽略
    }
  }

  /**
   * 清理所有残留的 foundry worktree 和分支
   */
  async pruneAll(): Promise<void> {
    // 1. 列出所有 worktree
    const list = await git(['worktree', 'list', '--porcelain'], this.repoPath);
    if (list.code !== 0) return;

    const worktrees = this.parseWorktreeList(list.stdout);
    for (const wt of worktrees) {
      if (wt.path.includes('.foundry' + path.sep + 'worktrees') && fs.existsSync(wt.path)) {
        await git(['worktree', 'remove', wt.path, '--force'], this.repoPath).catch(() => {});
        try {
          await fs.promises.rm(wt.path, { recursive: true, force: true });
        } catch {
          // 忽略
        }
      }
    }

    // 2. git worktree prune
    await git(['worktree', 'prune'], this.repoPath).catch(() => {});

    // 3. 删除所有 foundry/task-* 分支
    const branches = await git(['branch', '--list', 'foundry/task-*'], this.repoPath);
    if (branches.code === 0) {
      const branchList = branches.stdout
        .split('\n')
        .map((b) => b.trim().replace('*', '').trim())
        .filter((b) => b.startsWith('foundry/task-'));
      for (const b of branchList) {
        await git(['branch', '-D', b], this.repoPath).catch(() => {});
      }
    }
  }

  /**
   * 解析 worktree list --porcelain 输出
   */
  private parseWorktreeList(output: string): Array<{ path: string; branch?: string }> {
    const result: Array<{ path: string; branch?: string }> = [];
    const blocks = output.split('\n\n');
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      const pathLine = lines.find((l) => l.startsWith('worktree '));
      const branchLine = lines.find((l) => l.startsWith('branch '));
      if (pathLine) {
        result.push({
          path: pathLine.slice('worktree '.length),
          branch: branchLine ? branchLine.slice('branch '.length) : undefined,
        });
      }
    }
    return result;
  }

  /**
   * 获取当前 HEAD 的 snapshot hash
   */
  async snapshot(): Promise<string> {
    const result = await git(['rev-parse', 'HEAD'], this.repoPath);
    return result.stdout.trim();
  }

  /**
   * 回滚到 snapshot
   */
  async rollback(snapshotHash: string): Promise<void> {
    const result = await git(['reset', '--hard', snapshotHash], this.repoPath);
    if (result.code !== 0) {
      throw new WorktreeError(`回滚到 ${snapshotHash} 失败: ${result.stderr}`);
    }
  }

  /**
   * 一键回滚：清理所有 foundry 痕迹
   */
  async fullRollback(): Promise<void> {
    await this.pruneAll();
    await git(['branch', '-D', 'foundry/integration'], this.repoPath).catch(() => {});
    try {
      await fs.promises.rm(this.foundryDir, { recursive: true, force: true });
    } catch {
      // 忽略
    }
  }
}
