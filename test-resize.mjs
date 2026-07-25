import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require('electron');
const app = await electron.launch({
  executablePath: typeof electronPath === 'string' ? electronPath : electronPath.default,
  args: [path.join(__dirname, 'dist-electron', 'main.js'), '--user-data-dir=' + path.join(process.env.TEMP || '/tmp', 'cs-resize-' + Date.now())],
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

let tplBtn = await page.$('button[title="工作流模板"]');
if (!tplBtn) {
  const btns = await page.$$('button');
  for (const b of btns) {
    const t = (await b.textContent())?.trim();
    if (t && t.includes('模板')) { tplBtn = b; break; }
  }
}
await tplBtn.click();
await new Promise(r => setTimeout(r, 2500));

// 点击第一个模板卡片
await page.evaluate(() => {
  const card = document.querySelector('.orch-browser-card');
  if (card) card.click();
});
await new Promise(r => setTimeout(r, 2500));

// 检查初始宽度（应该翻倍）
const initial = await page.evaluate(() => {
  const stages = document.querySelector('.tmpl-editor-col-stagelist');
  const graph = document.querySelector('.tmpl-editor-col-graph');
  const resizers = document.querySelectorAll('.tmpl-col-resizer');
  return {
    stagesW: stages ? Math.round(stages.getBoundingClientRect().width) : 0,
    graphW: graph ? Math.round(graph.getBoundingClientRect().width) : 0,
    resizerCount: resizers.length,
  };
});
console.log('初始宽度:', JSON.stringify(initial));

// 测试拖拽分隔条 1（左栏）
const resizer1 = await page.$('.tmpl-col-resizer');
if (resizer1) {
  const box = await resizer1.boundingBox();
  // 拖拽：向右移动 100px
  await page.mouse.move(box.x + box.width / 2, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + 50, { steps: 5 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
}
const afterDrag1 = await page.evaluate(() => {
  const stages = document.querySelector('.tmpl-editor-col-stagelist');
  return { stagesW: stages ? Math.round(stages.getBoundingClientRect().width) : 0 };
});
console.log('拖拽1后左栏宽度:', JSON.stringify(afterDrag1));

// 测试拖拽分隔条 2（右栏）
const resizers2 = await page.$$('.tmpl-col-resizer');
if (resizers2.length >= 2) {
  const box = await resizers2[1].boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + 50, { steps: 5 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
}
const afterDrag2 = await page.evaluate(() => {
  const graph = document.querySelector('.tmpl-editor-col-graph');
  return { graphW: graph ? Math.round(graph.getBoundingClientRect().width) : 0 };
});
console.log('拖拽2后右栏宽度:', JSON.stringify(afterDrag2));

console.log('---');
console.log('左栏初始宽度(应为~440):', initial.stagesW >= 400 ? '✓' : '✗', initial.stagesW);
console.log('右栏初始宽度(应为~600):', initial.graphW >= 560 ? '✓' : '✗', initial.graphW);
console.log('分隔条数量(应为2):', initial.resizerCount === 2 ? '✓' : '✗', initial.resizerCount);
console.log('左栏拖拽生效(变宽):', afterDrag1.stagesW > initial.stagesW ? '✓' : '✗', `${initial.stagesW} → ${afterDrag1.stagesW}`);
console.log('右栏拖拽生效(变窄):', afterDrag2.graphW < initial.graphW ? '✓' : '✗', `${initial.graphW} → ${afterDrag2.graphW}`);

await page.screenshot({ path: 'test-resize.png' });
console.log('截图: test-resize.png');

await app.close();
