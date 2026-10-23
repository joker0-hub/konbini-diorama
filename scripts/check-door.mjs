/**
 * 自动门状态截图：把门分别定格在全关 / 全开，各拍一张，
 * 用来确认"门确实打开了，而且门扇没有滑出店角"。
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

// 门口正视角度
await page.evaluate(() => window.__konbini.view([4.6, 2.1, 7.4], [0.9, 1.5, 0.4]));
await new Promise((r) => setTimeout(r, 900));

const probe = await page.evaluate(() => {
  const w = window.__konbini.world;
  return {
    doorRootX: w.store.doorL.parent.position.x,
    leafL: +w.store.doorL.children[0].position.x.toFixed(3),
    leafR: +w.store.doorR.children[0].position.x.toFixed(3),
  };
});
console.log('door probe:', JSON.stringify(probe));

// 采样 12 秒，记录门扇位置范围
const samples = [];
for (let i = 0; i < 60; i++) {
  samples.push(await page.evaluate(() => +window.__konbini.world.store.doorR.children[0].position.x.toFixed(3)));
  await new Promise((r) => setTimeout(r, 200));
}
const min = Math.min(...samples);
const max = Math.max(...samples);
console.log(`doorR x range: ${min} .. ${max}  (travel ${(max - min).toFixed(3)}m)`);

// 定格全关
await page.evaluate(() => {
  const w = window.__konbini.world;
  w.store.doorL.children[0].position.x = -0.4;
  w.store.doorR.children[0].position.x = 0.4;
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: `${outDir}/door-closed.png` });

// 定格全开（用 update 里同样的公式推出极限值）
const open = await page.evaluate(() => {
  const w = window.__konbini.world;
  const L2 = window.__konbini.layout;
  const doorW = 1.6;
  const half = doorW / 2;
  const doorCX = 0.95;
  const maxSlide = Math.min(doorW * 0.46, Math.max(0.3, L2.store.x1 - 0.08 - (doorCX + half)));
  w.store.doorL.children[0].position.x = -half / 2 - maxSlide;
  w.store.doorR.children[0].position.x = half / 2 + maxSlide;
  return { maxSlide: +maxSlide.toFixed(3), leafR: +w.store.doorR.children[0].position.x.toFixed(3), storeX1: L2.store.x1 };
});
console.log('open state:', JSON.stringify(open));
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: `${outDir}/door-open.png` });

await browser.close();
console.log('done');
