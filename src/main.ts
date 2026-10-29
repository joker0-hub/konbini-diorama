/** 入口：可拖拽查看的微缩模型，樱花树可点击打开四项环境参数。 */

import './style.css';
import * as THREE from 'three';
import { buildWorld } from './scene/world';
import { createCameraRig } from './render/camera';
import { createPipeline } from './render/pipeline';
import { createSakuraPanel } from './ui/sakura-panel';
import { createEnvUI } from './ui/envbar';
import { createCodeOpening } from './ui/intro';
import { P } from './core/palette';
import { applyTextureQuality } from './core/textures';
import { L } from './scene/layout';
import type { TimeOfDay, Weather } from './scene/environment';

const canvas = document.getElementById('stage') as HTMLCanvasElement;

/* ---------------- 渲染器 ---------------- */
// antialias 开着对"直接渲到屏幕"有用；本项目走 RT + 后处理，
// 真正决定几何边缘质量的是 pipeline 里那个 RT 的 samples（MSAA）。
// 两处都开，默认帧缓冲那条路径（例如调试）也能受益。
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
});
/**
 * 渲染像素比 —— 远景摩尔纹的根治点。
 *
 * 实测结论（1200×800 视口下把 pixelRatio 从 1 提到 2）：
 * 屋顶/墙面/地砖上的网格状条纹几乎完全消失。
 * 说明这类"摩尔纹"本质是**采样密度不足**，不是纹理过滤的问题：
 * 地砖缝、砖墙线这些 1~3px 级的高频细节，在 1 个渲染像素要覆盖
 * 一大片纹理时，无论 aniso 和 mipmap 怎么配都会走样成波纹。
 *
 * 所以策略从"跟随设备像素比"改成"保证最低采样密度"：
 *   - 设备像素比 >= 2（高 DPI 屏）：直接用设备的，不再人为削到 1.75
 *   - 设备像素比 = 1（普通屏）：超采样到 2 倍，用带宽换清晰度
 * 上限定 2 是因为再往上收益递减、显存与填充率开销陡增。
 */
const MAX_PIXEL_RATIO = 2;
/** 渲染分辨率的下限倍率：低于它就会出现可见摩尔纹 */
const MIN_PIXEL_RATIO = 2;
function currentPixelRatio(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(Math.max(dpr, MIN_PIXEL_RATIO), MAX_PIXEL_RATIO);
}
renderer.setPixelRatio(currentPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x05070d, 1);

// 纹理各向异性必须等 renderer 建好才知道上限（本机 16）。
// 这一步会把已创建的纹理全部抬到上限，远景的斜视平面才不会被采成波纹。
applyTextureQuality(renderer);

/* ---------------- 场景 ---------------- */
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0b1120, 0.018);
void P;

/**
 * 初始环境由 URL 参数决定：
 *   ?time=day|dusk|night   ?weather=clear|rain|snow
 * 缺省为「白天 + 雨」—— 雨里亮着灯的便利店，是这组石膏微缩模型的主场景。
 * 加 &instant=1 可让积雪/过渡立刻到位（截图与自动化测试用）。
 */
function readEnvFromUrl(): { time: TimeOfDay; weather: Weather; instant: boolean; intro: boolean } {
  const q = new URLSearchParams(location.search);
  const t = q.get('time');
  const w = q.get('weather');
  const time: TimeOfDay = t === 'day' || t === 'dusk' || t === 'night' ? t : 'day';
  const weather: Weather = w === 'clear' || w === 'rain' || w === 'snow' ? w : 'rain';
  return {
    time,
    weather,
    instant: q.get('instant') === '1',
    // ?intro=0 只跳过开场字幕，不影响模型的入场组装
    intro: q.get('intro') !== '0',
  };
}
const envInit = readEnvFromUrl();

const world = buildWorld({ time: envInit.time, weather: envInit.weather });
scene.add(world.root);
// ?instant=1：把过渡与积雪一次性推到终态（截图 / 自动化测试用）
if (envInit.instant) world.environment.set({}, true);

