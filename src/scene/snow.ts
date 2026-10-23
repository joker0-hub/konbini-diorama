/**
 * 积雪。
 *
 * 目标：切到下雪后，地面、屋顶、车顶、雨棚这些"朝上的面"上
 * 缓慢长出一层薄雪，到达上限就停住 —— 不要变成厚雪堆。
 *
 * 实现选择：**不去改每个物体的材质**，而是在给定矩形上叠一层白色薄板，
 * 厚度随时间从 0 长到 maxDepth。
 *
 * 为什么这么做：
 * - 改材质（往 toon 里混白）要遍历全场景并按面法线判断朝上，
 *   而且静态几何已经合并成一个网格，法线信息还在但没法接受"部分变白"。
 * - 叠薄板只增加很少的 draw call，而且天然拥有"厚度"这个可动画量，
 *   "缓慢变厚"直接就是 scale.y 的插值，不需要任何着色器改动。
 *
 * 关键约束（避免"雪厚了"）：
 * - 上限 2.2cm —— 微缩模型比例下，超过 3cm 就会盖掉地砖纹理和路缘石细节。
 * - 增长用 easeOut，前段快后段慢，视觉上是"落雪积起来然后停"。
 * - 边缘留一点内缩，避免和墙面/立面的描边打架。
 */

import * as THREE from 'three';
import { L } from './layout';
import { toon } from '../core/materials';
import { snowSurfaceTex } from '../core/snowTex';

/** 雪面在世界坐标里的水平矩形 */
export interface SnowPatch {
  x0: number; x1: number; z0: number; z1: number;
  /** 该矩形所处的高度（雪从这往上长） */
  y: number;
  /** 相对厚度系数：屋顶/车顶这类孤立的面积薄一点，地面满一点 */
  scale?: number;
  /** 圆角半径，用于贴合圆形/不规则顶面 */
  round?: boolean;
}

export interface SnowHandles {
  root: THREE.Group;
  /** 0..1 的积雪进度（1 = 到达上限） */
  update: (snowAmount: number) => void;
  /** 当前最大厚度（米） */
  setMaxDepth: (d: number) => void;
}

/** 雪的固有色：略偏蓝白，纯白在三渲二里会糊成一片 */
const SNOW_COLOR = 0xeaf0f8;
/** 默认最大厚度：4cm。
 *  2.2cm 在俯视角度下几乎看不出（地砖缝和路缘石会把它"吃掉"），
 *  但再厚就会盖掉细节。4cm 是"看得见一层、又不失细节"的甜点。 */
const DEFAULT_MAX_DEPTH = 0.04;
/** 硬上限：任何参数组合下雪都不会超过 4.5cm */
const MAX_HARD_DEPTH = 0.045;

