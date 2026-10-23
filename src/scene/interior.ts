/**
 * 便利店内装。
 *
 * ── 平面图（俯视，x 向右，z 向下 = 靠近店门）────────────────────────
 *
 *   z=-6.4 ┌─────────┬──────────┬─────────┬──────┐
 *          │ 饮料冷柜 │ 零食/杯面 │ 便当柜   │ 后场门│   ← 后墙
 *          ├─────────┴──────────┴─────────┴──────┤
 *          │ 杂志架                      ┌──────┐│
 *          │  ATM                        │ 烟柜 ││
 *   x=-5.2 │ 储物架        ┌───┐┌───┐    │      ││ x=2.15
 *          │              │货 ││货 │    │ 收银 ││
 *          │              │架 ││架 │    │ 台   ││
 *          │        ┌───┐ └───┘└───┘    │      ││
 *          │ 矮货架  │货 │               └──────┘│
 *   z=+0.7 └─────────┴───┴───────┬───────────────┘
 *                                 │ 自动门（前脸）
 *
 * 左墙通道：中央货架整体向右让 0.4m，留出约 0.86m 的通道，
 * 从街上能看见杂志架 / ATM；自由货架（gondola-1..3 / low-gondola）都带名字，
 * 方便脚本断言"没有挡住左侧"。
 *
 * 硬约束：所有实体的包围盒必须落在
 *   x ∈ [X0, X1]、z ∈ [Z0, Z1]
 * 之内。越界就会从玻璃里伸出去 —— 这是本项目最容易犯的错，
 * scripts/check-poke.mjs 会用 world 矩阵做包围盒检查来兜住它。
 */

import * as THREE from 'three';
import { P } from '../core/palette';
import { addBox, addCyl, addFlat, addMesh, group, noOutline, planeGeo } from '../core/geom';
import { additiveClone, decal, glow, radialGlowTex, toon as toonBase, RAMP_INDOOR } from '../core/materials';
import { ProductField, type ProductKind } from '../core/products';
import * as TX from '../core/textures';
import { L } from './layout';
import type { SceneCtx } from './base';

const S = L.store;

/** 店内所有不透明材质统一走 RAMP_INDOOR，避免漏掉个别漏网之鱼。 */
const toon = (color: number, opts: Parameters<typeof toonBase>[1] = {}) =>
  toonBase(color, { ramp: RAMP_INDOOR, ...opts });

/** 店内可用空间（从 layout 推导，绝不硬编码） */
const IN = {
  x0: S.x0 + 0.2,
  x1: S.x1 - 0.08,
  z0: S.z0 + 0.2,
  z1: S.z1 - 0.08,
};

