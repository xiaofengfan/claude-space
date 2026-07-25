import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require('electron');
const app = await electron.launch({
  executablePath: typeof electronPath === 'string' ? electronPath : electronPath.default,
  args: [path.join(__dirname, 'dist-electron', 'main.js'), '--user-data-dir=' + path.join(process.env.TEMP || '/tmp', 'cs-test-cache-' + Date.now())],
  cwd: __dirname,
});

await app.firstWindow();
await new Promise(r => setTimeout(r, 4000));

let page = null;
const allWindows = app.windows();
for (const w of allWindows) {
  const url = await w.evaluate(() => location.href).catch(() => '');
  console.log('窗口 URL:', url);
  if (url.includes('localhost') || url.includes('index.html')) {
    page = w;
    break;
  }
}
if (!page) page = allWindows[allWindows.length - 1];

console.log('使用窗口:', await page.title());
await new Promise(r => setTimeout(r, 2000));

// 检查主窗口布局
const layoutInfo = await page.evaluate(() => {
  const body = document.body;
  const bodyRect = body.getBoundingClientRect();
  const root = document.getElementById('root');
  const rootRect = root?.getBoundingClientRect();

  // 主布局元素
  const appRoot = document.querySelector('.app-root, [class*="app-root"]');
  const sidebar = document.querySelector('.sidebar, [class*="sidebar"]');
  const nav = document.querySelector('nav, .nav, [class*="nav"]');
  const main = document.querySelector('main, .main, [class*="main-content"]');

  // 检查 dialog 是否意外显示
  const dialog = document.querySelector('.dialog-overlay');
  const unifiedDialog = document.querySelector('.unified-template-dialog');

  // 收集主要元素的尺寸
  const elements = {};
  const checkEls = ['.app-root', '.app-sidebar', '.sidebar', 'nav', '.project-nav', '.nav-bar', 'main', '.main-content', '#root > *'];
  for (const sel of checkEls) {
    const el = document.querySelector(sel);
    if (el) {
      const r = el.getBoundingClientRect();
      elements[sel] = { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    }
  }

  // 直接看 root 第一层子元素
  const rootChildren = [];
  if (root) {
    for (const child of root.children) {
      const r = child.getBoundingClientRect();
      rootChildren.push({
        tag: child.tagName,
        className: child.className?.toString?.()?.substring(0, 80) || '',
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
      });
    }
  }

  return {
    bodyW: Math.round(bodyRect.width),
    bodyH: Math.round(bodyRect.height),
    rootW: rootRect ? Math.round(rootRect.width) : null,
    rootH: rootRect ? Math.round(rootRect.height) : null,
    dialogOpen: !!dialog,
    unifiedDialogOpen: !!unifiedDialog,
    elements,
    rootChildren,
    // 取前 200 字符文本
    bodyText: body.innerText.substring(0, 300),
  };
});

console.log('主窗口布局:', JSON.stringify(layoutInfo, null, 2));

// 如果项目列表存在，选择第一个项目
if (!layoutInfo.unifiedDialogOpen) {
  const clicked = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="project-card"], .orch-project-item, [class*="project-item"]');
    if (cards.length > 0) { cards[0].click(); return true; }
    // 尝试点击包含项目名的元素
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.children.length === 0 && el.textContent && el.textContent.includes('claude-space')) {
        el.click(); return true;
      }
    }
    return false;
  });
  console.log('点击项目:', clicked);
  await new Promise(r => setTimeout(r, 2000));

  // 检查选中项目后的主窗口布局
  const afterSelect = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar, [class*="sidebar"]');
    const main = document.querySelector('main, .main-content');
    const nav = document.querySelector('.project-nav');
    return {
      sidebar: sidebar ? { w: Math.round(sidebar.getBoundingClientRect().width), h: Math.round(sidebar.getBoundingClientRect().height), x: Math.round(sidebar.getBoundingClientRect().x), y: Math.round(sidebar.getBoundingClientRect().y) } : null,
      main: main ? { w: Math.round(main.getBoundingClientRect().width), h: Math.round(main.getBoundingClientRect().height), x: Math.round(main.getBoundingClientRect().x), y: Math.round(main.getBoundingClientRect().y) } : null,
      nav: nav ? { w: Math.round(nav.getBoundingClientRect().width), h: Math.round(nav.getBoundingClientRect().height), x: Math.round(nav.getBoundingClientRect().x), y: Math.round(nav.getBoundingClientRect().y) } : null,
      dialogOpen: !!document.querySelector('.dialog-overlay'),
    };
  });
  console.log('选中项目后布局:', JSON.stringify(afterSelect, null, 2));

  // 打开模板弹窗
  const tplBtn = await page.$('button[title="工作流模板"]');
  if (tplBtn) {
    await tplBtn.click();
    await new Promise(r => setTimeout(r, 2000));
    const dialogLayout = await page.evaluate(() => {
      const d = document.querySelector('.unified-template-dialog');
      const r = d?.getBoundingClientRect();
      // 用精确选择器检查主窗口布局（避免匹配弹窗内的元素）
      const overlay = document.querySelector('.dialog-overlay');
      const appSidebar = overlay ? null : document.querySelector('.app-sidebar');
      // 从 .app 直接查第一层 sidebar/main
      const app = document.querySelector('.app');
      let mainSidebar = null, appMain = null;
      if (app) {
        for (const child of app.children) {
          const cls = child.className?.toString?.() || '';
          if (cls.includes('sidebar') && !cls.includes('orch-browser')) mainSidebar = child;
          if (child.tagName === 'MAIN' && !cls.includes('orch-browser')) appMain = child;
        }
      }
      return {
        dialog: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } : null,
        mainSidebar: mainSidebar ? { w: Math.round(mainSidebar.getBoundingClientRect().width), x: Math.round(mainSidebar.getBoundingClientRect().x), y: Math.round(mainSidebar.getBoundingClientRect().y) } : null,
        appMain: appMain ? { w: Math.round(appMain.getBoundingClientRect().width), x: Math.round(appMain.getBoundingClientRect().x), y: Math.round(appMain.getBoundingClientRect().y) } : null,
      };
    });
    console.log('弹窗打开时布局:', JSON.stringify(dialogLayout, null, 2));
    await page.screenshot({ path: 'test-dialog-open.png' });
    console.log('弹窗截图: test-dialog-open.png');
  }
}

await page.screenshot({ path: 'test-main-window.png' });
console.log('截图: test-main-window.png');

await app.close();
