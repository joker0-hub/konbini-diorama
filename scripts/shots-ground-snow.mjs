import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const executablePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => p && fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto((process.argv[2] || 'http://127.0.0.1:5188/') + '?intro=0&instant=1&weather=clear', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__konbini, { timeout: 90000 });
  await page.evaluate(() => window.__konbini.skipIntro());
  fs.mkdirSync('shots/ground-snow', { recursive: true });
  const capture = async (name) => {
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: `shots/ground-snow/${name}.png` });
  };
  await page.evaluate(() => window.__konbini.view([8.8, 5.6, 9.8], [0.4, 0.65, 2.5]));
  await capture('ground-clear');
  await page.evaluate(() => window.__konbini.env.set({ weather: 'snow' }));
  await new Promise((r) => setTimeout(r, 4000));
  await capture('snow-early');
  await page.evaluate(() => window.__konbini.env.set({ weather: 'snow' }, true));
  await capture('snow-full');
  await page.evaluate(() => window.__konbini.view([10, 11, 14], [-1, 1, 0]));
  await capture('snow-roofs');
  await page.evaluate(() => window.__konbini.env.set({ time: 'night' }, true));
  await capture('snow-night');
  await page.evaluate(() => window.__konbini.env.set({ time: 'day', weather: 'clear' }));
  await new Promise((r) => setTimeout(r, 5500));
  await capture('snow-melted');
  console.log(JSON.stringify(await page.evaluate(() => ({ details: window.__konbini.env.details(), stats: window.__konbini.stats() }))));
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
