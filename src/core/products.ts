/**
 * 商品陈列。
 *
 * 便利店里的"内容感"靠货架上密密麻麻的商品堆出来，
 * 但逐个 Mesh 会直接把 draw call 顶到几千。
 *
 * 做法：按「薯片 / 盒装零食 / 罐装 / 瓶装 / 杯面」分族，
 * 每族按包装变体实例化主体与细节，食品用独立几何表现米饭、配菜和夹层。
 * 整店几百件商品共用少量批次，近看每一件都有品牌、口味、
 * 净含量和条码，而不是一排纯色方块。
 */

import * as THREE from 'three';
import { toon, RAMP_INDOOR } from './materials';
import * as TX from './textures';
import { productGeometry, productDetails } from './shelf-product-geometry';

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

export type ProductKind = 'box' | 'chips' | 'can' | 'bottle' | 'cup' | 'onigiri' | 'bento' | 'sandwich' | 'bread' | 'carton';

/** 每个商品族的包装贴图。商店里同一排会有不同口味，靠 tex 变体区分。 */
const TEX: Record<ProductKind, THREE.Texture[]> = {
  box: [0, 1, 2, 3].map((i) => TX.snackBoxTex(i)),
  chips: [0, 1, 2, 3].map((i) => TX.chipBagTex(i)),
  can: [0, 1, 2].map((i) => TX.canLabelTex(i)),
  bottle: [0, 1, 2].map((i) => TX.bottleLabelTex(i)),
  cup: [0, 1, 2].map((i) => TX.cupNoodleTex(i)),
  onigiri: [0, 1, 2].map((i) => TX.freshFoodTex('onigiri', i)),
  bento: [0, 1, 2].map((i) => TX.freshFoodTex('bento', i)),
  sandwich: [0, 1, 2].map((i) => TX.freshFoodTex('sandwich', i)),
  bread: [0, 1, 2].map((i) => TX.freshFoodTex('bread', i)),
  carton: [0, 1, 2].map((i) => TX.freshFoodTex('carton', i)),
};

let seedState = 20261023;
function rand(): number {
  seedState = (seedState * 1664525 + 1013904223) >>> 0;
  return seedState / 4294967296;
}

export class ProductField {
  private lists: Record<ProductKind, ProductSpec[]> = {
    box: [], chips: [], can: [], bottle: [], cup: [],
    onigiri: [], bento: [], sandwich: [], bread: [], carton: [],
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
    for (const kind of Object.keys(this.lists) as ProductKind[]) {
      this.buildFamily(parent, this.lists[kind], kind, productGeometry(kind), opts);
    }
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
    if (kind === 'bottle' || kind === 'can' || kind === 'cup') {
      for (const texture of textures) texture.wrapS = THREE.RepeatWrapping;
    }
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
      const close = new THREE.Group();
      close.add(mesh);
      const distant = new THREE.Group();
      const lowBody = new THREE.InstancedMesh(productGeometry(kind, true), mat, items.length);
      lowBody.name = `products-${kind}-${tex}-distant`;
      // Matrices are immutable after construction, so both levels can share
      // their GPU instance buffer instead of uploading identical data twice.
      lowBody.instanceMatrix = mesh.instanceMatrix;
      lowBody.castShadow = mesh.castShadow;
      lowBody.receiveShadow = true;
      distant.add(lowBody);
      // Shared instanced details keep the denser models inexpensive to draw.
      const detailGeo = productDetails(kind, tex);
      if (detailGeo) {
        const detail = new THREE.InstancedMesh(detailGeo, toon(0xffffff, {
          ramp: RAMP_INDOOR, vertexColors: true,
        }), items.length);
        detail.name = `product-details-${kind}-${tex}`;
        detail.instanceMatrix.copy(mesh.instanceMatrix);
        detail.castShadow = opts.cast ?? false;
        detail.receiveShadow = true;
        close.add(detail);
        const lowDetail = new THREE.InstancedMesh(productDetails(kind, tex, true)!, detail.material, items.length);
        lowDetail.name = `product-details-${kind}-${tex}-distant`;
        lowDetail.instanceMatrix = detail.instanceMatrix;
        lowDetail.castShadow = detail.castShadow;
        lowDetail.receiveShadow = true;
        distant.add(lowDetail);
      }
      // Recenter each batch for LOD's distance calculation. The instance
      // translations remain in shelf coordinates, compensated on both groups.
      mesh.computeBoundingSphere();
      const center = mesh.boundingSphere!.center;
      const lod = new THREE.LOD();
      lod.name = `product-lod-${kind}-${tex}`;
      lod.position.copy(center);
      close.position.copy(center).negate();
      distant.position.copy(close.position);
      lod.addLevel(close, 0);
      // 14m is a conservative switch for the default 28-degree camera;
      // hysteresis prevents flicker while orbiting across that boundary.
      lod.addLevel(distant, 14, 0.12);
      parent.add(lod);
    }
  }
}
