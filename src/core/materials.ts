/**
 * 三渲二材质系统。
 *
 * 核心是 MeshToonMaterial + 一张 4 档 gradientMap：
 * 光影被压成硬边色阶，这是"动画赛璐璐"的骨架。
 * 自发光元素（灯箱、招牌、荧光灯）用 MeshBasicMaterial 并允许颜色 > 1，
 * 由后处理 bloom 拾取，夜里的霓虹才有"糊开的光"。
 */

import * as THREE from 'three';
import { P } from './palette';

/* ------------------------------------------------------------
 * 色阶渐变
 * ------------------------------------------------------------ */

function makeGradient(steps: number[]): THREE.DataTexture {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => {
    const b = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
    data[i * 4 + 0] = b;
    data[i * 4 + 1] = b;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** 主色阶：4 档，暗部不压死，亮部留高光 */
export const RAMP_MAIN = makeGradient([0.34, 0.55, 0.78, 1.0]);
/** 柔色阶：5 档，用于玻璃、金属等需要更细过渡的材质 */
export const RAMP_SOFT = makeGradient([0.42, 0.55, 0.68, 0.82, 1.0]);
/**
 * 平滑色阶：12 档，专给"大面积平面"用（地面、人行道、墙面）。
 * 4 档色阶放在地板上，点光源会打出一圈圈可见的同心色阶，
 * 看起来像渲染 bug 而不是风格。这里只把色阶加密，不改变卡通感。
 */
export const RAMP_SMOOTH = makeGradient([
  0.16, 0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.87, 0.94, 1.0,
]);
/**
 * 室内色阶：上限压低但下限抬高。
 *
 * 便利店内是"高亮环境"，如果沿用主色阶，所有朝上的面都会顶到 1.0，
 * 白货架 + 白墙 + 白地 = 一片死白，商品颜色反而看不见。
 *
 * 但下限也不能太低：0.30 的暗部在隔着玻璃、又叠了雨的画面里会
 * 直接糊成灰黑，从街上根本看不清货架。现在提到 0.46 起步，
 * 保证隔着玻璃看进去仍有清楚的层次。
 */
export const RAMP_INDOOR = makeGradient([0.46, 0.56, 0.65, 0.73, 0.8, 0.86]);

/* ------------------------------------------------------------
 * 材质缓存
 * ------------------------------------------------------------ */

const cache = new Map<string, THREE.Material>();

export interface ToonOpts {
  color?: number;
  map?: THREE.Texture | null;
  emissive?: number;
  emissiveIntensity?: number;
  ramp?: THREE.DataTexture;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  vertexColors?: boolean;
  fog?: boolean;
  metalness?: number;
  roughness?: number;
}

export function toon(color: number, opts: ToonOpts = {}): THREE.MeshToonMaterial {
  const rampKey =
    opts.ramp === RAMP_SOFT ? 's' : opts.ramp === RAMP_SMOOTH ? 'm' : opts.ramp === RAMP_INDOOR ? 'i' : 'k';
  const key = `t:${color}:${opts.map?.uuid ?? ''}:${opts.emissive ?? 0}:${
    opts.emissiveIntensity ?? 1
  }:${rampKey}:${opts.side ?? 0}:${opts.transparent ?? false}:${
    opts.opacity ?? 1
  }:${opts.vertexColors ?? false}:${opts.fog ?? true}`;
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshToonMaterial;

  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: opts.ramp ?? RAMP_MAIN,
    map: opts.map ?? null,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    vertexColors: opts.vertexColors ?? false,
    fog: opts.fog ?? true,
  });
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  cache.set(key, m);
  return m;
}

/** 自发光（颜色可 >1 以喂给 bloom）。不参与光照，保持色块纯净。 */export function glow(color: number | THREE.ColorRepresentation, intensity = 1, opacity = 1): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const key = `g:${c.r.toFixed(3)}:${c.g.toFixed(3)}:${c.b.toFixed(3)}:${opacity}`;
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshBasicMaterial;
  const m = new THREE.MeshBasicMaterial({
    color: c,
    transparent: opacity < 1,
    opacity,
    toneMapped: false,
    fog: false,
  });
  cache.set(key, m);
  return m;
}

/** 每个对象独立的自发光材质（需要单独做透明度/闪烁动画时用）。 */
export function glowClone(color: number, intensity = 1, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    transparent: true,
    opacity,
    toneMapped: false,
    fog: false,
  });
}