export function buildInterior(root: THREE.Object3D, ctx: SceneCtx): void {
  const FY = S.floorY;
  const X0 = IN.x0;
  const X1 = IN.x1;
  const Z0 = IN.z0;
  const Z1 = IN.z1;

  const g = group(root, 0, 0, 0, 'interior');
  const products = new ProductField();

  const white = toon(P.shelfWhite);
  const metal = toon(P.shelfMetal);
  const dark = toon(0x2a303a);
  const cream = toon(P.storeCream);

  /* ================= 天花灯箱 ================= */
  const panelMat = glow(0xfffdf2, 1.0);
  const panelW = X1 - X0 - 1.2;
  const panelCX = (X0 + X1) / 2 - 0.15;
  for (const z of [-5.9, -4.3, -2.7, -1.1]) {
    addBox(g, toon(0xb9bec6), panelW + 0.14, 0.06, 0.42, panelCX, S.ceilY - 0.14, z, { cast: false, receive: false });
    addBox(g, panelMat, panelW, 0.03, 0.28, panelCX, S.ceilY - 0.1, z, { cast: false, receive: false });
    for (let i = 0; i < 4; i++) {
      addBox(g, toon(0xb9bec6), 0.035, 0.04, 0.3,
        panelCX - panelW / 2 + (panelW * (i + 0.5)) / 4, S.ceilY - 0.105, z, { cast: false, receive: false });
    }
  }
  addBox(g, glow(0xfff6e4, 0.16), X1 - X0 - 0.3, 0.02, Z1 - Z0 - 0.3,
    (X0 + X1) / 2, S.ceilY - 0.035, (Z0 + Z1) / 2, { cast: false, receive: false });

  // 轨道射灯
  for (const z of [-4.9, -3.1, -1.3]) {
    addBox(g, dark, X1 - X0 - 1.6, 0.03, 0.045, panelCX, S.ceilY - 0.16, z, { cast: false });
    for (let i = 0; i < 3; i++) {
      const x = X0 + 1.0 + i * 1.9;
      addCyl(g, dark, 0.045, 0.055, 0.14, x, S.ceilY - 0.3, z, { seg: 8 });
      addMesh(g, new THREE.CylinderGeometry(0.04, 0.04, 0.014, 8), glow(0xfff1cc, 1.2), x, S.ceilY - 0.31, z).castShadow = false;
    }
  }

  /* ================= 室内光源 ================= */
  // 点光源会叠加：10 盏 intensity=2 会把浅色货架推过 1.0，
  // toon 色阶全落在最高档，商品颜色被冲成白色。只用 3 盏 + 1 盏冷色补光。
  const lights: [number, number, number, number][] = [
    [-3.6, 1.9, -4.6, 2.6], // 后场（冷柜侧）
    [-1.0, 2.2, -2.0, 2.4], // 中段（货架）
    [1.0, 1.9, 0.0, 2.2],   // 前区（收银/门口）
  ];
  for (const [x, y, z, i] of lights) {
    const l = new THREE.PointLight(0xfff2da, i, 9.5, 1.7);
    l.position.set(x, y, z);
    g.add(l);
  }
  const coolFill = new THREE.PointLight(0xcfe6ff, 1.4, 5.0, 2);
  coolFill.position.set(-4.0, 1.4, -5.6);
  g.add(coolFill);

  /* ================= 后墙：饮料冷柜 ================= */
  {
    const cX0 = X0;
    const cX1 = X0 + 2.3;
    const cZ = Z0 + 0.4;
    const cH = 2.24;
    const cg = group(g, 0, 0, 0, 'drinks-cooler');
    addBox(cg, dark, cX1 - cX0, cH, 0.76, (cX0 + cX1) / 2, FY, cZ);
    addBox(cg, glow(0xe8f6ff, 0.8), cX1 - cX0 - 0.14, cH - 0.36, 0.04,
      (cX0 + cX1) / 2, FY + 0.12, cZ + 0.29, { cast: false });
    for (let i = 0; i < 5; i++) {
      addBox(cg, toon(0xb4c2d0), cX1 - cX0 - 0.18, 0.02, 0.5,
        (cX0 + cX1) / 2, FY + 0.34 + i * 0.37, cZ + 0.02, { cast: false });
    }
    const perRow = Math.floor((cX1 - cX0 - 0.22) / 0.1);
    for (let r = 0; r < 5; r++) {
      // 最底层放一排罐装饮料，上面四层是瓶装；罐/瓶各有自己的标签包装。
      const kind: ProductKind = r === 0 ? 'can' : 'bottle';
      const dims = kind === 'can'
        ? { w: 0.075, h: 0.16, d: 0.075 }
        : { w: 0.077, h: 0.26, d: 0.077 };
      products.row(kind, {
        x0: cX0 + 0.16, count: perRow, step: 0.1,
        y: FY + 0.36 + r * 0.37, z: cZ - 0.03,
        w: dims.w, h: dims.h, d: dims.d, texOffset: r * 2,
      });
    }
    for (let i = 0; i <= 3; i++) {
      addBox(cg, toon(0x363e4a), 0.065, cH - 0.24, 0.075, cX0 + (cX1 - cX0) * (i / 3), FY + 0.12, cZ + 0.35);
    }
    for (let i = 0; i < 3; i++) {
      const dw = (cX1 - cX0) / 3;
      const x = cX0 + dw * (i + 0.5);
      const pane = new THREE.Mesh(planeGeo(dw - 0.1, cH - 0.36),
        toon(0xcfe8ff, { transparent: true, opacity: 0.13, side: THREE.DoubleSide }));
      pane.position.set(x, FY + cH / 2, cZ + 0.37);
      pane.renderOrder = 3;
      cg.add(pane);
      noOutline(pane);
      addBox(cg, toon(0x969da6), 0.026, 0.44, 0.038, x + dw / 2 - 0.1, FY + 0.92, cZ + 0.385);
    }
    const strip = new THREE.Mesh(planeGeo(cX1 - cX0, 0.15), decal(TX.popStripTex(), 0.95));
    strip.position.set((cX0 + cX1) / 2, FY + cH + 0.09, cZ + 0.36);
    cg.add(strip);
    noOutline(strip);
    // 冷柜溢光：宽度必须收在墙面以内。
    // 之前比柜体宽 1.4m，左侧直接伸进巷子里，从外面能看到一块发光的板。
    const spill = new THREE.Mesh(planeGeo(cX1 - cX0, 2.4), additiveClone(radialGlowTex(), 0xa9d8ff, 0.18));
    spill.position.set((cX0 + cX1) / 2, FY + 1.12, cZ + 0.5);
    cg.add(spill);
    noOutline(spill);
  }

  /* ================= 后墙：零食 / 杯面墙架 ================= */
  buildWallShelf(g, products, {
    x0: X0 + 2.4, x1: X0 + 4.6, z: Z0 + 0.3, y: FY, h: 2.1, depth: 0.5, tiers: 5,
    kind: 'box', tierKinds: ['box', 'chips', 'box', 'cup', 'box'],
    cols: 11, w: 0.14, hh: 0.22, d: 0.14, width: white,
  });

  /* ================= 后墙：饭团 / 便当柜 ================= */
  {
    const bx0 = X0 + 4.85;
    const bx1 = X1 - 1.15;
    const bz = Z0 + 0.36;
    const bg = group(g, 0, 0, 0, 'bento-case');
    addBox(bg, toon(0xdfe5e9), bx1 - bx0, 1.72, 0.64, (bx0 + bx1) / 2, FY, bz, { r: 0.02 });
    addBox(bg, glow(0xf4fcff, 0.72), bx1 - bx0 - 0.1, 1.46, 0.03, (bx0 + bx1) / 2, FY + 0.16, bz + 0.3, { cast: false });
    for (let i = 0; i < 4; i++) {
      addBox(bg, toon(0xa6b2be), bx1 - bx0 - 0.12, 0.02, 0.48, (bx0 + bx1) / 2, FY + 0.26 + i * 0.33, bz + 0.06, { cast: false });
    }
    for (let r = 0; r < 4; r++) {
      const n = Math.max(3, Math.floor((bx1 - bx0 - 0.2) / 0.185));
      products.row('box', {
        x0: bx0 + 0.14, count: n, step: 0.185,
        y: FY + 0.28 + r * 0.33, z: bz + 0.14,
        w: 0.145, h: 0.14, d: 0.125, texOffset: r * 3 + 9,
      });
    }
    const pop = new THREE.Mesh(planeGeo(bx1 - bx0, 0.3), decal(TX.popStripTex(), 0.96));
    pop.position.set((bx0 + bx1) / 2, FY + 1.86, bz + 0.33);
    bg.add(pop);
    noOutline(pop);
    addBox(bg, toon(0x2f6bd8), bx1 - bx0 - 0.02, 0.085, 0.028, (bx0 + bx1) / 2, FY + 1.72, bz + 0.33, { cast: false });
    addBox(bg, toon(0xb2b8c0), (bx1 - bx0) / 2 - 0.06, 0.48, 0.34, bx0 + (bx1 - bx0) / 4, FY, bz - 0.12);
    addBox(bg, toon(0xa4aab3), (bx1 - bx0) / 2 - 0.06, 0.48, 0.34, bx1 - (bx1 - bx0) / 4, FY, bz - 0.12);
  }

  /* ================= 后墙：后场门 ================= */
  {
    const dx = (X0 + 4.85 + X1 - 1.15) / 2 + (X1 - 1.15 - (X0 + 4.85)) / 2 + 0.6;
    const doorX = Math.min(X1 - 0.45, X1 - 0.32);
    void dx;
    const dz = Z0 + 0.03;
    addBox(g, toon(0xc9ced4), 0.82, 2.1, 0.075, doorX, FY, dz);
    addBox(g, toon(0x9db2c6), 0.24, 0.5, 0.02, doorX, FY + 1.38, dz + 0.05, { cast: false });
    addBox(g, toon(0x363d4a), 0.28, 0.4, 0.02, doorX, FY + 0.42, dz + 0.05, { cast: false });
    addBox(g, toon(0xb4b9c1), 0.05, 0.17, 0.045, doorX + 0.33, FY + 1.02, dz + 0.075);
    addBox(g, toon(0xf0eee4), 0.38, 0.19, 0.02, doorX, FY + 2.22, dz + 0.03, { cast: false });
    addBox(g, toon(0xd2452f), 0.38, 0.042, 0.024, doorX, FY + 2.38, dz + 0.03, { cast: false });
    addBox(g, toon(0x2a303a), 0.14, 0.2, 0.05, doorX - 0.54, FY + 1.36, dz + 0.06);
  }

  /* ================= 左墙：杂志架 ================= */
  {
    const mx = X0 + 0.29;
    const mz0 = Z0 + 0.35;
    const mz1 = Z0 + 2.9;
    const rack = group(g, 0, 0, 0, 'magazine-rack');
    addBox(rack, toon(0xd9d6cd), 0.56, 1.38, mz1 - mz0, mx, FY, (mz0 + mz1) / 2);
    for (let i = 0; i < 3; i++) {
      const face = new THREE.Mesh(planeGeo(mz1 - mz0 - 0.1, 0.35), decal(TX.magazineTex(i), 1));
      face.position.set(mx + 0.29, FY + 0.34 + i * 0.41, (mz0 + mz1) / 2);
      face.rotation.y = Math.PI / 2;
      rack.add(face);
      noOutline(face);
      addBox(rack, toon(0x8d949c), 0.05, 0.028, mz1 - mz0, mx + 0.3, FY + 0.17 + i * 0.41, (mz0 + mz1) / 2, { cast: false });
    }
    addBox(rack, glow(0xfff4dc, 1.1), 0.045, 0.045, mz1 - mz0 - 0.1, mx + 0.23, FY + 1.4, (mz0 + mz1) / 2, { cast: false });
    addBox(rack, toon(0x2f6bd8), 0.58, 0.22, mz1 - mz0, mx, FY + 1.38, (mz0 + mz1) / 2, { cast: false });
  }

  /* ================= 左墙：ATM ================= */
  {
    const ax = X0 + 0.38;
    const az = Z0 + 3.9;
    addBox(g, toon(0x3a424d), 0.66, 1.62, 0.9, ax, FY, az);
    addBox(g, toon(0x292f39), 0.045, 1.2, 0.78, ax + 0.34, FY + 0.2, az, { cast: false });
    addMesh(g, planeGeo(0.32, 0.24), glow(0x6fd2ff, 1.2), ax + 0.37, FY + 1.2, az, { ry: Math.PI / 2 }).castShadow = false;
    addBox(g, toon(0x6b7280), 0.055, 0.28, 0.5, ax + 0.39, FY + 0.72, az);
    addBox(g, glow(0x59e0ff, 0.85), 0.028, 0.09, 0.34, ax + 0.37, FY + 1.46, az, { cast: false });
    addBox(g, glow(0xdfefff, 0.9), 0.68, 0.035, 0.92, ax, FY + 1.66, az, { cast: false });
  }

  /* ================= 左墙：储物架 ================= */
  {
    const lx = X0 + 0.26;
    const lz = Z0 + 5.3;
    for (let i = 0; i < 2; i++) {
      addBox(g, toon(0x8d949c), 0.44, 1.78, 0.44, lx, FY, lz + i * 0.5);
      addBox(g, toon(0x363d4a), 0.02, 0.055, 0.18, lx + 0.23, FY + 1.3, lz + i * 0.5, { cast: false });
      addBox(g, toon(0x363d4a), 0.02, 0.055, 0.18, lx + 0.23, FY + 1.5, lz + i * 0.5, { cast: false });
    }
  }

  /* ================= 中央双面货架 ================= */
  // 整体向右让 0.4m：左侧墙边让出更宽的通道，从街上能看见杂志架 / ATM，
  // 而不是被第一排货架挡死。这个偏移只影响自由货架，后墙挂架不动。
  const GONDOLA_SHIFT = 0.4;
  buildGondola(g, products, { name: 'gondola-1', x0: X0 + 0.75 + GONDOLA_SHIFT, x1: X0 + 1.45 + GONDOLA_SHIFT, z0: Z0 + 1.5, z1: Z0 + 4.0, y: FY, h: 1.42 });
  buildGondola(g, products, { name: 'gondola-2', x0: X0 + 2.05 + GONDOLA_SHIFT, x1: X0 + 2.75 + GONDOLA_SHIFT, z0: Z0 + 1.5, z1: Z0 + 4.0, y: FY, h: 1.42 });
  buildGondola(g, products, { name: 'gondola-3', x0: X0 + 3.35 + GONDOLA_SHIFT, x1: X0 + 4.05 + GONDOLA_SHIFT, z0: Z0 + 1.5, z1: Z0 + 3.7, y: FY, h: 1.42 });

  /* ================= 面向玻璃的矮货架 ================= */
  // 只占前窗左半段，给收银台让出视线。
  // 整块的 z 必须留在 Z1 以内，否则会从正面玻璃伸出去。
  buildLowGondola(g, products, { name: 'low-gondola', x0: X0 + 0.4 + GONDOLA_SHIFT, x1: X0 + 2.35 + GONDOLA_SHIFT, z0: Z1 - 0.66, z1: Z1 - 0.2, y: FY, h: 0.95 });

  /* ================= 收银台（横在前窗后方） ================= */
  buildCounter(g, products);

  /* ================= 地面导视 ================= */
  {
    const doorCX = (L.door.x0 + L.door.x1) / 2;
    const guide = new THREE.Mesh(planeGeo(0.15, 2.6), new THREE.MeshBasicMaterial({
      color: 0x2f7fbf, transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false,
    }));
    guide.rotation.x = -Math.PI / 2;
    guide.position.set(doorCX, FY + 0.005, Z1 - 1.9);
    g.add(guide);
    for (let i = 0; i < 3; i++) {
      const arrow = new THREE.Mesh(new THREE.CircleGeometry(0.1, 3), new THREE.MeshBasicMaterial({
        color: 0x3f9fd0, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false,
      }));
      arrow.rotation.x = -Math.PI / 2;
      arrow.rotation.z = -Math.PI / 2;
      arrow.position.set(doorCX, FY + 0.006, Z1 - 0.8 - i * 0.4);
      g.add(arrow);
    }
    for (let i = 0; i < 2; i++) {
      addFlat(g, new THREE.MeshBasicMaterial({
        color: 0xe8ece6, transparent: true, opacity: 0.24, depthWrite: false, toneMapped: false,
      }), 0.42, 0.24, 1.0, FY + 0.005, Z1 - 1.5 - i * 0.46);
    }
  }

  /* ================= 墙面海报 ================= */
  {
    const poster = new THREE.Mesh(planeGeo(2.1, 0.92), decal(TX.interiorPosterStrip(), 1));
    poster.position.set(X0 + 0.028, FY + 1.9, Z0 + 4.8);
    poster.rotation.y = Math.PI / 2;
    g.add(poster);
    noOutline(poster);
    const p2 = new THREE.Mesh(planeGeo(0.62, 0.9), decal(TX.posterTex(2), 1));
    p2.position.set(X1 - 1.35, FY + 1.62, Z0 + 0.06);
    g.add(p2);
    noOutline(p2);
  }

  products.build(g);

  /* ================= 地面光斑 ================= */
  const floorGlow = new THREE.Mesh(planeGeo(X1 - X0, Z1 - Z0), additiveClone(radialGlowTex(), 0xffe3b4, 0.16));
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.set((X0 + X1) / 2, FY + 0.02, (Z0 + Z1) / 2);
  floorGlow.renderOrder = 2;
  g.add(floorGlow);
  noOutline(floorGlow);

  ctx.pieces.push(g);
}

