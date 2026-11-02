import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((path) => path && fs.existsSync(path));
const browser = await puppeteer.launch({ executablePath, headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto((process.argv[2] || 'http://127.0.0.1:5188/') + '?intro=0&instant=1&weather=clear', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__konbini, { timeout: 90000 });
  await page.evaluate(() => window.__konbini.skipIntro());
  await page.addStyleTag({ content: '.envbar, .bottle-drag-hint { visibility: hidden; }' });
  fs.mkdirSync('shots', { recursive: true });
  for (const [name, pos, target] of [
    ['vending-bin-detail', [5.4, 1.65, -2.6], [2.96, 0.68, -3.84]],
    ['sorting-bins-detail', [1.7, 1.65, 4.8], [2.95, 0.55, 2.3]],
    ['bins-in-scene', [9.6, 12.4, 17.6], [-2.6, 0.9, 0.6]],
  ]) {
    await page.evaluate(({ pos, target }) => {
      const k = window.__konbini;
      k.controls.minDistance = 1;
      k.view(pos, target);
    }, { pos, target });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: `shots/${name}.png` });
  }
  console.log(JSON.stringify(await page.evaluate(() => ({
    bins: window.__konbini.world.street.recyclingBins.length,
    stats: window.__konbini.stats(),
  }))));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
