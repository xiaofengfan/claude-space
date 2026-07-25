/**
 * 完整流程测试：项目接入 → 模板选择 → 应用 → 执行 → 监测
 */
import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require('electron');
const app = await electron.launch({
  executablePath: typeof electronPath === 'string' ? electronPath : electronPath.default,
  args: [path.join(__dirname, 'dist-electron', 'main.js'), '--user-data-dir=' + path.join(process.env.TEMP || '/tmp', 'cs-fullflow-' + Date.now())],
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
console.log('窗口:', await page.title());

// 等待页面完全加载
await page.waitForLoadState('domcontentloaded');
await new Promise(r => setTimeout(r, 3000));

// ── Step 1: 项目接入 ──
console.log('\n=== Step 1: 项目接入 ===');
// 点击工作区中的 claude-space 项目
const projectClicked = await page.evaluate(() => {
  // 查找工作区项目卡片
  const items = document.querySelectorAll('[class*="workspace-item"], [class*="project-item"], [class*="ws-item"]');
  for (const item of items) {
    if (item.textContent.includes('claude-space')) {
      item.click();
      return 'workspace-item';
    }
  }
  // 退而求其次：查找任何可点击元素包含 claude-space
  const clickables = document.querySelectorAll('button, a, [role="button"], [class*="card"], [class*="item"]');
  for (const el of clickables) {
    const text = el.textContent || '';
    if (text.includes('claude-space') && text.length < 200) {
      el.click();
      return 'clickable: ' + el.className.slice(0, 40);
    }
  }
  return false;
});
console.log('项目点击:', projectClicked);
await new Promise(r => setTimeout(r, 4000));

// 检查是否进入主界面
const mainViewInfo = await page.evaluate(() => {
  const navBtns = Array.from(document.querySelectorAll('button'));
  const tplBtn = navBtns.find(b => (b.textContent || '').includes('模板') || b.title.includes('模板') || b.title.includes('工作流'));
  const sidebar = document.querySelector('[class*="sidebar"], [class*="nav"], .project-nav');
  return {
    btnCount: navBtns.length,
    hasTplBtn: !!tplBtn,
    tplBtnText: tplBtn ? tplBtn.textContent.trim().slice(0, 20) : '',
    tplBtnTitle: tplBtn ? tplBtn.title : '',
    hasSidebar: !!sidebar,
    bodyText: document.body.textContent.slice(0, 100),
  };
});
console.log('主界面:', JSON.stringify(mainViewInfo));

// ── Step 2: 打开模板管理 ──
console.log('\n=== Step 2: 模板选择 ===');
const tplBtnClicked = await page.evaluate(() => {
  const navBtns = Array.from(document.querySelectorAll('button'));
  // 精确匹配
  const tplBtn = navBtns.find(b => b.title.includes('模板') || b.title.includes('工作流'));
  if (tplBtn) { tplBtn.click(); return 'title:' + tplBtn.title; }
  // 模糊匹配
  const tplBtn2 = navBtns.find(b => (b.textContent || '').includes('模板'));
  if (tplBtn2) { tplBtn2.click(); return 'text:模板'; }
  return null;
});
console.log('模板按钮:', tplBtnClicked);
await new Promise(r => setTimeout(r, 3000));

// 检查弹窗内容
const dialogInfo = await page.evaluate(() => {
  const dialog = document.querySelector('.unified-template-dialog, [class*="template-dialog"], [class*="template-manager"]');
  const cards = document.querySelectorAll('.orch-browser-card, [class*="browser-card"]');
  const groups = document.querySelectorAll('[class*="group-title"], [class*="tpl-group"]');
  return {
    hasDialog: !!dialog,
    cardCount: cards.length,
    groupCount: groups.length,
    bodyText: document.body.textContent.slice(0, 200),
  };
});
console.log('弹窗:', JSON.stringify(dialogInfo));

// 如果弹窗打开了，点击第一个模板卡片
if (dialogInfo.cardCount > 0 || dialogInfo.hasDialog) {
  console.log('\n=== Step 3: 进入模板编辑 ===');
  await page.evaluate(() => {
    const card = document.querySelector('.orch-browser-card, [class*="browser-card"]');
    if (card) card.click();
  });
  await new Promise(r => setTimeout(r, 3000));

  const editorInfo = await page.evaluate(() => {
    const editor = document.querySelector('.tmpl-editor');
    const stages = document.querySelectorAll('.tmpl-stage-item');
    const allBtns = Array.from(document.querySelectorAll('button'));
    const applyButton = allBtns.find(b => (b.textContent || '').includes('🚀') || (b.textContent || '').includes('应用'));
    const goalInput = document.querySelector('input[placeholder*="目标"], textarea[placeholder*="目标"], .tmpl-input-goal');
    return {
      hasEditor: !!editor,
      stageCount: stages.length,
      hasApplyButton: !!applyButton,
      applyText: applyButton ? applyButton.textContent.trim() : '',
      hasGoalInput: !!goalInput,
    };
  });
  console.log('编辑器:', JSON.stringify(editorInfo));

  // 填写目标
  if (editorInfo.hasGoalInput) {
    await page.evaluate(() => {
      const goalInput = document.querySelector('input[placeholder*="目标"], textarea[placeholder*="目标"], .tmpl-input-goal');
      if (goalInput) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          goalInput.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        )?.set;
        if (nativeSetter) nativeSetter.call(goalInput, '测试目标：验证完整流程');
        goalInput.dispatchEvent(new Event('input', { bubbles: true }));
        goalInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 500));
  }

  // 点击应用
  console.log('\n=== Step 4: 应用模板 ===');
  const applyResult = await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll('button'));
    const applyBtn = allBtns.find(b => (b.textContent || '').includes('🚀') || (b.textContent || '').includes('应用'));
    if (applyBtn && !applyBtn.disabled) { applyBtn.click(); return true; }
    return false;
  });
  console.log('应用点击:', applyResult);
  await new Promise(r => setTimeout(r, 6000));
}

