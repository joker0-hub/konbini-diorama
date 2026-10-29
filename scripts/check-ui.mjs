/**
 * 樱花树参数面板验证：点击树打开、四个参数联动、右上角收起、手机尺寸不溢出。
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Chrome or Edge was not found.');
const base = process.argv[2] || 'http://127.0.0.1:5188/';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
await page.evaluate(() => window.__konbini.skipIntro());
await new Promise((resolve) => setTimeout(resolve, 1800));

// 树被放在板块左下角，默认机位看不到它 —— 先把镜头对准树，
// 再按屏幕坐标点击。这既让测试稳定，也验证了"看得到就能点得开"。
await page.evaluate(() => {
  window.__konbini.view([-3.2, 2.6, 12.4], [-6.4, 1.6, 6.4]);
});
await new Promise((resolve) => setTimeout(resolve, 900));

const initial = await page.evaluate(() => {
  const tree = window.__konbini.world.street.sakura;
  const point = new window.__konbini.camera.position.constructor(0, 2.1, 0);
  tree.pickRoot.localToWorld(point);
  point.project(window.__konbini.camera);
  const panel = document.querySelector('.sakura-panel');
  return {
    point: { x: (point.x * 0.5 + 0.5) * innerWidth, y: (-point.y * 0.5 + 0.5) * innerHeight },
    panelExists: Boolean(panel),
    initiallyHidden: panel?.hidden === true,
    labels: [...document.querySelectorAll('.sakura-panel input[type="range"]')].map((input) => input.getAttribute('aria-label')),
    otherPanel: Boolean(document.querySelector('.envbar')),
    envbarButtons: document.querySelectorAll('.envbar .envbar__btn').length,
    treeName: tree.root.name,
  };
});
check('树在场景内且参数面板默认收起', initial.treeName === 'sakura-tree' && initial.panelExists && initial.initiallyHidden);
check('只保留四个指定参数', JSON.stringify(initial.labels) === JSON.stringify(['樱花单簇蓬松度', '前后纵深饱和度', '正面透枝疏花度', '落樱强度']), JSON.stringify(initial.labels));
check('底部环境条存在（3 时段 + 3 天气）', initial.otherPanel && initial.envbarButtons === 6, `buttons=${initial.envbarButtons}`);

await page.mouse.click(initial.point.x, initial.point.y);
await new Promise((resolve) => setTimeout(resolve, 250));
const opened = await page.evaluate(() => document.querySelector('.sakura-panel')?.hidden === false);
check('点击樱花树打开面板', opened);
await page.evaluate(() => {
  const input = document.querySelector('[data-parameter="blossomScale"]');
  input.value = '1.30';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const blossomScale = await page.evaluate(() => window.__konbini.world.street.sakura.getParameters().blossomScale);
check('花簇滑块会更新樱花模型', blossomScale === 1.3, `value=${blossomScale}`);
await page.evaluate(() => {
  const input = document.querySelector('[data-parameter="frontThinning"]');
  input.value = '40';
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const thinning = await page.evaluate(() => window.__konbini.world.street.sakura.getParameters().frontThinning);
check('透枝疏花滑块会更新樱花模型', Math.abs(thinning - 0.4) < 1e-6, `value=${thinning}`);
await page.click('.sakura-panel__close');
const closed = await page.evaluate(() => document.querySelector('.sakura-panel')?.hidden === true);
check('点击右上角收起按钮关闭面板', closed);

await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const mobilePanel = await page.evaluate(() => {
  const panel = document.querySelector('.sakura-panel');
  panel.hidden = false;
  const rect = panel.getBoundingClientRect();
  return { fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight };
});
check('手机端面板不超出屏幕', mobilePanel.fits, JSON.stringify(mobilePanel));
check('页面没有 JavaScript 错误', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\
${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

