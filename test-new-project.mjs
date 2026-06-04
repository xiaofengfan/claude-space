/**
 * 测试"新建项目"功能 — Playwright Electron 驱动
 * 用法: node test-new-project.mjs
 */
import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs';

const APP_DIR = path.resolve(import.meta.dirname || '.');
const SHOT_DIR = path.join(APP_DIR, 'test-screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');

let app, page;
let shotN = 0;

function shot(name) {
  const f = path.join(SHOT_DIR, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  return page.screenshot({ path: f }).then(() => {
    console.log(`  📸 ${f}`);
  });
}

async function run() {
  console.log('🚀 启动 Electron...');
  app = await electron.launch({
    executablePath: electronBin,
    args: ['--no-sandbox', APP_DIR],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: 'http://localhost:5173',
    },
    timeout: 60_000,
  });

  // 等待主窗口加载
  await new Promise(r => setTimeout(r, 6_000));

  const windows = app.windows();
  console.log(`   ${windows.length} 个窗口:`);
  for (const w of windows) console.log(`     ${w.url()}`);

  page = windows.find(w => !w.url().startsWith('devtools://'));
  if (!page) {
    console.log('❌ 找不到应用页面');
    await app.close();
    process.exit(1);
  }

  console.log(`   选中页面: ${page.url()}`);
  await shot('01-initial');

  // ── 检查初始状态 ──
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('\n📄 页面初始文本(前500字):');
  console.log(bodyText.substring(0, 500));

  // ── 尝试点击"新建项目"按钮 ──
  // 可能在 WelcomePage 中 ("新建项目" 按钮) 或菜单中 ("新建项目...")
  console.log('\n🔍 查找"新建项目"入口...');

  // 先尝试 WelcomePage 上的按钮 (文本内容匹配)
  let clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const target = btns.find(b => b.textContent?.includes('新建项目') && !b.textContent?.includes('...'));
    if (target) { target.click(); return 'WelcomePage-btn'; }
    return null;
  });

  if (!clicked) {
    // 尝试菜单栏中的"新建项目..."
    clicked = await page.evaluate(() => {
      // 先点"文件"菜单或直接查找
      const all = [...document.querySelectorAll('[role="menuitem"], .menu-item, button')];
      const target = all.find(el => el.textContent?.trim().startsWith('新建项目'));
      if (target) { target.click(); return 'menu-item'; }
      return null;
    });
  }

  console.log(`   点击结果: ${clicked || '未找到按钮'}`);

  if (!clicked) {
    console.log('⚠️ 未找到新建项目按钮 — 可能已加载了项目，尝试通过菜单操作');
    // 尝试找菜单栏触发
    await shot('02-no-button-found');
  }

  // 等待对话框出现
  await new Promise(r => setTimeout(r, 1000));
  await shot('02-after-click');

  // ── 检查对话框是否出现 ──
  const dialogVisible = await page.evaluate(() => {
    const overlay = document.querySelector('.dialog-overlay');
    if (!overlay) return false;
    const h2 = overlay.querySelector('h2');
    return h2 ? h2.textContent : 'dialog-no-h2';
  });

  console.log(`\n📦 对话框状态: ${dialogVisible || '未出现'}`);

  if (dialogVisible) {
    // 找到输入框并输入项目名
    const inputFound = await page.evaluate(() => {
      const input = document.querySelector('.dialog-overlay input[type="text"]');
      if (input) {
        input.value = '';
        input.focus();
        return true;
      }
      return false;
    });

    if (inputFound) {
      console.log('   ⌨️ 输入测试项目名...');
      await page.keyboard.type('test-new-project', { delay: 30 });
      await new Promise(r => setTimeout(r, 500));
      await shot('03-dialog-filled');
    }

    // 点击"创建项目"按钮
    const createClicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.dialog-overlay button')];
      const target = btns.find(b => b.textContent?.includes('创建项目') || b.textContent?.includes('创建'));
      if (target) { target.click(); return true; }
      return false;
    });

    console.log(`   点击创建: ${createClicked ? '✅' : '❌ 未找到创建按钮'}`);

    // 等待创建完成
    await new Promise(r => setTimeout(r, 2000));
    await shot('04-after-create');
  } else {
    console.log('❌ 对话框未出现 — 新建项目功能可能仍有问题');
  }

  // ── 验证结果 ──
  const finalBody = await page.evaluate(() => document.body.innerText);
  console.log('\n📄 最终页面文本(前500字):');
  console.log(finalBody.substring(0, 500));

  // 检查是否成功加载了项目
  const hasProjectNav = await page.evaluate(() => {
    return document.body.innerText.includes('test-new-project');
  });
  console.log(`\n🎯 验证: 页面是否包含 "test-new-project": ${hasProjectNav ? '✅ 是' : '❌ 否'}`);

  // 最后截图
  await shot('05-final');

  console.log('\n✅ 测试完成。截图保存在:', SHOT_DIR);
  await app.close();
}

run().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