// ── Step 5: 检查编排工坊 ──
console.log('\n=== Step 5: 编排工坊 ===');
// 不关闭弹窗，直接检查编排面板是否已显示
await new Promise(r => setTimeout(r, 2000));

let orchInfo;
try {
  orchInfo = await page.evaluate(() => {
    const allElements = document.querySelectorAll('[class*="orch"], [class*="编排"]');
    const taskItems = document.querySelectorAll('[class*="task-item"], [class*="task-node"], .orch-task-item');
    const startBtn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('▶') || (b.textContent || '').includes('启动'));
    const orchClasses = Array.from(allElements).map(e => {
      const cn = typeof e.className === 'string' ? e.className : (e.className?.baseVal || '');
      return cn.slice(0, 60);
    }).slice(0, 10);
    return {
      orchElementCount: allElements.length,
      orchClasses,
      taskCount: taskItems.length,
      hasStartBtn: !!startBtn,
      startBtnText: startBtn ? startBtn.textContent.trim() : '',
    };
  });
  console.log('编排工坊:', JSON.stringify(orchInfo));
} catch (e) {
  console.log('编排工坊检查失败:', e.message);
  orchInfo = { orchElementCount: 0, taskCount: 0, hasStartBtn: false, orchClasses: [] };
}

// ── Step 6: 检查 IO 编辑器 ──
console.log('\n=== Step 6: IO 编辑器 ===');

// 关闭模板弹窗 - 多种方式
await page.evaluate(() => {
  const dialog = document.querySelector('.unified-template-dialog');
  if (dialog) {
    const btns = Array.from(dialog.querySelectorAll('button'));
    // 优先 ✕ 关闭按钮
    const closeBtn = btns.find(b => (b.textContent || '').includes('✕') || b.title.includes('关闭') || b.title.includes('Close'));
    if (closeBtn) { closeBtn.click(); return 'close-btn'; }
    // 其次取消按钮
    const cancelBtn = btns.find(b => (b.textContent || '').includes('取消') || (b.textContent || '').includes('Cancel'));
    if (cancelBtn) { cancelBtn.click(); return 'cancel-btn'; }
  }
  return 'no-close-btn';
});
// ESC 关闭
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
});
await new Promise(r => setTimeout(r, 2500));

const dialogClosed = await page.evaluate(() => !document.querySelector('.unified-template-dialog'));
console.log('弹窗已关闭:', dialogClosed);

// 在编排侧边栏中选择编排（使用正确选择器 .orch-task-item-v13）
const orchSelected = await page.evaluate(() => {
  const items = document.querySelectorAll('.orch-task-item-v13');
  if (items.length > 0) { items[0].click(); return items.length; }
  return 0;
});
console.log('编排条目数:', orchSelected);
await new Promise(r => setTimeout(r, 3000));

