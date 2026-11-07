import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((file) => file && fs.existsSync(file));
const browser = await puppeteer.launch({ executablePath, headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const base = process.argv[2] || 'http://127.0.0.1:5188/';
const pose = () => page.evaluate(() => {
  const k = window.__konbini;
  return { position: k.camera.position.toArray(), target: k.controls.target.toArray(), fov: k.camera.fov };
});
const assertHome = async (home) => {
  await page.waitForFunction(() => !window.__konbini.cameraRig.isFocusing(), { timeout: 12000 });
  const actual = await pose();
  for (const key of ['position', 'target']) {
    assert.ok(actual[key].every((value, i) => Math.abs(value - home[key][i]) < 1e-6), JSON.stringify({actual, home}));
  }
  assert.equal(actual.fov, home.fov);
  assert.ok(await page.evaluate(() => window.__konbini.controls.enabled && !window.__konbini.controls.autoRotate));
};
const ready = async () => {
  await page.goto(new URL('?intro=0&instant=1', base).href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!window.__konbini, { timeout: 90000 });
  await page.evaluate(() => window.__konbini.skipIntro());
};
const toolbarFits = async () => {
  assert.ok(await page.evaluate(() => {
    const boxes = ['.camera-reset', '.opening-replay', '.sound-toggle'].map((selector) =>
      document.querySelector(selector).getBoundingClientRect());
    return boxes.every((r) => r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight) &&
      boxes.every((a, i) => boxes.slice(i + 1).every((b) => a.right <= b.left || b.right <= a.left));
  }), 'Scene buttons fit and do not overlap');
};

try {
  await ready();
  const home = await pose();
  // Real orbit/zoom gestures exercise the accumulated damping state.
  await page.mouse.move(650, 350);
  await page.mouse.down();
  await page.mouse.move(810, 450, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel({ deltaY: -450 });
  assert.notDeepEqual((await pose()).position, home.position);
  await page.click('.camera-reset');
  await assertHome(home);
  await toolbarFits();
  console.log('PASS desktop orbit/zoom returns home with no residual drift');

  await page.evaluate(() => {
    const k = window.__konbini;
    k.cameraRig.focus(k.world.street.vending[0].pickRoot, () => { window.__unexpectedArrival = true; });
  });
  await page.click('.camera-reset');
  await assertHome(home);
  assert.ok(await page.evaluate(() => !window.__unexpectedArrival && !document.querySelector('dialog[open]')));
  console.log('PASS reset cancels the object approach without a delayed popup');

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluate(() => {
    const k = window.__konbini;
    k.view([12, 3, 1], [2, 1, -2]);
    k.cameraRig.setMode('first-person');
    k.controls.autoRotate = true;
  });
  await page.click('.camera-reset');
  await assertHome(home);
  assert.equal(await page.evaluate(() => window.__konbini.cameraRig.getMode()), 'orbit');
  console.log('PASS reduced motion and first-person mode return to orbit');
  fs.mkdirSync('shots', { recursive: true });
  await page.screenshot({ path: 'shots/camera-reset-desktop.png' });

  await page.setViewport({ width: 320, height: 740, isMobile: true, hasTouch: true });
  await ready();
  const mobileHome = await pose();
  assert.equal(mobileHome.fov, 32);
  await page.evaluate(() => window.__konbini.view([12, 3, 1], [2, 1, -2]));
  await page.tap('.camera-reset');
  await assertHome(mobileHome);
  await toolbarFits();
  await page.screenshot({ path: 'shots/camera-reset-mobile.png' });
  console.log('PASS narrow mobile home framing and toolbar layout');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
