/**
 * 真实诊断：启动编排后到底发生了什么
 * 1. 创建真实小项目（git init）
 * 2. 创建编排
 * 3. 启动并监听所有事件 20 秒
 * 4. 查询任务状态、run 记录、错误信息
 */
import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronPath = require('electron');

// 创建真实小项目
const testProjectDir = path.join(process.env.TEMP || '/tmp', 'test-orch-project-' + Date.now());
console.log('测试项目路径:', testProjectDir);
fs.mkdirSync(testProjectDir, { recursive: true });
fs.writeFileSync(path.join(testProjectDir, 'README.md'), '# Test Project\n\nA test project for orchestrator.\n');
fs.writeFileSync(path.join(testProjectDir, 'package.json'), JSON.stringify({
  name: 'test-orch-project',
  version: '1.0.0',
  description: 'Test project',
  scripts: { test: 'echo "test passed"' },
}, null, 2));
fs.writeFileSync(path.join(testProjectDir, 'index.js'), 'console.log("hello world");\n');

// git init
try {
  execSync('git init', { cwd: testProjectDir, stdio: 'pipe' });
  execSync('git add -A', { cwd: testProjectDir, stdio: 'pipe' });
  execSync('git -c user.name=test -c user.email=test@test.com commit -m "initial commit"', { cwd: testProjectDir, stdio: 'pipe' });
  console.log('git 初始化完成');
} catch (e) {
  console.log('git 初始化失败:', e.message);
}

const app = await electron.launch({
  executablePath: typeof electronPath === 'string' ? electronPath : electronPath.default,
  args: [path.join(__dirname, 'dist-electron', 'main.js'), '--user-data-dir=' + path.join(process.env.TEMP || '/tmp', 'cs-diag-' + Date.now())],
  cwd: __dirname,
});

await app.firstWindow();
await new Promise(r => setTimeout(r, 5000));

let page = null;
for (const w of app.windows()) {
  const url = await w.evaluate(() => location.href).catch(() => '');
  if (url.includes('localhost') || url.includes('index.html')) { page = w; break; }
}
if (!page) page = app.windows()[app.windows().length - 1];
await page.waitForLoadState('domcontentloaded');
await new Promise(r => setTimeout(r, 3000));

// 把测试项目加入 claude-space（通过 IPC 扫描目录）
console.log('\n=== 添加测试项目 ===');
// 先把测试项目路径写到一个临时目录，让 claude-space 能扫描到
// 直接用 IPC 创建编排（不通过 UI）

// 创建编排
console.log('\n=== 创建编排 ===');
const createRes = await page.evaluate(async (repoPath) => {
  return await window.orchestrator.create({
    repoPath,
    templateId: 'hotfix',
    goal: '修复 index.js 中的 console.log 输出问题',
    autoApprove: true,
    testCommand: 'echo test-passed',
  });
}, testProjectDir);
console.log('创建结果:', JSON.stringify(createRes, null, 2));

if (!createRes.ok) {
  console.log('✗ 创建失败');
  try { await app.close(); } catch {}
  process.exit(1);
}

const orchId = createRes.data.id || createRes.data;
console.log('编排 ID:', orchId);

// 订阅所有事件
await page.evaluate(() => {
  window.__events = [];
  const push = (type) => (p) => window.__events.push({ type, time: new Date().toISOString().slice(11, 23), ...p });
  window.orchestrator.onStatusChange(push('status-change'));
  window.orchestrator.onTaskStarted(push('task-started'));
  window.orchestrator.onTaskCompleted(push('task-completed'));
  window.orchestrator.onTaskLog(push('task-log'));
  window.orchestrator.onAwaitApproval(push('await-approval'));
  window.orchestrator.onLog(push('log'));
});

// 启动编排
console.log('\n=== 启动编排 ===');
const startRes = await page.evaluate(async (id) => {
  return await window.orchestrator.start(id);
}, orchId);
console.log('start 结果:', JSON.stringify(startRes, null, 2));

// 等待 20 秒收集事件
console.log('\n=== 等待 20 秒收集事件... ===');
await new Promise(r => setTimeout(r, 20000));

// 收集事件
const events = await page.evaluate(() => window.__events || []);
console.log(`\n收集到 ${events.length} 个事件:`);
events.forEach((e, i) => {
  const msg = e.message || e.line || e.status || e.outcome || JSON.stringify(e.event || '').slice(0, 100);
  console.log(`  [${i}] ${e.time} ${e.type}: ${msg} | task=${e.taskId || '-'} | orch=${(e.orchestrationId || '').slice(0, 12)}`);
});

// 查询最终状态
const statusRes = await page.evaluate(async (id) => {
  const res = await window.orchestrator.status(id);
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  return {
    ok: true,
    orchStatus: res.data.orchestration.status,
    tasks: res.data.tasks.map(t => ({
      id: t.id, title: t.title, kind: t.kind, status: t.status,
      lastError: t.lastError, attempts: t.attempts,
      worktreePath: t.worktreePath, worktreeBranch: t.worktreeBranch,
    })),
  };
}, orchId);
console.log('\n=== 最终状态 ===');
console.log('编排状态:', statusRes.orchStatus);
if (statusRes.tasks) {
  statusRes.tasks.forEach(t => {
    console.log(`  任务 ${t.title} | kind=${t.kind} | status=${t.status} | attempts=${t.attempts} | err=${t.lastError || '-'} | wt=${t.worktreePath || '-'}`);
  });
}

// 查询任务详情（run 记录）
console.log('\n=== 任务详情（run 记录）===');
if (statusRes.tasks) {
  for (const t of statusRes.tasks) {
    const detail = await page.evaluate(async (taskId) => {
      const res = await window.orchestrator.taskDetail(taskId);
      if (!res.ok || !res.data) return null;
      return {
        runs: (res.data.runs || []).map(r => ({
          attempt: r.attempt, outcome: r.outcome, error: r.error,
          startedAt: r.startedAt, finishedAt: r.finishedAt,
        })),
      };
    }, t.id);
    if (detail && detail.runs && detail.runs.length > 0) {
      console.log(`任务 ${t.title} 的 runs:`);
      detail.runs.forEach(r => console.log(`  attempt=${r.attempt} outcome=${r.outcome} error=${r.error || '-'} started=${r.startedAt} finished=${r.finishedAt}`));
    } else {
      console.log(`任务 ${t.title}: 无 run 记录`);
    }
  }
}

// 检查 worktree 目录
console.log('\n=== worktree 目录检查 ===');
const worktreesDir = path.join(testProjectDir, '.foundry', 'worktrees');
try {
  const dirs = fs.readdirSync(worktreesDir);
  console.log('worktree 目录:', dirs);
} catch (e) {
  console.log('worktree 目录不存在或为空:', e.message);
}

// 检查 foundry/integration 分支
try {
  const branches = execSync('git branch -a', { cwd: testProjectDir, encoding: 'utf8' });
  console.log('\n分支列表:\n' + branches);
} catch (e) {
  console.log('git branch 失败:', e.message);
}

try { await app.close(); } catch {}