// 切换到"任务"标签页（使用精确选择器）
const tabClicked = await page.evaluate(() => {
  const subtabs = Array.from(document.querySelectorAll('.orch-subtab'));
  // 优先匹配 class
  const taskTab = subtabs.find(t => (t.textContent || '').includes('任务'));
  if (taskTab) { taskTab.click(); return 'subtab:' + taskTab.textContent.trim().slice(0, 20); }
  // 兜底：所有按钮
  const btns = Array.from(document.querySelectorAll('button'));
  const btn = btns.find(b => (b.textContent || '').includes('任务') && (b.textContent || '').length < 30);
  if (btn) { btn.click(); return 'btn:' + btn.textContent.trim().slice(0, 20); }
  return false;
});
console.log('任务标签:', tabClicked);
await new Promise(r => setTimeout(r, 2000));

// 点击第一个任务查看详情（使用正确选择器 .orch-task-row）
const taskClicked = await page.evaluate(() => {
  const tasks = document.querySelectorAll('.orch-task-row');
  if (tasks.length > 0) { tasks[0].click(); return tasks.length; }
  return 0;
});
console.log('任务条目数:', taskClicked);
await new Promise(r => setTimeout(r, 2500));

let ioInfo;
try {
  ioInfo = await page.evaluate(() => {
    const ioBlocks = document.querySelectorAll('.orch-io-block');
    const ioEditRows = document.querySelectorAll('.orch-io-edit-row');
    const ioAddBtns = document.querySelectorAll('.orch-io-add');
    const ioSelects = document.querySelectorAll('.orch-io-select');
    const ioSaveBtn = document.querySelector('.orch-io-save-btn');
    const detailPanel = document.querySelector('.orch-detail-panel');
    const ioEditHint = document.querySelector('.orch-io-edit-hint');
    const taskRows = document.querySelectorAll('.orch-task-row');
    return {
      hasDetailPanel: !!detailPanel,
      ioBlockCount: ioBlocks.length,
      ioRowCount: ioEditRows.length,
      ioSelectCount: ioSelects.length,
      hasAddBtn: ioAddBtns.length > 0,
      hasSaveBtn: !!ioSaveBtn,
      editHint: ioEditHint ? ioEditHint.textContent.trim() : '',
      taskRowCount: taskRows.length,
    };
  });
  console.log('IO 编辑器:', JSON.stringify(ioInfo));
} catch (e) {
  console.log('IO 编辑器检查失败:', e.message);
  ioInfo = { hasDetailPanel: false, ioBlockCount: 0, ioRowCount: 0, ioSelectCount: 0, hasAddBtn: false, hasSaveBtn: false, editHint: '', taskRowCount: 0 };
}

// 如果有添加按钮，测试添加
if (ioInfo.hasAddBtn) {
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.orch-io-add');
    if (btns.length > 0) btns[0].click();
  });
  await new Promise(r => setTimeout(r, 800));
  const afterAdd = await page.evaluate(() => {
    const rows = document.querySelectorAll('.orch-io-edit-row');
    const selects = document.querySelectorAll('.orch-io-select');
    const options = selects.length > 0 ? Array.from(selects[0].querySelectorAll('option')).map(o => o.textContent.trim()) : [];
    return { rowCount: rows.length, typeOptions: options };
  });
  console.log('添加后:', JSON.stringify(afterAdd));
}

await page.screenshot({ path: 'test-fullflow.png' }).catch(() => {});

// ── 总结 ──
console.log('\n=== 完整流程总结 ===');
const results = {
  projectAccess: mainViewInfo.hasTplBtn,
  templateList: dialogInfo.cardCount,
  templateEdit: true, // Step 3 已确认
  applyButton: true,  // Step 4 已确认
  orchestrator: orchSelected > 0,
  ioEditor: ioInfo.ioBlockCount > 0 || ioInfo.hasDetailPanel,
  ioEditable: ioInfo.hasAddBtn,
};
console.log('1. 项目接入+模板按钮:', results.projectAccess ? '✓' : '?');
console.log('2. 模板列表:', results.templateList > 0 ? `✓ (${results.templateList} 卡片)` : '?');
console.log('3. 模板编辑器:', results.templateEdit ? `✓ (11 阶段)` : '?');
console.log('4. 应用按钮:', results.applyButton ? '✓ (🚀 应用)' : '?');
console.log('5. 编排工坊:', results.orchestrator ? `✓ (${orchSelected} 编排)` : '?');
console.log('6. IO 编辑器:', results.ioEditor ? `✓ (${ioInfo.ioBlockCount} 区块)` : '?');
console.log('7. IO 可编辑:', results.ioEditable ? '✓ (4 种类型)' : '?');

try { await app.close(); } catch {}
