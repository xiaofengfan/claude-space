import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require('electron');
const app = await electron.launch({
  executablePath: typeof electronPath === 'string' ? electronPath : electronPath.default,
  args: [path.join(__dirname, 'dist-electron', 'main.js'), '--user-data-dir=' + path.join(process.env.TEMP || '/tmp', 'cs-feat-' + Date.now())],
  cwd: __dirname,
});

await app.firstWindow();
await new Promise(r => setTimeout(r, 4000));

let page = null;
for (const w of app.windows()) {
  const url = await w.evaluate(() => location.href).catch(() => '');
  if (url.includes('localhost') || url.includes('index.html')) { page = w; break; }
}
if (!page) page = app.windows()[app.windows().length - 1];
console.log('窗口:', await page.title());
await new Promise(r => setTimeout(r, 2000));

// 选择项目 + 打开弹窗
await new Promise(r => setTimeout(r, 1500));
await page.evaluate(() => {
  const els = document.querySelectorAll('*');
  for (const el of els) {
    if (el.children.length === 0 && el.textContent && el.textContent.includes('claude-space')) {
      el.click(); return;
    }
  }
});
await new Promise(r => setTimeout(r, 2500));

// 点击模板按钮（用 evaluate 绕过遮挡检测）
await page.evaluate(() => {
  const btn = document.querySelector('button[title="工作流模板"]') || (() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find(b => (b.textContent || '').includes('模板'));
  })();
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 2500));

// 点击第一个模板卡片进入编辑
await page.evaluate(() => {
  const card = document.querySelector('.orch-browser-card');
  if (card) card.click();
});
await new Promise(r => setTimeout(r, 2500));

// 1. 验证输入/输出编辑器
const ioInfo = await page.evaluate(() => {
  const ioLists = document.querySelectorAll('.tmpl-io-list');
  const ioRows = document.querySelectorAll('.tmpl-io-row');
  const ioTypeSelects = document.querySelectorAll('.tmpl-input-io-type');
  // 取第一个 io-type 的选项
  let typeOptions = [];
  if (ioTypeSelects.length > 0) {
    typeOptions = Array.from(ioTypeSelects[0].querySelectorAll('option')).map(o => o.textContent.trim());
  }
  return {
    ioListCount: ioLists.length,
    ioRowCount: ioRows.length,
    typeOptions,
  };
});
console.log('输入/输出编辑器:', JSON.stringify(ioInfo));

// 1b. 点击第一个 IO 列表的"添加"按钮，验证类型选项出现
await page.evaluate(() => {
  const addBtns = document.querySelectorAll('.tmpl-io-list .tmpl-btn-sm');
  if (addBtns.length > 0) addBtns[0].click();
});
await new Promise(r => setTimeout(r, 500));
const ioAfterAdd = await page.evaluate(() => {
  const ioRows = document.querySelectorAll('.tmpl-io-row');
  const ioTypeSelects = document.querySelectorAll('.tmpl-input-io-type');
  let typeOptions = [];
  if (ioTypeSelects.length > 0) {
    typeOptions = Array.from(ioTypeSelects[0].querySelectorAll('option')).map(o => o.textContent.trim());
  }
  return { ioRowCount: ioRows.length, typeOptions };
});
console.log('添加IO项后:', JSON.stringify(ioAfterAdd));

// 2. 验证流程图布局（多行）
const graphInfo = await page.evaluate(() => {
  const svg = document.querySelector('.orch-wf-graph');
  const nodes = document.querySelectorAll('.orch-wf-graph g[transform]');
  const viewBox = svg ? svg.getAttribute('viewBox') : '';
  return {
    nodeCount: nodes.length,
    viewBox,
  };
});
console.log('流程图:', JSON.stringify(graphInfo));