/* ------------------------------------------------------------------ */

function buildWallShelf(
  parent: THREE.Object3D,
  products: ProductField,
  spec: {
    x0: number; x1: number; z: number; y: number; h: number; depth: number;
    tiers: number; kind: ProductKind; tierKinds?: ProductKind[]; cols: number;
    w: number; hh: number; d: number; width: THREE.Material;
  },
): void {
  const { x0, x1, z, y, h, depth, tiers, kind, cols, w, hh, d, width } = spec;
  const span = x1 - x0;
  const mid = (x0 + x1) / 2;
  addBox(parent, width, span, h, 0.06, mid, y, z - depth / 2);
  addBox(parent, width, span, 0.05, depth, mid, y + h, z);
  const step = (h - 0.1) / tiers;
  for (let i = 0; i < tiers; i++) {
    const ty = y + 0.1 + i * step;
    addBox(parent, width, span, 0.03, depth, mid, ty, z);
    const tierKind = spec.tierKinds?.[i] ?? kind;
    const dims = tierKind === 'chips'
      ? { w: 0.13, h: 0.21, d: 0.06 }
      : tierKind === 'cup'
        ? { w: 0.09, h: 0.15, d: 0.09 }
        : { w, h: hh, d };
    const stepX = span / cols;
    products.row(tierKind, {
      x0: x0 + stepX / 2, count: cols, step: stepX,
      y: ty + 0.03, z: z + 0.01,
      w: dims.w, h: dims.h, d: dims.d, texOffset: i * 2 + 6,
    });
    addBox(parent, toon(0xfbfaf4), span - 0.04, 0.05, 0.01, mid, ty + 0.015, z + depth / 2 - 0.01, { cast: false });
  }
}

