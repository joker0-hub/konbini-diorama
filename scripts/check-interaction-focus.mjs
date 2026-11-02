import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((path) => path && fs.existsSync(path));
const browser = await puppeteer.launch({ executablePath, headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const base = process.argv[2] || 'http://127.0.0.1:5188/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function aim(kind) {
  return page.evaluate((kind) => {
    const k = window.__konbini;
    k.cameraRig.setMode('orbit');
    if (kind === 'vending') k.view([11, 4, 0.6], [2.8, 0.75, -2.5]);
    else k.view([-2, 7, 17], [-6.4, 1.6, 6.4]);
    k.camera.updateMatrixWorld();
    k.world.root.updateMatrixWorld(true);
    const root = kind === 'vending' ? k.world.street.vending[0].root : k.world.street.sakura.pickRoot;
    const p = root.localToWorld(new k.camera.position.constructor(...(kind === 'vending' ? [0, 1.2, 0.43] : [0, 2.1, 0])));
    const before = k.camera.position.toArray();
    const distance = k.camera.position.distanceTo(p);
    const worldPoint = p.toArray();
    p.project(k.camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2, before, distance, worldPoint };
  }, kind);
}

try {
  await page.goto(base + '?intro=0&instant=1&weather=clear', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__konbini, { timeout: 90000 });
  await page.evaluate(() => window.__konbini.skipIntro());
  const shells = [];
  for (const kind of ['vending', 'sakura']) {
    const point = await aim(kind);
    await page.mouse.click(point.x, point.y);
    assert.ok(await page.evaluate(() => window.__konbini.cameraRig.isFocusing() && !document.querySelector('dialog[open]')),
      'Camera starts before showing the dialog');
    await page.waitForSelector(`.${kind}-panel[open]`, { timeout: 10000 });
    const result = await page.evaluate(({ kind, point }) => {
      const k = window.__konbini;
      const panel = document.querySelector(`.${kind}-panel`);
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      return {
        closer: k.camera.position.distanceTo(new k.camera.position.constructor(...point.worldPoint)) < point.distance - 0.2,
        centered: Math.abs(rect.x + rect.width / 2 - innerWidth / 2) < 1 && Math.abs(rect.y + rect.height / 2 - innerHeight / 2) < 1,
        focusing: k.cameraRig.isFocusing(),
        shell: [style.width, style.borderRadius, style.backgroundImage, style.padding],
        position: k.camera.position.toArray(),
      };
    }, { kind, point });
    assert.ok(result.closer && result.centered && !result.focusing, JSON.stringify(result));
    shells.push(result.shell);
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement.closest('dialog[open]') !== null));
    await sleep(150);
    assert.deepEqual(await page.evaluate(() => window.__konbini.camera.position.toArray()), result.position);
    fs.mkdirSync('shots', { recursive: true });
    await page.screenshot({ path: `shots/${kind}-focus.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.$('dialog[open]'), null);
    console.log(`PASS ${kind}: approach, arrival, centered modal, focus trap, stable camera, Escape`);
  }
  assert.deepEqual(shells[0], shells[1], 'Both panels share the same shell');

  let point = await aim('vending');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Escape');
  await sleep(1100);
  assert.ok(await page.evaluate(() => !window.__konbini.cameraRig.isFocusing() && window.__konbini.controls.enabled && !document.querySelector('dialog[open]')));
  console.log('PASS Escape cancels the approach without a delayed popup');

  for (const kind of ['vending', 'sakura']) {
    point = await aim(kind);
    await page.evaluate(() => window.__konbini.cameraRig.setMode('first-person'));
    await page.mouse.click(point.x, point.y);
    await page.waitForSelector(`.${kind}-panel[open]`);
    const after = await page.evaluate(() => window.__konbini.camera.position.toArray());
    assert.ok(after.every((value, i) => Math.abs(value - point.before[i]) < 1e-7));
    await page.keyboard.press('Escape');
  }
  console.log('PASS First-person mode opens both panels without camera movement');

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  point = await aim('vending');
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('.vending-panel[open]');
  assert.equal(await page.evaluate(() => window.__konbini.cameraRig.isFocusing()), false);
  await page.keyboard.press('Escape');

  await page.setViewport({ width: 390, height: 844 });
  point = await aim('sakura');
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('.sakura-panel[open]');
  assert.ok(await page.$eval('.sakura-panel', (panel) => {
    const r = panel.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
      Math.abs(r.x + r.width / 2 - innerWidth / 2) < 1 && Math.abs(r.y + r.height / 2 - innerHeight / 2) < 1;
  }));
  await page.screenshot({ path: 'shots/sakura-focus-mobile.png' });
  await page.mouse.click(4, 4);
  assert.equal(await page.$('dialog[open]'), null);
  console.log('PASS Reduced motion, mobile centering and backdrop dismissal');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
