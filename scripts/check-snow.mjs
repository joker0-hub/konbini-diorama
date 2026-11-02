/**
 * 雪的验证：
 * 1) 切到下雪后，积雪量随时间单调增加
 * 2) 到达上限后停住（不再增长）
 * 3) 厚度有上限（不能变成厚雪堆）
 * 4) 切走后会融化
 * 5) 飘雪粒子可见
 * 并出一组截图。
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

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
await page.evaluate(() => window.__konbini.skipIntro());
await new Promise((r) => setTimeout(r, 2200));

// 先确保是晴天、无雪
await page.evaluate(() => window.__konbini.env.set({ time: 'night', weather: 'clear' }, true));
await new Promise((r) => setTimeout(r, 400));

const snowOf = () => page.evaluate(() => {
  let g = null;
  window.__konbini.scene.traverse((o) => { if (o.name === 'snow-layer') g = o; });
  if (!g) return { err: 'no snow-layer' };
  let maxScaleY = 0;
  let baseY = 0;
  let count = 0;
  g.traverse((m) => {
    if (!m.isMesh) return;
    count++;
    if (m.scale.y > maxScaleY) { maxScaleY = m.scale.y; baseY = m.position.y; }
  });
  let fall = null;
  window.__konbini.scene.traverse((o) => {
    if (o.name === 'snowfall') fall = { visible: o.visible, opacity: o.material.uniforms.uOpacity.value };
  });
  return {
    visible: g.visible,
    patches: count,
    maxThicknessCm: +(maxScaleY * 100).toFixed(2),
    progress: window.__konbini.env.getSnow ? +window.__konbini.env.getSnow().toFixed(3) : null,
    snowfall: fall,
  };
});

// 晴天时应无雪
const clearState = await snowOf();
check('晴天无积雪', !clearState.visible || clearState.maxThicknessCm < 0.05, JSON.stringify(clearState));
const surfaces = await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const k = window.__konbini;
  const ray = new THREE.Raycaster();
  const ground = [[-3, 5.5], [6, -1], [0, 2.8]].map(([x, z]) => {
    ray.set(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(k.world.root, true).find(({ object }) => object.isMesh && object.visible &&
      !object.userData.recyclingPick && !object.userData.vendingPick && object.material.visible);
    return hit?.point.y;
  });
  const snow = k.scene.getObjectByName('snow-layer');
  const caps = snow.children.filter((o) => o.name.startsWith('snow-street-cap-'));
  const bins = k.world.street.recyclingBins;
  const binHeightsMatch = bins.every((bin, i) => {
    const expected = new THREE.Box3().setFromObject(bin).max.y;
    return Math.abs(caps[i + 2].userData.snowSurface.y - expected - 0.003) < 1e-5;
  });
  const roof = snow.getObjectByName('snow-store-roof').userData.snowSurface.y;
  const canopy = snow.getObjectByName('snow-canopy').userData.snowSurface;
  const fall = k.scene.getObjectByName('snowfall').material.uniforms.uSurfaceMap.value;
  const at = (x, z) => {
    const ix = Math.floor((x / 16.6 + 0.5) * 256), iz = Math.floor((z / 16.6 + 0.5) * 256);
    return fall.image.data[iz * 256 + ix];
  };
  return { ground, capCount: caps.length, binHeightsMatch, roof,
    canopy: [canopy.y, canopy.z0, canopy.z1], landingRoof: at(-1, -2), landingRoad: at(-2, 5.7) };
});
check('两条马路不再被人行道覆盖', surfaces.ground[0] < 0.06 && surfaces.ground[1] < 0.06 && Math.abs(surfaces.ground[2] - 0.14) < 0.005, JSON.stringify(surfaces.ground));
check('五只桶顶与两台售卖机均有独立积雪面', surfaces.capCount === 7 && surfaces.binHeightsMatch);
check('屋顶与雨棚积雪贴合实际顶面', Math.abs(surfaces.roof - 4.023) < 0.001 && Math.abs(surfaces.canopy[0] - 2.563) < 0.001 && surfaces.canopy[1] >= 1.1 && surfaces.canopy[2] <= 2.2, JSON.stringify(surfaces));
check('飘雪高度场区分屋顶与道路', surfaces.landingRoof > 4 && surfaces.landingRoad < 0.06);

// 切到下雪，逐步采样
await page.evaluate(() => window.__konbini.env.set({ weather: 'snow' }));
const samples = [];
for (let i = 0; i < 16; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await snowOf();
  samples.push(s.maxThicknessCm);
  if (i === 3) await page.screenshot({ path: `${outDir}/snow-early.png` });
}
const peak = Math.max(...samples);
const final = samples[samples.length - 1];

check(
  '积雪随时间增长',
  samples[3] > samples[0] + 0.05,
  samples.map((v) => v.toFixed(2)).join(' '),
);
check(
  '积雪到达上限后停止增长',
  Math.abs(samples[samples.length - 1] - samples[samples.length - 3]) < 0.02,
  `last3=${samples.slice(-3).map((v) => v.toFixed(2)).join(',')}`,
);
check(
  '积雪厚度有上限（≤4.5cm，不会变厚雪堆）',
  peak <= 4.5,
  `peak=${peak.toFixed(2)}cm`,
);

const finalState = await snowOf();
check('飘雪粒子可见', finalState.snowfall?.visible === true && finalState.snowfall.opacity > 0.5,
  JSON.stringify(finalState.snowfall));

await page.evaluate(() => window.__konbini.view([11.0, 11.2, 15.2], [-0.8, 0.8, -1.2]));
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: `${outDir}/snow-full.png` });

// 低角度看地面与屋顶积雪
await page.evaluate(() => window.__konbini.view([6.4, 2.2, 8.2], [0.2, 2.2, 0.4]));
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: `${outDir}/snow-ground.png` });

// 切走后应融化
await page.evaluate(() => window.__konbini.env.set({ weather: 'clear' }));
await new Promise((r) => setTimeout(r, 6500));
const melted = await snowOf();
check('切走后积雪融化', !melted.visible || melted.maxThicknessCm < 0.1, JSON.stringify(melted));
const melt = await page.evaluate(() => ({ d: window.__konbini.env.details(), label: document.querySelector('.envbar__snow-feedback').textContent }));
check('融雪留下湿润反馈且不产生雨滴', melt.d.meltwater > 0.2 && melt.d.wetness > 0.2 && melt.d.rain === 0 && melt.label.includes('湿润'), JSON.stringify(melt));
await page.evaluate(() => { for (let i = 0; i < 400; i++) window.__konbini.world.environment.update(0.1); });
const dry = await page.evaluate(() => window.__konbini.env.details());
check('融雪后地面逐渐恢复干燥', dry.wetness <= 0.161 && dry.meltwater < 0.02, JSON.stringify(dry));
check('无浏览器或着色器错误', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