/* ---------------- 相机 ---------------- */
const rig = createCameraRig(canvas);
const camera = rig.camera;
// 层 0 = 实体（参与深度描边）；层 1 = 玻璃 / 雨 / 辉光 / 贴花（不参与描边）；
// 层 2 = 密集小面片（樱花花簇、落樱、地面花瓣）—— 正常着色，
// 但不参与描边用的深度 pass，否则几千片花瓣会被逐片描上黑边。
camera.layers.enable(1);
camera.layers.enable(2);

/* ---------------- 后处理管线 ---------------- */
const pipeline = createPipeline(renderer, scene, camera);

// 环境要同时驱动灯光（world 内）与雾/背景/后处理（这里）。
// 管线建好后把渲染侧引用交进去，并立刻按当前预设刷一次。
world.environment.bindRender({
  fog: scene.fog as THREE.FogExp2,
  renderer,
  setSky: (zenith, horizon) => world.setSky(zenith, horizon),
  pipeline,
});

/* ---------------- 尺寸 ---------------- */
/**
 * 兜底：2 倍像素比的填充率是 1 倍的 4 倍。
 * 在小视口（本机实测 2400×1600 仍有 100 FPS）完全没问题，
 * 但超宽屏 / 集成显卡上可能吃不消。
 *
 * 做法是「先按最高质量跑，跑不动再退一档」：
 * 连续 45 帧平均超过 28ms（约 36 FPS）就把像素比降一级，最低 1x。
 * 只在性能真的不够时降级，正常设备始终享受满清晰度，不会出现
 * 因为固定低倍率而在任何位置都能看到摩尔纹的情况。
 */
let pixelRatioLevel = currentPixelRatio();
let frameBudget = 0;
let frameCount = 0;
let downgraded = false;

function applyPixelRatio(pr: number): void {
  pixelRatioLevel = pr;
  renderer.setPixelRatio(pr);
  resize();
}

function watchFrameBudget(dtMs: number): void {
  if (downgraded || pixelRatioLevel <= 1.01) return;
  frameBudget += dtMs;
  frameCount++;
  if (frameCount < 45) return;
  const avg = frameBudget / frameCount;
  frameBudget = 0;
  frameCount = 0;
  if (avg > 28) {
    // 退一档，但不低于 1x（再低摩尔纹就会回来）
    const next = Math.max(1, +(pixelRatioLevel - 0.5).toFixed(1));
    if (next < pixelRatioLevel) {
      applyPixelRatio(next);
    }
    if (pixelRatioLevel <= 1.01) downgraded = true;
  }
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  const pr = renderer.getPixelRatio();
  pipeline.setSize(w * pr, h * pr);
}
window.addEventListener('resize', resize);
// 监听像素比本身的变化（拖窗口到另一屏时不一定触发 resize）
if (window.matchMedia) {
  const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mq.addEventListener?.('change', () => resize(), { once: false });
}
resize();

/* ---------------- 底部环境切换条 ---------------- */
// UI 只发指令、不自己改高亮；高亮统一由 environment.onChange 回灌，
// 这样从控制台或 URL 改动时界面也不会和真实状态脱节。
const envUI = createEnvUI(
  document.body,
  () => world.environment.get(),
  (patch) => world.environment.set(patch),
);
const unsubscribeEnvUI = world.environment.onChange((s) => envUI.setState(s));
// 页面销毁时解绑（单页应用里无实际意义，但避免热更新时重复订阅）
window.addEventListener('beforeunload', () => unsubscribeEnvUI());

/* ---------------- 代码开场动画 ---------------- */
// 一段"正在编译这个场景"的脚本先敲出来，敲完后两扇门滑开，
// 露出背后已经组装到一半的模型。纯代码生成，没有任何图片/视频资源。
// ?intro=0 或 ?instant=1 时直接跳过（截图与自动化测试用）。
const opening = createCodeOpening({
  disabled:
    !envInit.intro ||
    envInit.instant ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  time: envInit.time,
  weather: envInit.weather,
});

/* ---------------- 樱花树参数面板 ---------------- */
// 面板只通过点击樱花树打开；右上角按钮负责收起。
const sakuraPanel = createSakuraPanel(document.body, (patch) => world.street.sakura.setParameters(patch));
const sakuraRaycaster = new THREE.Raycaster();
const sakuraPointer = new THREE.Vector2();
let sakuraPointerStart: { x: number; y: number } | null = null;