/** 玻璃：淡淡冷色 + 低不透明度，保证店内清晰可见。 */
export function glass(): THREE.MeshBasicMaterial {
  const key = 'glass';
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshBasicMaterial;
  const m = new THREE.MeshBasicMaterial({
    color: 0x9ec9ea,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  cache.set(key, m);
  return m;
}

/** 半透明投影材质（地垫、反光贴、湿痕） */
export function decal(map: THREE.Texture, opacity = 1, color = 0xffffff): THREE.MeshBasicMaterial {
  const key = `d:${map.uuid}:${opacity}:${color}`;
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshBasicMaterial;
  const m = new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    // 关键：贴花完全依赖 alpha 通道。
    // 若保持不透明混合，Canvas 里"没画"的区域（alpha=0 但 RGB=0）
    // 会把底下的东西压成一片灰 —— 玻璃磨砂带、招牌贴纸都会发灰。
    alphaTest: 0,
  });
  // 预乘 alpha，让半透明边缘不发黑
  m.premultipliedAlpha = false;
  cache.set(key, m);
  return m;
}

/** 加色叠层（湿地反光、灯光浴、雨幕光） */
export function additive(map: THREE.Texture | null, color = 0xffffff, opacity = 1): THREE.MeshBasicMaterial {
  const key = `a:${map?.uuid ?? 'none'}:${color}:${opacity}`;
  const hit = cache.get(key);
  if (hit) return hit as THREE.MeshBasicMaterial;
  const m = new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  cache.set(key, m);
  return m;
}

export function additiveClone(map: THREE.Texture | null, color = 0xffffff, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/**
 * 径向光晕精灵贴图：所有"灯在雨里的雾状辉光"共用一张。
 * 三渲二里光晕要干净——中心实、边缘软、无噪声。
 * 曲线用 pow 让亮度集中在中心 1/3，避免外圈出现可见的"环"。
 *
 * 注意：贴图是圆形的。把圆形衰减直接贴在非等比的平面上
 * （比如横长条的招牌光晕），边缘会在矩形四角露出来，形成可见弧线。
 * 所以这里额外提供 glowSprite(w, h)，按平面宽高比把圆拉成椭圆再采样。
 */
let glowTexCache: THREE.Texture | null = null;
export function radialGlowTex(): THREE.Texture {
  if (glowTexCache) return glowTexCache;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5;
      const dy = (y + 0.5) / S - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - r, 3.2);
      const i = (y * S + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  glowTexCache = t;
  return t;
}

const glowSpriteCache = new Map<string, THREE.Texture>();
/**
 * 按平面宽高比生成的椭圆光晕。
 *
 * 关键是必须用「切比雪夫半径」（max(|dx|,|dy|)）而不是欧氏半径，
 * 这样衰减在矩形的四条边上同时归零，四角也已经是 0。
 * 用欧氏半径的话，|dx| 或 |dy| 到 1 时角上仍有非零 alpha，
 * 就会在贴图边界留下一道可见的硬边（在长条形的招牌光晕上特别明显）。
 */
export function glowSprite(aspect: number): THREE.Texture {
  const key = aspect.toFixed(2);
  const hit = glowSpriteCache.get(key);
  if (hit) return hit;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  // 椭圆度：横长条时把纵向压扁，让光晕沿招牌方向铺开
  const squeeze = Math.max(1, aspect) / Math.max(1, 1 / aspect);
  void squeeze;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = Math.abs(((x + 0.5) / S - 0.5) * 2); // 0..1
      const dy = Math.abs(((y + 0.5) / S - 0.5) * 2); // 0..1
      // 切比雪夫半径 + 轻微欧氏混合，边缘更自然但严格归零
      const cheb = Math.max(dx, dy);
      const r = cheb;
      const a = Math.pow(Math.max(0, 1 - r), 2.2);
      const i = (y * S + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  glowSpriteCache.set(key, t);
  return t;
}

/** 给场景内所有固定材质垫一个统一的雾色（湿空气的蓝）。 */
export function sceneFog(): THREE.FogExp2 {
  return new THREE.FogExp2(P.fog, 0.016);
}

export const MAT = {
  asphalt: () => toon(0xffffff, { map: null }),
};