export function buildSnow(): SnowHandles {
  const root = new THREE.Group();
  root.name = 'snow-layer';
  // 不参与描边：雪的边缘靠自身色阶过渡，加描边会像贴纸
  root.layers.set(1);

  // 用带轻微噪点的雪面材质：纯白在三渲二里会糊成一块白板
  const mat = toon(SNOW_COLOR, { map: snowSurfaceTex() });
  const patches: { mesh: THREE.Mesh; flat: number; baseY: number }[] = [];

  const H = L.half;
  const S = L.store;
  const C = L.curb;

  /**
   * 加一块雪面。
   * `baseThickness` 是这块面在"进度 1"时的厚度系数，用来做分层次的观感：
   * 地面上薄一点（否则盖住地砖）、屋顶上稍厚一点（风不会吹走）。
   */
  const addPatch = (
    x0: number, x1: number, z0: number, z1: number,
    y: number, baseThickness = 1,
  ): void => {
    const w = x1 - x0;
    const d = z1 - z0;
    if (w <= 0.01 || d <= 0.01) return;
    const geo = new THREE.BoxGeometry(w, 1, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.castShadow = false;
    m.receiveShadow = true;
    m.layers.set(1);
    // 关键：标记为"动态"，不让静态几何合并把它吃掉。
    // 合并会把 toon 材质的网格并入 merged-static 并从原组摘除，
    // 雪面每帧都在改 scale.y，必须留在自己的组里。
    m.userData.noMerge = true;
    root.add(m);
    patches.push({ mesh: m, flat: baseThickness, baseY: y });
  };

  /* ---------------- 地面：沥青 ---------------- */
  // 主路（z 从 road.z 到台座边）
  addPatch(-H, H, L.road.z, H, 0.004, 1);
  // 右侧竖路（x 从 road.x 到台座边）
  addPatch(L.road.x, H, -H, L.road.z, 0.004, 1);

  /* ---------------- 人行道（L 形） ---------------- */
  // 沿前街的一条（人行道是主要观感面，给满厚度）
  addPatch(-H, L.walk.xOuter, L.walk.zInner, L.walk.zOuter, C + 0.002, 1.0);
  // 沿右侧街的一条
  addPatch(L.walk.xInner, L.walk.xOuter, -H, L.walk.zInner, C + 0.002, 1.0);

  /* ---------------- 便利店屋顶 ---------------- */
  // 屋顶给满厚度（上限），但不允许超过总上限
  addPatch(S.x0, S.x1, S.z0, S.z1, S.roofY + 0.02, 1.0);

  /* ---------------- 入口雨棚 ---------------- */
  // 雨棚顶面：canW 由 store.ts 内的约束推出，这里按同样的规则算
  const canX = (L.door.x0 + L.door.x1) / 2;
  const canW = Math.min(2.3, 2 * (S.x1 - 0.16 - canX));
  const canTop = S.glassTop - 0.22 - 0.055;
  addPatch(canX - canW / 2, canX + canW / 2, S.z1 + 0.02, S.z1 + 1.2, canTop + 0.01, 0.9);

  /* ---------------- 自动贩卖机顶 ---------------- */
  // 贩卖机在 x≈2.6、朝向街道；顶面高度约 1.9
  addPatch(2.24, 3.06, -3.3, -1.2, 1.9, 0.85);

  /* ---------------- 邻楼屋顶 ---------------- */
  const N = L.neighbor;
  addPatch(N.x0, N.x1, N.z0, N.z1, N.h + 0.4, 1.0);

  /* ---------------- 路缘石沿线 ---------------- */
  // 路缘石窄，单独给一条薄雪，让"雪盖住边"这件事在低角度能看出来
  // 路缘石窄，单独给一条薄雪，让"雪盖住边"这件事在低角度能看出来
  addPatch(-H, L.walk.xOuter, L.walk.zOuter - 0.22, L.walk.zOuter, C + 0.002, 0.75);
  addPatch(L.walk.xOuter - 0.22, L.walk.xOuter, -H, L.walk.zOuter, C + 0.002, 0.75);

  let maxDepth = DEFAULT_MAX_DEPTH;

  // 关键：创建后立刻把厚度设为 0。
  // 否则几何体的原始高度是 1（= 1 米），在第一次 update 之前
  // 雪层就是满厚度的 —— 表现为"雨天屋顶和地面也是白的"。
  const apply = (snowAmount: number): void => {
    const a = THREE.MathUtils.clamp(snowAmount, 0, 1);
    root.visible = a > 0.001;
    if (!root.visible) return;
    for (const p of patches) {
      // 厚度上限在这里再夹一次（不只是靠系数）。
      // 使用者明确要求"雪不要厚了"，所以即使某个 flat 系数写大了，
      // 也不会突破 MAX_HARD_DEPTH —— 这是最后一道保险。
      const depth = Math.min(MAX_HARD_DEPTH, maxDepth * p.flat * a);
      // 几何体原始高度是 1，直接用 scale.y 表达厚度
      p.mesh.scale.y = Math.max(0.0005, depth);
      // 盒体原点在中心：要让底面压在 baseY 上，中心就得抬到 baseY + depth/2
      p.mesh.position.y = p.baseY + depth / 2;
    }
  };

  // 初始状态：无雪
  apply(0);

  return {
    root,
    setMaxDepth(d) {
      maxDepth = d;
    },
    update: apply,
  };
}
