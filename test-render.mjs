import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// 注入 mock：用 Proxy 让所有属性都返回 async 函数
await page.addInitScript(() => {
  const handler = {
    get(target, prop) {
      if (prop === 'then' || prop === Symbol.toPrimitive || prop === Symbol.iterator) return undefined;
      if (prop in target) return target[prop];
      return async () => undefined;
    }
  };
  const base = {
    workspaceList: async () => [],
    scanProjects: async () => [],
    settingsGet: async () => ({}),
    claudeStatus: async () => ({ running: false }),
    listSessions: async () => [],
    workspaceSwitch: async () => ({ success: true }),
    workspaceAdd: async () => ({ id: '1', name: 'test', path: 'test', isActive: true }),
    getIdeConfig: async () => [],
    listIdes: async () => [],
    listAutoRules: async () => [],
  };
  window.electronAPI = new Proxy(base, handler);
  window.orchestrator = {
    templates: async () => ({ ok: true, data: [
      { id: 'greenfield', name: '全新项目', description: '从零创建', kind: 'greenfield', tasks: [{id:'a',title:'t1',kind:'phase',deps:[]}], entry: 'a', terminals: ['a'] },
      { id: 'refactor', name: '项目重构', description: '重构', kind: 'refactor', tasks: [{id:'a',title:'t1',kind:'phase',deps:[]}], entry: 'a', terminals: ['a'] },
    ]}),
    list: async () => ({ ok: true, data: [] }),
    create: async () => ({ ok: true, data: { id: 'test' } }),
    createWithTemplate: async () => ({ ok: true, data: { id: 'test' } }),
    onStatusChange: () => () => {},
    onTaskStarted: () => () => {},
    onTaskCompleted: () => () => {},
    onTaskLog: () => () => {},
    onAwaitApproval: () => () => {},
    onLog: () => () => {},
  };
});

const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await page.goto('http://localhost:55173/', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(5000);

// 检查页面是否有内容
const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
console.log('--- 页面内容前500字符 ---');
console.log(bodyText || '(空)');

const navBtn = await page.$('button[title="工作流模板"]');
console.log('\n1. 顶部导航栏模板按钮存在:', !!navBtn);

if (navBtn) {
  await navBtn.click();
  await page.waitForTimeout(2000);
  
  const dialog = await page.$('.unified-template-dialog');
  console.log('2. 弹窗已打开:', !!dialog);
  
  const afterClickText = await page.evaluate(() => document.body.innerText);
  console.log('3. 包含"简单模式":', afterClickText.includes('简单模式'));
  console.log('4. 包含"高级模式":', afterClickText.includes('高级模式'));
  console.log('5. 包含"普通模式":', afterClickText.includes('普通模式'));
  console.log('6. 包含"融合模式":', afterClickText.includes('融合模式'));
  
  const hasBrowser = await page.$('.orch-browser');
  const hasEditor = await page.$('.tmpl-editor');
  const hasGroup = await page.$('.orch-template-group');
  console.log('7. TemplateBrowser 渲染:', !!hasBrowser);
  console.log('8. TemplateEditor 渲染:', !!hasEditor);
  console.log('9. 按kind分组渲染:', !!hasGroup);
  
  await page.screenshot({ path: 'test-template-dialog.png', fullPage: false });
  console.log('10. 截图已保存');
  
  const dialogText = await page.evaluate(() => {
    const d = document.querySelector('.unified-template-dialog');
    return d ? d.innerText.substring(0, 1500) : '(无弹窗)';
  });
  console.log('--- 弹窗内容 ---');
  console.log(dialogText);
} else {
  console.log('模板按钮未找到，列出所有按钮:');
  const btns = await page.$$('button');
  for (const b of btns.slice(0, 20)) {
    const txt = await b.textContent();
    const title = await b.getAttribute('title');
    console.log(`  按钮: "${txt?.trim()}" title="${title || ''}"`);
  }
}

console.log('\n--- 控制台错误数:', errors.length, '---');
if (errors.length > 0) console.log(errors.slice(0, 5).join('\n'));

await browser.close();
