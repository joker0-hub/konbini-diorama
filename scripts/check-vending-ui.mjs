/** Browser regression: opening, purchasing, real pointer gestures, recycling and cleanup. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.CHROME_PATH,
].find((path) => path && fs.existsSync(path));
if (!executablePath) throw new Error('Install Chrome/Edge or set CHROME_PATH.');
const base = process.argv[2] || 'http://127.0.0.1:5188/';
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
function check(name, condition, detail) {
  assert.ok(condition, `${name}${detail ? ': ' + JSON.stringify(detail) : ''}`);
  console.log('PASS  ' + name);
  passed++;
}

async function project(position) {
  return page.evaluate((xyz) => {
    const k = window.__konbini;
    const p = new k.camera.position.constructor(...xyz).project(k.camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
  }, position);
}
async function bottlePoint(id) {
  const position = await page.evaluate((id) => window.__konbini.world.street.vending[0].getBottleState(id)?.position, id);
  assert.ok(position, 'Bottle exists before pointer interaction.');
  return project(position);
}
async function state(id) {
  return page.evaluate((id) => window.__konbini.world.street.vending[0].getBottleState(id), id);
}
async function waitIdle() {
  await page.waitForFunction(() => !window.__konbini.world.street.vending[0].isBusy(), { timeout: 12000 });
}
async function purchase(drink) {
  await waitIdle();
  const point = await page.evaluate(() => {
    const k = window.__konbini;
    const p = k.world.street.vending[0].root.localToWorld(new k.camera.position.constructor(0, 1.2, 0.43)).project(k.camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForSelector('.vending-panel[open]', { timeout: 3000 });
  await page.click(`[data-drink-id="${drink}"]`);
}
async function hold(id) {
  const p = await bottlePoint(id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await sleep(470);
  const s = await state(id);
  if (s?.state !== 'held') {
    fs.mkdirSync('shots', { recursive: true });
    await page.screenshot({ path: 'shots/vending-hold-failure.png' });
  }
  check('Long press picks up an actual visible bottle', s?.state === 'held', { state: s, p });
}

try {
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(base + '?time=day&weather=clear', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
  check('Default load retains the STEP 1 opening', await page.$eval('.ide__step', (e) => e.textContent.includes('STEP 1 / 2')));
  await page.click('.ide__go');
  check('Opening advances to STEP 2', await page.$eval('.intro', (e) => e.classList.contains('is-step2')));
  await page.click('.ide__go');
  check('Opening retains the title card', await page.$eval('.intro', (e) => e.classList.contains('is-splash')));
  await page.waitForSelector('.intro', { hidden: true, timeout: 15000 });
  await page.waitForFunction(() => window.__konbini.world.assembly.finished, { timeout: 15000 });
  check('Opening doors finish and the assembled scene remains interactive', true);
  await page.evaluate(() => window.__konbini.view([11, 4, 0.6], [2.8, 0.75, -2.5]));
  await sleep(500);
  await purchase('water');
  check('Buying from the visible machine closes the dialog', await page.$('.vending-panel[open]') === null);
  await waitIdle();
  await purchase('tea');
  await waitIdle();
  await purchase('ramune');
  await waitIdle();
  const oldId = await page.evaluate(() => window.__konbini.world.street.vending[0].getBottles()[0].id);
  await purchase('peach');
  check('Fourth purchase immediately removes the oldest bottle', !(await state(oldId)));
  await waitIdle();
  const ids = await page.evaluate(() => window.__konbini.world.street.vending[0].getBottles().map((b) => b.id));
  check('The tray retains exactly three bottles', ids.length === 3);

  const cameraBefore = await page.evaluate(() => window.__konbini.camera.position.toArray());
  await hold(ids[0]);
  const heldControls = await page.evaluate(() => window.__konbini.controls.enabled);
  const ground = await project([4.8, 0.5, -1.6]);
  await page.mouse.move(ground.x, ground.y, { steps: 12 });
  await sleep(160);
  await page.mouse.up();
  check('Ground release starts the cleanup countdown', (await state(ids[0]))?.state === 'ground');
  check('Dragging freezes the camera and restores orbit afterwards', !heldControls && await page.evaluate((before) => {
    const k = window.__konbini;
    return k.controls.enabled && k.camera.position.toArray().every((v, i) => Math.abs(v - before[i]) < 1e-7);
  }, cameraBefore));
  await sleep(1300);
  check('The dropped bottle stays visible before ten seconds', Boolean(await state(ids[0])));
  const rest = await state(ids[0]);
  check('The dropped bottle lands above the physical ground', rest.position[1] >= 0.02, rest);
  await hold(ids[0]);
  check('Picking up a dropped bottle suspends cleanup', (await state(ids[0]))?.remaining === null);
  await page.mouse.up();
  const cleanupStarted = Date.now();
  check('Releasing again resets the ten-second countdown', (await state(ids[0]))?.remaining > 9.7);

  const binPosition = await page.evaluate(() => {
    const k = window.__konbini;
    return k.world.street.recyclingBins[0].getWorldPosition(new k.camera.position.constructor()).toArray();
  });
  await hold(ids[1]);
  const bin = await project(binPosition);
  await page.mouse.move(bin.x, bin.y, { steps: 12 });
  check('A garbage bin highlights as a valid drop target', await page.$eval('.bottle-drag-hint', (e) => e.dataset.recycle === 'true'));
  await page.mouse.up();
  check('Dropping into a garbage bin removes the bottle immediately', !(await state(ids[1])));

  await page.waitForFunction((id) => !window.__konbini.world.street.vending[0].getBottleState(id), { timeout: 18000 }, ids[0]);
  const cleanupDuration = Date.now() - cleanupStarted;
  check('Ground bottle expires after ten real seconds, including slow frames', cleanupDuration >= 9600 && cleanupDuration <= 11500, cleanupDuration);
  check('An untouched tray bottle does not expire', Boolean(await state(ids[2])));
  await hold(ids[2]);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  check('Window blur releases the bottle and restores the camera', (await state(ids[2]))?.state === 'ground' && await page.evaluate(() => window.__konbini.controls.enabled));

  // Switching mobile emulation reloads Chromium; start a fresh scene intentionally.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
  await page.evaluate(() => window.__konbini.skipIntro());
  await page.waitForSelector('.intro', { hidden: true, timeout: 5000 });
  await page.evaluate(() => window.__konbini.view([11, 4, -1.2], [2.8, 0.65, -3.1]));
  await sleep(350);
  await purchase('coffee');
  await waitIdle();
  const touchId = await page.evaluate(() => window.__konbini.world.street.vending[0].getBottles().at(-1).id);
  const touchPoint = await bottlePoint(touchId);
  const cdp = await page.createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y }] });
  await sleep(470);
  check('Touch long press also picks up a bottle', (await state(touchId))?.state === 'held');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  check('Touch cancellation restores controls and drops safely', (await state(touchId))?.state === 'ground' && await page.evaluate(() => window.__konbini.controls.enabled));
  check('Mobile interaction hint fits the viewport', await page.$eval('.bottle-drag-hint', (e) => {
    const r = e.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  }));
  await page.setViewport({ width: 1280, height: 900, isMobile: true, hasTouch: true });
  await page.evaluate(() => window.__konbini.view([10.2, 3.9, -0.3], [2.8, 0.7, -2.6]));
  await purchase('orange');
  await waitIdle();
  fs.mkdirSync('shots', { recursive: true });
  await page.screenshot({ path: 'shots/vending-physics.png' });
  check('No browser runtime errors', errors.length === 0, errors);
  console.log(`\n${passed}/${passed} browser checks passed.`);
} catch (error) {
  fs.mkdirSync('shots', { recursive: true });
  await page.screenshot({ path: 'shots/vending-ui-failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
