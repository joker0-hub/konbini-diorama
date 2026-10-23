/**
 * 定点截图：专门检查用户反馈的三处
 *   1) 玻璃处有没有东西穿出来
 *   2) 自动门开/关是否看得出来
 *   3) 从街上能否看到收银台
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
const base = process.argv[2] || 'http://127.0.0.1:5188/';
const outDir = 'shots/diag';
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1600,1000'],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
await page.evaluate(() => window.__konbini.skipIntro());
await new Promise((r) => setTimeout(r, 2500));

const shot = async (name, pos, target) => {
  await page.evaluate(
    (p, t) => window.__konbini.view(p, t),
    pos,
    target,
  );
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
};

// 1) 正对前玻璃：看穿模 + 门
await shot('fix-front', [3.2, 1.9, 8.6], [0.4, 1.4, 0.5]);
// 2) 右街：看收银台
await shot('fix-side-counter', [7.4, 2.0, 2.4], [2.0, 1.2, -1.6]);
// 3) 店角外：看侧玻璃有没有东西伸出
await shot('fix-corner', [6.4, 2.6, 6.2], [1.2, 1.1, 0.0]);
// 4) 低角度贴近：极近距离看玻璃面
await shot('fix-close', [2.6, 1.5, 4.4], [1.0, 1.35, 0.2]);

await browser.close();
console.log('done');
