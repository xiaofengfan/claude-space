/**
 * SQLite 持久化
 *
 * 借鉴 Foundry packages/store/src/sqlite-uow.ts，重写为 better-sqlite3
 *
 * 技术选型：better-sqlite3
 * 原因：Electron 28 自带 Node 18，不支持 node:sqlite
 *
 * 表结构：projects / orchestrations / tasks / runs / schema_version
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type {
  Orchestration,
  OrchestrationStatus,
  Project,
  Run,
  Task,
  TaskStatus,
} from './types.js';
import { StoreError } from './errors.js';

// ── 行类型（数据库原始行）──────────────────────────────────

interface ProjectRow {
  id: string;
  repo_path: string;
  kind: string | null;
  goal: string | null;
  phase: string | null;
  created_at: string;
  updated_at: string;
}

interface OrchestrationRow {
  id: string;
  project_id: string;
  template_id: string;
  status: string;
  goal: string;
  test_command: string | null;
  auto_approve: number;
  model: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface TaskRow {
  id: string;
  orchestration_id: string;
  title: string;
  description: string | null;
  kind: string;
  status: string;
  deps_json: string;
  phase: string | null;
  prompt: string | null;
  gate: string | null;
  approval_prompt: string | null;
  max_attempts: number;
  timeout_ms: number | null;
  fallback_to: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  attempts: number;
  last_error: string | null;
  last_run_id: string | null;
  inputs_json: string | null;
  outputs_json: string | null;
  model: string | null;
  retry_policy_json: string | null;
  advisors_json: string | null;
  cases_json: string | null;
  workflow_ref: string | null;
  params_json: string | null;
  harness_json: string | null;
  inject_as: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  task_id: string;
  attempt: number;
  session_id: string | null;
  started_at: string;
  finished_at: string | null;
  outcome: string | null;
  commit_hash: string | null;
  error: string | null;
}

// ── SqliteStore ───────────────────────────────────────────

export class SqliteStore {
  private static instances = new Map<string, SqliteStore>();
  private db: DatabaseType;

  private constructor(repoPath: string) {
    const dbPath = path.join(repoPath, '.foundry', 'foundry.sqlite');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    try {
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
      this.migrate();
    } catch (e) {
      throw new StoreError(
        `打开 SQLite 失败: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  }

  /** 获取单例（同 repoPath 只开一个连接） */
  static get(repoPath: string): SqliteStore {
    if (!this.instances.has(repoPath)) {
      this.instances.set(repoPath, new SqliteStore(repoPath));
    }
    return this.instances.get(repoPath)!;
  }

  /** 关闭连接 */
  close(): void {
    try {
      this.db.close();
    } catch (e) {
      console.warn(`[store] close failed: ${e}`);
    }
  }

  // ── Migration ──────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        repo_path TEXT NOT NULL,
        kind TEXT,
        goal TEXT,
        phase TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orchestrations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        template_id TEXT NOT NULL,
        status TEXT NOT NULL,
        goal TEXT NOT NULL,
        test_command TEXT,
        auto_approve INTEGER DEFAULT 0,
        model TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        orchestration_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        deps_json TEXT NOT NULL,
        phase TEXT,
        prompt TEXT,
        gate TEXT,
        approval_prompt TEXT,
        max_attempts INTEGER DEFAULT 3,
        timeout_ms INTEGER,
        fallback_to TEXT,
        worktree_path TEXT,
        worktree_branch TEXT,
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        last_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (orchestration_id) REFERENCES orchestrations(id)
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        session_id TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        outcome TEXT,
        commit_hash TEXT,
        error TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_orch ON tasks(orchestration_id);
      CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_orch_proj ON orchestrations(project_id);
    `);

    // 迁移：为旧表添加 inputs_json/outputs_json 列
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN inputs_json TEXT');
    } catch { /* 列已存在 */ }
    try {
      this.db.exec('ALTER TABLE tasks ADD COLUMN outputs_json TEXT');
    } catch { /* 列已存在 */ }
    // 迁移：v3 扩展字段（model/retryPolicy/advisors/cases/workflow/params/harness/injectAs）
    for (const col of [
      'model TEXT',
      'retry_policy_json TEXT',
      'advisors_json TEXT',
      'cases_json TEXT',
      'workflow_ref TEXT',
      'params_json TEXT',
      'harness_json TEXT',
      'inject_as TEXT',
    ]) {
      try { this.db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`); } catch { /* 列已存在 */ }
    }

    // 记录 migration 版本
    const versionRow = this.db.prepare('SELECT COUNT(*) as c FROM schema_version').get() as { c: number };
    if (versionRow.c === 0) {
      this.db.prepare(
        'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
      ).run(1, new Date().toISOString());
    }
  }

  // ── Project ────────────────────────────────────────────

  saveProject(project: Project): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO projects
        (id, repo_path, kind, goal, phase, created_at, updated_at)
        VALUES (@id, @repo_path, @kind, @goal, @phase, @created_at, @updated_at)
      `).run({
        id: project.id,
        repo_path: project.repoPath,
        kind: project.kind ?? null,
        goal: project.goal ?? null,
        phase: project.phase ?? null,
        created_at: project.createdAt,
        updated_at: project.updatedAt,
      });
    });
    tx();
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? this.mapProject(row) : null;
  }

  getProjectByRepo(repoPath: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE repo_path = ?').get(repoPath) as ProjectRow | undefined;
    return row ? this.mapProject(row) : null;
  }

  private mapProject(row: ProjectRow): Project {
    return {
      id: row.id,
      repoPath: row.repo_path,
      kind: row.kind ?? undefined,
      goal: row.goal ?? undefined,
      phase: row.phase ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ── Orchestration ──────────────────────────────────────

  saveOrchestration(orch: Orchestration): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO orchestrations
        (id, project_id, template_id, status, goal, test_command, auto_approve, model,
         created_at, updated_at, finished_at)
        VALUES (@id, @project_id, @template_id, @status, @goal, @test_command, @auto_approve, @model,
                @created_at, @updated_at, @finished_at)
      `).run({
        id: orch.id,
        project_id: orch.projectId,
        template_id: orch.templateId,
        status: orch.status,
        goal: orch.goal,
        test_command: orch.testCommand ?? null,
        auto_approve: orch.autoApprove ? 1 : 0,
        model: orch.model ?? null,
        created_at: orch.createdAt,
        updated_at: orch.updatedAt,
        finished_at: orch.finishedAt ?? null,
      });
    });
    tx();
  }

  getOrchestration(id: string): Orchestration | null {
    const row = this.db.prepare('SELECT * FROM orchestrations WHERE id = ?').get(id) as OrchestrationRow | undefined;
    return row ? this.mapOrchestration(row) : null;
  }

  listOrchestrations(projectId: string): Orchestration[] {
    const rows = this.db.prepare(
      'SELECT * FROM orchestrations WHERE project_id = ? ORDER BY created_at DESC',
    ).all(projectId) as OrchestrationRow[];
    return rows.map((r) => this.mapOrchestration(r));
  }

  findPendingOrchestrations(projectId: string): Orchestration[] {
    const rows = this.db.prepare(
      `SELECT * FROM orchestrations
       WHERE project_id = ? AND status IN ('pending', 'running', 'paused')
       ORDER BY created_at DESC`,
    ).all(projectId) as OrchestrationRow[];
    return rows.map((r) => this.mapOrchestration(r));
  }

  updateOrchestrationStatus(id: string, status: OrchestrationStatus): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE orchestrations
      SET status = ?, updated_at = ?, finished_at = ?
      WHERE id = ?
    `).run(
      status,
      now,
      ['success', 'failed', 'interrupted'].includes(status) ? now : null,
      id,
    );
  }

  private mapOrchestration(row: OrchestrationRow): Orchestration {
    return {
      id: row.id,
      projectId: row.project_id,
      templateId: row.template_id,
      status: row.status as OrchestrationStatus,
      goal: row.goal,
      testCommand: row.test_command ?? undefined,
      autoApprove: row.auto_approve === 1,
      model: row.model ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at ?? undefined,
    };
  }

  // ── Task ───────────────────────────────────────────────

  saveTask(task: Task): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO tasks
        (id, orchestration_id, title, description, kind, status, deps_json,
         phase, prompt, gate, approval_prompt, max_attempts, timeout_ms, fallback_to,
         worktree_path, worktree_branch, attempts, last_error, last_run_id,
         inputs_json, outputs_json,
         model, retry_policy_json, advisors_json, cases_json, workflow_ref, params_json, harness_json, inject_as,
         created_at, updated_at)
        VALUES (@id, @orchestration_id, @title, @description, @kind, @status, @deps_json,
                @phase, @prompt, @gate, @approval_prompt, @max_attempts, @timeout_ms, @fallback_to,
                @worktree_path, @worktree_branch, @attempts, @last_error, @last_run_id,
                @inputs_json, @outputs_json,
                @model, @retry_policy_json, @advisors_json, @cases_json, @workflow_ref, @params_json, @harness_json, @inject_as,
                @created_at, @updated_at)
      `).run({
        id: task.id,
        orchestration_id: task.orchestrationId,
        title: task.title,
        description: task.description ?? null,
        kind: task.kind,
        status: task.status,
        deps_json: JSON.stringify(task.deps),
        phase: task.phase ?? null,
        prompt: task.prompt ?? null,
        gate: task.gate ?? null,
        approval_prompt: task.approvalPrompt ?? null,
        max_attempts: task.maxAttempts ?? 3,
        timeout_ms: task.timeoutMs ?? null,
        fallback_to: task.fallbackTo ?? null,
        worktree_path: task.worktreePath ?? null,
        worktree_branch: task.worktreeBranch ?? null,
        attempts: task.attempts,
        last_error: task.lastError ?? null,
        last_run_id: task.lastRunId ?? null,
        inputs_json: task.inputs ? JSON.stringify(task.inputs) : null,
        outputs_json: task.outputs ? JSON.stringify(task.outputs) : null,
        model: task.model ?? null,
        retry_policy_json: task.retryPolicy ? JSON.stringify(task.retryPolicy) : null,
        advisors_json: task.advisors ? JSON.stringify(task.advisors) : null,
        cases_json: task.cases ? JSON.stringify(task.cases) : null,
        workflow_ref: task.workflow ?? null,
        params_json: task.params ? JSON.stringify(task.params) : null,
        harness_json: task.harness ? JSON.stringify(task.harness) : null,
        inject_as: task.injectAs ?? null,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
      });
    });
    tx();
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? this.mapTask(row) : null;
  }

  listTasks(orchestrationId: string): Task[] {
    const rows = this.db.prepare(
      'SELECT * FROM tasks WHERE orchestration_id = ? ORDER BY created_at ASC',
    ).all(orchestrationId) as TaskRow[];
    return rows.map((r) => this.mapTask(r));
  }

  updateTaskStatus(
    id: string,
    status: TaskStatus,
    extra?: { attempts?: number; lastError?: string; lastRunId?: string; worktreePath?: string; worktreeBranch?: string },
  ): void {
    const now = new Date().toISOString();
    const sets = ['status = ?', 'updated_at = ?'];
    const vals: (string | number | null)[] = [status, now];

    if (extra?.attempts !== undefined) {
      sets.push('attempts = ?');
      vals.push(extra.attempts);
    }
    if (extra?.lastError !== undefined) {
      sets.push('last_error = ?');
      vals.push(extra.lastError);
    }
    if (extra?.lastRunId !== undefined) {
      sets.push('last_run_id = ?');
      vals.push(extra.lastRunId);
    }
    if (extra?.worktreePath !== undefined) {
      sets.push('worktree_path = ?');
      vals.push(extra.worktreePath);
    }
    if (extra?.worktreeBranch !== undefined) {
      sets.push('worktree_branch = ?');
      vals.push(extra.worktreeBranch);
    }

    vals.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  /** 更新任务的输入/输出配置 */
  updateTaskIO(
    id: string,
    inputs?: Task['inputs'],
    outputs?: Task['outputs'],
  ): void {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const vals: (string | number | null)[] = [now];

    if (inputs !== undefined) {
      sets.push('inputs_json = ?');
      vals.push(inputs ? JSON.stringify(inputs) : null);
    }
    if (outputs !== undefined) {
      sets.push('outputs_json = ?');
      vals.push(outputs ? JSON.stringify(outputs) : null);
    }

    vals.push(id);
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }

  private mapTask(row: TaskRow): Task {
    return {
      id: row.id,
      orchestrationId: row.orchestration_id,
      title: row.title,
      description: row.description ?? undefined,
      kind: row.kind as Task['kind'],
      status: row.status as TaskStatus,
      deps: JSON.parse(row.deps_json) as string[],
      phase: row.phase ?? undefined,
      prompt: row.prompt ?? undefined,
      gate: (row.gate as Task['gate']) ?? undefined,
      approvalPrompt: row.approval_prompt ?? undefined,
      maxAttempts: row.max_attempts,
      timeoutMs: row.timeout_ms ?? undefined,
      fallbackTo: row.fallback_to ?? undefined,
      worktreePath: row.worktree_path ?? undefined,
      worktreeBranch: row.worktree_branch ?? undefined,
      attempts: row.attempts,
      lastError: row.last_error ?? undefined,
      lastRunId: row.last_run_id ?? undefined,
      inputs: row.inputs_json ? JSON.parse(row.inputs_json) : undefined,
      outputs: row.outputs_json ? JSON.parse(row.outputs_json) : undefined,
      model: row.model ?? undefined,
      retryPolicy: row.retry_policy_json ? JSON.parse(row.retry_policy_json) : undefined,
      advisors: row.advisors_json ? JSON.parse(row.advisors_json) : undefined,
      cases: row.cases_json ? JSON.parse(row.cases_json) : undefined,
      workflow: row.workflow_ref ?? undefined,
      params: row.params_json ? JSON.parse(row.params_json) : undefined,
      harness: row.harness_json ? JSON.parse(row.harness_json) : undefined,
      injectAs: row.inject_as ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ── Run ────────────────────────────────────────────────

  saveRun(run: Run): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO runs
        (id, task_id, attempt, session_id, started_at, finished_at, outcome, commit_hash, error)
        VALUES (@id, @task_id, @attempt, @session_id, @started_at, @finished_at, @outcome, @commit_hash, @error)
      `).run({
        id: run.id,
        task_id: run.taskId,
        attempt: run.attempt,
        session_id: run.sessionId ?? null,
        started_at: run.startedAt,
        finished_at: run.finishedAt ?? null,
        outcome: run.outcome ?? null,
        commit_hash: run.commitHash ?? null,
        error: run.error ?? null,
      });
    });
    tx();
  }

  getRun(id: string): Run | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    return row ? this.mapRun(row) : null;
  }

  listRuns(taskId: string): Run[] {
    const rows = this.db.prepare(
      'SELECT * FROM runs WHERE task_id = ? ORDER BY attempt ASC',
    ).all(taskId) as RunRow[];
    return rows.map((r) => this.mapRun(r));
  }

  private mapRun(row: RunRow): Run {
    return {
      id: row.id,
      taskId: row.task_id,
      attempt: row.attempt,
      sessionId: row.session_id ?? undefined,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? undefined,
      outcome: (row.outcome as Run['outcome']) ?? undefined,
      commitHash: row.commit_hash ?? undefined,
      error: row.error ?? undefined,
    };
  }

  // ── 事务 ───────────────────────────────────────────────

  /**
   * 执行事务
   *
   * @param fn - 事务体
   */
  transaction<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return tx();
  }
}
