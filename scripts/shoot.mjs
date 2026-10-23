/**
 * 截图脚本：驱动 headless Chrome 抓取固定视角，用于肉眼回归。
 * 用法：node scripts/shoot.mjs <baseUrl> <outDir>
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('no chrome found');
  process.exit(1);
}

const base = process.argv[2] || 'http://127.0.0.1:5188/';
const outDir = process.argv[3] || 'shots';
fs.mkdirSync(outDir, { recursive: true });

const HERO = [[11.0, 11.2, 15.2], [-0.8, 0.8, -1.2]];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--no-sandbox',
    '--window-size=1600,1000',
  ],
  defaultViewport: { width: 1600, height: 1000 },
});

const page = await browser.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
await page.evaluate(() => window.__konbini.skipIntro());
await new Promise((r) => setTimeout(r, 3000));

const shots = [];

async function shot(name, setup, wait = 1300) {
  await page.evaluate(setup);
  await new Promise((r) => setTimeout(r, wait));
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  shots.push(name);
  console.log('shot', name);
}

const view = (name, pos, target, wait) =>
  shot(name, `window.__konbini.view(${JSON.stringify(pos)}, ${JSON.stringify(target)})`, wait);

// 1. 主视角（街角）
await view('01-hero', HERO[0], HERO[1]);

// 2. 正面（招牌 + 玻璃 + 店内）
await view('02-front', [0.2, 4.4, 15.5], [-1.0, 1.6, 0.0]);

// 3. 近景（门口 + 自动门 + 地垫 + 伞架）
await view('03-door', [4.6, 3.0, 7.6], [1.0, 1.3, 1.4]);

// 4. 侧街（贩卖机 + 巷口 + 玻璃）
await view('04-side', [14.0, 6.2, 3.2], [2.4, 1.4, -1.4]);

// 5. 俯视（微缩模型感）
await view('05-top', [7.0, 19.5, 10.5], [-1.0, 0.4, -1.4]);

// 6. 低角度（雨夜氛围）
await view('06-low', [9.5, 2.8, 13.5], [-0.8, 1.8, -1.0]);

// 7. 店内（拆掉屋顶与天花）
await page.evaluate(() => {
  window.__konbini.world.root.traverse((o) => {
    if (o.name === 'roof' || o.name === 'store-ceiling') o.visible = false;
  });
  window.__konbini.view([7.0, 7.0, 8.0], [-1.4, 1.0, -1.6]);
});
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: path.join(outDir, '07-interior.png') });
shots.push('07-interior');
console.log('shot 07-interior');

// 7b. 店内平视（贴近玻璃往里看，检查陈列密度）
await page.evaluate(() => {
  window.__konbini.view([1.2, 1.75, 4.6], [-2.2, 1.3, -3.2]);
});
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: path.join(outDir, '07b-inside.png') });
shots.push('07b-inside');
console.log('shot 07b-inside');
await page.evaluate(() => {
  window.__konbini.world.root.traverse((o) => {
    if (o.name === 'store-ceiling') o.visible = true;
  });
});

// 8. 描边调试
await page.evaluate(() => {
  window.__konbini.world.root.traverse((o) => {
    if (o.name === 'roof') o.visible = true;
  });
  window.__konbini.pipeline.debugEdges(true);
  window.__konbini.view([11.0, 11.2, 15.2], [-0.8, 0.8, -1.2]);
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: path.join(outDir, '09-edges.png') });
shots.push('09-edges');
console.log('shot 09-edges');
await page.evaluate(() => window.__konbini.pipeline.debugEdges(false));

// 9. 入场动画中间帧
// 用 ?intro=0 关掉代码开场字幕，只保留模型的组装动画。
const assemblyUrl = base + (base.includes('?') ? '&' : '?') + 'intro=0';
await page.goto(assemblyUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
await new Promise((r) => setTimeout(r, 1700));
await page.evaluate(() => window.__konbini.view([11.0, 11.2, 15.2], [-0.8, 0.8, -1.2]));
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: path.join(outDir, '08-assembly.png') });
shots.push('08-assembly');
console.log('shot 08-assembly');

const info = await page.evaluate(() => window.__konbini.stats());
console.log('renderer info:', JSON.stringify(info));

await browser.close();
console.log('done:', shots.join(', '));
