/**
 * 积雪的表面噪点。
 *
 * 单独拆一个文件是为了避免改动巨大的 textures.ts（那里集中了所有贴图，
 * 手改容易误伤相邻代码）。
 *
 * 雪面如果是一整块纯白，三渲二会直接糊成一块白板 ——
 * 需要极轻微的明暗变化来表达"这是有体积的雪，不是贴了张白纸"。
 * 噪点强度刻意压得很低（±4%），因为微缩比例下雪本来就该是干净的。
 */

import * as THREE from 'three';

let cached: THREE.Texture | null = null;

export function snowSurfaceTex(): THREE.Texture {
  if (cached) return cached;

  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;

  // 底色：略偏冷的白
  ctx.fillStyle = '#eef3fa';
  ctx.fillRect(0, 0, S, S);

  let a = 20250101;
  const rand = (): number => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };

  // 大块的明暗起伏（模拟雪堆的缓坡）
  for (let i = 0; i < 22; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rad = 12 + rand() * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const bright = rand() > 0.5;
    g.addColorStop(0, bright ? 'rgba(255,255,255,0.16)' : 'rgba(196,210,230,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // 细颗粒（雪粒感），强度很低
  for (let i = 0; i < 1400; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const v = rand();
    ctx.fillStyle = v > 0.5
      ? `rgba(255,255,255,${0.05 + rand() * 0.06})`
      : `rgba(180,196,218,${0.03 + rand() * 0.05})`;
    ctx.fillRect(x, y, 1 + (rand() > 0.8 ? 1 : 0), 1);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  t.anisotropy = 4;
  cached = t;
  return t;
}
