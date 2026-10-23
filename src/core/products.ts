/**
 * 商品陈列。
 *
 * 便利店里的"内容感"靠货架上密密麻麻的商品堆出来，
 * 但逐个 Mesh 会直接把 draw call 顶到几千。
 *
 * 做法：按「薯片 / 盒装零食 / 罐装 / 瓶装 / 杯面」分族，
 * 每族用一个 InstancedMesh + 几张 Canvas 包装贴图（变体）。
 * 整店几百件商品只占 ~20 个 draw call，但近看每一件都有品牌、口味、
 * 净含量和条码，而不是一排纯色方块。
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toon, RAMP_INDOOR } from './materials';
import * as TX from './textures';

export interface ProductSpec {
  x: number;
  y: number;
  z: number;
  /** 宽 / 高 / 深（罐为直径 / 高 / 直径） */
  w: number;
  h: number;
  d: number;
  /** 面向，弧度；0 = 正面朝 +Z */
  ry?: number;
  /** 包装变体索引 */
  tex?: number;
}

export type ProductKind = 'box' | 'chips' | 'can' | 'bottle' | 'cup';

/** 每个商品族的包装贴图。商店里同一排会有不同口味，靠 tex 变体区分。 */
const TEX: Record<ProductKind, THREE.Texture[]> = {
  box: [0, 1, 2, 3].map((i) => TX.snackBoxTex(i)),
  chips: [0, 1, 2, 3].map((i) => TX.chipBagTex(i)),
  can: [0, 1, 2].map((i) => TX.canLabelTex(i)),
  bottle: [0, 1, 2].map((i) => TX.bottleLabelTex(i)),
  cup: [0, 1, 2].map((i) => TX.cupNoodleTex(i)),
};

let seedState = 20261023;
function rand(): number {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
}

export class ProductField {
  private lists: Record<ProductKind, ProductSpec[]> = {
    box: [], chips: [], can: [], bottle: [], cup: [],
  };

  add(kind: ProductKind, spec: ProductSpec): void {
    this.lists[kind].push(spec);
  }

  /** 一排商品：沿 X 排列 */
  row(
    kind: ProductKind,
    opts: {
      x0: number;
      count: number;
      step: number;
      y: number;
      z: number;
      w: number;
      h: number;
      d: number;
      ry?: number;
      jitter?: number;
      /** 包装变体偏移；同一排会循环不同口味 */
      texOffset?: number;
      /** 兼容旧调用 */
      colorOffset?: number;
      skip?: (i: number) => boolean;
    },
  ): void {
    const variants = TEX[kind].length;
    const offset = opts.texOffset ?? opts.colorOffset ?? 0;
    for (let i = 0; i < opts.count; i++) {
      if (opts.skip?.(i)) continue;
      const j = opts.jitter ?? 0;
      this.add(kind, {
        x: opts.x0 + i * opts.step + (rand() - 0.5) * j,
        y: opts.y,
        z: opts.z + (rand() - 0.5) * j,
        w: opts.w,
        h: opts.h * (1 + (rand() - 0.5) * 0.08),
        d: opts.d,
        ry: (opts.ry ?? 0) + (rand() - 0.5) * 0.06,
        tex: (offset + i) % variants,
      });
    }
  }

  /** 一层货架铺满（X 向多排） */
  grid(
    kind: ProductKind,
    opts: {
      x0: number;
      z0: number;
      cols: number;
      rows: number;
      stepX: number;
      stepZ: number;
      y: number;
      w: number;
      h: number;
      d: number;
      texOffset?: number;
      colorOffset?: number;
    },
  ): void {
    for (let r = 0; r < opts.rows; r++) {
      this.row(kind, {
        x0: opts.x0,
        count: opts.cols,
        step: opts.stepX,
        y: opts.y,
        z: opts.z0 + r * opts.stepZ,
        w: opts.w,
        h: opts.h,
        d: opts.d,
        jitter: 0.008,
        texOffset: (opts.texOffset ?? opts.colorOffset ?? 0) + r * 5,
      });
    }
  }

  get count(): number {
    return Object.values(this.lists).reduce((n, list) => n + list.length, 0);
  }

  build(parent: THREE.Object3D, opts: { cast?: boolean } = {}): void {
    // 盒装/袋装用圆角盒：薯片袋的鼓包、零食盒的倒角都能读出来
    const boxGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);
    const chipGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.18);
    const canGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
    const bottleGeo = new THREE.CylinderGeometry(0.36, 0.5, 1, 12);
    const cupGeo = new THREE.CylinderGeometry(0.5, 0.38, 1, 14);

    this.buildFamily(parent, this.lists.box, 'box', boxGeo, opts);
    this.buildFamily(parent, this.lists.chips, 'chips', chipGeo, opts);
    this.buildFamily(parent, this.lists.can, 'can', canGeo, opts);
    this.buildFamily(parent, this.lists.bottle, 'bottle', bottleGeo, opts);
    this.buildFamily(parent, this.lists.cup, 'cup', cupGeo, opts);
  }

  private buildFamily(
    parent: THREE.Object3D,
    list: ProductSpec[],
    kind: ProductKind,
    geo: THREE.BufferGeometry,
    opts: { cast?: boolean },
  ): void {
    if (!list.length) return;
    const textures = TEX[kind];
    const groups = new Map<number, ProductSpec[]>();
    for (const p of list) {
      const t = ((p.tex ?? 0) % textures.length + textures.length) % textures.length;
      const arr = groups.get(t);
      if (arr) arr.push(p);
      else groups.set(t, [p]);
    }

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (const [tex, items] of groups) {
      // 颜色全部来自包装贴图；instanceColor 保持白色，不再用纯色染整件商品。
      const mat = toon(0xffffff, {
        ramp: RAMP_INDOOR,
        map: textures[tex],
        emissive: 0x15100a,
        emissiveIntensity: 1,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      mesh.name = `products-${kind}-${tex}`;
      mesh.castShadow = opts.cast ?? false;
      mesh.receiveShadow = true;
      items.forEach((p, i) => {
        pos.set(p.x, p.y + p.h / 2, p.z);
        q.setFromAxisAngle(up, p.ry ?? 0);
        scl.set(p.w, p.h, p.d);
        m.compose(pos, q, scl);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      parent.add(mesh);
    }
  }
}
