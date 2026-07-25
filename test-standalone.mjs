import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto('http://localhost:55173/test-standalone.html', { waitUntil: 'networkidle', timeout: 15000 });
await page.waitForTimeout(3000);

const text = await page.evaluate(() => document.body.innerText);
console.log('包含"简单模式":', text.includes('简单模式'));
console.log('包含"高级模式":', text.includes('高级模式'));
console.log('包含"普通模式":', text.includes('普通模式'));
console.log('包含"融合模式":', text.includes('融合模式'));
console.log('包含"全新项目":', text.includes('全新项目'));
console.log('包含"自定义":', text.includes('自定义'));

const tb = await page.$('.orch-browser');
const te = await page.$('.tmpl-editor');
const grp = await page.$('.orch-template-group');
console.log('TemplateBrowser 渲染:', !!tb);
console.log('TemplateEditor 渲染:', !!te);
console.log('按kind分组:', !!grp);

await page.screenshot({ path: 'test-standalone-result.png' });
console.log('截图: test-standalone-result.png');
console.log('--- 页面文本 ---');
console.log(text.substring(0, 1000));
if (errors.length) console.log('错误:', errors.slice(0,3).join('\n'));

await browser.close();