function buildGondola(
  parent: THREE.Object3D,
  products: ProductField,
  spec: { name?: string; x0: number; x1: number; z0: number; z1: number; y: number; h: number },
): void {
  const { x0, x1, z0, z1, y, h } = spec;
  const g = group(parent, 0, 0, 0, spec.name ?? 'gondola');
  const white = toon(P.shelfWhite);
  const metal = toon(P.shelfMetal);
  const midX = (x0 + x1) / 2;
  const midZ = (z0 + z1) / 2;
  const spanX = x1 - x0;
  const spanZ = z1 - z0;

  addBox(g, toon(0xefece2), 0.055, h, spanZ, midX, y, midZ);
  addBox(g, toon(0xd4d8dd), spanX - 0.02, 0.16, spanZ - 0.02, midX, y + h, midZ, { cast: false });
  // 顶部分类牌
  for (const side of [-1, 1]) {
    addBox(g, toon(0x2f6bd8), 0.02, 0.2, Math.min(1.6, spanZ * 0.7),
      midX + side * (spanX / 2 + 0.04), y + h + 0.3, midZ, { cast: false });
  }
  const pop = new THREE.Mesh(planeGeo(spanZ - 0.08, 0.14), decal(TX.popStripTex(), 0.9));
  pop.position.set(midX - spanX / 2 - 0.03, y + h + 0.08, midZ);
  pop.rotation.y = -Math.PI / 2;
  g.add(pop);
  noOutline(pop);

  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const ty = y + 0.24 + i * ((h - 0.36) / tiers);
    addBox(g, white, spanX, 0.025, spanZ, midX, ty, midZ, { cast: false });
    // 四层里两层薯片、一层杯面、一层盒装零食：货架近看有明确品类。
    const tierKind: ProductKind = i === 1 || i === 2 ? 'chips' : i === 3 ? 'cup' : 'box';
    const dims = tierKind === 'chips'
      ? { w: 0.13, h: 0.19, d: 0.055 }
      : tierKind === 'cup'
        ? { w: 0.085, h: 0.14, d: 0.085 }
        : { w: 0.08, h: 0.15, d: 0.06 };
    const cols = 10;
    const step = (spanZ - 0.1) / cols;
    for (const side of [-1, 1]) {
      addBox(g, toon(0xfbfaf4), 0.01, 0.048, spanZ - 0.04,
        midX + side * (spanX / 2 + 0.003), ty + 0.008, midZ, { cast: false });
      for (let c = 0; c < cols; c++) {
        for (let row = 0; row < 2; row++) {
          const px = midX + side * (0.06 + row * 0.065);
          products.row(tierKind, {
            x0: px, count: 1, step: 0,
            y: ty + 0.025,
            z: z0 + 0.07 + c * step,
            w: dims.w, h: dims.h, d: dims.d,
            // 中央货架两侧朝向过道：标签必须朝向 x，而不是对着店外。
            ry: side * Math.PI / 2,
            texOffset: c + row * 4 + i * 3,
          });
        }
      }
    }
  }
  for (const dz of [-spanZ / 2 + 0.1, spanZ / 2 - 0.1]) {
    addBox(g, metal, 0.055, 0.24, 0.055, midX, y, midZ + dz, { cast: false });
  }
}

