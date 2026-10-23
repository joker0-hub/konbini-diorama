/**
 * 场景组装：底座 → 便利店 → 内装 → 街道 → 雨 → 入场动画。
 */

import * as THREE from 'three';
import { P } from '../core/palette';
import { group } from '../core/geom';
import { buildBase, type SceneCtx } from './base';
import { buildStore, DOOR, type StoreParts } from './store';
import { buildInterior } from './interior';
import { buildStreet, type StreetRefs } from './street';
import { buildDrips, buildGlassRain, buildLightCone, buildRain, type RainHandles } from './rain';
import { Assembly, phaseWindow } from './assembly';
import { mergeStaticMeshes } from './merge';
import { Environment, type EnvState } from './environment';
import { buildStarfield } from './stars';
import { buildSnow } from './snow';
import { buildSnowfall } from './snowfall';
import { createWet, type WetHandles } from './wet';
import type { SignalHandles } from './signal';
import { L } from './layout';
void phaseWindow;

export interface World {
  root: THREE.Group;
  ctx: SceneCtx;
  store: StoreParts;
  street: StreetRefs;
  rain: RainHandles;
  assembly: Assembly;
  update: (t: number, dt: number, cam: THREE.Camera) => void;
  /** 开关静态几何合并（截图调试时可能需要关掉） */
  setMergeEnabled: (on: boolean) => void;
  /** 立即执行合并 */
  doMerge: () => void;
  /** 环境（时段 × 天气）控制器 */
  environment: Environment;
  /** 街角信号灯（车灯 + 行人灯 + 循环） */
  signal: SignalHandles;
  /** 湿地面控制（用于调试/自动测试） */
  wet: WetHandles;
  /** 天空渐变（由 Environment 驱动，经 main 转发到这里） */
  setSky: (zenith: number, horizon: number) => void;
}

