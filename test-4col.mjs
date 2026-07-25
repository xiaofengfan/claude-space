import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require('electron');
const app = await electron.launch({
  executablePath: typeof electronPath === 'string' ? electronPath : electronPath.default,
  args: [path.join(__dirname, 'dist-electron', 'main.js'), '--user-data-dir=' + path.join(process.env.TEMP || '/tmp', 'cs-4col-' + Date.now())],
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

// 选择项目
await new Promise(r => setTimeout(r, 1500));
const clicked = await page.evaluate(() => {
  const els = document.querySelectorAll('*');
  for (const el of els) {
    if (el.children.length === 0 && el.textContent && el.textContent.includes('claude-space')) {
      el.click(); return true;
    }
  }
  return false;
});
console.log('点击项目:', clicked);
await new Promise(r => setTimeout(r, 2500));

// 打开模板弹窗
let tplBtn = await page.$('button[title="工作流模板"]');
console.log('模板按钮(title):', !!tplBtn);
if (!tplBtn) {
  const btns = await page.$$('button');
  for (const b of btns) {
    const t = (await b.textContent())?.trim();
    if (t && t.includes('模板')) { tplBtn = b; break; }
  }
}
if (!tplBtn) { console.log('未找到模板按钮'); await app.close(); process.exit(1); }
await tplBtn.click();
await new Promise(r => setTimeout(r, 3000));

// 验证列表视图
const listView = await page.evaluate(() => {
  const listView = document.querySelector('.orch-tpl-list-view');
  const cards = document.querySelectorAll('.orch-browser-card');
  const inuseTags = document.querySelectorAll('.orch-browser-card-tag.inuse');
  return {
    hasListView: !!listView,
    cardCount: cards.length,
    inuseCount: inuseTags.length,
  };
});
console.log('列表视图:', JSON.stringify(listView));

// 点击第一个模板卡片进入编辑
await page.evaluate(() => {
  const card = document.querySelector('.orch-browser-card');
  if (card) card.click();
});
await new Promise(r => setTimeout(r, 2500));

// 验证四区布局
const layout = await page.evaluate(() => {
  const topbar = document.querySelector('.tmpl-editor-topbar');
  const backBtn = document.querySelector('.tmpl-back-btn');
  const basicInline = document.querySelector('.tmpl-basic-inline');
  const applyInline = document.querySelector('.tmpl-apply-inline');
  const split = document.querySelector('.tmpl-editor-split');
  const colStages = document.querySelector('.tmpl-editor-col-stagelist');
  const colTaskDetail = document.querySelector('.tmpl-editor-col-taskdetail');
  const colGraph = document.querySelector('.tmpl-editor-col-graph');
  const stageItems = document.querySelectorAll('.tmpl-stage-item');
  const activeStage = document.querySelector('.tmpl-stage-item.active');
  const taskDetail = document.querySelector('.tmpl-task-detail');
  const promptTextarea = document.querySelector('.tmpl-task-detail textarea.tmpl-input-mono');
  const kvEditor = document.querySelector('.tmpl-kv-list');

  const r = (el) => {
    if (!el) return null;
    const x = el.getBoundingClientRect();
    return { w: Math.round(x.width), h: Math.round(x.height), x: Math.round(x.x), y: Math.round(x.y) };
  };

  const stageR = r(colStages);
  const detailR = r(colTaskDetail);
  const graphR = r(colGraph);

  return {
    hasTopbar: !!topbar,
    hasBackBtn: !!backBtn,
    hasBasicInline: !!basicInline,
    hasApplyInline: !!applyInline,
    hasSplit: !!split,
    isHorizontal: split ? window.getComputedStyle(split).flexDirection === 'row' : false,
    colStages: stageR,
    colTaskDetail: detailR,
    colGraph: graphR,
    stageItemCount: stageItems.length,
    hasActiveStage: !!activeStage,
    hasTaskDetail: !!taskDetail,
    hasPromptTextarea: !!promptTextarea,
    hasKvEditor: !!kvEditor,
    // 顺序：阶段在左，详情在中，流程图在右
    correctOrder: stageR && detailR && graphR ? (stageR.x < detailR.x && detailR.x < graphR.x) : false,
  };
});

console.log('四区布局:', JSON.stringify(layout, null, 2));

console.log('---');
console.log('列表视图:', listView.hasListView ? '✓' : '✗');
console.log('卡片数:', listView.cardCount);
console.log('应用中标记:', listView.inuseCount);
console.log('顶部工具栏:', layout.hasTopbar ? '✓' : '✗');
console.log('返回按钮:', layout.hasBackBtn ? '✓' : '✗');
console.log('基本信息行内:', layout.hasBasicInline ? '✓' : '✗');
console.log('应用操作行内:', layout.hasApplyInline ? '✓' : '✗');
console.log('三栏水平:', layout.isHorizontal ? '✓' : '✗');
console.log('顺序正确(阶段<详情<流程图):', layout.correctOrder ? '✓' : '✗');
console.log('阶段项数:', layout.stageItemCount);
console.log('选中阶段:', layout.hasActiveStage ? '✓' : '✗');
console.log('阶段详情面板:', layout.hasTaskDetail ? '✓' : '✗');
console.log('提示词编辑器:', layout.hasPromptTextarea ? '✓' : '✗');
console.log('输入参数编辑器:', layout.hasKvEditor ? '✓' : '✗');

await page.screenshot({ path: 'test-4col-layout.png' });
console.log('截图: test-4col-layout.png');

await app.close();
