/**
 * 场景组装：底座 → 便利店 → 内装 → 街道 → 雨 → 入场动画。
 */

import * as THREE from 'three';
import { group } from '../core/geom';
import { buildBase, type SceneCtx } from './base';
import { buildStore, DOOR, type StoreParts } from './store';
import { buildInterior } from './interior';
import { buildStreet, type StreetRefs } from './street';
import { buildDrips, buildLightCone, buildRain, type RainHandles } from './rain';
import { buildGlassRain } from './glass-rain';
import { Assembly } from './assembly';
import { mergeStaticMeshBatches } from './merge';
import { Environment, type EnvState } from './environment';
import { buildStarfield } from './stars';
import { buildSnow, type SnowPatch } from './snow';
import { buildSnowfall } from './snowfall';
import { createWet, type WetHandles } from './wet';
import { createWetReflection, type WetReflection } from './wet-reflection';
import type { SignalHandles } from './signal';
import { L } from './layout';

export interface World {
  root: THREE.Group;
  ctx: SceneCtx;
  store: StoreParts;
  street: StreetRefs;
  rain: RainHandles;
  assembly: Assembly;
  update: (t: number, dt: number, cam: THREE.Camera, weatherDt?: number) => void;
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
  wetReflection: WetReflection;
  /** 天空渐变（由 Environment 驱动，经 main 转发到这里） */
  setSky: (zenith: number, horizon: number) => void;
}

