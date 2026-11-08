/** Exterior geometry, cable connections, distance detail, and render-pass regression. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(p => p && fs.existsSync(p));
assert.ok(executablePath, 'Set CHROME_PATH to a Chromium executable.');
const url = new URL(process.argv[2] || 'http://127.0.0.1:5188/');
url.searchParams.set('intro', '0');
const browser = await puppeteer.launch({ executablePath, headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'], defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const check = (name, ok, detail) => { assert.ok(ok, `${name}: ${JSON.stringify(detail)}`); console.log(`PASS ${name}`); };
const frames = async (n = 2) => page.evaluate(async n => {
  for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
}, n);

try {
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__konbini);
  await page.evaluate(() => { window.__konbini.world.setMergeEnabled(false); window.__konbini.skipIntro(); });
  await frames();
  const geometry = await page.evaluate(() => {
    const app = window.__konbini, root = app.world.root, S = app.layout.store;
    root.updateMatrixWorld(true);
    const bounds = object => {
      object.geometry.computeBoundingBox();
      return object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
    };
    const rear = bounds(root.getObjectByName('store-back-wall'));
    const side = bounds(root.getObjectByName('store-alley-wall'));
    const door = root.getObjectByName('store-service-door');
    const vents = [], poles = [], terminals = [];
    root.traverse(o => {
      if (o.name === 'store-rear-vent') vents.push(o);
      if (o.name === 'utility-pole') poles.push(o);
      if (o.name === 'utility-wire-terminal') {
        const b = bounds(o);
        terminals.push(o.position.clone().set((b.min.x+b.max.x)/2, b.max.y, (b.min.z+b.max.z)/2));
      }
    });
    const wires = root.getObjectByName('utility-wires').children.filter(o => o.name === 'utility-cable');
    const gaps = wires.slice(0, 10).flatMap(o => [0, 1].map(t => {
      const p = o.geometry.parameters.path.getPoint(t).applyMatrix4(o.matrixWorld);
      return Math.min(...terminals.map(a => a.distanceTo(p)));
    }));
    const groupBounds = group => {
      const lo = [Infinity,Infinity,Infinity], hi = [-Infinity,-Infinity,-Infinity];
      group.traverse(o => {
        if (!o.isMesh || !(o.layers.mask & 1)) return;
        const b = bounds(o);
        for (const [i, key] of ['x','y','z'].entries()) { lo[i] = Math.min(lo[i], b.min[key]); hi[i] = Math.max(hi[i], b.max[key]); }
      });
      return { lo, hi };
    };
    const frontPrint = root.getObjectByName('front-lightbox-print');
    const sidePrint = root.getObjectByName('side-lightbox-print');
    const vertical = root.getObjectByName('vertical-sign');
    const canopy = root.getObjectByName('canopy');
    const board = root.getObjectByName('store-pavement-advertisement');
    const canopyBox = groupBounds(canopy), boardBox = groupBounds(board), verticalBox = groupBounds(vertical);
    const adPrints = [];
    root.getObjectByName('store-advertising').traverse(o => { if (o.name === 'advertisement-print') adPrints.push(o); });
    const signPrints = [frontPrint, sidePrint];
    const aspectErrors = signPrints.map(o => {
      const a = o.geometry.parameters.width / o.geometry.parameters.height;
      const b = o.material.map.image.width / o.material.map.image.height;
      return Math.abs(a / b - 1);
    });
    const rainOrigins = root.getObjectByName('drips-layer').children.filter(o => o.userData.dripOrigin).slice(0,8).map(o => o.userData.dripOrigin);
    const outlet = groupBounds(root.getObjectByName('canopy-rain-outlet'));
    return { roofGap: Math.max(S.roofY - rear.max.y, S.roofY - side.max.y),
      door: !!door, vents: vents.length, cabinet: !!root.getObjectByName('store-meter-cabinet'),
      alley: !!root.getObjectByName('store-alley-service'), poles: poles.length,
      poleFeet: poles.map(o => o.position.y), curb: app.layout.curb,
      terminals: terminals.length, powerWires: gaps.length / 2, maxGap: Math.max(...gaps),
      signs: { front: !!frontPrint, side: !!sidePrint, verticalFaces: vertical.children.filter(o => o.name === 'vertical-sign-face').length,
        width: verticalBox.hi[0] - verticalBox.lo[0], aspectErrors,
        maxWhite: Math.max(...signPrints.map(o => o.material.color.r)),
        hardware: !!root.getObjectByName('sign-service-hatch') },
      canopy: { box: canopyBox, frontPrintBottom: bounds(frontPrint).min.y,
        panels: canopy.children.filter(o => o.name === 'canopy-roof-panel').length,
        gutter: !!root.getObjectByName('canopy-gutter'), outlet: !!root.getObjectByName('canopy-rain-outlet') },
      advertising: { prints: adPrints.length, box: boardBox, doorX0: app.layout.door.x0,
        tactileEndZ: app.layout.walk.zInner + .55 + .15 },
      rain: { origins: rainOrigins, outlet, canopyBox } };
  });
  check('solid rear/alley walls reach the roof', geometry.roofGap < 1e-5, geometry);
  check('rear service fixtures and alley details exist', geometry.door && geometry.vents === 2 && geometry.cabinet && geometry.alley, geometry);
  check('four detailed poles sit on the pavement', geometry.poles === 4 && geometry.poleFeet.every(y => Math.abs(y - geometry.curb) < 1e-5), geometry);
  check('all power conductors meet insulator terminals', geometry.terminals === 24 && geometry.powerWires === 10 && geometry.maxGap < 1e-5, geometry);
  const signs = geometry.signs, canopy = geometry.canopy, ad = geometry.advertising, rain = geometry.rain;
  check('lightboxes have closed hardware and four vertical faces', signs.front && signs.side && signs.hardware && signs.verticalFaces === 4 && signs.width <= .58, signs);
  check('printed lettering keeps its proportions and avoids self-bloom', Math.max(...signs.aspectErrors) < .04 && signs.maxWhite < .7, signs);
  check('canopy has panels and drainage clear of the sign face', canopy.panels === 4 && canopy.gutter && canopy.outlet && canopy.box.hi[0] < 2.2 && canopy.box.hi[1] < canopy.frontPrintBottom, canopy);
  check('advertisements leave the door and tactile paving clear', ad.prints === 4 && ad.box.hi[0] < ad.doorX0 - .1 && ad.box.lo[2] > ad.tactileEndZ + .05 && Math.abs(ad.box.lo[1] - geometry.curb) < 1e-5, ad);
  check('canopy rain starts within the gutter and at its outlet', rain.origins.length === 8 && rain.origins.every(p => p.x >= rain.canopyBox.lo[0] && p.x <= rain.canopyBox.hi[0] && p.z >= rain.canopyBox.hi[2] - .12 && p.z <= rain.canopyBox.hi[2]) &&
    Math.abs(rain.origins[7].y - rain.outlet.lo[1]) < .002, rain);

  const merge = await page.evaluate(() => {
    const root = window.__konbini.world.root;
    const measure = () => {
      let triangles = 0, meshes = 0;
      root.traverse(o => { if (o.isMesh) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.count ?? 1); } });
      return { triangles, meshes };
    };
    const before = measure();
    window.__konbini.world.setMergeEnabled(true);
    window.__konbini.world.doMerge();
    return { before, after: measure() };
  });
  check('static batching preserves every triangle', merge.before.triangles === merge.after.triangles && merge.after.meshes < merge.before.meshes / 2, merge);

  const lodLevels = async (pos, target) => {
    await page.evaluate((p,t) => window.__konbini.view(p,t), pos,target);
    await frames();
    return page.evaluate(() => {
      let near = 0, far = 0;
      window.__konbini.world.root.traverse(o => {
        if (o.isLOD && o.name.startsWith('product-lod-')) {
          if (o.getCurrentLevel() === 0) near++; else far++;
        }
      });
      return { near, far };
    });
  };
  const distant = await lodLevels([9.6,12.4,17.6], [-2.6,.9,.6]);
  const near = await lodLevels([1.2,1.75,4.6], [-2.2,1.3,-3.2]);
  check('overview uses lightweight product geometry', distant.far > 0 && distant.near === 0, distant);
  check('approaching shelves restores close detail', near.near > 0, near);
  await lodLevels([9.6,12.4,17.6], [-2.6,.9,.6]);

  const passes = await page.evaluate(() => {
    const app = window.__konbini, renderer = app.renderer, original = renderer.render;
    const layers = app.camera.layers.mask, override = app.scene.overrideMaterial;
    const clear = renderer.getClearColor(app.scene.fog.color.clone()).clone();
    const runs = [];
    renderer.render = function(scene, camera) {
      if (scene === app.scene) runs.push({ layers: camera.layers.mask, depth: !!scene.overrideMaterial?.isMeshDepthMaterial,
        shadows: renderer.shadowMap.autoUpdate || renderer.shadowMap.needsUpdate });
      return original.apply(this, arguments);
    };
    try { app.pipeline.render(1, 1/60); } finally { renderer.render = original; }
    return { runs, restored: app.camera.layers.mask === layers && app.scene.overrideMaterial === override &&
      renderer.getClearColor(clear.clone()).equals(clear), stats: app.stats() };
  });
  check('only the main scene pass rebuilds shadows', passes.runs.length === 3 && passes.runs.filter(p => p.shadows).length === 1 && passes.runs[1].depth && passes.runs[1].layers === 1, passes);
  check('pipeline restores state and reports all passes', passes.restored && passes.stats.totalCalls > passes.stats.calls && passes.stats.calls < 900, passes);

  for (const time of ['day', 'dusk', 'night']) {
    for (const weather of ['clear', 'rain', 'snow']) {
      await page.evaluate((time,weather) => window.__konbini.env.set({ time,weather },true), time,weather);
      await frames();
    }
  }
  check('nine environment combinations render without errors', errors.length === 0, errors);
  const adaptive = await page.evaluate(async () => {
    const app = window.__konbini, original = app.pipeline.render;
    const before = app.renderer.getPixelRatio();
    app.pipeline.render = function() {
      original.apply(this, arguments);
      const start = performance.now();
      while (performance.now() - start < 32) { /* Simulate sustained GPU/CPU load. */ }
    };
    try {
      const deadline = performance.now() + 6500;
      while (app.renderer.getPixelRatio() === before && performance.now() < deadline) await new Promise(requestAnimationFrame);
      return { before, after: app.renderer.getPixelRatio() };
    } finally { app.pipeline.render = original; }
  });
  check('sustained slow frames lower render cost', adaptive.after < adaptive.before, adaptive);
  await page.setViewport({ width: 1920, height: 1080 });
  await frames(3);
  const size = await page.evaluate(() => ({ ratio: window.__konbini.renderer.getPixelRatio(), width: innerWidth, height: innerHeight }));
  check('large viewports respect the render pixel budget', size.ratio < 2 && size.width * size.height * size.ratio ** 2 <= 6_000_001, size);
  console.log('17 scene checks passed');
} finally { await browser.close(); }