canvas.addEventListener('pointerdown', (event) => {
  sakuraPointerStart = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
});
canvas.addEventListener('pointerup', (event) => {
  const start = sakuraPointerStart;
  sakuraPointerStart = null;
  if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;

  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  sakuraPointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  sakuraRaycaster.setFromCamera(sakuraPointer, camera);
  if (sakuraRaycaster.intersectObject(world.street.sakura.pickRoot, true).length > 0) {
    sakuraPanel.setOpen(true);
  }
});
canvas.addEventListener('pointercancel', () => { sakuraPointerStart = null; });
window.addEventListener('beforeunload', () => sakuraPanel.destroy());

/* ---------------- 主循环 ---------------- */
const clock = new THREE.Clock();
let elapsed = 0;

function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  rig.update(dt);
  world.update(elapsed, dt, camera);
  pipeline.render(elapsed, dt);
  // 帧率守卫：只有真的跑不动才退档，正常设备一直保持最高清晰度
  watchFrameBudget(dt * 1000);
  requestAnimationFrame(frame);
}

renderer.compile(scene, camera);
requestAnimationFrame(frame);

/* ---------------- 调试接口 ---------------- */
declare global {
  interface Window {
    __konbini?: {
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      controls: typeof rig.controls;
      world: typeof world;
      renderer: THREE.WebGLRenderer;
      pipeline: typeof pipeline;
      skipIntro: () => void;
      /** 只跳过代码开场字幕，保留模型的入场组装动画 */
      skipOpening: () => void;
      view: (pos: [number, number, number], target: [number, number, number]) => void;
      replay: () => void;
      spin: (on: boolean) => void;
      stats: () => Record<string, number>;
      /** 总平面常量，供调试/检查脚本读取（避免脚本里重复硬编码尺寸） */
      layout: typeof L;
      /** 环境：时段 × 天气（两个维度独立） */
      env: {
        get: () => { time: string; weather: string };
        set: (
          o: { time?: 'day' | 'dusk' | 'night'; weather?: 'clear' | 'rain' | 'snow' },
          instant?: boolean,
        ) => void;
        cycleTime: () => { time: string; weather: string };
        toggleWeather: () => { time: string; weather: string };
        /** 当前积雪量 0..1 */
        getSnow: () => number;
        /** 合成后的实时参数（雨量/雪量/星空/湿度等），供自动测试断言 */
        details: () => ReturnType<typeof world.environment.details>;
      };
      /** 街角信号灯：可在控制台读取当前相位 */
      signal: typeof world.signal;
    };
  }
}

window.__konbini = {
  scene,
  camera,
  controls: rig.controls,
  world,
  renderer,
  pipeline,
  layout: L,
  env: {
    get: () => world.environment.get(),
    set: (o, instant) => world.environment.set(o, instant),
    cycleTime: () => world.environment.cycleTime(),
    toggleWeather: () => world.environment.toggleWeather(),
    getSnow: () => world.environment.getSnow(),
    details: () => world.environment.details(),
  },
  signal: world.signal,
  skipIntro: () => {
    opening.skip();
    world.assembly.finishNow();
  },
  skipOpening: () => opening.skip(),
  view: (pos, target) => {
    camera.position.set(pos[0], pos[1], pos[2]);
    rig.controls.target.set(target[0], target[1], target[2]);
    rig.controls.update();
  },
  replay: () => location.reload(),
  spin: (on) => {
    rig.controls.autoRotate = on;
    rig.controls.autoRotateSpeed = 0.5;
  },
  stats: () => {
    // 报"场景本身"的统计。renderer.info.render 会被最后一趟全屏 quad 覆盖，
    // pipeline 在渲完场景时把真实数字存进了 sceneStats。
    const r = renderer.info;
    return {
      calls: pipeline.sceneStats.calls,
      triangles: pipeline.sceneStats.triangles,
      geometries: r.memory.geometries,
      textures: r.memory.textures,
      programs: r.programs?.length ?? 0,
    };
  },
};
