/**
 * 时段 × 天气截图矩阵。
 * 每种组合拍一张 hero 角度，用来检查过渡是否合理、星空是否出现。
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

const combos = [
  ['day', 'clear'],
  ['dusk', 'clear'],
  ['night', 'clear'],
  ['night', 'rain'],
];

for (const [time, weather] of combos) {
  await page.evaluate(
    (t, w) => {
      window.__konbini.env.set({ time: t, weather: w }, true);
      window.__konbini.view([11.0, 11.2, 15.2], [-0.8, 0.8, -1.2]);
    },
    time,
    weather,
  );
  await new Promise((r) => setTimeout(r, 1100));
  const st = await page.evaluate(() => window.__konbini.env.get());
  const stars = await page.evaluate(() => {
    let v = null;
    window.__konbini.scene.traverse((o) => {
      if (o.name === 'starfield') v = { visible: o.visible, opacity: o.material.uniforms.uOpacity.value };
    });
    return v;
  });
  const name = `env-${time}-${weather}`;
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(name, JSON.stringify(st), 'stars:', JSON.stringify(stars));
}

await browser.close();
console.log('done');
