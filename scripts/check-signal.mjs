/**
 * 红绿灯验证：
 * 1) 杆脚落地、灯箱/行人灯都在台座内，且不在店铺体内部
 * 2) 行人灯确实挂在杆上（距离 < 25cm），不再浮空
 * 3) 车灯三相位循环；车绿/黄时行人一定红；行人绿/闪时车一定红
 * 4) 绿人走路帧会切换
 * 5) 出两张相位截图
 *
 * 注意：必须在「关闭静态合并」的页面上量几何 —— 合并会把杆、灯箱、行人灯
 * 外壳的 toon 网格并进 merged-static，原组里只剩下发光面片。
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
  args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1400,900'],
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
await page.evaluate(() => window.__konbini.world.setMergeEnabled(false));
await page.evaluate(() => window.__konbini.skipIntro());
await new Promise((r) => setTimeout(r, 2500));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/* ---------------- 1. 几何 ---------------- */
const geom = await page.evaluate(() => {
  const L = window.__konbini.layout;
  const root = window.__konbini.world.root;
  root.updateMatrixWorld(true);

  const bbox = (obj) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity, n = 0;
    obj.traverse((m) => {
      if (!m.isMesh) return;
      if (!m.geometry) return;
      // 只量实体（layer 0）；发光面片/地面反光在 layer 1，会把包围盒拉到地面
      if ((m.layers.mask & 1) === 0) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      minX = Math.min(minX, bb.min.x); maxX = Math.max(maxX, bb.max.x);
      minY = Math.min(minY, bb.min.y); maxY = Math.max(maxY, bb.max.y);
      minZ = Math.min(minZ, bb.min.z); maxZ = Math.max(maxZ, bb.max.z);
      n++;
    });
    return n ? {
      min: [+minX.toFixed(3), +minY.toFixed(3), +minZ.toFixed(3)],
      max: [+maxX.toFixed(3), +maxY.toFixed(3), +maxZ.toFixed(3)],
      center: [+((minX + maxX) / 2).toFixed(3), +((minY + maxY) / 2).toFixed(3), +((minZ + maxZ) / 2).toFixed(3)],
      n,
    } : null;
  };

  let sig = null;
  root.traverse((o) => { if (o.name === 'traffic-signal' && !sig) sig = o; });
  let head = null;
  root.traverse((o) => { if (o.name === 'signal-head' && !head) head = o; });
  let ped = null;
  root.traverse((o) => { if (o.name === 'ped-signal' && !ped) ped = o; });

  const lamps = ['lamp-green', 'lamp-yellow', 'lamp-red'].map((name) => {
    let m = null;
    root.traverse((o) => { if (o.name === name) m = o; });
    return m ? {
      name,
      mat: m.material?.type,
      color: m.material?.color?.getHexString(),
      hasMap: Boolean(m.material?.map),
      layers: m.layers?.mask,
    } : null;
  });
  const pedIcons = ['ped-red', 'ped-green'].map((name) => {
    let m = null;
    root.traverse((o) => { if (o.name === name) m = o; });
    return m ? { name, hasMap: Boolean(m.material?.map), map: m.material?.map?.uuid } : null;
  });

  const pedPos = ped ? ped.getWorldPosition(new (window.__konbini.camera.position.constructor)()) : null;
  return {
    sig: bbox(sig),
    head: head ? bbox(head) : null,
    headPos: head ? head.getWorldPosition(new (window.__konbini.camera.position.constructor)()).toArray().map((v) => +v.toFixed(3)) : null,
    ped: ped ? bbox(ped) : null,
    pedPos: pedPos ? pedPos.toArray().map((v) => +v.toFixed(3)) : null,
    lamps,
    pedIcons,
    curb: L.curb,
    storeX1: L.store.x1,
    half: L.half,
    walkXOuter: L.walk.xOuter,
    walkZOuter: L.walk.zOuter,
  };
});

check('信号灯杆脚落地（≈路缘高度 0.14）',
  geom.sig && Math.abs(geom.sig.min[1] - geom.curb) <= 0.02,
  `minY=${geom.sig?.min[1]} curb=${geom.curb}`);
check('信号灯整体在台座内',
  geom.sig && geom.sig.min[0] > -geom.half - 0.3 && geom.sig.max[0] < geom.half + 0.3 &&
    geom.sig.min[2] > -geom.half - 0.3 && geom.sig.max[2] < geom.half + 0.3,
  JSON.stringify(geom.sig));
check('灯箱在店铺之外（不挡招牌/玻璃）',
  geom.head && geom.head.min[0] > geom.storeX1,
  `head.minX=${geom.head?.min[0]} storeX1=${geom.storeX1}`);
check('灯箱悬在右侧车道上方，不在人行道正上方',
  geom.head && geom.head.center[0] > geom.walkXOuter && geom.head.center[2] < geom.walkZOuter,
  `head.center=${geom.head?.center} walk=(${geom.walkXOuter}, ${geom.walkZOuter})`);
check('行人灯挂在杆上（距离 < 0.25m）',
  geom.pedPos && Math.hypot(geom.pedPos[0] - 4.18, geom.pedPos[2] - 2.96) < 0.25,
  `pedPos=${geom.pedPos} pole=(4.18, 2.96)`);
