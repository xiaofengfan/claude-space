import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require('electron');
const app = await electron.launch({
  executablePath: typeof electronPath === 'string' ? electronPath : electronPath.default,
  args: [path.join(__dirname, 'dist-electron', 'main.js'), '--user-data-dir=' + path.join(process.env.TEMP || '/tmp', 'cs-layout-' + Date.now())],
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

// 选择项目 - 先等列表加载
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

// 检查窗口尺寸
const winSize = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
console.log('窗口尺寸:', JSON.stringify(winSize));

// 打开模板弹窗
let tplBtn = await page.$('button[title="工作流模板"]');
console.log('模板按钮(title):', !!tplBtn);
if (!tplBtn) {
  // 列出所有按钮找模板按钮
  const btns = await page.$$('button');
  for (const b of btns) {
    const t = (await b.textContent())?.trim();
    if (t && t.includes('模板')) {
      console.log('找到模板按钮(文本):', t);
      tplBtn = b;
      break;
    }
  }
}
if (!tplBtn) { console.log('未找到模板按钮'); await app.close(); process.exit(1); }
await tplBtn.click();
await new Promise(r => setTimeout(r, 3000));

// 验证三栏布局
const layout = await page.evaluate(() => {
  const dialog = document.querySelector('.unified-template-dialog');
  const dRect = dialog?.getBoundingClientRect();
  const computed = dialog ? window.getComputedStyle(dialog) : null;

  // 三栏：模板列表 + 阶段管理 + 流程图详情
  const sidebar = document.querySelector('.orch-browser-sidebar');
  const editor = document.querySelector('.tmpl-editor');
  const split = document.querySelector('.tmpl-editor-split');
  const colStages = document.querySelector('.tmpl-editor-col-stages');
  const colDetail = document.querySelector('.tmpl-editor-col-detail');

  const r = (el) => {
    if (!el) return null;
    const x = el.getBoundingClientRect();
    return { w: Math.round(x.width), h: Math.round(x.height), x: Math.round(x.x), y: Math.round(x.y) };
  };

  // 检查是否有内容重叠：阶段管理底部 vs 流程图
  const stagesSection = document.querySelector('.tmpl-editor-col-stages .tmpl-editor-section');
  const flowSection = document.querySelector('.tmpl-editor-col-detail .tmpl-editor-section');
  const stagesRect = stagesSection?.getBoundingClientRect();
  const flowRect = flowSection?.getBoundingClientRect();

  // 流程图是否完整可见（在弹窗内）
  const flowGraph = document.querySelector('.tmpl-editor-col-detail .wf-flow-graph, .tmpl-editor-col-detail [class*="flow"]');
  const flowGraphRect = flowGraph?.getBoundingClientRect();

  // 边框/背景检查
  const borderVisible = computed ? computed.borderTopColor : null;

  return {
    dialog: r(dialog),
    dialogBg: computed?.backgroundColor,
    dialogBorder: computed?.border,
    sidebar: r(sidebar),
    editor: r(editor),
    split: r(split),
    colStages: r(colStages),
    colDetail: r(colDetail),
    stagesSection: stagesRect ? { w: Math.round(stagesRect.width), h: Math.round(stagesRect.height), bottom: Math.round(stagesRect.bottom) } : null,
    flowSection: flowRect ? { w: Math.round(flowRect.width), h: Math.round(flowRect.height), bottom: Math.round(flowRect.bottom), top: Math.round(flowRect.top) } : null,
    flowGraph: flowGraphRect ? { w: Math.round(flowGraphRect.width), h: Math.round(flowGraphRect.height), bottom: Math.round(flowGraphRect.bottom) } : null,
    dialogBottom: dRect ? Math.round(dRect.bottom) : null,
    // 三栏水平排列检查
    isHorizontal: split ? window.getComputedStyle(split).flexDirection === 'row' : false,
  };
});

console.log('布局信息:', JSON.stringify(layout, null, 2));

// 关键判断
const ok = layout.colStages && layout.colDetail &&
  layout.colStages.x < layout.colDetail.x && // 阶段在左，详情在右
  layout.isHorizontal &&
  layout.flowSection && layout.flowSection.bottom <= (layout.dialogBottom + 5); // 流程图不超出弹窗

console.log('三栏水平排列:', layout.isHorizontal);
console.log('阶段管理在详情左侧:', layout.colStages && layout.colDetail ? layout.colStages.x < layout.colDetail.x : false);
console.log('流程图底部未超出弹窗:', layout.flowSection ? layout.flowSection.bottom <= (layout.dialogBottom + 5) : false);
console.log('整体结果:', ok ? '✓ 通过' : '✗ 需修复');

await page.screenshot({ path: 'test-3col-layout.png' });
console.log('截图: test-3col-layout.png');

await app.close();
