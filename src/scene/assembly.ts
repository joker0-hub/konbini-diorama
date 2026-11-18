import * as THREE from 'three';

// Time in seconds. Adjacent stages overlap so the next part starts
// moving as the previous one seats.
const TIMING = {
  base: { start: 0, duration: 0.6, stagger: 0 },
  paving: { start: 0.45, duration: 0.72, stagger: 0 },
  shell: { start: 1.0, duration: 0.9, stagger: 0.56 },
  interior: { start: 1.85, duration: 1.0, stagger: 0 },
  roof: { start: 2.55, duration: 0.8, stagger: 0.43, fromY: 1.55 },
  street: { start: 3.05, duration: 0.75, stagger: 0.55 },
  props: { start: 3.6, duration: 0.52, stagger: 0.48 },
};
const LIGHTS_START = 3.85;
const DURATION = 4.8;

interface Motion {
  /** Vertical offset in the parent's coordinates at the start of the move. */
  fromY?: number;
  /** Initial fraction of the final height for parts built up from ground level. */
  fromScaleY?: number;
  /** Relative start within the phase's stagger window (0–1). */
  order?: number;
}

interface Item {
  object: THREE.Object3D;
  start: number;
  end: number;
  y: number;
  scaleY: number;
  fromY: number;
  fromScaleY: number;
  visible: boolean;
  settled: boolean;
}

export class Assembly {
  private items: Item[] = [];
  private elapsed = 0;
  finished = false;
  paused = false;
  onDone: (() => void) | null = null;
  progress = 0;

  add(object: THREE.Object3D, phase: keyof typeof TIMING, motion: Motion = {}): void {
    const timing = TIMING[phase];
    const { start, duration, stagger } = timing;
    const begins = start + stagger * (motion.order ?? 0);
    this.items.push({
      object,
      start: begins,
      end: begins + duration,
      y: object.position.y,
      scaleY: object.scale.y,
      fromY: motion.fromY ?? ('fromY' in timing ? timing.fromY : 0),
      fromScaleY: motion.fromScaleY ?? 1,
      visible: object.visible,
      settled: false,
    });
    object.visible = false;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get lighting(): number {
    return THREE.MathUtils.smoothstep(this.elapsed, LIGHTS_START, DURATION);
  }

  finishNow(): void {
    this.updateTo(DURATION);
  }

  update(dt: number): void {
    if (this.paused) return;
    this.updateTo(Math.min(this.elapsed + dt, DURATION));
  }

  private updateTo(time: number): void {
    if (this.finished) return;
    this.elapsed = time;
    this.progress = time / DURATION;

    for (const item of this.items) {
      if (item.settled || time <= item.start) continue;
      const t = THREE.MathUtils.smoothstep(time, item.start, item.end);
      item.object.visible = item.visible;
      item.object.position.y = item.y + item.fromY * (1 - t);
      item.object.scale.y = item.scaleY * THREE.MathUtils.lerp(item.fromScaleY, 1, t);
      item.settled = t === 1;
    }

    if (time === DURATION) {
      this.finished = true;
      this.onDone?.();
    }
  }
}
