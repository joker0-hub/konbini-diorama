/**
 * 穿模检查：找出所有超出店内空间的 Mesh。
 *
 * 店内可用空间（世界坐标）：
 *   x ∈ [store.x0 + 墙厚, store.x1 - 玻璃厚]
 *   z ∈ [store.z0 + 墙厚, store.z1 - 玻璃厚]
 * 任何实体 mesh 的包围盒只要越界，就会从玻璃里伸出去。
 */

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
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
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__konbini), { timeout: 90000 });
await page.evaluate(() => window.__konbini.skipIntro());
await new Promise((r) => setTimeout(r, 2500));

const report = await page.evaluate(() => {
  const THREE = window.__konbini.scene.constructor;
  void THREE;
  const world = window.__konbini.world;
  const L = window.__konbini.layout;
  const S = L.store;
  // 内部安全边界：留 4cm 余量，避免贴面被误判
  const margin = 0.04;
  const lo = { x: S.x0 + 0.2 + margin, z: S.z0 + 0.2 + margin };
  const hi = { x: S.x1 - 0.06 - margin, z: S.z1 - 0.06 - margin };

  const interior = [];
  world.root.traverse((o) => {
    if (o.name === 'interior') interior.push(o);
  });
  const target = interior[0];
  if (!target) return { error: 'no interior group' };

  const out = [];
  target.updateMatrixWorld(true);
  target.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (!o.geometry) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone();
    bb.applyMatrix4(o.matrixWorld);
    const over = {
      xMin: lo.x - bb.min.x,
      xMax: bb.max.x - hi.x,
      zMin: lo.z - bb.min.z,
      zMax: bb.max.z - hi.z,
    };
    const worst = Math.max(over.xMin, over.xMax, over.zMin, over.zMax);
    if (worst > 0.02) {
      out.push({
        kind: o.isInstancedMesh ? `inst(${o.count})` : 'mesh',
        name: o.name || '(anon)',
        material: o.material?.type,
        worst: +worst.toFixed(3),
        box: [
          +bb.min.x.toFixed(2), +bb.min.z.toFixed(2),
          +bb.max.x.toFixed(2), +bb.max.z.toFixed(2),
        ],
        sides: Object.entries(over).filter(([, v]) => v > 0.02).map(([k]) => k),
      });
    }
  });
  out.sort((a, b) => b.worst - a.worst);
  return { open: { lo, hi }, count: out.length, items: out.slice(0, 40) };
});

console.log(JSON.stringify(report, null, 1));
await browser.close();
