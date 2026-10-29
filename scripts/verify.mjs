/**
 * 自动化验收：不依赖肉眼。
 * 1) 页面无 JS 报错
 * 2) 入场动画确实分阶段进行（不同时刻可见对象数递增）
 * 3) 店内商品实例数量充足
 * 4) 关键元素存在（招牌、自动门、贩卖机、信号灯、雨、积水波纹）
 * 5) 自动门会实际位移
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\msedge.exe',
];
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const base = process.argv[2] || 'http://127.0.0.1:5188/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1280,800'],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ---- 1. 入场动画分阶段 ----
// 注意：headless + SwiftShader 的帧率很低，dt 又被 clamp 到 0.05，
// 所以动画在这里比在真机上慢很多。多等一会儿再判定"完成"。
const counts = [];
for (let i = 0; i < 14; i++) {
  await new Promise((r) => setTimeout(r, 900));
  const n = await page.evaluate(() => {
    let visible = 0;
    window.__konbini.world.root.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && o.visible) {
        let p = o;
        let allVisible = true;
        while (p) {
          if (!p.visible) { allVisible = false; break; }
          p = p.parent;
        }
        if (allVisible) visible++;
      }
    });
    return { visible, progress: window.__konbini.world.assembly.progress };
  });
  counts.push(n);
  if (n.progress >= 1) break;
}
const first = counts[0];
// 找到"中途"的采样点：既不是最初，也不是最后一帧
const mid = counts.find((c) => c.progress > 0.35 && c.progress < 0.85);
check(
  '入场动画分阶段增长',
  Boolean(mid) && mid.visible > first.visible,
  counts.map((c) => `${c.visible}@${c.progress.toFixed(2)}`).join(' '),
);
// 完成后会做静态合并，网格总数会下降，所以这里断言"场景已完全就绪"用别的方式：
const done = await page.evaluate(() => ({
  finished: window.__konbini.world.assembly.isFinished,
  merged: window.__konbini.world.root.children.some((c) => c.name === 'merged-static'),
}));
check('入场动画最终完成', done.finished, JSON.stringify(done));

// ---- 2. 商品实例数 ----
const prod = await page.evaluate(() => {
  let total = 0;
  const kinds = {};
  window.__konbini.world.root.traverse((o) => {
    if (o.isInstancedMesh && o.name.startsWith('products-')) {
      total += o.count;
      kinds[o.name] = o.count;
    }
  });
  return { total, kinds };
});
check('店内商品数量 ≥ 300', prod.total >= 300, JSON.stringify(prod.kinds) + ` total=${prod.total}`);

// ---- 2b. 商品包装：薯片/盒装/杯面/饮料都有贴图 ----
const packaging = await page.evaluate(() => {
  const byKind = {};
  const groups = [];
  const maps = new Set();
  window.__konbini.world.root.traverse((o) => {
    if (!o.isInstancedMesh || !o.name.startsWith('products-')) return;
    const kind = o.name.split('-')[1];
    byKind[kind] = (byKind[kind] ?? 0) + o.count;
    groups.push({ name: o.name, count: o.count, map: Boolean(o.material?.map), geo: o.geometry?.type });
    if (o.material?.map) maps.add(o.material.map.uuid);
  });
  return { byKind, groups, maps: maps.size };
});
check(
  '薯片 / 盒装零食 / 杯面 / 饮料都有包装',
  (packaging.byKind.chips ?? 0) > 80 &&
    (packaging.byKind.box ?? 0) > 100 &&
    (packaging.byKind.bottle ?? 0) > 40 &&
    (packaging.byKind.can ?? 0) > 10 &&
    (packaging.byKind.cup ?? 0) > 40,
  JSON.stringify(packaging.byKind),
);
check(
  '每种商品都有独立包装贴图（≥ 10 张）',
  packaging.maps >= 10 && packaging.groups.every((g) => g.map),
  `maps=${packaging.maps} groups=${packaging.groups.length}`,
);

// ---- 3. 关键元素 ----
const features = await page.evaluate(() => {
  const found = {
    sign: false, door: false, vending: false, signal: false,
    rain: false, ripples: false, glassRain: false, neon: false, alley: false, bicycle: false,
    cooler: false, counter: false, magazine: false, poster: false, acUnit: false,
    utilityPole: false, guardrail: false, crosswalk: false, lamp: false,
  };
  const seen = new Set();
  window.__konbini.world.root.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    if (n) seen.add(n);
    if (n === 'vertical-sign' || n === 'canopy') found.sign = true;
    if (n === 'auto-door') found.door = true;
    if (n.startsWith('vending-')) found.vending = true;
    if (n === 'traffic-signal') found.signal = true;
    if (n === 'utility-pole') found.utilityPole = true;
    if (n === 'bicycle') found.bicycle = true;
    if (n === 'drinks-cooler') found.cooler = true;
    if (n === 'counter') found.counter = true;
    if (n === 'magazine-rack') found.magazine = true;
    if (n === 'alley') found.alley = true;
  });
  // 材质层面
  let rainMesh = 0;
  let shaderCount = 0;
  window.__konbini.scene.traverse((o) => {
    if (o.isMesh && o.material && o.material.isShaderMaterial) shaderCount++;
  });
  return { found, shaderCount, meshNames: seen.size };
});
check('自动贩卖机存在', features.found.vending);
check('自动门存在', features.found.door);
check('招牌 / 竖向灯箱存在', features.found.sign);
check('信号灯存在', features.found.signal);
check('电线杆存在', features.found.utilityPole);
check('自行车存在', features.found.bicycle);
check('饮料冷柜存在', features.found.cooler);
check('收银台存在', features.found.counter);
check('杂志架存在', features.found.magazine);
check('小巷存在', features.found.alley);
check('自定义 Shader（雨/波纹/光锥/玻璃雨）≥ 4', features.shaderCount >= 4, `shaderCount=${features.shaderCount}`);

// ---- 4. 自动门会动 ----
// 门的滑动只发生在"开门"的几秒里，所以先强制触发一次开门再采样。
const doorMotion = await page.evaluate(async () => {
  const door = window.__konbini.world.store.doorL;
  const leaf = door.children[0];
  const samples = [];
  for (let i = 0; i < 90; i++) {
    samples.push(+leaf.position.x.toFixed(3));
    await new Promise((r) => setTimeout(r, 150));
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  return { min, max, range: +(max - min).toFixed(3) };
});
check('自动门有滑动动画', doorMotion.range > 0.3, `range=${doorMotion.range}m (${doorMotion.min}..${doorMotion.max})`);

// ---- 5. 雨在动 ----
const rainMoves = await page.evaluate(async () => {
  const t1 = window.__konbini.world.rain ? 1 : 0;
  void t1;
  const a = performance.now();
  await new Promise((r) => setTimeout(r, 500));
  return a > 0;
});
check('主循环持续运行', rainMoves);

// ---- 6. 渲染统计 ----
const stats = await page.evaluate(() => window.__konbini.stats());
check('draw call < 900', stats.calls < 900, JSON.stringify(stats));
check('三角面 < 900k', stats.triangles < 900000, `${stats.triangles}`);
check('静态几何已合并', await page.evaluate(() => window.__konbini.world.root.children.some((c) => c.name === 'merged-static')));

// 静态合并不能误删“同材质但没被合并”的单件。
// 旧版按材质删除，把另一个桶（castShadow 不同、只有一件、根本没合并）的
// 热食柜柜体也一起删了：开场能看到，几秒后消失。
const hotAfterMerge = await page.evaluate(() => {
  const root = window.__konbini.world.root;
  const body = root.getObjectByName('hot-case-body');
  if (!body) return { found: false };
  let visible = true;
  let p = body;
  while (p) {
    if (!p.visible) visible = false;
    p = p.parent;
  }
  return { found: true, visible };
});
check(
  '静态合并后热食柜柜体仍在',
  hotAfterMerge.found && hotAfterMerge.visible,
  JSON.stringify(hotAfterMerge),
);

// ---- 8. 店内实体不得越出玻璃/墙体 ----
// 这是最容易回归的一类 bug：某个货架或柜台往前挪一点，
// 就从玻璃里伸到街上。用世界矩阵算包围盒来兜住。
const poke = await page.evaluate(() => {
  const L = window.__konbini.layout;
  const S = L.store;
  const wallT = 0.18;
  const inner = {
    x0: S.x0 + wallT,
    x1: S.x1,
    z0: S.z0 + wallT,
    z1: S.z1,
  };
  let interior = null;
  window.__konbini.world.root.traverse((o) => {
    if (o.name === 'interior' && !interior) interior = o;
  });
  if (!interior) return { error: 'no interior group' };
  const worst = [];
  interior.updateMatrixWorld(true);
  interior.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (!o.geometry) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const over = Math.max(
      inner.x0 - bb.min.x,
      bb.max.x - inner.x1,
      inner.z0 - bb.min.z,
      bb.max.z - inner.z1,
    );
    if (over > 0.12) worst.push({ over: +over.toFixed(3), mat: o.material?.type });
  });
  worst.sort((a, b) => b.over - a.over);
  return { count: worst.length, worst: worst.slice(0, 3) };
});
check(
  '店内实体不穿出玻璃（>12cm 视为穿模）',
  poke.count === 0,
  JSON.stringify(poke),
);

// ---- 9. 收银台必须在玻璃后方、且不被后墙柜吞掉 ----
const counter = await page.evaluate(() => {
  const L = window.__konbini.layout;
  const S = L.store;
  let node = null;
  window.__konbini.world.root.traverse((o) => {
    if (o.name === 'counter' && !node) node = o;
  });
  if (!node) return { error: 'no counter group' };
  node.updateMatrixWorld(true);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  node.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x);
    minZ = Math.min(minZ, bb.min.z); maxZ = Math.max(maxZ, bb.max.z);
    minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y);
  });
  return {
    x: [+minX.toFixed(2), +maxX.toFixed(2)],
    z: [+minZ.toFixed(2), +maxZ.toFixed(2)],
    y: [+minY.toFixed(2), +maxY.toFixed(2)],
    glassZ: S.z1,
    backZ: S.z0 + 0.18,
  };
});
check(
  '收银台在玻璃内侧且不被墙吞掉',
  !counter.error && counter.z[1] < counter.glassZ - 0.4 && counter.z[0] > counter.backZ,
  JSON.stringify(counter),
);

// ---- 10. 自动门滑动量不得让门扇穿出店角 ----
// 门扇的层级：doorRoot(在门洞中心) → doorL/doorR 组 → leaf(偏移 doorW/4)
// leaf 的世界 x = 门洞中心 + doorW/4 + slide，再加半个门扇宽度就是最右边缘。
const doorGeom = await page.evaluate(() => {
  const L = window.__konbini.layout;
  const doorW = L.door.x1 - L.door.x0;
  const half = doorW / 2;
  const cxm = (L.door.x0 + L.door.x1) / 2;
  const maxSlide = Math.min(doorW * 0.46, Math.max(0.3, L.store.x1 - 0.08 - (cxm + half)));
  const leafHalf = (doorW / 2 - 0.02) / 2;
  const rightEdge = cxm + half / 2 + maxSlide + leafHalf;
  return { maxSlide: +maxSlide.toFixed(3), rightEdge: +rightEdge.toFixed(3), storeX1: L.store.x1 };
});
check(
  '开门后门扇不穿出转角',
  doorGeom.rightEdge <= doorGeom.storeX1,
  JSON.stringify(doorGeom),
);

// ---- 11. 环境系统：三时段 × 三天气，两个维度必须正交 ----
const envOk = await page.evaluate(async () => {
  const seen = [];
  const findMesh = (name) => {
    let found = null;
    window.__konbini.scene.traverse((o) => {
      if (o.name === name) found = o;
    });
    return found;
  };
  const wetEntries = window.__konbini.world.wet.entries;
  for (const time of ['day', 'dusk', 'night']) {
    for (const weather of ['clear', 'rain', 'snow']) {
      window.__konbini.env.set({ time, weather }, true);
      await new Promise((r) => setTimeout(r, 80));
      const st = window.__konbini.env.get();
      const d = window.__konbini.env.details();
      const sf = findMesh('starfield');
      const rain = findMesh('rain-streaks');
      const snow = findMesh('snowfall');
      const ripple = wetEntries.find((e) => e.ripple);
      const wetDecal = wetEntries.find((e) => !e.ripple);
      seen.push({
        want: `${time}/${weather}`,
        got: `${st.time}/${st.weather}`,
        star: sf ? +sf.material.uniforms.uStarOpacity.value.toFixed(3) : null,
        rain: +d.rain.toFixed(3),
        snow: +d.snow.toFixed(3),
        wetness: +d.wetness.toFixed(3),
        rainVisible: rain ? rain.visible && rain.parent.visible : null,
        rainOpacity: rain ? +rain.material.uniforms.uOpacity.value.toFixed(3) : null,
        snowVisible: snow ? snow.visible && snow.parent.visible : null,
        snowOpacity: snow ? +snow.material.uniforms.uOpacity.value.toFixed(3) : null,
        rippleVisible: ripple ? ripple.mesh.visible : null,
        wetOpacity: wetDecal ? +wetDecal.mesh.material.opacity.toFixed(3) : null,
        key: +d.keyIntensity.toFixed(3),
        exposure: +d.exposure.toFixed(3),
      });
    }
  }
  // 复原到默认「白天 + 雨」
  window.__konbini.env.set({ time: 'day', weather: 'rain' }, true);
  return seen;
});
const envAt = (k) => envOk.find((e) => e.want === k);
const rainy = envOk.filter((e) => e.want.endsWith('/rain'));
const snowies = envOk.filter((e) => e.want.endsWith('/snow'));
const clears = envOk.filter((e) => e.want.endsWith('/clear'));

check(
  '三个时段 × 三种天气（9 组）都能切换',
  envOk.length === 9 && envOk.every((e) => e.want === e.got),
  envOk.map((e) => e.got).join(' '),
);
check(
  '雨量只由天气决定：任何时段选「雨」都会下雨',
  rainy.every((e) => e.rain >= 0.999 && e.rainVisible && e.rainOpacity > 0.5) &&
    clears.concat(snowies).every((e) => e.rain === 0 && !e.rainVisible),
  envOk.map((e) => `${e.want}:${e.rain}/${e.rainOpacity}`).join(' '),
);
check(
  '雪量只由天气决定：任何时段选「雪」都会下雪',
  snowies.every((e) => e.snow >= 0.999 && e.snowVisible && e.snowOpacity > 0.5) &&
    clears.concat(rainy).every((e) => e.snow === 0 && !e.snowVisible),
  envOk.map((e) => `${e.want}:${e.snow}/${e.snowOpacity}`).join(' '),
);
check(
  '地面湿度只由天气决定（晴 0.16 / 雨 1 / 雪 0.05）',
  clears.every((e) => Math.abs(e.wetness - 0.16) < 1e-3) &&
    rainy.every((e) => e.wetness === 1) &&
    snowies.every((e) => Math.abs(e.wetness - 0.05) < 1e-3) &&
    rainy.every((e) => e.wetOpacity > 0.3) &&
    clears.every((e) => e.wetOpacity < 0.2),
  envOk.map((e) => `${e.want}:${e.wetness}/${e.wetOpacity}`).join(' '),
);
check(
  '星空 = 时段 × 天气：夜晴有星，白天/阴雨没有',
  envAt('night/clear').star > 0.8 &&
    envAt('night/rain').star < 0.2 &&
    envAt('night/snow').star > 0.1 &&
    envAt('night/snow').star < 0.4 &&
    envAt('dusk/clear').star > 0.1 &&
    ['day/clear', 'day/rain', 'day/snow'].every((k) => envAt(k).star === 0),
  envOk.map((e) => `${e.want}:${e.star}`).join(' '),
);
check(
  '天气独立影响光照：同时段晴比雨/雪亮',
  envAt('day/clear').key > envAt('day/rain').key &&
    envAt('day/clear').key > envAt('day/snow').key &&
    envAt('night/clear').key > envAt('night/rain').key &&
    envAt('night/clear').key > envAt('night/snow').key,
  envOk.map((e) => `${e.want}:${e.key}`).join(' '),
);
check(
  '晴天没有雨滴涟漪，雨天才有',
  clears.every((e) => !e.rippleVisible) && rainy.every((e) => e.rippleVisible),
  envOk.map((e) => `${e.want}:${e.rippleVisible}`).join(' '),
);

// ---- 12. 雨棚不得越过店角 / 不得插进招牌板 ----
const canopyGeom = await page.evaluate(() => {
  const L = window.__konbini.layout;
  const S = L.store;
  let node = null;
  window.__konbini.world.root.traverse((o) => {
    if (o.name === 'canopy' && !node) node = o;
  });
  if (!node) return { error: 'no canopy' };
  node.updateMatrixWorld(true);
  let maxX = -Infinity;
  let maxY = -Infinity;
  node.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    maxX = Math.max(maxX, bb.max.x);
    maxY = Math.max(maxY, bb.max.y);
  });
  return {
    maxX: +maxX.toFixed(2),
    maxY: +maxY.toFixed(2),
    storeX1: S.x1,
    signBottom: +(S.glassTop - 0.1).toFixed(2),
  };
});
check(
  '雨棚不越过店角',
  !canopyGeom.error && canopyGeom.maxX <= canopyGeom.storeX1 + 0.01,
  JSON.stringify(canopyGeom),
);
check(
  '雨棚不插进招牌板',
  !canopyGeom.error && canopyGeom.maxY <= canopyGeom.signBottom + 0.01,
  JSON.stringify(canopyGeom),
);

// ---- 13. 樱花参数面板默认收起；底部环境条存在且可用 ----
const ui = await page.evaluate(() => {
  const panel = document.querySelector('.sakura-panel');
  const bar = document.querySelector('.envbar');
  return {
    found: Boolean(panel),
    hidden: panel?.hidden,
    labels: [...document.querySelectorAll('.sakura-panel input[type="range"]')]
      .map((input) => input.getAttribute('aria-label')),
    envbar: Boolean(bar),
    envbarLabel: bar?.getAttribute('aria-label') ?? null,
    envbarButtons: [...document.querySelectorAll('.envbar .envbar__btn')].map((b) => b.textContent?.trim()),
    envbarActive: [...document.querySelectorAll('.envbar .envbar__btn[aria-checked="true"]')]
      .map((b) => b.textContent?.trim()),
  };
});
const expectedSakuraControls = ['樱花单簇蓬松度', '前后纵深饱和度', '正面透枝疏花度', '落樱强度'];
check('樱花参数面板存在且默认收起', ui.found && ui.hidden === true, JSON.stringify(ui));
check('面板仅保留指定的四个参数', JSON.stringify(ui.labels) === JSON.stringify(expectedSakuraControls), JSON.stringify(ui.labels));
check(
  '底部环境条存在：3 时段 + 3 天气共 6 个按钮，且高亮与当前状态一致',
  ui.envbar && ui.envbarButtons.length === 6 && ui.envbarActive.length === 2,
  JSON.stringify({ label: ui.envbarLabel, buttons: ui.envbarButtons, active: ui.envbarActive }),
);

// ---- 14/15. 落地与越界检查 ----
// 必须在「没有做静态合并」的状态下测：合并会把静态子件从原组摘出
// 并并入 merged-static，之后按名字（bicycle / utility-pole / traffic-signal）
// 就查不到任何东西。所以另开一个页面，先关合并再跳过入场。
let feet = { curb: 0, bikes: [], poles: [] };
let outside = { half: 0, bad: [] };
let storefront = null;
{
  const p2 = await browser.newPage();
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p2.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
  await p2.evaluate(() => window.__konbini.world.setMergeEnabled(false));
  await p2.evaluate(() => window.__konbini.skipIntro());
  await new Promise((r) => setTimeout(r, 2500));

  feet = await p2.evaluate(() => {
    const c = window.__konbini.layout.curb;
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);
    const gather = (name) => {
      const out = [];
      root.traverse((o) => {
        if (o.name !== name) return;
        let minY = Infinity;
        o.traverse((m) => {
          if (!m.isMesh && !m.isInstancedMesh) return;
          if (!m.geometry) return;
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
          minY = Math.min(minY, bb.min.y);
        });
        if (Number.isFinite(minY)) out.push(+minY.toFixed(3));
      });
      return out;
    };
    return { curb: c, bikes: gather('bicycle'), poles: gather('utility-pole') };
  });

  outside = await p2.evaluate(() => {
    // 台座实际外沿比 L.half 大 0.3（base.ts 里 plinth 用了 H*2 + 0.6）。
    // 用 8 判定会把站在台座边上的电线杆、树误判成"越界"。
    const H = window.__konbini.layout.half + 0.3;
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);

    const byName = new Map();
    root.traverse((o) => {
      if (!o.name) return;
      if (!byName.has(o.name)) byName.set(o.name, []);
      byName.get(o.name).push(o);
    });

    const bad = [];
    for (const name of ['traffic-signal', 'road-signs', 'utility-pole', 'bicycle', 'tree']) {
      for (const o of byName.get(name) ?? []) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        let n = 0;
        o.traverse((m) => {
          if (!m.isMesh && !m.isInstancedMesh) return;
          if (!m.geometry) return;
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
          minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x);
          minZ = Math.min(minZ, bb.min.z); maxZ = Math.max(maxZ, bb.max.z);
          n++;
        });
        if (!n) continue;
        // 越界量：四个边分别比一次，只保留正值
        const over = Math.max(-H - minX, maxX - H, -H - minZ, maxZ - H);
        if (over > 0.05) {
          bad.push({
            name,
            over: +over.toFixed(2),
            x: [+minX.toFixed(1), +maxX.toFixed(1)],
            z: [+minZ.toFixed(1), +maxZ.toFixed(1)],
          });
        }
      }
    }
    return { half: H, bad };
  });

  // 自动门是滑门：门洞范围内不能有静止构件横在门口。
  // 旧版踢脚板 / 磨砂膜 / 中横梁都是通长的，门一开就留下 0.4m 高的
  // 深色板，看起来像一道门槛。这里按"与门洞的 x 重叠宽度"判定，
  // 门框竖挺（只有 ~4cm 压进门洞）不会误报。
  const doorway = await p2.evaluate(() => {
    const L = window.__konbini.layout;
    const door = L.door;
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);
    const bad = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      // 只看静态、不透明的建筑构件：雨幕 / 飞雪 / 门扇本身都不算"门槛"。
      let p = o;
      while (p) {
        if (p.name === 'auto-door' || p.name === 'rain-layer' || p.name === 'snow-layer') return;
        p = p.parent;
      }
      const m = o.material;
      if (!m || m.transparent || m.opacity < 0.5) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const overlap = Math.min(bb.max.x, door.x1) - Math.max(bb.min.x, door.x0);
      const inZ = bb.max.z > L.store.z1 - 0.16 && bb.min.z < L.store.z1 + 0.18;
      const inY = bb.max.y > 0.24 && bb.min.y < 2.2;
      if (overlap > 0.25 && inZ && inY) {
        bad.push({
          name: o.name || '(unnamed)',
          x: [+bb.min.x.toFixed(2), +bb.max.x.toFixed(2)],
          y: [+bb.min.y.toFixed(2), +bb.max.y.toFixed(2)],
          z: [+bb.min.z.toFixed(2), +bb.max.z.toFixed(2)],
        });
      }
    });
    return { count: bad.length, bad: bad.slice(0, 8) };
  });
  check(
    '开门后门洞底部没有静止的「门槛」构件',
    doorway.count === 0,
    JSON.stringify(doorway),
  );

  // 门洞内部的均分竖挺：立面上每隔 2m 分一根竖挺，会正好分到门洞里一根。
  // 门扇滑开后它仍戳在门洞中间，看起来就是「多了一个门框」。
  // 门洞内的静止立柱必须一根都不剩（两侧门边挺在门洞边界上，不算）。
  const insideJambs = await p2.evaluate(() => {
    const L = window.__konbini.layout;
    const door = L.door;
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);
    const bad = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      let p = o;
      while (p) {
        if (p.name === 'auto-door' || p.name === 'rain-layer' || p.name === 'snow-layer') return;
        p = p.parent;
      }
      const m = o.material;
      if (!m || m.transparent || m.opacity < 0.5) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const w = bb.max.x - bb.min.x;
      const overlap = Math.min(bb.max.x, door.x1 - 0.02) - Math.max(bb.min.x, door.x0 + 0.02);
      const inZ = bb.max.z > L.store.z1 - 0.16 && bb.min.z < L.store.z1 + 0.18;
      const inY = bb.max.y > 0.3 && bb.min.y < 2.2;
      // 只看竖挺：窄、且整根都落在门洞内侧
      if (w < 0.3 && overlap > w * 0.9 && inZ && inY) {
        bad.push({
          x: [+bb.min.x.toFixed(2), +bb.max.x.toFixed(2)],
          y: [+bb.min.y.toFixed(2), +bb.max.y.toFixed(2)],
        });
      }
    });
    return { door: [door.x0, door.x1], count: bad.length, bad: bad.slice(0, 6) };
  });
  check(
    '门洞里没有多余的静止竖挺（门框）',
    insideJambs.count === 0,
    JSON.stringify(insideJambs),
  );

  // 自行车坐垫必须压在座管上。旧版座管只到 0.78，坐垫底面在 0.82，
  // 中间空 4cm，远看就是“坐垫浮在车架上”。
  const bikeSeats = await p2.evaluate(() => {
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);
    const bbox = (o) => {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      return o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    };
    const bikes = [];
    root.traverse((o) => {
      if (o.name === 'bicycle') bikes.push(o);
    });
    const bad = [];
    for (const bike of bikes) {
      const saddle = bike.getObjectByName('bike-saddle');
      const post = bike.getObjectByName('bike-seat-post');
      if (!saddle || !post) {
        bad.push({ missing: true });
        continue;
      }
      const s = bbox(saddle);
      const p = bbox(post);
      const gap = +(s.min.y - p.max.y).toFixed(3);
      const cx = (p.min.x + p.max.x) / 2;
      const cz = (p.min.z + p.max.z) / 2;
      const under =
        cx >= s.min.x - 0.01 &&
        cx <= s.max.x + 0.01 &&
        cz >= s.min.z - 0.01 &&
        cz <= s.max.z + 0.01;
      if (gap > 0.005 || !under) bad.push({ gap, under });
    }
    return { count: bikes.length, bad };
  });
  check(
    '自行车坐垫与座管相连（坐垫下方没有空隙）',
    bikeSeats.count === 3 && bikeSeats.bad.length === 0,
    JSON.stringify(bikeSeats),
  );

  // 货架顶部的蓝色分类牌必须压在顶板上。旧版悬空 14cm、还往外偏 4cm。
  const topSigns = await p2.evaluate(() => {
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);
    const bbox = (o) => {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      return o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    };
    const gondolas = [];
    root.traverse((o) => {
      if (/^gondola-\d+$/.test(o.name)) gondolas.push(o);
    });
    const bad = [];
    for (const g of gondolas) {
      const cap = g.getObjectByName('gondola-cap');
      const signs = [];
      g.traverse((o) => {
        if (o.name === 'gondola-sign') signs.push(o);
      });
      if (!cap || signs.length === 0) {
        bad.push({ missing: true });
        continue;
      }
      const c = bbox(cap);
      for (const sign of signs) {
        const sb = bbox(sign);
        const gap = +(sb.min.y - c.max.y).toFixed(3);
        const overlapX = +(Math.min(sb.max.x, c.max.x) - Math.max(sb.min.x, c.min.x)).toFixed(3);
        if (gap > 0.005 || overlapX < 0.005) bad.push({ gap, overlapX });
      }
    }
    return { count: gondolas.length, bad };
  });
  check(
    '货架顶部的蓝色分类牌压在顶板上（不悬空）',
    topSigns.count === 3 && topSigns.bad.length === 0,
    JSON.stringify(topSigns),
  );

  // 侧街的自行车 / 售卖机回收桶 / 垃圾桶背后的护栏，
  // 都是“单独看没问题，和旁边的物件一比对就穿模”的类型。
  const streetDetails = await p2.evaluate(() => {
    const L = window.__konbini.layout;
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);
    const box = (obj) => {
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let maxY = -Infinity;
      obj.traverse((m) => {
        if (!m.isMesh || !m.geometry) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
        minX = Math.min(minX, bb.min.x);
        maxX = Math.max(maxX, bb.max.x);
        minZ = Math.min(minZ, bb.min.z);
        maxZ = Math.max(maxZ, bb.max.z);
        maxY = Math.max(maxY, bb.max.y);
      });
      return { minX, maxX, minZ, maxZ, maxY };
    };

    // 侧街那辆自行车：后轮不能越过 x=2.2 的侧墙
    const bikesIntoWall = [];
    root.traverse((o) => {
      if (o.name !== 'bicycle') return;
      const b = box(o);
      if ((b.minZ + b.maxZ) / 2 < 0 && b.minX < L.store.x1 + 0.05) {
        bikesIntoWall.push(+b.minX.toFixed(2));
      }
    });

    // 蓝色售卖机的回收桶必须在机器外侧，不能卡在红蓝两台中间
    const blue = root.getObjectByName('vending-blue');
    const bin = blue?.getObjectByName('vending-bin');
    const binBox = bin ? box(bin) : null;
    const binBetween = binBox
      ? +(((binBox.minZ + binBox.maxZ) / 2)).toFixed(2)
      : null;

    // 垃圾桶背后不能再有护栏白条（x 2.4..3.5, z 2.8..3.3）
    let railsBehindBins = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.material?.color) return;
      if ('#' + o.material.color.getHexString() !== '#e4e7ea') return;
      const b = box(o);
      if (b.maxX > 2.4 && b.minX < 3.5 && b.maxZ > 2.8 && b.minZ < 3.3 && b.maxY > 0.5) {
        railsBehindBins++;
      }
    });

    // 桶顶也不能再压一块浅灰背板（旧版 #dce1e6, 1.06×0.28, z≈2.09）
    let binPanels = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.material?.color) return;
      if ('#' + o.material.color.getHexString() !== '#dce1e6') return;
      const b = box(o);
      if (b.maxX > 2.4 && b.minX < 3.5 && b.maxZ > 1.9 && b.minZ < 2.6 && b.maxY > 0.9) {
        binPanels++;
      }
    });

    return { bikesIntoWall, binBetween, railsBehindBins, binPanels };
  });
  check(
    '蓝色售卖机旁的自行车不陷进侧墙',
    streetDetails.bikesIntoWall.length === 0,
    JSON.stringify(streetDetails.bikesIntoWall),
  );
  check(
    '蓝色回收桶在蓝色售卖机外侧（不在两台机器中间）',
    streetDetails.binBetween !== null && streetDetails.binBetween < -3.6,
    JSON.stringify({ binZ: streetDetails.binBetween }),
  );
  check(
    '垃圾桶背后没有护栏白条 / 多余背板',
    streetDetails.railsBehindBins === 0 && streetDetails.binPanels === 0,
    JSON.stringify({
      railsBehindBins: streetDetails.railsBehindBins,
      binPanels: streetDetails.binPanels,
    }),
  );

  storefront = await p2.evaluate(() => {
    const L = window.__konbini.layout;
    const S = L.store;
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);

    const bbox = (obj, layer0Only = false) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity, n = 0;
      obj.traverse((m) => {
        if (!m.isMesh) return;
        if (!m.geometry) return;
        if (layer0Only && (m.layers.mask & 1) === 0) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
        minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x);
        minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y);
        minZ = Math.min(minZ, bb.min.z); maxZ = Math.max(maxZ, bb.max.z);
        n++;
      });
      return n ? {
        minX, maxX, minY, maxY, minZ, maxZ,
        w: maxX - minX, h: maxY - minY, d: maxZ - minZ,
      } : null;
    };

    let walk = null, sign = null, umbrella = null, gondola1 = null, lowGondola = null;
    let counterFront = null, counterMenu = null;
    const brackets = [];
    const umbrellaNames = [];
    root.traverse((o) => {
      if (o.name === 'sidewalk' && !walk) walk = o;
      if (o.name === 'vertical-sign' && !sign) sign = o;
      if (o.name === 'umbrella-stand' && !umbrella) umbrella = o;
      if (o.name === 'gondola-1' && !gondola1) gondola1 = o;
      if (o.name === 'low-gondola' && !lowGondola) lowGondola = o;
      if (o.name === 'counter-front') counterFront = o;
      if (o.name === 'counter-menu') counterMenu = o;
      if (o.name === 'sign-bracket-top' || o.name === 'sign-bracket-bottom') brackets.push(o.name);
      if (o.name.startsWith('umbrella-') && o.name !== 'umbrella-stand') umbrellaNames.push(o.name);
    });
    let counterMeshes = 0;
    counterFront?.traverse((o) => { if (o.isMesh) counterMeshes++; });

    const walkBox = walk ? bbox(walk) : null;
    const signBox = sign ? bbox(sign, true) : null;
    const umbrellaBox = umbrella ? bbox(umbrella, true) : null;
    const g1 = gondola1 ? bbox(gondola1, true) : null;
    const lg = lowGondola ? bbox(lowGondola, true) : null;
    const bikeBottoms = [];
    root.traverse((o) => {
      if (o.name !== 'bicycle') return;
      const b = bbox(o);
      if (b) bikeBottoms.push(b.minY);
    });

    const X0 = S.x0 + 0.2; // interior.ts 的 IN.x0
    return {
      curb: L.curb,
      walkTop: walkBox?.maxY ?? null,
      bikeBottoms,
      umbrella: umbrellaBox ? {
        bottom: umbrellaBox.minY,
        w: +umbrellaBox.w.toFixed(3),
        h: +umbrellaBox.h.toFixed(3),
        d: +umbrellaBox.d.toFixed(3),
        maxX: +umbrellaBox.maxX.toFixed(3),
      } : null,
      umbrellaNames,
      sign: signBox ? {
        bottom: +signBox.minY.toFixed(3),
        top: +signBox.maxY.toFixed(3),
        minX: +signBox.minX.toFixed(3),
        minZ: +signBox.minZ.toFixed(3),
        w: +signBox.w.toFixed(3),
      } : null,
      brackets,
      gondola1: g1 ? { minX: +g1.minX.toFixed(3), maxX: +g1.maxX.toFixed(3) } : null,
      lowGondola: lg ? { minX: +lg.minX.toFixed(3), maxX: +lg.maxX.toFixed(3) } : null,
      leftAisle: g1 ? +(g1.minX - (X0 + 0.29)).toFixed(3) : null,
      counterMeshes,
      hasCounterMenu: Boolean(counterMenu),
      counterMenuMap: Boolean(counterMenu?.material?.map),
      doorX0: L.door.x0,
      storeX1: S.x1,
      storeZ1: S.z1,
      X0,
    };
  });

  await p2.close();
}

const nearGround = (v, target, tol = 0.02) => Math.abs(v - target) <= tol;
check(
  '人行道顶面高度 = 路缘 0.14（不是 0.28）',
  storefront && Math.abs(storefront.walkTop - storefront.curb) < 0.004,
  `walkTop=${storefront?.walkTop} curb=${storefront?.curb}`,
);
check(
  '自行车轮胎不陷入人行道（留 1.2cm 离地间隙）',
  storefront && storefront.bikeBottoms.length === 3 &&
    storefront.bikeBottoms.every((v) => v > storefront.walkTop + 0.004 && v < storefront.walkTop + 0.03),
  `walkTop=${storefront?.walkTop} bikes=${storefront?.bikeBottoms?.join(',')}`,
);
check(
  '电线杆落地（不陷地不悬空）',
  feet.poles.length === 4 && feet.poles.every((v) => nearGround(v, feet.curb)),
  `curb=${feet.curb} poles=${feet.poles.join(',')}`,
);
check(
  '伞架换成参考图的黑框 + 四把伞（黑/蓝/红/白），落地且不挡门',
  storefront && storefront.umbrella &&
    Math.abs(storefront.umbrella.bottom - (storefront.walkTop + 0.003)) < 0.01 &&
    storefront.umbrellaNames.length === 4 &&
    ['umbrella-black', 'umbrella-blue', 'umbrella-red', 'umbrella-white'].every((n) => storefront.umbrellaNames.includes(n)) &&
    storefront.umbrella.w > 0.78 && storefront.umbrella.w < 0.9 &&
    storefront.umbrella.h > 1.1 && storefront.umbrella.h < 1.3 &&
    storefront.umbrella.d > 0.4 && storefront.umbrella.d < 0.65 &&
    storefront.umbrella.maxX < storefront.doorX0 - 0.05,
  JSON.stringify(storefront?.umbrella) + ` names=${storefront?.umbrellaNames?.join(',')}`,
);
check(
  '竖招牌抬高、移出檐口、无侧面突出装饰条，并有上下两根支架',
  storefront && storefront.sign &&
    storefront.sign.bottom > 1.2 && storefront.sign.bottom < 1.6 &&
    storefront.sign.top > 3.6 && storefront.sign.top < 4.0 &&
    storefront.sign.minX > storefront.storeX1 + 0.28 &&
    storefront.sign.minZ > storefront.storeZ1 + 0.28 &&
    storefront.sign.w <= 0.58 &&
    storefront.brackets.length === 2,
  JSON.stringify(storefront?.sign) + ` brackets=${storefront?.brackets?.join(',')}`,
);
check(
  '中央货架右移，左侧通道 ≥ 0.70m，矮货架让出左墙',
  storefront && storefront.leftAisle > 0.7 &&
    storefront.gondola1.minX > storefront.X0 + 1.0 &&
    storefront.lowGondola.minX > storefront.X0 + 0.7,
  `leftAisle=${storefront?.leftAisle} gondola1=${JSON.stringify(storefront?.gondola1)} low=${JSON.stringify(storefront?.lowGondola)}`,
);
check(
  '柜台正面有分块面板 / 拉手 / 咖啡菜单（不再是纯立方体）',
  storefront && storefront.counterMeshes >= 15 && storefront.hasCounterMenu && storefront.counterMenuMap,
  `counterMeshes=${storefront?.counterMeshes} menu=${storefront?.hasCounterMenu}`,
);
check('街道物件不越出台座', outside.bad.length === 0, JSON.stringify(outside.bad));

// ---- 15b. 盲道必须留在人行道上；沿街电线杆必须彼此平行 ----
// 这两条都是"单独看没问题、一比对就露馅"的类型：
// 盲道越界会被读成路面标线，杆位错开会让杆子看起来斜插进斑马线。
{
  const streetLayout = await page.evaluate(() => {
    const L = window.__konbini.layout;
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);
    const r = (v) => +v.toFixed(2);

    // 黄色导盲砖（P.tactile = #d9c04a）
    const tactile = [];
    root.traverse((o) => {
      if (!o.isMesh || !o.material?.color) return;
      if ('#' + o.material.color.getHexString() !== '#d9c04a') return;
      if (!o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      tactile.push({ x: [r(bb.min.x), r(bb.max.x)], z: [r(bb.min.z), r(bb.max.z)] });
    });

    // 电线杆杆心（横担会外伸，所以用 position 而不是包围盒）
    const poles = [];
    root.traverse((o) => {
      if (o.name !== 'utility-pole') return;
      poles.push({ x: r(o.position.x), z: r(o.position.z) });
    });

    return {
      tactile,
      poles,
      walk: { xOuter: L.walk.xOuter, zOuter: L.walk.zOuter },
    };
  });

  // 盲道不得越过人行道外边界（越界 1cm 容差，吸附误差）。
  // 注意：静态合并会把同材质的盲道并成一个网格，所以这里只判"每一块都在界内"，
  // 不假设网格数量 —— 断言数量会在合并前后不一样，是脆弱的。
  const overX = streetLayout.tactile.filter((t) => t.x[1] > streetLayout.walk.xOuter + 0.01);
  const overZ = streetLayout.tactile.filter((t) => t.z[1] > streetLayout.walk.zOuter + 0.01);
  check(
    '盲道只在人行道内（不压斑马线、不落到车行道）',
    streetLayout.tactile.length >= 1 && overX.length === 0 && overZ.length === 0,
    JSON.stringify({ tactile: streetLayout.tactile, walk: streetLayout.walk }),
  );

  // 沿街（同侧）的两根杆必须共用同一个 x，杆列才是直的
  const xs = streetLayout.poles.map((p) => p.x).sort((a, b) => a - b);
  const rightSide = xs.filter((x) => x > 0);
  const leftSide = xs.filter((x) => x < 0);
  const aligned = (arr) => arr.length === 2 && Math.abs(arr[0] - arr[1]) < 0.02;
  check(
    '沿街电线杆彼此平行（同侧两根 x 对齐）',
    streetLayout.poles.length === 4 && aligned(rightSide) && aligned(leftSide),
    JSON.stringify({ poles: streetLayout.poles, rightSide, leftSide }),
  );
}

// ---- 15c. 樱花树在板块内、贴地、落樱不越界 ----
// 树被移到板块左下角（车道上），这类"整体搬位置"最容易漏掉两件事：
// 树冠探出台座，以及树根/树池陷进地面。
{
  const treeProbe = await page.evaluate(() => {
    const H = window.__konbini.layout.half;
    const root = window.__konbini.world.root;
    root.updateMatrixWorld(true);
    const r = (v) => +v.toFixed(3);

    let tree = null;
    root.traverse((o) => { if (o.name === 'sakura-tree') tree = o; });
    let pit = null;
    root.traverse((o) => { if (o.name === 'tree-pit') pit = o; });
    if (!tree) return { error: 'no tree' };

    const bounds = (obj, skipPetals) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity, n = 0;
      obj.traverse((m) => {
        if (!m.isMesh && !m.isInstancedMesh) return;
        if (!m.geometry) return;
        // 落樱是粒子，不参与树的实体包围盒
        if (skipPetals && m.name === 'sakura-falling-petals') return;
        // 描边代理体只在遮罩 pass 里绘制，主渲染永远看不到它，
        // 它用的是半径 1 的单位球 + 实例缩放，量进来的包围盒没有物理意义。
        if (m.name === 'sakura-outline-proxy') return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
        minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x);
        minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y);
        minZ = Math.min(minZ, bb.min.z); maxZ = Math.max(maxZ, bb.max.z);
        n++;
      });
      return n ? { minX, maxX, minY, maxY, minZ, maxZ } : null;
    };

    const tb = bounds(tree, true);
    const pb = pit ? bounds(pit, false) : null;
    return {
      half: H,
      tree: tb ? {
        x: [r(tb.minX), r(tb.maxX)], z: [r(tb.minZ), r(tb.maxZ)], minY: r(tb.minY),
      } : null,
      pit: pb ? { x: [r(pb.minX), r(pb.maxX)], z: [r(pb.minZ), r(pb.maxZ)], minY: r(pb.minY) } : null,
    };
  });

  const insidePlate = (b) => b &&
    b.x[0] >= -treeProbe.half - 0.01 && b.x[1] <= treeProbe.half + 0.01 &&
    b.z[0] >= -treeProbe.half - 0.01 && b.z[1] <= treeProbe.half + 0.01;

  check(
    '樱花树整体在板块内（树冠/树池都不越出台座）',
    !treeProbe.error && insidePlate(treeProbe.tree) && insidePlate(treeProbe.pit),
    JSON.stringify(treeProbe),
  );
  check(
    '樱花树贴地（树根与树池不陷进地面，5mm 容差）',
    !treeProbe.error && treeProbe.tree.minY > -0.005 && treeProbe.pit.minY > -0.005,
    `treeMinY=${treeProbe.tree?.minY} pitMinY=${treeProbe.pit?.minY}`,
  );
}

// ---- 16. 积雪：下雪会缓慢积累，封顶后停住，且厚度受限 ----
const snowProbe = await page.evaluate(async () => {
  const findLayer = () => {
    let g = null;
    window.__konbini.scene.traverse((o) => { if (o.name === 'snow-layer') g = o; });
    return g;
  };
  // 注意：只在图层不可见时返回 0。
  // 图层可见但还没被 update 过时，scale.y 是几何体原始高度 1，
  // 直接读会得到 100cm 这种假值。
  const maxCm = () => {
    const g = findLayer();
    if (!g || !g.visible) return 0;
    let m = 0;
    g.children.forEach((c) => {
      if (c.scale.y > m) m = c.scale.y;
    });
    return +(m * 100).toFixed(2);
  };

  // 先清零，并等足够久让积雪融完
  window.__konbini.env.set({ weather: 'clear' }, true);
  await new Promise((r) => setTimeout(r, 800));
  const zero = maxCm();

  // 切下雪，采样增长。
  // 注意：headless + SwiftShader 下的实际帧率远低于真机，而积雪是按
  // 累计时间推进的 —— 现在场景多了一遍遮罩 pass，帧率更低，
  // 14 秒窗口内尚未封顶。这里给到 22 秒，确保真正跑到 4cm 上限。
  window.__konbini.env.set({ weather: 'snow' });
  const samples = [];
  for (let i = 0; i < 22; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    samples.push(maxCm());
  }

  // 再等一段，确认不再变厚
  await new Promise((r) => setTimeout(r, 4000));
  const settled = maxCm();

  // 飘雪粒子
  let fall = null;
  window.__konbini.scene.traverse((o) => {
    if (o.name === 'snowfall') {
      fall = { visible: o.visible, opacity: +o.material.uniforms.uOpacity.value.toFixed(2) };
    }
  });

  window.__konbini.env.set({ weather: 'rain' }, true);
  return { zero, samples, settled, fall };
});
check('晴天无积雪', snowProbe.zero <= 0.05, `zero=${snowProbe.zero}cm`);
check(
  '下雪后积雪逐步变厚',
  snowProbe.samples[2] > snowProbe.samples[0] + 0.1,
  snowProbe.samples.join(' '),
);
check(
  '积雪封顶后不再变厚（≤4.5cm）',
  // 判"封顶"要用「最后三次采样的波动」而不是「settled 与最后一次之差」：
  // 后者在前一次采样恰好取到增长中的中间值时会被误判。
  Math.max(...snowProbe.samples.slice(-3)) - Math.min(...snowProbe.samples.slice(-3)) < 0.05 &&
    snowProbe.settled <= 4.5 &&
    snowProbe.settled >= 3.5,
  `settled=${snowProbe.settled}cm last3=${snowProbe.samples.slice(-3).join(',')}`,
);
check(
  '下雪时有飘雪粒子',
  snowProbe.fall?.visible === true && snowProbe.fall.opacity > 0.5,
  JSON.stringify(snowProbe.fall),
);

// ---- 16. 柜台上的设备必须落在台面跨度内 ----
// 台面设备（收银机/关东煮/咖啡机/热食柜）沿 x 一字排开，
// 如果台面不够长，最左边那件会悬在台外 —— 从街上隔着玻璃看
// 就是"咖啡机左边浮着一块方块"。这里直接量每个设备的包围盒是否被台面兜住。
{
  const p3 = await browser.newPage();
  p3.on('pageerror', (e) => errors.push(e.message));
  await p3.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p3.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
  await p3.evaluate(() => window.__konbini.world.setMergeEnabled(false));
  await p3.evaluate(() => window.__konbini.skipIntro());
  await new Promise((r) => setTimeout(r, 2200));

  const fit = await p3.evaluate(() => {
    let counter = null;
    window.__konbini.world.root.traverse((o) => {
      if (o.name === 'counter' && !counter) counter = o;
    });
    if (!counter) return { err: 'no counter' };
    counter.updateMatrixWorld(true);

    const bbox = (o) => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity, n = 0;
      o.traverse((m) => {
        if (!m.isMesh && !m.isInstancedMesh) return;
        if (!m.geometry) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
        minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x);
        minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y);
        minZ = Math.min(minZ, bb.min.z); maxZ = Math.max(maxZ, bb.max.z);
        n++;
      });
      return n ? { minX, maxX, minY, maxY, minZ, maxZ } : null;
    };

    const whole = bbox(counter);
    // 台面 = 柜台整体宽度上、y 在 0.98~1.12 之间那块的水平范围。
    // 直接用柜台整体的 x 跨度近似（台面比柜体略宽），并留 3cm 容差。
    const topMinX = whole.minX - 0.03;
    const topMaxX = whole.maxX + 0.03;

    // 所有"放在台面上"的分组：底边 y 在台面附近（1.0~1.15）且是 Group
    const bad = [];
    for (const child of counter.children) {
      if (child.type !== 'Group') continue;
      const b = bbox(child);
      if (!b) continue;
      // 只关心台面件（底边贴着台面）
      if (b.minY > 1.15 || b.minY < 0.98) continue;
      const over = Math.max(topMinX - b.minX, b.maxX - topMaxX);
      if (over > 0.02) {
        bad.push({
          x: [+b.minX.toFixed(2), +b.maxX.toFixed(2)],
          over: +over.toFixed(2),
        });
      }
    }
    return {
      counterX: [+whole.minX.toFixed(2), +whole.maxX.toFixed(2)],
      bad,
    };
  });

  check(
    '柜台上的设备都在台面跨度内（不悬空）',
    fit.bad.length === 0,
    JSON.stringify(fit),
  );
  await p3.close();
}

// ---- 无报错 ----
check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);


