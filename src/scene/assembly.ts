/**
 * 入场组装动画。
 *
 * 目标不是"整体淡入"，而是像摆积木：底座先落位，然后是铺装、
 * 建筑外壳、店内货架、屋顶设备、街道家具、最后是灯亮起来。
 *
 * 实现要点：
 * - 每个阶段有独立的时间窗，窗口之间重叠，看起来像连续施工而不是排队。
 * - 元素从自身下方的"地下"升起（depth 不同 → 层与层之间有先后感）。
 * - 用 easeOutBack 收尾，落位时有一点点过冲，像零件"咔"地扣上。
 * - 落位后缩放到 1、位置归零，不残留任何变换。
 */

import * as THREE from 'three';

export type Phase =
  | 'base'
  | 'paving'
  | 'shell'
  | 'interior'
  | 'roof'
  | 'street'
  | 'props'
  | 'light';

/** 每个阶段的入场时间窗（0..1，全局进度） */
const RANGE: Record<Phase, [number, number]> = {
  base: [0.0, 0.1],
  paving: [0.06, 0.2],
  shell: [0.16, 0.42],
  interior: [0.34, 0.62],
  roof: [0.54, 0.7],
  street: [0.6, 0.82],
  props: [0.72, 0.92],
  light: [0.86, 1.0],
};

/** 每阶段的升起高度（米） */
const DEPTH: Record<Phase, number> = {
  base: 2.2,
  paving: 1.8,
  shell: 3.0,
  interior: 2.2,
  roof: 3.2,
  street: 1.6,
  props: 1.4,
  light: 0.6,
};

const easeOutBack = (x: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

interface Item {
  obj: THREE.Object3D;
  start: number;
  end: number;
  depth: number;
  baseY: number;
  baseScale: THREE.Vector3;
  /** 起点的水平偏移（散件飞入感） */
  offset: THREE.Vector3;
  delayJitter: number;
}

export class Assembly {
  private items: Item[] = [];
  private elapsed = 0;
  private duration = 7.0;
  private started = false;
  finished = false;
  onDone: (() => void) | null = null;
  /** 全局进度 0..1 */
  progress = 0;

  constructor(private root: THREE.Object3D) {}

  /**
   * 注册一个元素。
   * @param phase 决定时间窗与升起高度
   * @param local 0..1，阶段内的相对位置（同阶段内的先后顺序）
   */
  add(obj: THREE.Object3D, phase: Phase, local = 0.5, opts: { depthScale?: number; spread?: number } = {}): void {
    const [s, e] = RANGE[phase];
    const span = e - s;
    // 同阶段内错开：local 越大越晚，窗口宽度收窄到 45% 产生重叠
    const w = span * 0.45;
    const start = s + (span - w) * THREE.MathUtils.clamp(local, 0, 1);
    const depth = DEPTH[phase] * (opts.depthScale ?? 1);
    const spread = opts.spread ?? 0.35;
    // 从"外面"飞进来一点，避免所有零件都直上直下
    const angle = Math.random() * Math.PI * 2;
    const dist = spread * (0.4 + Math.random() * 0.6);
    this.items.push({
      obj,
      start,
      end: start + w,
      depth,
      baseY: obj.position.y,
      baseScale: obj.scale.clone(),
      offset: new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist),
      delayJitter: 0,
    });
  }

  /**
   * 给一个父节点里的所有子网格一次性登记（按包围盒底部高度排序，
   * 低的先出现）。用于"内装 / 街道"这类由很多小件组成的组。
   */
  addChildren(parent: THREE.Object3D, phase: Phase, opts: { spread?: number; from?: number; to?: number } = {}): void {
    const kids = parent.children.filter((c) => c.visible !== false || true);
    const sorted = kids
      .map((c) => {
        const b = new THREE.Box3().setFromObject(c);
        const y = Number.isFinite(b.min.y) ? b.min.y : 0;
        return { c, y };
      })
      .sort((a, b) => a.y - b.y);
    const from = opts.from ?? 0;
    const to = opts.to ?? 1;
    sorted.forEach((item, i) => {
      const t = sorted.length > 1 ? i / (sorted.length - 1) : 0;
      this.add(item.c, phase, from + (to - from) * t, { spread: opts.spread });
    });
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** 跳过动画，直接到最终状态 */
  finishNow(): void {
    this.elapsed = this.duration + 1;
    this.progress = 1;
    this.apply(1);
    if (!this.finished) {
      this.finished = true;
      this.onDone?.();
    }
  }

  update(dt: number): void {
    if (this.finished) return;
    this.started = true;
    this.elapsed += dt;
    const p = THREE.MathUtils.clamp(this.elapsed / this.duration, 0, 1);
    this.progress = p;
    this.apply(p);
    if (p >= 1) {
      this.finished = true;
      this.apply(1);
      this.onDone?.();
    }
  }

  private apply(globalP: number): void {
    for (const it of this.items) {
      const raw = (globalP - it.start) / Math.max(1e-5, it.end - it.start);
      const local = THREE.MathUtils.clamp(raw, 0, 1);

      if (local <= 0) {
        // 还没轮到：藏起来，并放到地下，避免"半成品"露出来
        it.obj.visible = false;
        it.obj.position.y = it.baseY - it.depth;
        it.obj.scale.copy(it.baseScale).multiplyScalar(0.55);
        continue;
      }

      it.obj.visible = true;

      const e = easeOutBack(local);
      const ec = easeOutCubic(local);

      // 缩放：0.55 → 1（over 到 1.0，避免长期 >1 让描边变粗）
      const s = THREE.MathUtils.lerp(0.55, 1, Math.min(e, 1.06));
      it.obj.scale.copy(it.baseScale).multiplyScalar(s);

      // 高度：从地下升上来
      it.obj.position.y = it.baseY - it.depth * (1 - ec);

      // 水平：从外侧滑入
      it.obj.position.x = it.offset.x * (1 - ec);
      it.obj.position.z = it.offset.z * (1 - ec);
    }
  }
}

/** 阶段时间窗，供外部（如光芒渐亮）复用 */
export function phaseWindow(p: Phase): [number, number] {
  return RANGE[p];
}