export function buildWorld(envInit: EnvState = { time: 'day', weather: 'clear' }): World {
  const root = new THREE.Group();
  root.name = 'diorama';
  let mergeEnabled = true;
  const envInitLocal = envInit;

  const assembly = new Assembly();
  const ctx: SceneCtx = { assembly, ticks: [], flickers: [], wet: [] };

  /* ---------------- 环境光 ---------------- */
  // 环境光的具体数值由 Environment 在构造时覆盖；
  // 初值随后由默认的「白天 + 晴」或 URL 指定的环境同步，避免首帧闪烁。
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
  /* ---------------- 各层 ---------------- */
  const { paving, markings } = buildBase(root, ctx);
  const store = buildStore(root, ctx);
  const interior = buildInterior(root, ctx);
  const street = buildStreet(root, ctx);

  /* ---------------- 雨 ---------------- */
  const rainLayer = group(root, 0, 0, 0, 'rain-layer');
  const rain = buildRain(rainLayer, { count: 3000, height: 10, area: 16 });
  rainLayer.traverse((o) => o.layers.set(1));
  const drips = buildDrips(store.fittings, ctx);
  const glassRain = buildGlassRain(store.glazing);
  ctx.ticks.push((t) => glassRain.setTime(t));
  const lightCones = [
    buildLightCone(store.entranceLight, 2.0, 2.33),
    buildLightCone(street.streetLamp, 2.4, 4.4),
  ];

  /* ---------------- 雪 ---------------- */
  // Use the actual cabinet/bin bounds before assembly moves or merges their meshes.
  const smallSnowSurfaces: SnowPatch[] = [...street.vending.map((m) => m.pickRoot), ...street.recyclingBins].map((object, i) => {
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    return { x0: bounds.min.x + 0.012, x1: bounds.max.x - 0.012,
      z0: bounds.min.z + 0.012, z1: bounds.max.z - 0.012,
      y: bounds.max.y + 0.003, scale: 0.65, kind: 'cap', name: `snow-street-cap-${i}` };
  });
  const snow = buildSnow(smallSnowSurfaces);
  root.add(snow.root);
  const snowfall = buildSnowfall(root, { count: 1800, height: 11, area: 16.4, surfaces: snow.surfaces });

  /* ---------------- 星空 ---------------- */
  const stars = buildStarfield();
  root.add(stars.mesh);

  /* ---------------- 湿地面：跟随天气淡入淡出 ---------------- */
  // 反光片/积水暗斑/涟漪都在构建时登记到 ctx.wet；
  // 这里统一交给一个控制器，避免"晴天还是湿的"。
  const wet = createWet(ctx.wet);
  const reflectionExclusions: THREE.Object3D[] = [
    rain.mesh, drips.root, ...glassRain.layers, ...lightCones, ...ctx.wet.map(({ mesh }) => mesh), markings,
  ];
  // Shelf trim is subpixel in the softened ground reflection. Keep the shop
  // fixtures and glazing in the capture and skip the small merchandise batches.
  interior.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) reflectionExclusions.push(object);
  });
  const wetReflection = createWetReflection(paving, reflectionExclusions);
  ctx.ticks.push((t) => wetReflection.setTime(t));

  /* ---------------- 环境：时段 × 天气 ---------------- */
  // Keep the light count stable while animated groups appear. Their intensities
  // stay at zero until the lighting stage, so newly visible fixtures do not
  // force Three.js to compile a different shader for every material.
  const localLights = group(root, 0, 0, 0, 'local-lights');
  const collectLights = (group: THREE.Object3D) => {
    const lights: { light: THREE.PointLight | THREE.SpotLight; base: number }[] = [];
    group.traverse((object) => {
      if (object instanceof THREE.PointLight || object instanceof THREE.SpotLight) {
        lights.push({ light: object, base: object.intensity });
      }
    });
    for (const { light } of lights) {
      localLights.attach(light);
      if (light instanceof THREE.SpotLight) localLights.attach(light.target);
    }
    return lights;
  };
  const interiorLights = collectLights(interior);
  const shopLights = collectLights(store.root);
  const streetLights = collectLights(street.root).filter(({ light }) => light !== street.signal.light);

  // 用 Environment 的插值系数缩放各灯，门开启时再微调橱窗溢光。
  let signageScale = 1;
  let interiorScale = 1;
  let starOpacity = 1;
  let snowfallOpacity = 0;
  let rainDensity = 0;
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
        rainDensity = v;
        rain.setDensity(v);
        drips.setDensity(v);
        glassRain.setDensity(v);
        street.umbrellaStand.setRain(v);
        // 涟漪只在下雨时出现（雪天/晴天都关掉）
        wet.setRain(v);
        wetReflection.setRain(v);
      },
      setWetness(v) {
        wetness = v;
        wet.setWetness(v);
        wetReflection.setWetness(v);
      },
      setStarOpacity(v) {
        starOpacity = v;
      },
      setSnowfall(v) {
        // 飘雪只跟天气走：切到下雪的第一秒就该看见雪，而不是等 12 秒积雪铺满
        snowfallOpacity = v;
      },
      setSnow(v) {
        if (assembly.finished) snow.update(v);
      },
    },
    envInitLocal,
  );
  assembly.onDone = () => {
    snow.update(environment.getSnow());
  };

  let batches: ReturnType<typeof mergeStaticMeshBatches> | undefined;
  let merged = false;
  const advanceMerge = (deadline: number) => {
    if (!assembly.finished || !mergeEnabled || merged) return;
    batches ??= mergeStaticMeshBatches(root, {
      excludeNames: ['auto-door', 'rain-layer', 'snow-layer', 'sakura-tree', 'umbrella-stand'],
    });
    // Each batch replaces its originals in the same frame. Spread vertices
    // and GPU uploads across frames so the final assembly frame stays responsive.
    do {
      merged = !!batches.next().done;
    } while (!merged && performance.now() < deadline);
  };

  /* ---------------- 自动门 / 招牌闪烁 ---------------- */
  let doorTimer = 2.0;
  let openHold = 0;
  let doorPhase: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
  let doorProgress = 0;

  const update = (t: number, dt: number, cam: THREE.Camera, weatherDt = dt) => {
    // Presentation follows elapsed time, not the physics step capped at 50 ms.
    // This keeps the opening on time even on slow GPUs.
    assembly.update(weatherDt);
    environment.update(weatherDt);
    rain.update(t, dt, cam);
    stars.update(t, starOpacity);
    street.sakura.update(t, dt, cam);

    for (const fn of ctx.ticks) fn(t, dt);
    snowfall.update(t, snowfallOpacity);
    // 信号灯的灯光强度跟着"夜色/招牌亮度"走：白天不刺眼，夜里更亮；
    // 地面反光同时取决于湿地（晴天几乎看不见）。
    street.signal.update(t, dt, { signage: signageScale, wetness });

    const lighting = assembly.lighting;
    street.signal.light.intensity *= lighting;
    const exteriorScale = THREE.MathUtils.lerp(0.18, 1, signageScale) * lighting;
    const insideScale = interiorScale * lighting;
    for (const { light, base } of interiorLights) light.intensity = base * insideScale;
    for (const { light, base } of shopLights) light.intensity = base * exteriorScale;
    for (const { light, base } of streetLights) {
      light.intensity = base * (light === street.streetLamp ? exteriorScale : insideScale);
    }
    const coneOpacity = rainDensity * THREE.MathUtils.lerp(0.008, 0.052, signageScale) * lighting;
    for (const cone of lightCones) {
      cone.visible = rainDensity > 0.02 && lighting > 0;
      cone.material.uniforms.uOpacity.value = coneOpacity;
    }

    // 招牌呼吸 + 偶发闪烁（再乘上环境的招牌亮度系数）
    const breath = 1 + Math.sin(t * 1.25) * 0.016;
    const glitch = Math.sin(t * 43.7) > 0.9978 || Math.sin(t * 19.1) > 0.9972 ? 0.72 : 1;
    for (const f of ctx.flickers) {
      const wobble = Math.sin(t * (2.1 + f.seed) + f.seed * 3.1) * f.amp;
      f.mat.opacity = Math.max(0, (f.base + wobble) * breath * glitch * signageScale * lighting);
    }
    for (const material of store.signage.halos) {
      material.opacity = (0.22 + Math.sin(t * 0.6) * 0.015) * glitch * signageScale * lighting;
    }
    const diffuser = THREE.MathUtils.lerp(0.35, THREE.MathUtils.lerp(0.58, 0.77, signageScale), lighting);
    for (const material of store.signage.prints) material.color.setScalar(diffuser);

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

    store.frontSpill.intensity *= 1 + doorProgress * 0.15;
    advanceMerge(performance.now() + 2);
  };

  void doorTimer;
  void openHold;
  void doorPhase;

  return {
    root, ctx, store, street, rain, assembly, update, environment, wetReflection,
    signal: street.signal,
    wet,
    setSky(zenith: number, horizon: number) {
      stars.setSky(zenith, horizon);
    },
    setMergeEnabled(on: boolean) {
      mergeEnabled = on;
    },
    doMerge: () => advanceMerge(Infinity),
  };
}

/** 自动门循环周期（秒），必须大于上面分段表的最大时间 */
const DOOR_CYCLE = 8.6;
