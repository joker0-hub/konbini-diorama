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
import { L } from './scene/layout';
import type { TimeOfDay, Weather } from './scene/environment';

const canvas = document.getElementById('stage') as HTMLCanvasElement;

/* ---------------- 渲染器 ---------------- */
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setClearColor(0x05070d, 1);

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