// 3. 验证当前阶段内容面板
const stagePanelInfo = await page.evaluate(() => {
  const panel = document.querySelector('.tmpl-current-stage');
  const title = document.querySelector('.tmpl-current-stage-title');
  const steps = document.querySelectorAll('.tmpl-current-stage-steps li');
  return {
    exists: !!panel,
    title: title ? title.textContent.trim() : '',
    stepCount: steps.length,
  };
});
console.log('当前阶段面板:', JSON.stringify(stagePanelInfo));

// 4. 点击流程图节点验证联动
const beforeClick = await page.evaluate(() => {
  const t = document.querySelector('.tmpl-current-stage-title');
  return t ? t.textContent.trim() : '';
});
await page.evaluate(() => {
  // 点击最后一个节点
  const nodes = document.querySelectorAll('.orch-wf-graph g[transform]');
  if (nodes.length > 1) nodes[nodes.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 800));
const afterClick = await page.evaluate(() => {
  const t = document.querySelector('.tmpl-current-stage-title');
  return t ? t.textContent.trim() : '';
});
console.log('点击节点联动:', beforeClick !== afterClick ? '✓ 变化' : '· 无变化', `"${beforeClick}" → "${afterClick}"`);

// 5. 验证测试按钮
const testBtnInfo = await page.evaluate(() => {
  const btns = document.querySelectorAll('.tmpl-btn-test');
  return Array.from(btns).map(b => b.textContent.trim());
});
console.log('测试按钮:', JSON.stringify(testBtnInfo));

// 6. 点击单元测试按钮
await page.evaluate(() => {
  const btns = document.querySelectorAll('.tmpl-btn-test');
  for (const b of btns) {
    if (b.textContent.includes('单元测试')) { b.click(); return; }
  }
});
await new Promise(r => setTimeout(r, 800));
const unitResult = await page.evaluate(() => {
  const r = document.querySelector('.tmpl-test-result');
  if (!r) return { exists: false };
  const lines = document.querySelectorAll('.tmpl-test-result-line');
  const isOk = r.classList.contains('ok');
  return {
    exists: true,
    ok: isOk,
    lineCount: lines.length,
    firstLine: lines[0] ? lines[0].textContent.trim() : '',
  };
});
console.log('单元测试结果:', JSON.stringify(unitResult));
await new Promise(r => setTimeout(r, 500));

// 7. 点击模拟测试按钮
await page.evaluate(() => {
  const btns = document.querySelectorAll('.tmpl-btn-test');
  for (const b of btns) {
    if (b.textContent.includes('模拟测试')) { b.click(); return; }
  }
});
await new Promise(r => setTimeout(r, 800));
const simResult = await page.evaluate(() => {
  const r = document.querySelector('.tmpl-test-result');
  if (!r) return { exists: false };
  const lines = document.querySelectorAll('.tmpl-test-result-line');
  const isOk = r.classList.contains('ok');
  return {
    exists: true,
    ok: isOk,
    lineCount: lines.length,
    firstLine: lines[0] ? lines[0].textContent.trim() : '',
  };
});
console.log('模拟测试结果:', JSON.stringify(simResult));

await page.screenshot({ path: 'test-features.png' });
console.log('截图: test-features.png');

console.log('---');
console.log('输入/输出编辑器存在:', ioInfo.ioListCount >= 2 ? '✓' : '✗', `(列表数 ${ioInfo.ioListCount})`);
console.log('IO 类型选项(文件/目录/文档/变量):', ioAfterAdd.typeOptions.length === 4 ? '✓' : '✗', ioAfterAdd.typeOptions);
console.log('流程图节点存在:', graphInfo.nodeCount > 0 ? '✓' : '✗', `(节点数 ${graphInfo.nodeCount})`);
console.log('当前阶段面板存在:', stagePanelInfo.exists ? '✓' : '✗');
console.log('当前阶段步骤数:', stagePanelInfo.stepCount);
console.log('测试按钮(单元+模拟):', testBtnInfo.length === 2 ? '✓' : '✗', testBtnInfo);
console.log('单元测试执行:', unitResult.exists ? '✓' : '✗');
console.log('模拟测试执行:', simResult.exists ? '✓' : '✗');

await app.close();
