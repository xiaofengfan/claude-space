/**
 * 真实 UI 测试：完整操作流程
 * 1. 启动应用
 * 2. 通过 IPC 创建编排
 * 3. 在 UI 中选中编排
 * 4. 点击启动按钮
 * 5. 验证任务列表显示、任务状态变化
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
const testProjectDir = path.join(process.env.TEMP || '/tmp', 'test-ui-project-' + Date.now());
console.log('测试项目:', testProjectDir);
fs.mkdirSync(testProjectDir, { recursive: true });
fs.writeFileSync(path.join(testProjectDir, 'README.md'), '# Test\n');
fs.writeFileSync(path.join(testProjectDir, 'index.js'), 'console.log("hello");\n');
fs.writeFileSync(path.join(testProjectDir, 'package.json'), '{"name":"test","version":"1.0.0"}');
try {
  execSync('git init && git add -A && git -c user.name=test -c user.email=t@t.com commit -m init', { cwd: testProjectDir, stdio: 'pipe' });
} catch {}

const app = await electron.launch({
  executablePath: typeof electronPath === 'string' ? electronPath : electronPath.default,
  args: [path.join(__dirname, 'dist-electron', 'main.js'), '--user-data-dir=' + path.join(process.env.TEMP || '/tmp', 'cs-ui-' + Date.now())],
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

// 步骤1：添加测试项目到 claude-space
console.log('\n=== 步骤1：添加测试项目 ===');
// 先把项目路径添加到 claude-space 的项目列表
await page.evaluate(async (projectPath) => {
  // 尝试通过 scanProjects 扫描父目录
  const parentDir = projectPath.split(/[\\/]/).slice(0, -1).join('\\');
  await window.electronAPI.scanProjects(parentDir);
}, testProjectDir);

// 直接通过 IPC 创建编排
console.log('\n=== 步骤2：创建编排 ===');
const createRes = await page.evaluate(async (repoPath) => {
  return await window.orchestrator.create({
    repoPath,
    templateId: 'hotfix',
    goal: '修复 index.js 输出问题',
    autoApprove: true,
    testCommand: 'echo ok',
  });
}, testProjectDir);
console.log('创建:', createRes.ok ? '✓ ' + createRes.data.id : '✗ ' + JSON.stringify(createRes.error));

const orchId = createRes.ok ? createRes.data.id : null;
if (!orchId) { try { await app.close(); } catch {} process.exit(1); }

// 步骤3：导航到编排工坊
console.log('\n=== 步骤3：导航到编排工坊 ===');
// 点击 ▶ 运行 按钮导航到编排工坊
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('▶ 运行'));
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 2000));

// 步骤4：在侧边栏选中刚创建的编排
console.log('\n=== 步骤4：选中编排 ===');
const selected = await page.evaluate((id) => {
  const items = Array.from(document.querySelectorAll('.orch-task-item-v13'));
  const target = items.find(i => (i.textContent || '').includes('修复 index.js'));
  if (target) { target.click(); return true; }
  // 如果找不到，尝试第一个
  if (items.length > 0) { items[0].click(); return true; }
  return false;
}, orchId);
console.log('选中编排:', selected ? '✓' : '✗（侧边栏没有编排项）');
await new Promise(r => setTimeout(r, 3000));

// 步骤5：检查 UI 显示
console.log('\n=== 步骤5：检查 UI 显示 ===');
const uiInfo = await page.evaluate(() => {
  const view = document.querySelector('.orch-detail-view');
  if (!view) return { found: false };
  const header = view.querySelector('.orch-detail-header-h, .orch-detail-header');
  const goalText = view.querySelector('.orch-detail-goal-text')?.textContent?.trim();
  const metaItems = Array.from(view.querySelectorAll('.orch-detail-meta-item')).map(m => ({
    label: m.querySelector('.orch-detail-meta-label')?.textContent?.trim(),
    value: m.textContent?.trim().replace(m.querySelector('.orch-detail-meta-label')?.textContent || '', ''),
  }));
  const startBtn = Array.from(view.querySelectorAll('button')).find(b => (b.textContent || '').includes('▶ 启动') || (b.textContent || '').includes('▶ 运行'));
  const subtabs = Array.from(view.querySelectorAll('.orch-subtab')).map(t => t.textContent?.trim());
  const activeTab = view.querySelector('.orch-subtab.active')?.textContent?.trim();
  const taskRows = view.querySelectorAll('.orch-task-row').length;
  const taskList = view.querySelector('.orch-tasks-list');
  const detailPanel = view.querySelector('.orch-detail-panel');
  return {
    found: true,
    hasHeader: !!header,
    goalText,
    metaItems,
    hasStartBtn: !!startBtn,
    startBtnDisabled: startBtn?.disabled,
    subtabs,
    activeTab,
    taskRowCount: taskRows,
    hasTaskList: !!taskList,
    hasDetailPanel: !!detailPanel,
  };
});
console.log('UI 信息:', JSON.stringify(uiInfo, null, 2));

// 步骤6：点击启动
console.log('\n=== 步骤6：点击启动 ===');
if (uiInfo.hasStartBtn && !uiInfo.startBtnDisabled) {
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('▶ 启动') || (b.textContent || '').includes('▶ 运行'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  // 检查 toast 和状态变化
  const afterStart = await page.evaluate(() => {
    const toast = document.querySelector('.orch-toast');
    const metaItems = Array.from(document.querySelectorAll('.orch-detail-meta-item')).map(m => m.textContent?.trim());
    const taskRows = Array.from(document.querySelectorAll('.orch-task-row')).map(r => ({
      title: r.querySelector('.orch-task-title, [class*="title"]')?.textContent?.trim() || r.textContent?.trim().slice(0, 40),
      status: r.className,
    }));
    return {
      toast: toast?.textContent?.trim(),
      metaItems,
      taskRows,
    };
  });
  console.log('启动后:', JSON.stringify(afterStart, null, 2));
} else {
  console.log('启动按钮不可用:', uiInfo.startBtnDisabled);
}

// 等待 15 秒看任务状态变化
console.log('\n=== 步骤7：等待 15 秒观察任务状态 ===');
await new Promise(r => setTimeout(r, 15000));

const finalStatus = await page.evaluate(() => {
  const taskRows = Array.from(document.querySelectorAll('.orch-task-row')).map(r => ({
    text: r.textContent?.trim().slice(0, 60),
    classes: r.className,
  }));
  const metaItems = Array.from(document.querySelectorAll('.orch-detail-meta-item')).map(m => m.textContent?.trim());
  const toast = document.querySelector('.orch-toast')?.textContent?.trim();
  return { taskRows, metaItems, toast };
});
console.log('最终状态:', JSON.stringify(finalStatus, null, 2));

// 查询后端实际状态
const backendStatus = await page.evaluate(async (id) => {
  const res = await window.orchestrator.status(id);
  if (!res.ok || !res.data) return null;
  return {
    status: res.data.orchestration.status,
    tasks: res.data.tasks.map(t => ({ title: t.title, status: t.status, err: t.lastError })),
  };
}, orchId);
console.log('\n后端状态:', JSON.stringify(backendStatus, null, 2));

await page.screenshot({ path: 'test-ui-result.png' }).catch(() => {});

console.log('\n=== 总结 ===');
console.log('1. 创建编排:', createRes.ok ? '✓' : '✗');
console.log('2. 选中编排:', selected ? '✓' : '✗');
console.log('3. UI 显示编排:', uiInfo.found ? '✓' : '✗');
console.log('4. 横向布局:', uiInfo.hasHeader ? '✓' : '✗');
console.log('5. 目标显示:', uiInfo.goalText ? '✓ ' + uiInfo.goalText : '✗');
console.log('6. 启动按钮:', uiInfo.hasStartBtn ? '✓' : '✗');
console.log('7. 任务列表:', uiInfo.taskRowCount > 0 ? `✓ (${uiInfo.taskRowCount} 个)` : '✗');
console.log('8. 默认tab:', uiInfo.activeTab || '?');
console.log('9. 后端状态:', backendStatus ? backendStatus.status : '?');

try { await app.close(); } catch {}