function buildLowGondola(
  parent: THREE.Object3D,
  products: ProductField,
  spec: { name?: string; x0: number; x1: number; z0: number; z1: number; y: number; h: number },
): void {
  const { x0, x1, z0, z1, y, h } = spec;
  const g = group(parent, 0, 0, 0, spec.name ?? 'low-gondola');
  const midZ = (z0 + z1) / 2;
  const spanZ = z1 - z0;
  const spanX = x1 - x0;
  const body = toon(0xe6e3d9);
  const trim = toon(0xcfc9bb);

  // 开放前脸的矮货架：旧版是一个实心大盒子，商品被整个封在盒体里，
  // 从街上只能看到一块白板。现在只保留底座、两侧板、背板和顶板，
  // 正面敞开，薯片/杯面直接对着玻璃。
  addBox(g, body, spanX, 0.08, spanZ, (x0 + x1) / 2, y, midZ);
  addBox(g, body, 0.04, h, spanZ, x0, y, midZ);
  addBox(g, body, 0.04, h, spanZ, x1, y, midZ);
  addBox(g, body, spanX, h, 0.03, (x0 + x1) / 2, y, z0);
  addBox(g, trim, spanX + 0.02, 0.035, spanZ + 0.02, (x0 + x1) / 2, y + h - 0.035, midZ);
  addBox(g, toon(0x3a3f47), spanX, 0.055, 0.03, (x0 + x1) / 2, y, z1 - 0.015, { cast: false });

  for (let i = 0; i < 3; i++) {
    const ty = y + 0.24 + i * 0.25;
    addBox(g, toon(0xfbfaf4), spanX - 0.04, 0.018, spanZ - 0.02, (x0 + x1) / 2, ty, midZ, { cast: false });
    const tierKind: ProductKind = i === 1 ? 'chips' : i === 2 ? 'cup' : 'box';
    const dims = tierKind === 'chips'
      ? { w: 0.13, h: 0.19, d: 0.07 }
      : tierKind === 'cup'
        ? { w: 0.085, h: 0.14, d: 0.085 }
        : { w: 0.08, h: 0.15, d: 0.07 };
    for (let row = 0; row < 2; row++) {
      products.row(tierKind, {
        x0: x0 + 0.1, count: 10, step: (x1 - x0 - 0.2) / 10,
        y: ty + 0.018, z: midZ - 0.05 + row * 0.1,
        w: dims.w, h: dims.h, d: dims.d,
        texOffset: i * 2 + row * 3,
      });
    }
  }
}

