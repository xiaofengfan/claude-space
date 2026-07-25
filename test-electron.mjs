import { _electron as electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const electronPath = require('electron');
const app = await electron.launch({
  executablePath: typeof electronPath === 'string' ? electronPath : electronPath.default,
  args: [path.join(__dirname, 'dist-electron', 'main.js')],
  cwd: __dirname,
});

// 等待主窗口
const windows = [];
app.on('window', (w) => windows.push(w));

await app.firstWindow();
await new Promise(r => setTimeout(r, 3000));

// 找到主窗口（加载 localhost 或 file 的那个）
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

if (!page) {
  // 取最后一个
  page = allWindows[allWindows.length - 1];
}

if (!page) {
  console.log('没有找到主窗口');
  await app.close();
  process.exit(1);
}

console.log('使用窗口:', await page.title());
await new Promise(r => setTimeout(r, 3000));

// 检查是否需要选择项目
const projItem = await page.evaluate(() => {
  const els = document.querySelectorAll('*');
  for (const el of els) {
    if (el.children.length === 0 && el.textContent && el.textContent.includes('claude-space')) {
      return { found: true, tag: el.tagName, text: el.textContent.substring(0, 50) };
    }
  }
  return { found: false };
});
console.log('项目项:', JSON.stringify(projItem));

if (projItem.found) {
  // 点击包含 claude-space 的最小元素
  await page.evaluate(() => {
    const els = document.querySelectorAll('*');
    for (const el of els) {
      if (el.children.length === 0 && el.textContent && el.textContent.includes('claude-space')) {
        el.click();
        return;
      }
    }
  });
  await new Promise(r => setTimeout(r, 2000));
}

// 点击工作流模板按钮
const templateBtn = await page.$('button[title="工作流模板"]');
console.log('模板按钮存在:', !!templateBtn);

if (templateBtn) {
  await templateBtn.click();
  await new Promise(r => setTimeout(r, 2000));

  // 验证弹窗
  const dialogInfo = await page.evaluate(() => {
    const dialog = document.querySelector('.unified-template-dialog');
    if (!dialog) return { found: false };
    const rect = dialog.getBoundingClientRect();
    const computed = window.getComputedStyle(dialog);
    const headerBtns = document.querySelectorAll('.unified-template-window-btns .dialog-window-btn');
    const closeBtn = document.querySelector('.dialog-close-btn');
    const maxBtn = Array.from(document.querySelectorAll('.dialog-window-btn')).find(b => b.textContent.includes('🗖') || b.textContent.includes('🗗'));
    // 检查编辑器是否可编辑（非 readOnly）
    const inputs = document.querySelectorAll('.tmpl-editor input, .tmpl-editor select, .tmpl-editor textarea');
    const disabledCount = Array.from(inputs).filter(i => i.disabled).length;
    const addStageBtn = document.querySelector('.tmpl-editor .tmpl-btn-sm');
    return {
      found: true,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      hasMaximized: dialog.classList.contains('maximized'),
      windowBtnCount: headerBtns.length,
      hasCloseBtn: !!closeBtn,
      hasMaxBtn: !!maxBtn,
      maxBtnText: maxBtn?.textContent?.trim(),
      editorInputCount: inputs.length,
      editorDisabledCount: disabledCount,
      hasAddStageBtn: !!addStageBtn,
      addStageText: addStageBtn?.textContent?.trim(),
    };
  });

  console.log('弹窗信息:', JSON.stringify(dialogInfo, null, 2));

  // 测试最大化
  if (dialogInfo.found && dialogInfo.hasMaxBtn !== false) {
    const beforeRect = await page.evaluate(() => {
      const d = document.querySelector('.unified-template-dialog');
      return d ? { w: d.getBoundingClientRect().width, h: d.getBoundingClientRect().height } : null;
    });
    // 点击最大化按钮
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.dialog-window-btn');
      for (const b of btns) {
        if (b.textContent.includes('🗖')) { b.click(); return; }
      }
    });
    await new Promise(r => setTimeout(r, 500));
    const afterRect = await page.evaluate(() => {
      const d = document.querySelector('.unified-template-dialog');
      return { w: d.getBoundingClientRect().width, h: d.getBoundingClientRect().height, maximized: d.classList.contains('maximized') };
    });
    console.log('最大化前:', JSON.stringify(beforeRect), '后:', JSON.stringify(afterRect));

    // 还原
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.dialog-window-btn');
      for (const b of btns) {
        if (b.textContent.includes('🗗')) { b.click(); return; }
      }
    });
  }

  await page.screenshot({ path: 'test-result.png' });
  console.log('截图已保存: test-result.png');
} else {
  console.log('未找到模板按钮，页面按钮列表:');
  const btns = await page.$$('button');
  for (const b of btns.slice(0, 15)) {
    const t = (await b.textContent())?.trim();
    const title = await b.getAttribute('title');
    console.log(`  "${t}" title="${title||''}"`);
  }
  await page.screenshot({ path: 'test-result.png' });
}

await app.close();
