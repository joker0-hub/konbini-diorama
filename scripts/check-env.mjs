/**
 * 环境正交性验证（比 verify.mjs 里的 9 组矩阵更细）：
 * 1) 每个时段都能下雨、下雪、放晴
 * 2) 切换时段不会打断正在下的雨/雪，也不会重置积雪
 * 3) 切换天气不会改变时间
 * 4) 晴天/雨天的湿地、涟漪、星空互不串味
 * 5) 出 4 张关键组合截图
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
await new Promise((r) => setTimeout(r, 2200));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const probe = async () => page.evaluate(() => {
  const find = (name) => {
    let found = null;
    window.__konbini.scene.traverse((o) => { if (o.name === name) found = o; });
    return found;
  };
  const rain = find('rain-streaks');
  const snowfall = find('snowfall');
  const stars = find('starfield');
  const wet = window.__konbini.world.wet.entries;
  const ripple = wet.find((e) => e.ripple);
  const decal = wet.find((e) => !e.ripple);
  return {
    env: window.__konbini.env.get(),
    d: window.__konbini.env.details(),
    rainVisible: Boolean(rain && rain.visible),
    rainOpacity: rain ? rain.material.uniforms.uOpacity.value : 0,
    snowfallVisible: Boolean(snowfall && snowfall.visible),
    snowfallOpacity: snowfall ? snowfall.material.uniforms.uOpacity.value : 0,
    star: stars ? stars.material.uniforms.uStarOpacity.value : 0,
    rippleVisible: ripple ? ripple.mesh.visible : false,
    decalOpacity: decal ? decal.mesh.material.opacity : 0,
  };
});

/* ---------------- 1. 9 组矩阵 ---------------- */
const combos = [];
for (const time of ['day', 'dusk', 'night']) {
  for (const weather of ['clear', 'rain', 'snow']) {
    await page.evaluate(({ time, weather }) => window.__konbini.env.set({ time, weather }, true), { time, weather });
    await new Promise((r) => setTimeout(r, 120));
    const p = await probe();
    combos.push({ want: `${time}/${weather}`, ...p });
  }
}
const at = (k) => combos.find((c) => c.want === k);

check(
  '9 组（3 时段 × 3 天气）状态全部生效',
  combos.every((c) => `${c.env.time}/${c.env.weather}` === c.want),
  combos.map((c) => c.want).join(' '),
);
check(
  '每个时段都能下雨：day/dusk/night + rain 雨量都是 1',
  ['day/rain', 'dusk/rain', 'night/rain'].every((k) =>
    at(k).d.rain === 1 && at(k).rainVisible && at(k).rainOpacity > 0.5),
  ['day/rain', 'dusk/rain', 'night/rain'].map((k) => `${at(k).d.rain}/${at(k).rainOpacity}`).join(' '),
);
check(
  '每个时段都能下雪：day/dusk/night + snow 雪量都是 1',
  ['day/snow', 'dusk/snow', 'night/snow'].every((k) =>
    at(k).d.snow === 1 && at(k).snowfallVisible && at(k).snowfallOpacity > 0.5),
  ['day/snow', 'dusk/snow', 'night/snow'].map((k) => `${at(k).d.snow}/${at(k).snowfallOpacity}`).join(' '),
);
check(
  '晴天三个时段都没有雨/雪/湿地/涟漪',
  ['day/clear', 'dusk/clear', 'night/clear'].every((k) =>
    at(k).d.rain === 0 && at(k).d.snow === 0 && !at(k).rainVisible && !at(k).snowfallVisible &&
    !at(k).rippleVisible && at(k).decalOpacity < 0.2),
  ['day/clear', 'dusk/clear', 'night/clear'].map((k) => `${at(k).d.wetness}/${at(k).decalOpacity}`).join(' '),
);
check(
  '星空只由时段基准 × 天气通透度决定',
  at('night/clear').star === 1 &&
    at('day/clear').star === 0 &&
    at('dusk/clear').star > 0.2 &&
    at('night/rain').star < 0.2 &&
    at('night/snow').star > 0.1 &&
    at('night/snow').star < 0.4,
  combos.filter((c) => c.want.endsWith('/clear') || c.want.startsWith('night/')).map((c) => `${c.want}:${c.star}`).join(' '),
);