/**
 * 收银台 —— 横着摆在前窗后方。
 *
 * 为什么不是沿右墙（第一版的做法）：
 * 右墙玻璃外面就是人行道，两台自动贩卖机正好挡在玻璃前，
 * 从任何街角角度看过去，柜台都被贩卖机挡住了 —— 等于没有收银台。
 *
 * 所以柜台改成「平行于正面玻璃、位于其后方」，让台面和物品正对镜头：
 *   - 柜台长边沿 x，深度 0.62 沿 z
 *   - 台面上的收银机 / 关东煮 / 咖啡机 / 热食柜沿 x 排开
 *   - 主屏朝向 +z（正对街道），从外面直接能看见屏幕在亮
 * 这是日式便利店最常见的「进门右手就是收银台」的读法，
 * 也是最容易在一张静帧里被认出来的摆法。
 */
function buildCounter(parent: THREE.Object3D, products: ProductField): void {
  const FY = S.floorY;
  const g = group(parent, 0, 0, 0, 'counter');

  // 沿 x 的长度：靠门那一侧。
  // 柜台占住窗口右半边（靠近门口），左半边留给卖场 ——
  // 这样从街角看进去是"左边货架 + 右边收银台"的经典便利店构图，
  // 而不是一整排柜台把货架全挡住。
  // 台面跨度必须装得下全部台面设备，否则最左边那件会悬在台外。
  //
  // 排布（沿 x，从右到左）：收银机 → 关东煮 → 咖啡机 → 热食柜
  // 收银机中心 = x1 - 0.62，之后每件递减 0.78 / 0.72 / 0.68，
  // 热食柜半宽 0.2 —— 所以台面左端至少要到 "热食柜中心 - 0.2"。
  // 早前台面只有 2.4m，热食柜中心落在 -2.70，而台面左缘是 -2.30，
  // 整个柜子悬在台外，从街上隔着玻璃看就是"咖啡机左边浮着一块米黄方块"。
  const x0 = IN.x0 + 2.25;
  const x1 = IN.x0 + 5.35;
  const zc = S.z1 - 2.55;
  const depth = 0.56;
  const halfD = depth / 2;

  const bodyMat = toon(0xe6e2d6);
  const topMat = toon(0xc9c1b0);
  const darkTrim = toon(0x39414d);

  const span = x1 - x0;
  const midX = (x0 + x1) / 2;

  // 柜体（正面朝向 +z 街道方向）
  addBox(g, bodyMat, span, 0.82, depth, midX, FY, zc);
  // 台面，向街道方向略出挑
  addBox(g, topMat, span + 0.06, 0.09, depth + 0.1, midX, FY + 0.82, zc + 0.03);
  // 正面装饰：深色踢脚 + 一条品牌蓝
  addBox(g, darkTrim, span - 0.08, 0.1, 0.028, midX, FY + 0.02, zc + halfD + 0.006, { cast: false });
  addBox(g, toon(0x2f6bd8), span - 0.4, 0.04, 0.022, midX, FY + 0.34, zc + halfD + 0.012, { cast: false });
  // 台面下沿的一条灯带，把柜台从暗部里托出来
  addBox(g, glow(0xffeccb, 0.5), span - 0.2, 0.018, 0.02, midX, FY + 0.78, zc + halfD + 0.016, { cast: false });

  /* ---- 柜台正面细节：面板分缝 / 拉手 / 踢脚散热口 / 小菜单 ---- */
  // 旧版柜体就是一个 span×0.82×depth 的整块盒子，从门边看是一块巨大的灰立方体。
  // 这里把正面拆成 4 块嵌板 + 竖向分缝 + 拉手，再加踢脚散热口和咖啡菜单，
  // 近看能读成"收银台"，而不是一个纯色方块。
  const frontZ = zc + halfD;
  const cf = group(g, 0, 0, 0, 'counter-front');
  const panelCount = 4;
  const panelW = (span - 0.16) / panelCount;
  const menuX = x0 + span * 0.62;
  for (let i = 0; i < panelCount; i++) {
    const cx = x0 + 0.08 + panelW * (i + 0.5);
    addBox(cf, toon(0xd8d2c3), panelW - 0.055, 0.58, 0.012,
      cx, FY + 0.13, frontZ + 0.006, { cast: false });
    addBox(cf, toon(0xa39d8e), 0.016, 0.6, 0.014,
      x0 + 0.08 + panelW * i, FY + 0.13, frontZ + 0.008, { cast: false });
    if (Math.abs(cx - menuX) > 0.3) {
      addBox(cf, toon(0x4a525f), 0.1, 0.024, 0.024,
        cx + panelW * 0.24, FY + 0.62, frontZ + 0.02, { cast: false });
    }
  }
  addBox(cf, toon(0xa39d8e), 0.016, 0.6, 0.014,
    x1 - 0.08, FY + 0.13, frontZ + 0.008, { cast: false });

  // 踢脚散热口
  for (let i = 0; i < 4; i++) {
    addBox(cf, toon(0x1b2028), 0.16, 0.014, 0.012,
      midX - 0.9 + i * 0.6, FY + 0.055, frontZ + 0.014, { cast: false });
  }

  // 咖啡菜单板
  addBox(cf, toon(0x2f6bd8), 0.46, 0.3, 0.012,
    menuX, FY + 0.4, frontZ + 0.012, { cast: false });
  const menu = new THREE.Mesh(planeGeo(0.42, 0.26), decal(TX.counterMenuTex(), 1));
  menu.name = 'counter-menu';
  menu.position.set(menuX, FY + 0.55, frontZ + 0.02);
  cf.add(menu);
  noOutline(menu);

  const topY = FY + 0.91;

  /* ---- 收银机（放在靠门的一端，最显眼） ---- */
  const posX = x1 - 0.62;
  const pos = group(g, posX, topY, zc);
  // 底座
  addBox(pos, toon(0x2a303a), 0.34, 0.1, 0.3, 0, 0, 0, { r: 0.015 });
  // 机身
  addBox(pos, toon(0x22272f), 0.3, 0.26, 0.26, 0, 0.1, 0, { r: 0.01 });
  // 主屏：略微后仰，正面朝 +z（街道）
  const screen = new THREE.Mesh(planeGeo(0.3, 0.22), decal(TX.registerTex(), 1));
  screen.position.set(0, 0.4, 0.09);
  screen.rotation.x = -0.22;
  pos.add(screen);
  noOutline(screen);
  // 屏幕背后的黑色屏体
  addBox(pos, toon(0x14181e), 0.32, 0.24, 0.03, 0, 0.28, 0.06, { cast: false });
  // 键盘（朝向店员那一侧）
  addBox(pos, toon(0x3d4653), 0.3, 0.05, 0.16, 0, 0.11, -0.16, { cast: false });
  // 顾客显示屏：小屏立在柜台前沿，朝 +z
  const custStand = group(g, posX + 0.02, topY, zc + halfD - 0.04);
  addBox(custStand, toon(0x8d949c), 0.028, 0.18, 0.028, 0, 0, 0);
  addBox(custStand, toon(0x22272f), 0.24, 0.13, 0.04, 0, 0.18, 0, { cast: false });
  const cust = new THREE.Mesh(planeGeo(0.21, 0.1), glow(0x9fe9ff, 1.0));
  cust.position.set(0, 0.245, 0.025);
  custStand.add(cust);
  noOutline(cust);

  /* ---- 关东煮 ---- */
  const odenX = posX - 0.78;
  const oden = group(g, odenX, topY, zc);
  addBox(oden, toon(0x9aa1aa), 0.46, 0.2, 0.44, 0, 0, 0, { r: 0.025 });
  addBox(oden, toon(0x2f3b48), 0.42, 0.022, 0.4, 0, 0.19, 0, { cast: false });
  const broth = new THREE.Mesh(planeGeo(0.4, 0.38), toon(0xc29a58));
  broth.rotation.x = -Math.PI / 2;
  broth.position.set(0, 0.197, 0);
  oden.add(broth);
  // 隔断
  for (let i = 0; i < 3; i++) {
    addBox(oden, toon(0xb2b9c2), 0.006, 0.06, 0.38, -0.12 + i * 0.12, 0.13, 0, { cast: false });
  }
  addBox(oden, toon(0xb2b9c2), 0.4, 0.055, 0.006, 0, 0.13, 0, { cast: false });
  // 串
  const odenColors = [0xd9c08a, 0xd8a45a, 0xb98b4f, 0xe2d2a8, 0xcaa46a, 0xd9b47a, 0xc5b48a, 0xd8b878];
  for (let i = 0; i < 8; i++) {
    addCyl(oden, toon(odenColors[i]), 0.03, 0.03, 0.07,
      -0.13 + (i % 4) * 0.09, 0.135, -0.085 + Math.floor(i / 4) * 0.17, { seg: 8 });
  }
  // 关东煮价签牌已移除。
  // 原先是两块悬空的薄板（米色牌 + 红色条），靠 z=-0.2 挂在锅沿外侧，
  // 但锅体前沿在 z=+0.22，牌面从锅沿飘出去约 4cm 且没有任何支撑，
  // 从街上隔着玻璃看就是"咖啡机左边悬着一块米黄色方块"。
  // 这个尺度下价签的信息量极低，远不如让锅体本身干净。
  const odenGlow = new THREE.PointLight(0xffc98a, 1.7, 1.8, 2);
  odenGlow.position.set(odenX, topY + 0.26, zc + 0.2);
  oden.add(odenGlow);

  /* ---- 咖啡机 ---- */
  const coffeeX = odenX - 0.72;
  const coffee = group(g, coffeeX, topY, zc);
  addBox(coffee, toon(0x2a303a), 0.42, 0.62, 0.4, 0, 0, 0, { r: 0.02 });
  const front = new THREE.Mesh(planeGeo(0.38, 0.54), decal(TX.coffeeMachineTex(), 1));
  front.position.set(0, 0.3, 0.202);
  coffee.add(front);
  noOutline(front);
  addBox(coffee, toon(0xf2eded), 0.46, 0.04, 0.44, 0, 0.62, 0, { cast: false });
  for (let i = 0; i < 3; i++) {
    addCyl(coffee, toon(0xf4f0e4), 0.03, 0.025, 0.08, -0.12 + i * 0.12, 0.66, 0.06, { seg: 8 });
  }

  /* ---- 热食柜 ---- */
  const hotX = coffeeX - 0.68;
  const hot = group(g, hotX, topY, zc);
  addBox(hot, toon(0x363d4a), 0.4, 0.42, 0.4, 0, 0, 0, { r: 0.02 });
  addBox(hot, glow(0xffd58a, 0.9), 0.32, 0.26, 0.02, 0, 0.07, 0.19, { cast: false });
  for (let i = 0; i < 3; i++) {
    addCyl(hot, toon(0xd9a15c), 0.04, 0.04, 0.05, -0.1 + i * 0.1, 0.2, 0.02, { seg: 8 });
  }
  addBox(hot, toon(0xc8d4e0, { transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
    0.34, 0.24, 0.02, 0, 0.18, 0.2, { cast: false });

  /* ---- 柜台后方：背柜（香烟 + 咖啡杯） ---- */
  const backZ = zc - 0.78;
  const backX0 = x0 + 0.1;
  const backX1 = x1 - 0.1;
  addBox(g, toon(0xd8d4c8), backX1 - backX0, 1.5, 0.3, (backX0 + backX1) / 2, FY, backZ);
  // 香烟陈列：两排
  for (let i = 0; i < 2; i++) {
    const ty = FY + 0.62 + i * 0.3;
    addBox(g, toon(0x8d949c), backX1 - backX0 - 0.04, 0.016, 0.26, (backX0 + backX1) / 2, ty, backZ, { cast: false });
    products.row('box', {
      x0: backX0 + 0.06, count: 14, step: (backX1 - backX0 - 0.12) / 14,
      y: ty + 0.016, z: backZ + 0.02,
      w: 0.05, h: 0.085, d: 0.085, texOffset: i * 3,
    });
  }
  // 背柜灯带
  addBox(g, glow(0xf2f6ff, 0.75), backX1 - backX0 - 0.1, 0.03, 0.02,
    (backX0 + backX1) / 2, FY + 1.42, backZ + 0.16, { cast: false });

  /* ---- 柜台上方灯箱 ---- */
  addBox(g, toon(0xd4d8dd), span * 0.8, 0.08, 0.58, midX, S.ceilY - 0.42, zc, { cast: false });
  addBox(g, glow(0xfff4dc, 1.15), span * 0.76, 0.035, 0.5, midX, S.ceilY - 0.455, zc, { cast: false });
}

