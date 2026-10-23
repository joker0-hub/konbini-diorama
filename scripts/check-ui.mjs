/**
 * 底部环境控制台的验证：
 * - 两个维度（时间 / 天气）分组、状态、键盘、双向同步
 * - 点时间不改变天气、点天气不改变时间（正交性在 UI 层也要成立）
 * - 桌面 1600×1000 与手机 390×844 两种视口都不溢出
 * 同时出图。
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
  args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
});

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const activeLabels = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.envbar__btn.is-active')].map((b) => b.textContent));

/* ---------------- 桌面 ---------------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
  await page.evaluate(() => window.__konbini.skipIntro());
  await new Promise((r) => setTimeout(r, 2200));

  // 1. 存在、贴底、居中、分组
  const bar = await page.evaluate(() => {
    const el = document.querySelector('.envbar');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      found: true,
      bottomGap: Math.round(window.innerHeight - r.bottom),
      centered: Math.abs(r.left + r.width / 2 - window.innerWidth / 2) < 2,
      buttons: [...el.querySelectorAll('.envbar__btn')].map((b) => b.textContent),
      groups: [...el.querySelectorAll('.envbar__section-label')].map((b) => b.textContent),
      radiogroups: el.querySelectorAll('[role="radiogroup"]').length,
      radios: el.querySelectorAll('[role="radio"]').length,
    };
  });
  check('底部控制台存在', Boolean(bar));
  check(
    '贴底且水平居中',
    bar && bar.bottomGap >= 8 && bar.bottomGap <= 60 && bar.centered,
    `bottomGap=${bar?.bottomGap} centered=${bar?.centered}`,
  );
  check('时间 3 + 天气 3 共 6 个按钮', bar && bar.buttons.length === 6, bar && bar.buttons.join(' '));
  check(
    '两个独立 radiogroup（时间 / 天气）',
    bar && bar.groups.join(',') === '时间,天气' && bar.radiogroups === 2 && bar.radios === 6,
    JSON.stringify(bar),
  );

  // 2. 初始状态 = 夜晚 / 雨
  const initial = await activeLabels(page);
  check(
    '初始高亮为「夜晚 / 雨」',
    initial.length === 2 && initial.includes('夜晚') && initial.includes('雨'),
    `active=${initial.join(',')}`,
  );

  // 3. 点「黄昏」只改时间，天气保持雨
  await page.evaluate(() => {
    [...document.querySelectorAll('.envbar__btn')].find((b) => b.textContent === '黄昏').click();
  });
  await new Promise((r) => setTimeout(r, 350));
  const afterDusk = await page.evaluate(() => ({
    env: window.__konbini.env.get(),
    active: [...document.querySelectorAll('.envbar__btn.is-active')].map((b) => b.textContent),
    checked: [...document.querySelectorAll('.envbar__btn[aria-checked="true"]')].map((b) => b.textContent),
  }));
  check('点「黄昏」改变时间', afterDusk.env.time === 'dusk', JSON.stringify(afterDusk.env));
  check('点时间不改天气（仍是雨）', afterDusk.env.weather === 'rain', JSON.stringify(afterDusk.env));
  check(
    '时间组高亮同步、天气组仍为雨',
    afterDusk.active.includes('黄昏') && afterDusk.active.includes('雨') && afterDusk.active.length === 2,
    `active=${afterDusk.active.join(',')}`,
  );
  check(
    'aria-checked 与高亮一致',
    afterDusk.checked.length === 2 && afterDusk.checked.includes('黄昏') && afterDusk.checked.includes('雨'),
    `checked=${afterDusk.checked.join(',')}`,
  );

  // 4. 点「晴」只改天气，时间保持黄昏
  await page.evaluate(() => {
    [...document.querySelectorAll('.envbar__btn')].find((b) => b.textContent === '晴').click();
  });
  await new Promise((r) => setTimeout(r, 350));
  const afterClear = await page.evaluate(() => window.__konbini.env.get());
  check('点「晴」改变天气', afterClear.weather === 'clear', JSON.stringify(afterClear));
  check('点天气不改时间（仍是黄昏）', afterClear.time === 'dusk', JSON.stringify(afterClear));

  // 4b. 点「雪」
  await page.evaluate(() => {
    [...document.querySelectorAll('.envbar__btn')].find((b) => b.textContent === '雪').click();
  });
  await new Promise((r) => setTimeout(r, 350));
  const afterSnow = await page.evaluate(() => window.__konbini.env.get());
  check('点「雪」切到下雪', afterSnow.weather === 'snow' && afterSnow.time === 'dusk', JSON.stringify(afterSnow));

  // 5. 反向同步：控制台改状态，UI 要跟着变
  await page.evaluate(() => window.__konbini.env.set({ time: 'day', weather: 'rain' }, true));
  await new Promise((r) => setTimeout(r, 250));
  const synced = await activeLabels(page);
  check(
    '外部改状态时 UI 反向同步',
    synced.length === 2 && synced.includes('白天') && synced.includes('雨'),
    `active=${synced.join(',')}`,
  );
  const pageMeta = await page.evaluate(() => ({
    time: document.documentElement.dataset.time,
    weather: document.documentElement.dataset.weather,
    title: document.title,
    theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  }));
  check('页面 dataset / 标题 / 主题色同步', pageMeta.time === 'day' && pageMeta.weather === 'rain' &&
    pageMeta.title.includes('白天') && pageMeta.title.includes('雨') && pageMeta.theme === '#9fb8d4',
    JSON.stringify(pageMeta));

  // 6. 键盘：
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.envbar__btn')].find((x) => x.textContent === '白天');
    b.focus();
  });
  const beforeArrow = await page.evaluate(() => window.__konbini.env.get());
  await page.keyboard.press('ArrowRight');
  await new Promise((r) => setTimeout(r, 250));
  const afterArrow = await page.evaluate(() => window.__konbini.env.get());
  check(
    '方向键在时间组内切换，且不改天气',
    beforeArrow.time !== afterArrow.time && afterArrow.weather === 'rain',
    `${beforeArrow.time}/${beforeArrow.weather} -> ${afterArrow.time}/${afterArrow.weather}`,
  );

  await page.keyboard.press('6');
  await new Promise((r) => setTimeout(r, 250));
  const after6 = await page.evaluate(() => window.__konbini.env.get());
  check('数字键 6 切到下雪', after6.weather === 'snow', JSON.stringify(after6));

  await page.keyboard.press('4');
  await new Promise((r) => setTimeout(r, 250));
  const after4 = await page.evaluate(() => window.__konbini.env.get());
  check('数字键 4 切到晴', after4.weather === 'clear', JSON.stringify(after4));

  await page.keyboard.press('1');
  await new Promise((r) => setTimeout(r, 250));
  const after1 = await page.evaluate(() => window.__konbini.env.get());
  check('数字键 1 切到白天', after1.time === 'day', JSON.stringify(after1));

  await page.keyboard.press('w');
  await new Promise((r) => setTimeout(r, 250));
  const afterW = await page.evaluate(() => window.__konbini.env.get());
  check('W 循环天气且不改时间', afterW.weather !== 'clear' && afterW.time === 'day', JSON.stringify(afterW));

  // 7. 点击 UI 不应触发相机拖拽
  const camBefore = await page.evaluate(() => {
    const c = window.__konbini.camera.position;
    return [c.x, c.y, c.z].map((v) => +v.toFixed(3));
  });
  const box = await page.evaluate(() => {
    const r = document.querySelector('.envbar').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y - 40, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const camAfter = await page.evaluate(() => {
    const c = window.__konbini.camera.position;
    return [c.x, c.y, c.z].map((v) => +v.toFixed(3));
  });
  check('在 UI 上拖拽不会旋转相机',
    camBefore.every((v, i) => Math.abs(v - camAfter[i]) < 0.02),
    `${camBefore} -> ${camAfter}`);

  // 出一张默认状态图
  await page.evaluate(() => window.__konbini.env.set({ time: 'night', weather: 'rain' }, true));
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${outDir}/ui-desktop.png` });

  await page.close();
}

/* ---------------- 手机 ---------------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
  await page.evaluate(() => window.__konbini.skipIntro());
  await new Promise((r) => setTimeout(r, 2200));

  const m = await page.evaluate(() => {
    const el = document.querySelector('.envbar');
    const r = el.getBoundingClientRect();
    const sections = [...el.querySelectorAll('.envbar__section')].map((s) => {
      const b = s.getBoundingClientRect();
      return { top: Math.round(b.top), left: Math.round(b.left), width: Math.round(b.width), height: Math.round(b.height) };
    });
    const buttons = [...el.querySelectorAll('.envbar__btn')].map((b) => {
      const bb = b.getBoundingClientRect();
      return { text: b.textContent, w: Math.round(bb.width), h: Math.round(bb.height) };
    });
    return {
      width: Math.round(r.width),
      overflow: r.left < 0 || r.right > window.innerWidth,
      bottomGap: Math.round(window.innerHeight - r.bottom),
      sections,
      buttons,
    };
  });
  check('手机视口下不溢出', !m.overflow && m.width <= 390, JSON.stringify(m));
  check(
    '手机下时间/天气分成两行',
    m.sections.length === 2 && m.sections[0].top < m.sections[1].top &&
      Math.abs(m.sections[0].left - m.sections[1].left) < 2,
    JSON.stringify(m.sections),
  );
  check(
    '手机按钮可点（高 ≥ 30px）',
    m.buttons.every((b) => b.h >= 30 && b.w >= 60),
    JSON.stringify(m.buttons),
  );
  await page.screenshot({ path: `${outDir}/ui-mobile.png` });
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