export function buildWorld(envInit: EnvState = { time: 'day', weather: 'rain' }): World {
  const root = new THREE.Group();
  root.name = 'diorama';
  let mergeEnabled = true;
  const envInitLocal = envInit;

  const ctx: SceneCtx = { pieces: [], ticks: [], flickers: [], wet: [] };

  /* ---------------- 环境光 ---------------- */
  // 环境光的具体数值由 Environment 在构造时覆盖；
  // 这里给的是"白天 + 雨"的初值（新默认），只为保证第一帧不会闪。
  const hemi = new THREE.HemisphereLight(0xc4d8f0, 0x7d7668, 1.55);
  root.add(hemi);
  const moon = new THREE.DirectionalLight(0xfff4dd, 1.1);
  moon.position.set(13, 18, 11);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 48;
  moon.shadow.camera.left = -13;
  moon.shadow.camera.right = 13;
  moon.shadow.camera.top = 13;
  moon.shadow.camera.bottom = -13;
  // 阴影要贴着物体：bias 太大会"脱离"（peter-panning），
  // 太小又会在平面上出现自阴影条纹（shadow acne）。
  // 大平面（人行道）对这两者特别敏感 —— 表现为地上一块脏兮兮的椭圆。
  moon.shadow.bias = -0.00035;
  moon.shadow.normalBias = 0.05;
  root.add(moon);
  // 相机方向的弱冷补光：保证朝向观众的立面不死黑
  const fill = new THREE.DirectionalLight(0x6d8cc8, 0.4);
  fill.position.set(12, 5, 14);
  root.add(fill);
  // 门口/檐下的暖色补光（不投影），把"屋檐下的暖窝"托出来
  // 注意：点光源必须离墙面足够远、distance 足够小。
  // 贴着一面大墙放点光，等照面会在墙上切出一个半圆形亮斑，
  // 三渲二的硬边会让它看起来像模型破了一个洞。
  const porch = new THREE.PointLight(0xffd9a6, 2.0, 5.0, 2);
  porch.position.set(0.9, 2.2, L.store.z1 + 1.9);
  root.add(porch);

  // 门口溢光（主光）。
  // 不给点光开阴影：点光阴影是 6 面立方体贴图，在人行道这种大平面上
  // 会因为 bias/分辨率不足而糊出一块边缘发虚的深色椭圆，
  // 看起来像地砖脏了。方向光已经提供了足够的投影层次。
  const doorLight = new THREE.PointLight(0xffe2b4, 13, 12, 2);
  doorLight.position.set(1.2, 2.4, L.store.z1 + 1.6);
  root.add(doorLight);

  /* ---------------- 各层 ---------------- */
  const baseObj = buildBase(root, ctx);
  const store = buildStore(root, ctx);
  buildInterior(root, ctx);
  const street = buildStreet(root, ctx);

  /* ---------------- 雨 ---------------- */
  const rainLayer = group(root, 0, 0, 0, 'rain-layer');
  const rain = buildRain(rainLayer, { count: 3000, height: 10, area: 16 });
  rainLayer.traverse((o) => o.layers.set(1));
  buildDrips(root, ctx);
  buildGlassRain(root, store.frontGlass, store.sideGlass, ctx);
  // 门口与路灯的体积光锥
  const coneA = buildLightCone(rainLayer, 1.2, 2.4, L.store.z1 + 1.6, 3.0, 2.6, 0xffd9a8, 0.085);
  coneA.layers.set(1);
  const coneB = buildLightCone(rainLayer, -5.6, 4.0, 2.9, 2.6, 4.0, 0xffcf94, 0.075);
  coneB.layers.set(1);

  /* ---------------- 雪 ---------------- */
  // 积雪（平面薄板，随时间变厚）+ 飘雪（实例化粒子）
  const snow = buildSnow();
  root.add(snow.root);
  const snowfall = buildSnowfall(root, { count: 1800, height: 11, area: 15 });

  /* ---------------- 入场动画 ---------------- */
  // 分层入场：底座 → 铺装 → 建筑外壳 → 内装 → 屋顶 → 街道 → 小道具。
  const assembly = new Assembly(root);
  assembly.add(baseObj, 'base', 0, { depthScale: 1 });

  const interiorGroup = ctx.pieces.find((p) => p.name === 'interior');
  const streetGroup = ctx.pieces.find((p) => p.name === 'street');

  assembly.add(store.root, 'shell', 0.2, { spread: 0.2 });
  if (interiorGroup) assembly.add(interiorGroup, 'interior', 0.35, { spread: 0.15 });
  store.root.traverse((o) => {
    if (o.name === 'roof') assembly.add(o, 'roof', 0.4, { spread: 0.1 });
  });
  if (streetGroup) assembly.add(streetGroup, 'street', 0.3, { spread: 0.4 });

  for (const piece of ctx.pieces) {
    if (piece === baseObj || piece === store.root || piece === interiorGroup || piece === streetGroup) continue;
    assembly.add(piece, 'props', 0.5, { spread: 0.3 });
  }

  // 落位完成后合并静态几何：draw call 从 ~1700 降到几百，
  // 拖动/缩放才能真正跟手。合并必须在动画结束后做，
  // 否则会打断逐件的位移与缩放。
  let merged = false;
  const doMerge = () => {
    if (merged || !mergeEnabled) return;
    merged = true;
    mergeStaticMeshes(root, {
      // 这些子树里的网格每帧都在动（或被单独控制），不能烘焙
      excludeNames: ['auto-door', 'rain-layer', 'snow-layer'],
    });
  };
  assembly.onDone = doMerge;

  /* ---------------- 星空 ---------------- */
  const stars = buildStarfield();
  root.add(stars.mesh);

  /* ---------------- 雨相关层 ---------------- */
  // 晴/雨切换要同时处理：雨丝、屋檐滴水、玻璃雨痕、体积光锥。
  // 只关雨丝的话，晴天里玻璃上还在流雨、屋檐还在滴水，破绽很明显。
  const rainLayers: THREE.Object3D[] = [];
  for (const n of ['rain-streaks', 'drips-layer', 'glass-rain-front', 'glass-rain-side']) {
    const o = root.getObjectByName(n);
    if (o) rainLayers.push(o);
  }
  const lightCones: THREE.Object3D[] = [coneA, coneB];

  /* ---------------- 湿地面：跟随天气淡入淡出 ---------------- */
  // 反光片/积水暗斑/涟漪都在构建时登记到 ctx.wet；
  // 这里统一交给一个控制器，避免"晴天还是湿的"。
  const wet = createWet(ctx.wet);

  /* ---------------- 环境：时段 × 天气 ---------------- */
  // 收集所有需要随环境缩放的光源基线。
  // 不逐个硬编码 —— 内装和街道模块各自加灯，这里统一兜住。
  const interiorLights: { l: THREE.PointLight; base: number }[] = [];
  if (interiorGroup) {
    interiorGroup.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) {
        const pl = o as THREE.PointLight;
        interiorLights.push({ l: pl, base: pl.intensity });
      }
    });
  }
  const streetLights: { l: THREE.PointLight; base: number }[] = [];
  if (streetGroup) {
    streetGroup.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight) {
        const pl = o as THREE.PointLight;
        streetLights.push({ l: pl, base: pl.intensity });
      }
    });
  }
  // porch / doorLight 是 world 自己加的，也要算进"店铺灯光"
  const shopLights: { l: THREE.PointLight; base: number }[] = [
    { l: porch, base: porch.intensity },
    { l: doorLight, base: doorLight.intensity },
  ];

  // 这两个系数由 Environment 写入，update() 里再乘到各自的基础值上。
  // 不做"设置绝对亮度"是因为 update() 里还有门的呼吸等动态项，
  // 用系数相乘可以叠加而不互相覆盖。
  let signageScale = 1;
  let interiorScale = 1;
  let starOpacity = 1;
  let snowfallOpacity = 0;
  /** 当前地面湿度（0..1），信号灯的地面反光要用 */
  let wetness = 1;

  const environment = new Environment(
    {
      hemi,
      key: moon,
      fill,
      applySignage(v) {
        signageScale = v;
      },
      applyInterior(v) {
        interiorScale = v;
      },
      setRainDensity(v) {
        rain.setDensity(v);
        // 密度为 0 时直接隐藏整组。只把 alpha 调到 0 的话，
        // 透明物体仍然参与排序与绘制，晴天会白白多出几趟 pass；
        // 更重要的是"滴水/玻璃雨痕"这些不是靠 uOpacity 控制的，
        // 必须整组关掉才不会在晴天里继续下雨。
        const on = v > 0.02;
        for (const l of rainLayers) l.visible = on;
        for (const l of lightCones) l.visible = on;
        // 涟漪只在下雨时出现（雪天/晴天都关掉）
        wet.setRain(v);
      },
      setWetness(v) {
        wetness = v;
        wet.setWetness(v);
      },
      setStarOpacity(v) {
        starOpacity = v;
      },
      setSnowfall(v) {
        // 飘雪只跟天气走：切到下雪的第一秒就该看见雪，而不是等 12 秒积雪铺满
        snowfallOpacity = v;
      },
      setSnow(v) {
        snow.update(v);
      },
    },
    envInitLocal,
  );

  /* ---------------- 自动门 / 招牌闪烁 ---------------- */
  let doorTimer = 2.0;
  let openHold = 0;
  let doorPhase: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
  let doorProgress = 0;

  const update = (t: number, dt: number, cam: THREE.Camera) => {
    assembly.update(dt);
    environment.update(dt);
    rain.update(t, dt, cam);
    stars.update(t, cam, starOpacity);

    for (const fn of ctx.ticks) fn(t, dt);
    snowfall.update(t, snowfallOpacity);
    // 信号灯的灯光强度跟着"夜色/招牌亮度"走：白天不刺眼，夜里更亮；
    // 地面反光同时取决于湿地（晴天几乎看不见）。
    street.signal.update(t, dt, { signage: signageScale, wetness });

    // 灯光随环境缩放。
    // 用系数相乘而不是设绝对值：update() 里还有门的呼吸、招牌闪烁等
    // 动态项，相乘才能叠加而不互相覆盖。
    for (const it of interiorLights) it.l.intensity = it.base * interiorScale;
    for (const it of shopLights) it.l.intensity = it.base * interiorScale;
    for (const it of streetLights) it.l.intensity = it.base * Math.max(0.35, interiorScale);

    // 招牌呼吸 + 偶发闪烁（再乘上环境的招牌亮度系数）
    const breath = 1 + Math.sin(t * 1.25) * 0.016;
    const glitch = Math.sin(t * 43.7) > 0.9978 || Math.sin(t * 19.1) > 0.9972 ? 0.72 : 1;
    for (const f of ctx.flickers) {
      const wobble = Math.sin(t * (2.1 + f.seed) + f.seed * 3.1) * f.amp;
      f.mat.opacity = Math.max(0, (f.base + wobble) * breath * glitch * signageScale);
    }
    for (const m of store.signMats) {
      m.opacity = (0.28 + Math.sin(t * 0.6) * 0.02) * glitch * signageScale;
    }

    // 自动门：用「累计时间」驱动，不依赖单帧 dt，
    // 这样即使在低帧率的 headless 环境里节奏也一致。
    const phaseT = (t + 0) % DOOR_CYCLE;
    // 0 ~ 3.0s: 关着；3.0 ~ 5.0: 开；5.0 ~ 6.5: 开着；6.5 ~ 8.3: 关
    let target = 0;
    if (phaseT > 3.0 && phaseT < 5.0) target = (phaseT - 3.0) / 2.0;
    else if (phaseT >= 5.0 && phaseT < 6.5) target = 1;
    else if (phaseT >= 6.5 && phaseT < 8.3) target = 1 - (phaseT - 6.5) / 1.8;
    doorProgress = target;

    // 门扇滑动：两扇各向外退开。
    // 关键：滑动量必须封顶 —— 门洞右边缘到店角只差 0.45m，
    // 滑太多右扇会穿出转角玻璃，在街上看到一块悬空的玻璃板。
    const doorW = DOOR.x1 - DOOR.x0;
    const half = doorW / 2;
    const doorCX = (DOOR.x0 + DOOR.x1) / 2;
    const storeX1 = L.store.x1;
    const maxSlide = Math.min(doorW * 0.46, Math.max(0.3, storeX1 - 0.08 - (doorCX + half)));
    const slide = doorProgress * maxSlide;
    const lLeaf = store.doorL.children[0] as THREE.Object3D | undefined;
    const rLeaf = store.doorR.children[0] as THREE.Object3D | undefined;
    if (lLeaf) lLeaf.position.x = -half / 2 - slide;
    if (rLeaf) rLeaf.position.x = half / 2 + slide;

    // 门开时门口光略强
    street.doorSpill.intensity = 4.2 + doorProgress * 2.4;
  };

  void doorTimer;
  void openHold;
  void doorPhase;

  return {
    root, ctx, store, street, rain, assembly, update, environment,
    signal: street.signal,
    wet,
    setSky(zenith: number, horizon: number) {
      stars.setSky(zenith, horizon);
    },
    setMergeEnabled(on: boolean) {
      mergeEnabled = on;
    },
    doMerge,
  };
}

/** 自动门循环周期（秒），必须大于上面分段表的最大时间 */
const DOOR_CYCLE = 8.6;