/* ---------------- 2. 切换时段不打断天气 ---------------- */
await page.evaluate(() => window.__konbini.env.set({ time: 'night', weather: 'rain' }, true));
await new Promise((r) => setTimeout(r, 200));
const beforeTime = await probe();
await page.evaluate(() => window.__konbini.env.set({ time: 'day' }));
await new Promise((r) => setTimeout(r, 400)); // 过渡中
const midTime = await probe();
await new Promise((r) => setTimeout(r, 1600));
const afterTime = await probe();
check(
  '雨夜切白天：雨还在下',
  beforeTime.rainVisible && midTime.rainVisible && afterTime.rainVisible &&
    afterTime.rainOpacity > 0.5 && afterTime.d.rain === 1,
  `${beforeTime.rainOpacity} -> ${midTime.rainOpacity} -> ${afterTime.rainOpacity}`,
);
check(
  '雨夜切白天：只有时间和光照变了',
  afterTime.env.time === 'day' && afterTime.env.weather === 'rain' &&
    afterTime.d.keyIntensity > beforeTime.d.keyIntensity &&
    afterTime.star < 0.01,
  `key ${beforeTime.d.keyIntensity.toFixed(2)} -> ${afterTime.d.keyIntensity.toFixed(2)}, star=${afterTime.star}`,
);

/* ---------------- 3. 切换天气不改时间 ---------------- */
await page.evaluate(() => window.__konbini.env.set({ time: 'dusk', weather: 'clear' }, true));
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => window.__konbini.env.set({ weather: 'snow' }));
await new Promise((r) => setTimeout(r, 1800));
const weatherOnly = await probe();
check(
  '黄昏切雪：时段仍是黄昏',
  weatherOnly.env.time === 'dusk' && weatherOnly.env.weather === 'snow' &&
    weatherOnly.d.snow === 1 && weatherOnly.snowfallVisible,
  JSON.stringify(weatherOnly.env),
);

/* ---------------- 4. 积雪跨时段继续累积，不重置 ---------------- */
await page.evaluate(() => window.__konbini.env.set({ time: 'night', weather: 'snow' }, true));
await new Promise((r) => setTimeout(r, 200));
// instant 之后先融化一点，再用自然速率观察跨时段的连续性
await page.evaluate(() => window.__konbini.env.set({ weather: 'clear' }, true));
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => window.__konbini.env.set({ weather: 'snow' }));
await new Promise((r) => setTimeout(r, 3000));
const snowA = await sliceProbe();
await page.evaluate(() => window.__konbini.env.set({ time: 'dusk' }));
await new Promise((r) => setTimeout(r, 1500));
const snowB = await sliceProbe();
await page.evaluate(() => window.__konbini.env.set({ time: 'day' }));
await new Promise((r) => setTimeout(r, 1500));
const snowC = await sliceProbe();

async function sliceProbe() {
  return page.evaluate(() => {
    let g = null;
    window.__konbini.scene.traverse((o) => { if (o.name === 'snow-layer') g = o; });
    let max = 0;
    if (g) g.children.forEach((c) => { if (c.scale.y > max) max = c.scale.y; });
    return {
      env: window.__konbini.env.get(),
      snow: window.__konbini.env.details().snowOnGround,
      thicknessCm: +(max * 100).toFixed(2),
      visible: Boolean(g && g.visible),
    };
  });
}
check(
  '下雪时切换时段不会重置积雪，反而继续变厚',
  snowB.env.time === 'dusk' && snowC.env.time === 'day' &&
    snowB.snow > snowA.snow && snowC.snow > snowB.snow &&
    snowB.env.weather === 'snow' && snowC.env.weather === 'snow',
  `${snowA.snow.toFixed(2)} -> ${snowB.snow.toFixed(2)} -> ${snowC.snow.toFixed(2)}`,
);

/* ---------------- 5. 湿地随天气淡入淡出 ---------------- */
await page.evaluate(() => window.__konbini.env.set({ time: 'night', weather: 'rain' }, true));
await new Promise((r) => setTimeout(r, 500));
const wetRain = await probe();
await page.evaluate(() => window.__konbini.env.set({ weather: 'clear' }, true));
await new Promise((r) => setTimeout(r, 500));
const wetClear = await probe();
await page.evaluate(() => window.__konbini.env.set({ weather: 'snow' }, true));
await new Promise((r) => setTimeout(r, 500));
const wetSnow = await probe();
check(
  '湿地反光：雨 > 晴 > 雪（且晴天明显变干）',
  wetRain.decalOpacity > 0.3 && wetClear.decalOpacity < 0.2 &&
    wetSnow.decalOpacity < 0.05 && wetRain.rippleVisible &&
    !wetClear.rippleVisible && !wetSnow.rippleVisible,
  `rain=${wetRain.decalOpacity.toFixed(3)} clear=${wetClear.decalOpacity.toFixed(3)} snow=${wetSnow.decalOpacity.toFixed(3)}`,
);

/* ---------------- 6. 截图 ---------------- */
const shots = [
  ['env-day-clear', 'day', 'clear'],
  ['env-day-rain', 'day', 'rain'],
  ['env-dusk-snow', 'dusk', 'snow'],
  ['env-night-rain', 'night', 'rain'],
];
for (const [name, time, weather] of shots) {
  await page.evaluate(({ time, weather }) => {
    window.__konbini.env.set({ time, weather }, true);
    window.__konbini.view([11.0, 11.2, 15.2], [-0.8, 0.8, -1.2]);
  }, { time, weather });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
