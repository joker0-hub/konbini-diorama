/** Regression: opening survives preview links, reloads and deployment builds. */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const chrome = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((path) => path && fs.existsSync(path));
if (!chrome) throw new Error('Chrome/Edge not found; set CHROME_PATH.');
const preview = process.argv.includes('--preview');
const base = preview ? 'http://127.0.0.1:5190/' : (process.argv[2] || 'http://127.0.0.1:5188/');
let server;
let browser;
const errors = [];
let passed = 0;
function check(name, ok) {
  if (!ok) throw new Error(name);
  console.log(`PASS ${name}`);
  passed++;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  if (preview) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '5190', '--strictPort'], { stdio: 'inherit' });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error('Preview server exited.');
      try { ready = (await fetch(base)).ok; } catch {}
      if (ready) break;
      await sleep(200);
    }
    if (!ready) throw new Error('Preview server did not start.');
  }
  browser = await puppeteer.launch({ executablePath: chrome, headless: true,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox'], defaultViewport: { width: 900, height: 650 } });
  const page = await browser.newPage();
  // Includes compiling the 3D scene again after clicking Replay on CPU-only CI.
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(90000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // Observe in the page before its first frame. A remote browser may only answer
  // Puppeteer after an animation has finished; checking its current state races.
  await page.evaluateOnNewDocument((ci) => {
    const probe = window.__openingProbe = { initial: null, sawAssembly: false };
    const observe = () => {
      const k = window.__konbini;
      if (k) {
        if (!probe.initial) {
          probe.initial = { finished: k.world.assembly.finished, intro: !!document.querySelector('.intro') };
          // Test-only resolution, applied before the first expensive render.
          // Production quality and the animation clock remain unchanged.
          if (ci) {
            const { renderer, pipeline } = k;
            const setPixelRatio = renderer.setPixelRatio.bind(renderer);
            renderer.setPixelRatio = (ratio) => setPixelRatio(Math.min(ratio, 0.5));
            renderer.setPixelRatio(0.5);
            pipeline.setSize(innerWidth * 0.5, innerHeight * 0.5);
          }
        }
        const p = k.world.assembly.progress;
        if (p > 0 && p < 1) probe.sawAssembly = true;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }, !!process.env.CI);
  const ready = () => page.waitForFunction(() => !!window.__openingProbe?.initial, { timeout: 90000 });
  const visit = async (query = '') => {
    await page.goto(new URL(query, base).href, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await ready();
  };
  await page.setRequestInterception(true);
  const isSceneBundle = (request) => /\/(?:src\/main\.ts|assets\/main-[\w-]+\.js)$/.test(new URL(request.url()).pathname);
  const sceneRequest = page.waitForRequest(isSceneBundle);
  const holdScene = (request) => { if (!isSceneBundle(request)) void request.continue(); };
  page.on('request', holdScene);
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const pendingScene = await sceneRequest;
  await page.waitForSelector('.intro__status', { visible: true });
  await page.keyboard.press('Enter');
  check('3D 文件加载前先显示标题和加载状态，ENTER 隐藏', await page.evaluate(() =>
    Boolean(document.querySelector('.intro__title-jp') && document.querySelector('.intro__status:not([hidden])') &&
      document.querySelector('.intro__enter[hidden]')) && !window.__konbini));
  await pendingScene.continue();
  await page.setRequestInterception(false);
  page.off('request', holdScene);
  await ready();
  await page.waitForSelector('.intro__enter', { visible: true });
  check('首帧就绪后显示 ENTER', await page.$eval('.intro__enter', (button) => button.textContent === 'ENTER'));
  await sleep(3000);
  check('等待 ENTER 时，开场与模型组装保持待机', await page.evaluate(() =>
    !!document.querySelector('.intro:not(.is-open)') && window.__konbini.world.assembly.progress === 0));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.intro', { hidden: true, timeout: 15000 });
  await page.waitForFunction(() => window.__openingProbe.sawAssembly);
  check('进入场景后播放模型组装', true);
  await page.waitForFunction(() => window.__konbini.world.assembly.finished, { timeout: 90000 });
  check('组装完成，重播入口可见', await page.$eval('.opening-replay', (el) => !el.hidden));
  check('入场完成默认白天晴天，无降雨或积雪', await page.evaluate(() => {
    const k = window.__konbini, state = k.env.get(), surface = k.env.details();
    return state.time === 'day' && state.weather === 'clear' &&
      surface.rain === 0 && surface.snow === 0 && surface.meltwater === 0 && k.env.getSnow() === 0;
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  check('看过开场后刷新仍然播放', !!await page.$('.intro'));

  await visit('?time=night&weather=snow&instant=1&intro=0&source=test#corner');
  check('旧截图链接仍可当次跳过并立即显示积雪', await page.evaluate(() =>
    !document.querySelector('.intro') && window.__konbini.world.assembly.finished && window.__konbini.env.getSnow() === 1));
  const url = new URL(page.url());
  check('跳过参数已消费，环境与其他参数保留', !url.searchParams.has('intro') && !url.searchParams.has('instant') &&
    url.searchParams.get('weather') === 'snow' && url.searchParams.get('time') === 'night' &&
    url.searchParams.get('source') === 'test' && url.hash === '#corner');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  check('旧截图链接刷新后恢复开场', !!await page.$('.intro'));

  await visit('?intro=0');
  await page.waitForFunction(() => window.__openingProbe.sawAssembly);
  check('跳过加载界面时仍播放模型组装', await page.evaluate(() =>
    !window.__openingProbe.initial.intro && !window.__openingProbe.initial.finished));
  await page.evaluate(() => window.__konbini.env.set({ time: 'dusk', weather: 'clear' }, true));
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('.opening-replay')]);
  await ready();
  check('重播入口恢复开场并保留当前环境', await page.evaluate(() =>
    !!document.querySelector('.intro') && window.__konbini.env.get().time === 'dusk' &&
    window.__konbini.env.get().weather === 'clear' && window.__konbini.world.assembly.progress === 0));
  await page.waitForSelector('.intro__enter', { visible: true });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.intro', { hidden: true });
  await page.waitForFunction(() => window.__konbini.world.assembly.progress > 0);
  check('跳过开场后组装正常启动', true);

  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await visit();
  check('减少动效默认直接展示完整场景', await page.evaluate(() =>
    !document.querySelector('.intro') && window.__konbini.world.assembly.finished));
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('.opening-replay')]);
  await ready();
  check('减少动效下可主动查看静态开场', await page.evaluate(() =>
    !!document.querySelector('.intro') && window.__konbini.world.assembly.finished &&
    getComputedStyle(document.querySelector('.intro__title')).animationName === 'none'));
  await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true });
  await visit('?intro=1');
  const enter = await page.waitForSelector('.intro__enter', { visible: true });
  check('小屏 ENTER 按钮完整可见', await enter.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  }));
  await enter.tap();
  await page.waitForSelector('.intro', { hidden: true });
  await page.waitForSelector('.opening-replay:not([hidden])');
  check('手机重播按钮位于可见区域', await page.$eval('.opening-replay', (el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  }));
  check('无浏览器或着色器错误', errors.length === 0);
  console.log(`${passed}/${passed} passed`);
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