check('三颗车灯 + 行人红/绿图标齐全',
  geom.lamps.every((l) => l && l.mat === 'MeshBasicMaterial') &&
    geom.pedIcons.every((p) => p && p.hasMap),
  JSON.stringify({ lamps: geom.lamps, pedIcons: geom.pedIcons }));

/* ---------------- 2. 相位循环 ---------------- */
const samples = await page.evaluate(async () => {
  const out = [];
  const mapOf = () => {
    let m = null;
    window.__konbini.world.root.traverse((o) => { if (o.name === 'ped-green') m = o; });
    return m?.material?.map?.uuid ?? null;
  };
  for (let i = 0; i < 72; i++) {
    const st = window.__konbini.signal.state();
    out.push({
      phase: st.phase,
      ped: st.ped,
      cycleT: +st.cycleT.toFixed(2),
      levels: {
        green: +st.levels.green.toFixed(2),
        yellow: +st.levels.yellow.toFixed(2),
        red: +st.levels.red.toFixed(2),
        pedRed: +st.levels.pedRed.toFixed(2),
        pedGreen: +st.levels.pedGreen.toFixed(2),
      },
      map: mapOf(),
    });
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
});

const phases = new Set(samples.map((s) => s.phase));
const peds = new Set(samples.map((s) => s.ped));
check('车灯三相位都出现（绿 / 黄 / 红）', phases.size === 3 && phases.has('green') && phases.has('yellow') && phases.has('red'),
  [...phases].join(' '));
check('行人灯出现红 / 绿 / 闪三态', peds.size === 3 && peds.has('red') && peds.has('green') && peds.has('flash'),
  [...peds].join(' '));
check('车绿/黄时行人不绿（互锁）',
  samples.filter((s) => s.phase !== 'red').every((s) => s.ped === 'red'),
  samples.filter((s) => s.phase !== 'red' && s.ped !== 'red').slice(0, 3).map((s) => JSON.stringify(s)).join(' '));
check('行人绿/闪时车一定是红（互锁）',
  samples.filter((s) => s.ped !== 'red').every((s) => s.phase === 'red'),
  samples.filter((s) => s.ped !== 'red' && s.phase !== 'red').slice(0, 3).map((s) => JSON.stringify(s)).join(' '));

const greenStable = samples.filter((s) => s.phase === 'green' && s.cycleT > 2 && s.cycleT < 9);
const yellowStable = samples.filter((s) => s.phase === 'yellow' && s.cycleT > 10.5 && s.cycleT < 12.5);
const redStable = samples.filter((s) => s.phase === 'red' && s.cycleT > 14 && s.cycleT < 20.5);
check('绿灯时只有绿灯亮',
  greenStable.length >= 3 && greenStable.every((s) => s.levels.green > 0.8 && s.levels.yellow < 0.2 && s.levels.red < 0.2),
  greenStable.map((s) => `${s.levels.green}/${s.levels.yellow}/${s.levels.red}`).slice(0, 3).join(' '));
check('黄灯时只有黄灯亮',
  yellowStable.length >= 1 && yellowStable.every((s) => s.levels.yellow > 0.6 && s.levels.green < 0.3 && s.levels.red < 0.3),
  yellowStable.map((s) => `${s.levels.green}/${s.levels.yellow}/${s.levels.red}`).join(' '));
check('红灯时车红 / 行人绿',
  redStable.length >= 3 && redStable.every((s) => s.levels.red > 0.8) &&
    redStable.some((s) => s.levels.pedGreen > 0.6),
  redStable.map((s) => `${s.ped}:${s.levels.pedGreen}/${s.levels.pedRed}`).slice(0, 6).join(' '));
const pedRedStable = samples.filter((s) => s.phase !== 'red' && s.cycleT > 1);
check('车绿/黄时行人红灯亮',
  pedRedStable.length >= 3 && pedRedStable.every((s) => s.levels.pedRed > 0.8),
  pedRedStable.map((s) => `${s.phase}:${s.levels.pedRed}`).slice(0, 4).join(' '));

const walkMaps = new Set(redStable.filter((s) => s.levels.pedGreen > 0.5).map((s) => s.map));
check('绿人走路帧会切换（≥ 2 帧）', walkMaps.size >= 2, `frames=${walkMaps.size}`);

/* ---------------- 3. 出图 ---------------- */
async function waitFor(pred, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate(pred);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

await page.evaluate(() => {
  window.__konbini.env.set({ time: 'night', weather: 'clear' }, true);
  window.__konbini.view([5.2, 3.0, 7.4], [4.4, 2.8, 3.05]);
});
await waitFor(() => window.__konbini.signal.state().ped === 'green');
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: `${outDir}/signal-ped-green.png` });

await page.evaluate(() => window.__konbini.view([6.4, 4.7, 7.8], [6.14, 4.42, 3.0]));
await waitFor(() => window.__konbini.signal.state().phase === 'yellow');
// 等黄灯稳定，避免拍到"绿→黄"交叉淡出的那一帧（两盏都还亮）
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${outDir}/signal-yellow.png` });

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
