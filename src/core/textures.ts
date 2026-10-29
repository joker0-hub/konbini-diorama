/**
 * 程序化贴图 —— 全部用 Canvas2D 现画，无二进制资源。
 * 三渲二的贴图原则：色块干净、边缘硬、细节靠"画"而不是靠高频噪声。
 */

import * as THREE from 'three';
import { P } from './palette';

const JP = '"Yu Gothic", "YuGothic", "Meiryo", "Noto Sans JP", "MS Gothic", sans-serif';

const cache = new Map<string, THREE.Texture>();

/**
 * 全场景各向异性滤波等级。
 *
 * 这是远景摩尔纹的首要成因：地面/墙面都是被"斜着看"的平面，
 * 透视会让远处每个像素覆盖一大片纹理，采样点数量不足时就会把
 * 地砖缝、砖墙线采成一片混乱的波纹。
 *
 * 原来硬编码 8：既没有按显卡上限取（本机上限 16，等于白丢一半），
 * 又在纹理创建时就被固定死 —— 那时渲染器还没创建，拿不到 GPU 能力。
 * 现在先给一个保守值，由 applyTextureQuality() 在渲染器就绪后统一抬到上限。
 */
let textureAnisotropy = 8;

/** 由 main.ts 在 renderer 创建后调用：把各向异性抬到显卡支持的上限。 */
export function applyTextureQuality(renderer: THREE.WebGLRenderer): void {
  const max = renderer.capabilities.getMaxAnisotropy();
  if (max > textureAnisotropy) {
    textureAnisotropy = max;
  }
  // 已经建好的纹理也要一起更新（它们是在渲染器之前创建的）
  for (const t of cache.values()) {
    if (t.anisotropy !== textureAnisotropy) {
      t.anisotropy = textureAnisotropy;
      t.needsUpdate = true;
    }
  }
}

function mk(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  return [c, ctx];
}

function finish(
  c: HTMLCanvasElement,
  opts: { repeat?: [number, number]; srgb?: boolean } = {},
): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  t.anisotropy = textureAnisotropy;
  // 三线性 mipmap：缩小采样时用相邻两级 mip 插值，
  // 避免硬切 mip 级在远处出现"整片亮度跳变"的色块边界。
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function cached(key: string, build: () => THREE.CanvasTexture): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const t = build();
  // 纹理可能是在 applyTextureQuality 之后才首次创建（懒加载），
  // 这里补一次，保证新建纹理也用当前等级。
  if (t.anisotropy !== textureAnisotropy) {
    t.anisotropy = textureAnisotropy;
    t.needsUpdate = true;
  }
  cache.set(key, t);
  return t;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** 细颗粒噪声（沥青、水泥、布料用） */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, count: number, alpha = 0.05) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const v = r();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 1.3})`;
    const s = 1 + r() * 2.4;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

/* ============================================================
 * 地面材质
 * ============================================================ */

export function asphaltTex(): THREE.Texture {
  return cached('asphalt', () => {
    const S = 512;
    const [c, ctx] = mk(S, S);
    ctx.fillStyle = '#333a48';
    ctx.fillRect(0, 0, S, S);
    const r = rng(7);
    // 湿斑
    for (let i = 0; i < 26; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 26 + r() * 110;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(20,24,33,${0.14 + r() * 0.2})`);
      g.addColorStop(1, 'rgba(20,24,33,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    speckle(ctx, S, S, 11, 5200, 0.045);
    // 细裂纹
    ctx.strokeStyle = 'rgba(18,21,28,0.5)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      let x = r() * S;
      let y = r() * S;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (r() - 0.5) * 60;
        y += (r() - 0.5) * 34;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return finish(c, { repeat: [3, 3] });
  });
}

export function sidewalkTex(): THREE.Texture {
  return cached('sidewalk', () => {
    const S = 512;
    const [c, ctx] = mk(S, S);
    // 底色不再用比砖块暗很多的 #3d434f。
    // 原来底色和砖块差 ~40 个色阶、缝只有 2px，缩小时每一条缝都是一个
    // 独立采样点，mipmap 平均出来的中间灰和两侧亮块互相打架，
    // 远处就织成一片网格状波纹。现在底色只比砖块暗 ~12 个色阶，
    // 缝宽 3px 且有半透明过渡，缩小时的方差大幅下降。
    ctx.fillStyle = '#565c69';
    ctx.fillRect(0, 0, S, S);
    const n = 8;
    const t = S / n;
    const r = rng(23);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 84 + Math.floor(r() * 22);
        ctx.fillStyle = `rgb(${v},${v + 5},${v + 13})`;
        // 砖块之间留 3px，缝由底色透出
        ctx.fillRect(x * t + 3, y * t + 3, t - 6, t - 6);
        // 上沿高光也压淡：原来是 0.05 纯白细线，同样是高频细节
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.fillRect(x * t + 3, y * t + 3, t - 6, 2);
      }
    }
    // 斑点数量减半：每个 1~3px 的亮点在远景都是噪声源
    speckle(ctx, S, S, 31, 1200, 0.03);
    return finish(c, { repeat: [2, 2] });
  });
}

export function interiorFloorTex(): THREE.Texture {
  return cached('interiorFloor', () => {
    const S = 512;
    const [c, ctx] = mk(S, S);
    // 便利店是灰色 CS 乙烯基卷材，不是瓷砖。
    // 这里只画很淡的接缝 + 少量污渍，避免满屏方格把室内变成卫生间。
    ctx.fillStyle = '#b8b4a8';
    ctx.fillRect(0, 0, S, S);

    const r = rng(51);
    // 卷材的大块色差
    for (let i = 0; i < 14; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 50 + r() * 140;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(150,148,140,${0.06 + r() * 0.1})`);
      g.addColorStop(1, 'rgba(150,148,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 2m 一格的接缝（极淡）。
    // 室内是卷材地板，接缝不能画成砖缝，否则整片地面变成瓷砖格子 ——
    // 从街上透过玻璃看尤其刺眼。
    ctx.strokeStyle = 'rgba(150,148,142,0.2)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i <= 2; i++) {
      const p = (i / 2) * S;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, S);
      ctx.moveTo(0, p);
      ctx.lineTo(S, p);
      ctx.stroke();
    }
    // 商品/货架的微弱倒影斑（室内是亮面）
    for (let i = 0; i < 20; i++) {
      const x = r() * S;
      const y = r() * S;
      const w = 8 + r() * 46;
      const h = 24 + r() * 90;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(255,250,238,0.10)');
      g.addColorStop(1, 'rgba(255,250,238,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    }
    speckle(ctx, S, S, 61, 900, 0.025);
    return finish(c, { repeat: [3, 3] });
  });
}

export function manholeTex(): THREE.Texture {
  return cached('manhole', () => {
    const S = 256;
    const [c, ctx] = mk(S, S);
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#4c525d';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a2e36';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = '#3a3f49';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, 30 + i * 24, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = '#616977';
    ctx.lineWidth = 4;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(S / 2 + Math.cos(a) * 26, S / 2 + Math.sin(a) * 26);
      ctx.lineTo(S / 2 + Math.cos(a) * 112, S / 2 + Math.sin(a) * 112);
      ctx.stroke();
    }
    return finish(c);
  });
}

/* ============================================================
 * 招牌 / 标识
 * ============================================================ */

function logoMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  // 珊瑚色圆 + 白色星
  ctx.fillStyle = hex(P.storeCoral);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff9ec';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 === 0 ? r * 0.62 : r * 0.26;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function signFace(w: number, h: number, opts: { sub?: string; marks?: boolean } = {}): THREE.CanvasTexture {
  const [c, ctx] = mk(w, h);
  ctx.fillStyle = '#f7f2e5';
  ctx.fillRect(0, 0, w, h);

  // 顶部 / 底部撞色条
  const band = h * 0.075;
  ctx.fillStyle = hex(P.storeNavy);
  ctx.fillRect(0, 0, w, band);
  ctx.fillStyle = hex(P.storeMint);
  ctx.fillRect(0, band, w, band * 0.34);
  ctx.fillStyle = hex(P.storeCoral);
  ctx.fillRect(0, h - band * 0.42, w, band * 0.42);

  // 店名（logoMark 会改 fillStyle，画完必须重设）
  const markR = h * 0.2;
  logoMark(ctx, h * 0.34, h * 0.5, markR);
  ctx.fillStyle = hex(P.storeNavy);
  ctx.font = `700 ${Math.floor(h * 0.4)}px ${JP}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('ホシノマート', h * 0.66, h * 0.54);

  if (opts.marks !== false) {
    // 右侧 24H
    ctx.textAlign = 'right';
    ctx.fillStyle = hex(P.storeCoral);
    ctx.font = `800 ${Math.floor(h * 0.3)}px ${JP}`;
    ctx.fillText('24H', w - h * 0.28, h * 0.42);
    ctx.fillStyle = 'rgba(29,42,69,0.72)';
    ctx.font = `600 ${Math.floor(h * 0.115)}px ${JP}`;
    ctx.fillText(opts.sub ?? 'OPEN 24 HOURS', w - h * 0.28, h * 0.7);
  }
  return finish(c);
}

export function storeSignTex(): THREE.Texture {
  return cached('storeSign', () => signFace(1024, 220));
}

export function storeSignSmallTex(): THREE.Texture {
  return cached('storeSignSmall', () => signFace(768, 200, { marks: false, sub: '' }));
}

export function verticalSignTex(): THREE.Texture {
  return cached('verticalSign', () => {
    const W = 220;
    const H = 900;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#f8f3e6';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = hex(P.storeCoral);
    ctx.fillRect(0, 0, W, 78);
    ctx.fillStyle = '#fff';
    ctx.font = `800 52px ${JP}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('24H', W / 2, 42);
    ctx.fillStyle = hex(P.storeNavy);
    ctx.font = `700 104px ${JP}`;
    const chars = 'ホシノ';
    chars.split('').forEach((ch, i) => ctx.fillText(ch, W / 2, 190 + i * 116));
    ctx.fillStyle = hex(P.storeNavy);
    ctx.font = `700 58px ${JP}`;
    'マート'.split('').forEach((ch, i) => ctx.fillText(ch, W / 2, 610 + i * 68));
    // 底部收边：旧版是 30px 的 storeMint 青带，颜色和玻璃一样，
    // 低角度看过去像"招牌下半截是透明玻璃"。改成珊瑚色窄带 + 奶油底边，
    // 保持品牌色但读作实体招牌的封底。
    ctx.fillStyle = hex(P.storeCoral);
    ctx.fillRect(0, H - 24, W, 24);
    ctx.fillStyle = '#f8f3e6';
    ctx.fillRect(0, H - 6, W, 6);
    return finish(c);
  });
}

/** 合拢伞面的竖向折痕：灰度纹理，由伞布材质颜色着色。 */
export function umbrellaFoldTex(): THREE.Texture {
  return cached('umbrellaFold', () => {
    const W = 128;
    const H = 256;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const seams = 12;
    const step = W / seams;
    for (let i = 0; i < seams; i++) {
      const cx = (i + 0.5) * step;
      const grad = ctx.createLinearGradient(cx - 5, 0, cx + 5, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.4, 'rgba(0,0,0,0.18)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.42)');
      grad.addColorStop(0.6, 'rgba(0,0,0,0.18)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(cx - 5, 0, 10, H);
    }
    // 上端收口处稍暗，避免伞面顶部像一块平布
    const top = ctx.createLinearGradient(0, 0, 0, H * 0.22);
    top.addColorStop(0, 'rgba(0,0,0,0.18)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, W, H * 0.22);
    return finish(c);
  });
}

export function vendingTex(variant: 'blue' | 'red'): THREE.Texture {
  return cached('vending:' + variant, () => {
    const W = 384;
    const H = 768;
    const [c, ctx] = mk(W, H);
    const main = variant === 'blue' ? '#2f6bd8' : '#d8443c';
    ctx.fillStyle = '#e9eef5';
    ctx.fillRect(0, 0, W, H);
    // 机身色带
    ctx.fillStyle = main;
    ctx.fillRect(0, 0, W, 74);
    ctx.fillRect(0, H - 150, W, 150);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 40px ${JP}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('DRINK', 22, 40);
    ctx.font = `600 20px ${JP}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('つめた～い', 202, 42);

    // 商品展示窗
    const gx = 16;
    const gy = 88;
    const gw = W - 32;
    const gh = 400;
    const grad = ctx.createLinearGradient(0, gy, 0, gy + gh);
    grad.addColorStop(0, '#fffdf2');
    grad.addColorStop(1, '#ffe9c2');
    ctx.fillStyle = grad;
    ctx.fillRect(gx, gy, gw, gh);

    const r = rng(variant === 'blue' ? 91 : 92);
    const cols = 5;
    const rows = 3;
    const cw = gw / cols;
    const ch = gh / rows;
    const drinks = ['#e8493f', '#f2a13b', '#3aa76d', '#2f6bd8', '#8c4bd0', '#f4d03f', '#e46a9a', '#5ec7d8'];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = gx + col * cw;
        const y = gy + row * ch;
        // 罐/瓶
        const canH = ch * 0.52;
        const canW = cw * 0.42;
        const cx = x + cw / 2;
        const cy = y + ch * 0.52;
        ctx.fillStyle = drinks[Math.floor(r() * drinks.length)];
        ctx.beginPath();
        ctx.roundRect(cx - canW / 2, cy - canH / 2, canW, canH, 7);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(cx - canW / 2 + 3, cy - canH / 2 + 6, canW * 0.22, canH - 12);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect(cx - canW / 2, cy + canH / 2 - 5, canW, 5);
        // 价签
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - 22, y + ch - 26, 44, 17);
        ctx.fillStyle = '#d33';
        ctx.font = `700 13px ${JP}`;
        ctx.textAlign = 'center';
        ctx.fillText(variant === 'blue' ? '120' : '150', cx, y + ch - 17);
      }
      // 层板
      ctx.fillStyle = 'rgba(60,60,70,0.35)';
      ctx.fillRect(gx, gy + (row + 1) * ch - 3, gw, 3);
    }
    // 玻璃反光
    const gl = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
    gl.addColorStop(0, 'rgba(255,255,255,0.28)');
    gl.addColorStop(0.42, 'rgba(255,255,255,0.02)');
    gl.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeStyle = 'rgba(40,50,70,0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(gx, gy, gw, gh);

    // 按钮区
    ctx.fillStyle = '#2b3038';
    ctx.fillRect(20, 520, W - 40, 84);
    for (let i = 0; i < 5; i++) {
      const bx = 40 + i * 62;
      ctx.fillStyle = i === 2 ? '#8fe6a4' : '#6f7683';
      ctx.beginPath();
      ctx.roundRect(bx, 536, 42, 24, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `700 13px ${JP}`;
      ctx.textAlign = 'center';
      ctx.fillText(['ホット', 'つめ', 'コイン', 'IC', ''][i], bx + 21, 578);
    }
    // 取物口
    ctx.fillStyle = '#1a1e25';
    ctx.fillRect(38, H - 116, W - 76, 62);
    ctx.fillStyle = '#262c36';
    ctx.fillRect(46, H - 108, W - 92, 46);
    // 边框
    ctx.strokeStyle = 'rgba(30,38,52,0.85)';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, W - 8, H - 8);
    return finish(c);
  });
}

/* ============================================================
 * 货架商品包装
 *
 * 商品是 InstancedMesh，不能逐件换模型；这里把包装画进 Canvas 贴图，
 * 按「薯片 / 盒装零食 / 罐装 / 瓶装 / 杯面」分族，每族几张变体。
 * 材质只负责受光，颜色和信息全部来自贴图，货架才有便利店的内容感。
 * ============================================================ */

function starMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill = '#ffffff'): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.44;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function barcode(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void {
  ctx.fillStyle = '#f7f4ea';
  ctx.fillRect(x, y, w, h);
  const r = rng(seed);
  ctx.fillStyle = '#16181d';
  let px = x + 3;
  while (px < x + w - 4) {
    const bw = 1 + Math.floor(r() * 3);
    ctx.fillRect(px, y + 3, bw, h - 6);
    px += bw + 2 + Math.floor(r() * 2);
  }
}

const CHIP_FLAVORS = [
  { bg: '#d63a2c', dark: '#8d1f16', accent: '#ffd34e', flavor: 'うすしお', en: 'SALT', chip: '#f3c45b' },
  { bg: '#2f8f4c', dark: '#155a2e', accent: '#efe7b2', flavor: 'のりしお', en: 'SEAWEED', chip: '#e8c76a' },
  { bg: '#2f5fbd', dark: '#183a7c', accent: '#ffd25c', flavor: 'コンソメ', en: 'CONSOMMÉ', chip: '#efc06a' },
  { bg: '#e4a41b', dark: '#9a6408', accent: '#fff3c4', flavor: 'チーズ', en: 'CHEESE', chip: '#f7d27a' },
];

export function chipBagTex(variant: number): THREE.Texture {
  return cached('chipBag:' + variant, () => {
    const W = 256;
    const H = 384;
    const [c, ctx] = mk(W, H);
    const f = CHIP_FLAVORS[variant % CHIP_FLAVORS.length];

    ctx.fillStyle = f.bg;
    ctx.fillRect(0, 0, W, H);
    // 斜向高光，像镀铝袋的反光
    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = '#ffffff';
    for (let i = -H; i < W + H; i += 46) {
      ctx.save();
      ctx.translate(i, 0);
      ctx.rotate(-0.42);
      ctx.fillRect(0, -H, 18, H * 3);
      ctx.restore();
    }
    ctx.restore();

    // 上下封口
    ctx.fillStyle = f.dark;
    ctx.fillRect(0, 0, W, 26);
    ctx.fillRect(0, H - 24, W, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 22; i++) {
      ctx.fillRect(i * 12 + 4, 6, 3, H - 30);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let i = 0; i < 22; i++) {
      ctx.fillRect(i * 12 + 9, H - 20, 3, 14);
    }

    // 品牌
    starMark(ctx, 30, 52, 14, '#ffffff');
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 17px ${JP}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('HOSHINO', 50, 54);

    // 主标题
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.font = `900 43px ${JP}`;
    ctx.fillText('POTATO', W / 2 + 2, 118 + 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('POTATO', W / 2, 118);
    ctx.font = `900 38px ${JP}`;
    ctx.fillText('CHIPS', W / 2, 156);

    // 口味条
    ctx.fillStyle = f.accent;
    ctx.fillRect(0, 184, W, 48);
    ctx.fillStyle = f.dark;
    ctx.font = `800 28px ${JP}`;
    ctx.textAlign = 'center';
    ctx.fillText(f.flavor, W / 2, 213);
    ctx.font = `700 14px ${JP}`;
    ctx.fillText(f.en, W / 2, 241);

    // 薯片插画
    for (let i = 0; i < 3; i++) {
      const cx = 62 + i * 66;
      const cy = 292 + (i % 2) * 16;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.35 + i * 0.28);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(0, 4, 35, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = f.chip;
      ctx.beginPath();
      ctx.ellipse(0, 0, 34, 21, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      ctx.beginPath();
      ctx.ellipse(-8, -5, 17, 8, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 净含量 + 条码
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 13px ${JP}`;
    ctx.textAlign = 'left';
    ctx.fillText('NET 60g', 18, 346);
    barcode(ctx, 156, 326, 80, 36, 120 + variant);
    return finish(c);
  });
}

const SNACK_BOXES = [
  { bg: '#4a2a1e', dark: '#26130d', accent: '#f2c14e', name: 'CHOCO', sub: 'BITTER', shape: 'square' },
  { bg: '#f1e6cf', dark: '#8a7252', accent: '#2f6bd8', name: 'COOKIE', sub: 'BUTTER', shape: 'circle' },
  { bg: '#cfe9df', dark: '#2c6b57', accent: '#2f8f6a', name: 'GUM', sub: 'MINT', shape: 'pellet' },
  { bg: '#f4c6d8', dark: '#8f2c54', accent: '#d02f6f', name: 'CANDY', sub: 'STRAWBERRY', shape: 'bean' },
];

export function snackBoxTex(variant: number): THREE.Texture {
  return cached('snackBox:' + variant, () => {
    const W = 256;
    const H = 400;
    const [c, ctx] = mk(W, H);
    const v = SNACK_BOXES[variant % SNACK_BOXES.length];
    ctx.fillStyle = v.bg;
    ctx.fillRect(0, 0, W, H);
    // 顶部品牌带 + 底部色带
    ctx.fillStyle = v.dark;
    ctx.fillRect(0, 0, W, 44);
    starMark(ctx, 25, 22, 11, '#ffffff');
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 16px ${JP}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('HOSHINO', 44, 23);
    ctx.fillStyle = v.accent;
    ctx.fillRect(0, H - 34, W, 34);

    // 主标题
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 40px ${JP}`;
    ctx.fillText(v.name, W / 2, 112);
    ctx.font = `700 15px ${JP}`;
    ctx.fillText(v.sub, W / 2, 140);

    // 商品图形
    const cx = W / 2;
    const cy = 232;
    if (v.shape === 'square') {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 ? '#8a4b2b' : '#5d2f1a';
        ctx.fillRect(cx - 52 + (i % 2) * 52, cy - 26 + Math.floor(i / 2) * 34, 46, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(cx - 48 + (i % 2) * 52, cy - 22 + Math.floor(i / 2) * 34, 38, 6);
      }
    } else if (v.shape === 'circle') {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i % 2 ? '#d9a968' : '#c58f4f';
        ctx.beginPath();
        ctx.arc(cx - 38 + i * 38, cy, 27, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(90,45,20,0.45)';
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          ctx.arc(cx - 38 + i * 38 + Math.cos(k * 2.2) * 15, cy + Math.sin(k * 2.2) * 15, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (v.shape === 'pellet') {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? '#ffffff' : '#bfe8d8';
        ctx.beginPath();
        ctx.ellipse(cx - 55 + (i % 3) * 55, cy - 20 + Math.floor(i / 3) * 48, 24, 18, 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = ['#ff6f91', '#ffd166', '#8bd3c7', '#c78bff', '#ff9f68'][i];
        ctx.save();
        ctx.translate(cx - 68 + i * 34, cy);
        ctx.rotate(-0.4 + i * 0.2);
        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 27, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 信息区
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(18, 300, W - 36, 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 13px ${JP}`;
    ctx.textAlign = 'left';
    ctx.fillText('NET 45g', 18, 330);
    barcode(ctx, 150, 310, 86, 38, 260 + variant);
    return finish(c);
  });
}

const CAN_FLAVORS = [
  { bg: '#1f2a44', label: '#e0b45a', name: 'COFFEE', sub: 'BLACK' },
  { bg: '#b92f28', label: '#ffe0a6', name: 'SODA', sub: 'CIDER' },
  { bg: '#2f7b58', label: '#e7f5d8', name: 'TEA', sub: 'GREEN' },
];

export function canLabelTex(variant: number): THREE.Texture {
  return cached('canLabel:' + variant, () => {
    const W = 512;
    const H = 256;
    const [c, ctx] = mk(W, H);
    const v = CAN_FLAVORS[variant % CAN_FLAVORS.length];
    ctx.fillStyle = v.bg;
    ctx.fillRect(0, 0, W, H);
    // 金属上下边
    ctx.fillStyle = '#c7ccd2';
    ctx.fillRect(0, 0, W, 24);
    ctx.fillRect(0, H - 24, W, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, 24, W, 5);
    ctx.fillRect(0, H - 29, W, 5);

    // 标签左右各一遍，卷起来任何角度都能读到
    for (const cx of [W * 0.25, W * 0.75]) {
      ctx.fillStyle = v.label;
      ctx.fillRect(cx - 100, 54, 200, 148);
      ctx.fillStyle = v.bg;
      ctx.font = `900 40px ${JP}`;
      ctx.textAlign = 'center';
      ctx.fillText(v.name, cx, 116);
      ctx.font = `700 15px ${JP}`;
      ctx.fillText(v.sub, cx, 142);
      ctx.fillStyle = v.bg;
      ctx.fillRect(cx - 76, 158, 152, 3);
      starMark(ctx, cx, 182, 11, v.bg);
      barcode(ctx, cx - 44, 166, 88, 12, 380 + variant);
    }
    return finish(c);
  });
}

const BOTTLE_FLAVORS = [
  { body: '#dcecf4', cap: '#2f6bd8', band: '#f7fbff', ink: '#1c3a5c', name: 'WATER', sub: 'MINERAL' },
  { body: '#e6efd8', cap: '#3c7a3c', band: '#f8fbef', ink: '#24502a', name: 'TEA', sub: 'GREEN' },
  { body: '#f2f0e8', cap: '#2f6bd8', band: '#ffffff', ink: '#26384e', name: 'MILK', sub: 'RICH' },
];

export function bottleLabelTex(variant: number): THREE.Texture {
  return cached('bottleLabel:' + variant, () => {
    const W = 256;
    const H = 384;
    const [c, ctx] = mk(W, H);
    const v = BOTTLE_FLAVORS[variant % BOTTLE_FLAVORS.length];
    ctx.fillStyle = v.body;
    ctx.fillRect(0, 0, W, H);
    // 瓶盖
    ctx.fillStyle = v.cap;
    ctx.fillRect(0, 0, W, 34);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 18; i++) ctx.fillRect(i * 15 + 4, 5, 3, 23);

    // 标签带
    ctx.fillStyle = v.band;
    ctx.fillRect(0, 118, W, 150);
    ctx.fillStyle = v.cap;
    ctx.fillRect(0, 118, W, 8);
    ctx.fillRect(0, 260, W, 8);
    ctx.fillStyle = v.ink;
    ctx.textAlign = 'center';
    ctx.font = `900 42px ${JP}`;
    ctx.fillText(v.name, W / 2, 188);
    ctx.font = `700 15px ${JP}`;
    ctx.fillText(v.sub, W / 2, 212);
    ctx.fillStyle = v.cap;
    ctx.fillRect(48, 226, W - 96, 3);
    starMark(ctx, 58, 246, 9, v.cap);
    ctx.fillStyle = v.ink;
    ctx.font = `700 11px ${JP}`;
    ctx.textAlign = 'left';
    ctx.fillText('500ml', 74, 250);
    barcode(ctx, 150, 230, 70, 28, 520 + variant);

    // 瓶底阴影
    ctx.fillStyle = 'rgba(20,30,40,0.16)';
    ctx.fillRect(0, H - 22, W, 22);
    return finish(c);
  });
}

const CUP_FLAVORS = [
  { body: '#f4e9d6', band: '#c9352c', ink: '#8f1f16', name: 'CUP NOODLE', sub: 'しょうゆ' },
  { body: '#e8f0f4', band: '#2f6bd8', ink: '#1c3a7c', name: 'SEAFOOD', sub: 'シーフード' },
];

export function cupNoodleTex(variant: number): THREE.Texture {
  return cached('cupNoodle:' + variant, () => {
    const W = 256;
    const H = 256;
    const [c, ctx] = mk(W, H);
    const v = CUP_FLAVORS[variant % CUP_FLAVORS.length];
    ctx.fillStyle = v.body;
    ctx.fillRect(0, 0, W, H);
    // 杯盖
    ctx.fillStyle = '#d9dde2';
    ctx.fillRect(0, 0, W, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(0, 6, W, 4);
    // 标签
    ctx.fillStyle = v.band;
    ctx.fillRect(0, 54, W, 118);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `900 28px ${JP}`;
    ctx.fillText(v.name, W / 2, 108);
    ctx.font = `800 18px ${JP}`;
    ctx.fillText(v.sub, W / 2, 136);
    // 面
    ctx.strokeStyle = '#f2d27a';
    ctx.lineWidth = 5;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(W / 2 - 26 + i * 17, 178, 9, 0.2, Math.PI * 1.5);
      ctx.stroke();
    }
    ctx.fillStyle = v.ink;
    ctx.font = `700 12px ${JP}`;
    ctx.textAlign = 'left';
    ctx.fillText('HOSHINO', 16, 238);
    barcode(ctx, 154, 214, 84, 26, 700 + variant);
    return finish(c);
  });
}

/** 柜台正面的小咖啡菜单：近看能读出价格，避免柜体是一块纯色板。 */
export function counterMenuTex(): THREE.Texture {
  return cached('counterMenu', () => {
    const W = 256;
    const H = 160;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#f6f1e3';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2f6bd8';
    ctx.fillRect(0, 0, W, 34);
    starMark(ctx, 24, 17, 10, '#ffffff');
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 15px ${JP}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('HOSHINO COFFEE', 44, 18);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#1d2a45';
    ctx.font = `900 30px ${JP}`;
    ctx.fillText('COFFEE', W / 2, 66);
    ctx.strokeStyle = '#c9352c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(38, 82);
    ctx.lineTo(W - 38, 82);
    ctx.stroke();

    ctx.fillStyle = '#1d2a45';
    ctx.font = `700 15px ${JP}`;
    ctx.textAlign = 'left';
    ctx.fillText('HOT  ¥100', 32, 112);
    ctx.fillText('ICE  ¥120', 142, 112);
    ctx.fillStyle = '#c9352c';
    ctx.font = `700 11px ${JP}`;
    ctx.fillText('S  M  L', 32, 138);
    ctx.fillStyle = '#1d2a45';
    ctx.fillText('OPEN 24H', 142, 138);
    return finish(c);
  });
}

/* ============================================================
 * 店内：杂志封面 / 海报 / POP
 * ============================================================ */

export function magazineTex(seed: number): THREE.Texture {
  return cached('magazine:' + seed, () => {
    const W = 512;
    const H = 384;
    const [c, ctx] = mk(W, H);
    const r = rng(seed);
    const tint = ['#f3c3d2', '#bfe2f2', '#f8e2a0', '#c9e8c4', '#e2cdf5', '#f6c9a8'][seed % 6];
    ctx.fillStyle = '#f4f1e8';
    ctx.fillRect(0, 0, W, H);
    const cols = 4;
    const rows = 3;
    const cw = W / cols;
    const ch = H / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = x * cw + 7;
        const py = y * ch + 6;
        const w = cw - 14;
        const h = ch - 18;
        ctx.fillStyle = tint;
        ctx.fillRect(px, py, w, h);
        // 封面图块
        const g = ctx.createLinearGradient(px, py, px + w, py + h);
        g.addColorStop(0, `hsla(${Math.floor(r() * 360)},70%,78%,1)`);
        g.addColorStop(1, `hsla(${Math.floor(r() * 360)},55%,58%,1)`);
        ctx.fillStyle = g;
        ctx.fillRect(px + 5, py + h * 0.3, w - 10, h * 0.66);
        // 标题条
        ctx.fillStyle = 'rgba(30,30,40,0.82)';
        ctx.fillRect(px + 5, py + 6, w - 10, h * 0.16);
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.floor(h * 0.1)}px ${JP}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(['特集', '新作', '夏号', '読み物'][Math.floor(r() * 4)], px + 12, py + 6 + h * 0.08);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillRect(px + 8, py + h * 0.62, w * 0.6, 5);
        ctx.fillRect(px + 8, py + h * 0.7, w * 0.42, 4);
      }
      ctx.fillStyle = 'rgba(90,94,102,0.55)';
      ctx.fillRect(0, (y + 1) * ch - 5, W, 5);
    }
    return finish(c);
  });
}

export function posterTex(seed: number): THREE.Texture {
  return cached('poster:' + seed, () => {
    const W = 256;
    const H = 384;
    const [c, ctx] = mk(W, H);
    const r = rng(seed * 37 + 5);
    const hues = [[350, 45], [200, 48], [140, 42], [30, 50], [280, 45]];
    const [hue, sat] = hues[seed % hues.length];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `hsl(${hue},${sat}%,72%)`);
    g.addColorStop(1, `hsl(${hue + 18},${sat + 8}%,52%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 放射
    ctx.save();
    ctx.translate(W / 2, H * 0.42);
    for (let i = 0; i < 16; i++) {
      ctx.rotate((Math.PI * 2) / 16);
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.04)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 300, -0.09, 0.09);
      ctx.fill();
    }
    ctx.restore();
    // 主体色块
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.4, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `hsl(${hue + 30},60%,45%)`;
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.4, 30, 0, Math.PI * 2);
    ctx.fill();
    // 文字
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.floor(34 + r() * 8)}px ${JP}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const titles = ['新発売', '夏限定', 'ポイント', 'いらっしゃい', '大特価'];
    ctx.fillText(titles[seed % titles.length], W / 2, H * 0.72);
    ctx.font = `600 20px ${JP}`;
    ctx.fillText(['冷たい', 'あつい', 'おいしい', 'おトク', '限定'][seed % 5], W / 2, H * 0.84);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `700 16px ${JP}`;
    ctx.fillText('HOSHINO MART', W / 2, H * 0.94);
    return finish(c);
  });
}

export function noticeBoardTex(): THREE.Texture {
  return cached('notice', () => {
    const W = 384;
    const H = 512;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#7b6a52';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#a89272';
    ctx.fillRect(14, 14, W - 28, H - 28);
    const r = rng(303);
    // 布告纸
    for (let i = 0; i < 12; i++) {
      const w = 52 + r() * 66;
      const h = 62 + r() * 70;
      const x = 22 + r() * (W - 44 - w);
      const y = 22 + r() * (H - 44 - h);
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate((r() - 0.5) * 0.14);
      ctx.fillStyle = ['#f4efe2', '#f7f2c8', '#e8eef5', '#f2e3d9'][i % 4];
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = 'rgba(60,60,70,0.55)';
      for (let l = 0; l < 5; l++) {
        ctx.fillRect(-w / 2 + 6, -h / 2 + 12 + l * (h / 7), w - 12 - r() * 14, 2.6);
      }
      if (i % 3 === 0) {
        ctx.fillStyle = ['#d0453a', '#2f6bd8', '#2f8f66'][i % 3];
        ctx.fillRect(-w / 2 + 6, -h / 2 + h * 0.55, w - 12, 12);
      }
      // 图钉
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(0, -h / 2 + 5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = '#4b3f2e';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, W - 8, H - 8);
    return finish(c);
  });
}

export function coolerBackTex(): THREE.Texture {
  return cached('coolerBack', () => {
    const W = 256;
    const H = 512;
    const [c, ctx] = mk(W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#dfe9f2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(120,140,165,0.35)';
    for (let i = 0; i < 6; i++) ctx.fillRect(0, 60 + i * 74, W, 4);
    return finish(c);
  });
}

export function popStripTex(): THREE.Texture {
  return cached('popStrip', () => {
    const W = 512;
    const H = 64;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#fffdf5';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffcf33';
    ctx.fillRect(0, 0, W, 12);
    ctx.fillStyle = '#c33';
    ctx.font = `800 30px ${JP}`;
    ctx.textBaseline = 'middle';
    const words = ['新発売', 'おすすめ', '100円', '限定', 'SALE'];
    ctx.textAlign = 'center';
    for (let i = 0; i < 5; i++) {
      ctx.fillText(words[i], (i + 0.5) * (W / 5), H * 0.62);
      if (i < 4) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect((i + 1) * (W / 5) - 1, 0, 2, H);
        ctx.fillStyle = '#c33';
      }
    }
    return finish(c);
  });
}

/* ============================================================
 * 玻璃贴膜 / 路面文字 / 建筑细节
 * ============================================================ */

export function glassFilmTex(): THREE.Texture {
  return cached('glassFilm', () => {
    const W = 1024;
    const H = 256;
    const [c, ctx] = mk(W, H);
    ctx.clearRect(0, 0, W, H);
    // 底部磨砂带
    ctx.fillStyle = 'rgba(246,247,242,0.9)';
    ctx.fillRect(0, H - 62, W, 62);
    ctx.fillStyle = hex(P.storeNavy);
    ctx.font = `700 30px ${JP}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('ホシノマート', 18, H - 31);
    ctx.textAlign = 'right';
    ctx.fillStyle = hex(P.storeCoral);
    ctx.font = `800 30px ${JP}`;
    ctx.fillText('24時間営業', W - 18, H - 31);
    // 小贴纸
    const stickers: [string, string][] = [
      ['ATM', '#2f6bd8'],
      ['コピー', '#2f8f66'],
      ['Wi-Fi', '#8c4bd0'],
      ['宅配', '#d4763a'],
    ];
    stickers.forEach(([label, color], i) => {
      const x = 60 + i * 116;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.beginPath();
      ctx.roundRect(x, 40, 88, 54, 10);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `800 ${label.length > 3 ? 20 : 24}px ${JP}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + 44, 68);
    });
    return finish(c);
  });
}

export function roadStopTex(): THREE.Texture {
  return cached('roadStop', () => {
    const W = 512;
    const H = 256;
    const [c, ctx] = mk(W, H);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(238,240,240,0.82)';
    ctx.font = `800 150px ${JP}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('止まれ', W / 2, H / 2);
    return finish(c);
  });
}

export function roadMarkTex(kind: 'P' | 'bike'): THREE.Texture {
  return cached('roadMark:' + kind, () => {
    const W = 256;
    const H = 256;
    const [c, ctx] = mk(W, H);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(240,242,240,0.85)';
    ctx.fillStyle = 'rgba(240,242,240,0.85)';
    ctx.lineWidth = 12;
    if (kind === 'P') {
      ctx.font = `800 190px ${JP}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', W / 2, H / 2);
    } else {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, 96, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W * 0.34, H * 0.66, 34, 0, Math.PI * 2);
      ctx.arc(W * 0.68, H * 0.66, 34, 0, Math.PI * 2);
      ctx.moveTo(W * 0.34, H * 0.66);
      ctx.lineTo(W * 0.5, H * 0.42);
      ctx.lineTo(W * 0.68, H * 0.66);
      ctx.moveTo(W * 0.5, H * 0.42);
      ctx.lineTo(W * 0.42, H * 0.3);
      ctx.stroke();
    }
    return finish(c);
  });
}

export function shutterTex(): THREE.Texture {
  return cached('shutter', () => {
    const W = 256;
    const H = 256;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#8d949c';
    ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 16) {
      const g = ctx.createLinearGradient(0, y, 0, y + 16);
      g.addColorStop(0, '#a4abb3');
      g.addColorStop(0.5, '#7e858d');
      g.addColorStop(1, '#5f666e');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, W, 15);
    }
    speckle(ctx, W, H, 71, 700, 0.05);
    return finish(c, { repeat: [1, 1] });
  });
}

export function acGrilleTex(): THREE.Texture {
  return cached('acGrille', () => {
    const W = 256;
    const H = 256;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#cdd2d8';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(60,68,80,0.35)';
    for (let y = 18; y < H - 12; y += 13) ctx.fillRect(12, y, W - 24, 5);
    ctx.strokeStyle = '#9aa1aa';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    return finish(c);
  });
}

export function brickTex(): THREE.Texture {
  return cached('brick', () => {
    const S = 512;
    const [c, ctx] = mk(S, S);
    ctx.fillStyle = '#3f4450';
    ctx.fillRect(0, 0, S, S);
    const bw = 64;
    const bh = 26;
    const r = rng(404);
    for (let row = 0; row < S / bh; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let col = -1; col < S / bw + 1; col++) {
        const v = 74 + Math.floor(r() * 26);
        ctx.fillStyle = `rgb(${v + 8},${v},${v - 4})`;
        ctx.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
      }
    }
    speckle(ctx, S, S, 405, 2400, 0.05);
    return finish(c, { repeat: [2, 2] });
  });
}

export function alleyNeonTex(text: string, color: string): THREE.Texture {
  return cached('neon:' + text, () => {
    const W = 128;
    const H = 512;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#0b0d14';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.strokeRect(9, 9, W - 18, H - 18);
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.font = `800 74px ${JP}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    text.split('').forEach((ch, i) => ctx.fillText(ch, W / 2, 78 + i * 86));
    return finish(c);
  });
}

export function concreteTex(): THREE.Texture {
  return cached('concrete', () => {
    const S = 256;
    const [c, ctx] = mk(S, S);
    ctx.fillStyle = '#767c88';
    ctx.fillRect(0, 0, S, S);
    const r = rng(808);
    for (let i = 0; i < 40; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 8 + r() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},255,0.04)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    speckle(ctx, S, S, 809, 1500, 0.05);
    // 模板缝
    ctx.strokeStyle = 'rgba(40,44,52,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
    return finish(c, { repeat: [2, 2] });
  });
}

/** 地面湿反光：暖色灯带在湿地上的竖向拖影（贴图直接画，比实时反射更像动画美术） */
export function wetSmearTex(warm = true): THREE.Texture {
  return cached('wetSmear:' + warm, () => {
    const W = 256;
    const H = 512;
    const [c, ctx] = mk(W, H);
    ctx.clearRect(0, 0, W, H);
    const r = rng(warm ? 111 : 222);
    const colors = warm
      ? ['rgba(255,214,150,', 'rgba(255,240,205,', 'rgba(255,186,120,']
      : ['rgba(120,200,255,', 'rgba(190,150,255,', 'rgba(110,235,210,'];
    for (let i = 0; i < 26; i++) {
      const x = W * 0.5 + (r() - 0.5) * W * 0.8;
      const w = 4 + r() * 30;
      const h = 120 + r() * 380;
      const y = H - h * 0.5 - r() * 60;
      const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
      const col = colors[Math.floor(r() * colors.length)];
      g.addColorStop(0, col + '0)');
      g.addColorStop(0.35, col + (0.18 + r() * 0.3).toFixed(2) + ')');
      g.addColorStop(1, col + '0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
    }
    // 横向波纹打断，让反射像水面
    ctx.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < H; y += 7) {
      ctx.fillStyle = `rgba(0,0,0,${0.12 + r() * 0.22})`;
      ctx.fillRect(0, y, W, 2.2);
    }
    ctx.globalCompositeOperation = 'source-over';

    // 边缘遮罩：贴地平面的边界必须彻底淡出，
    // 否则会在地面上看到一条硬边的椭圆弧（加色混合尤其明显）。
    // 注意必须用「椭圆」渐变：在 2:1 的贴图上用圆形渐变，
    // 左右边中点仍有 ~27% 不透明度，边界会直接露出来。
    ctx.globalCompositeOperation = 'destination-in';
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(1, H / W);
    const rr = W / 2;
    const mask = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(0.4, 'rgba(0,0,0,0.9)');
    mask.addColorStop(0.72, 'rgba(0,0,0,0.4)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mask;
    ctx.fillRect(-W / 2, -W / 2, W, W);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    return finish(c);
  });
}

export function puddleMaskTex(): THREE.Texture {
  return cached('puddleMask', () => {
    const S = 512;
    const [c, ctx] = mk(S, S);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    const r = rng(1313);
    for (let i = 0; i < 34; i++) {
      const x = 40 + r() * (S - 80);
      const y = 40 + r() * (S - 80);
      const rad = 26 + r() * 80;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const a = 0.5 + r() * 0.5;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.65, `rgba(255,255,255,${a * 0.55})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c, { srgb: false });
  });
}

export function sidewalkDecalTex(): THREE.Texture {
  return cached('sidewalkDecal', () => {
    const W = 512;
    const H = 128;
    const [c, ctx] = mk(W, H);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(232,236,232,0.62)';
    ctx.font = `700 54px ${JP}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('この先 工事中', W / 2, H / 2);
    return finish(c);
  });
}

/** 便利店内的墙面海报排 */
export function interiorPosterStrip(): THREE.Texture {
  return cached('interiorPosters', () => {
    const W = 512;
    const H = 256;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#eceae2';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) {
      const x = 12 + i * 168;
      const g = ctx.createLinearGradient(x, 0, x, 226);
      g.addColorStop(0, ['#ffd166', '#8ecae6', '#f4978e'][i]);
      g.addColorStop(1, ['#ef476f', '#219ebc', '#f07167'][i]);
      ctx.fillStyle = g;
      ctx.fillRect(x, 10, 150, 226);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.arc(x + 75, 96, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b2f3a';
      ctx.font = `800 26px ${JP}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(['新商品', 'クーポン', '季節限定'][i], x + 75, 172);
      ctx.font = `600 17px ${JP}`;
      ctx.fillText(['いちご', '50円引', '夏の味'][i], x + 75, 202);
    }
    return finish(c);
  });
}

export function coffeeMachineTex(): THREE.Texture {
  return cached('coffeeMachine', () => {
    const W = 256;
    const H = 384;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#2d3138';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(10, 10, W - 20, 86);
    ctx.fillStyle = '#7a3b1f';
    ctx.font = `800 34px ${JP}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COFFEE', W / 2, 44);
    ctx.fillStyle = '#3b4048';
    ctx.font = `600 18px ${JP}`;
    ctx.fillText('HOT / ICE', W / 2, 76);
    // 杯子出口
    ctx.fillStyle = '#15181d';
    ctx.fillRect(48, 220, W - 96, 92);
    ctx.fillStyle = '#d9dde3';
    ctx.font = `700 16px ${JP}`;
    ctx.fillText('カップ', W / 2, 268);
    // 按钮
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = ['#e8493f', '#f2a13b', '#3aa76d', '#2f6bd8'][i];
      ctx.beginPath();
      ctx.roundRect(36 + i * 48, 120, 36, 30, 6);
      ctx.fill();
    }
    return finish(c);
  });
}

export function registerTex(): THREE.Texture {
  return cached('register', () => {
    const W = 256;
    const H = 128;
    const [c, ctx] = mk(W, H);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#59e0ff';
    ctx.font = `600 16px ${JP}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('ホシノマート', 10, 8);
    ctx.fillText('合計 ¥ 1,280', 10, 32);
    ctx.fillStyle = '#f6f2e2';
    ctx.font = `700 40px ${JP}`;
    ctx.fillText('¥1,280', 10, 58);
    return finish(c);
  });
}

/**
 * 自动门玻璃上的贴纸带。
 *
 * 门扇是纯玻璃（透明 + 细边框），开合时几乎没有可读的视觉变化 ——
 * 远处的观众只会觉得"门一直没动"。真实便利店的玻璃门上也确实贴着
 * 一条横向的店铺信息带，正好用来把开合动作"演"出来。
 */
export function doorStickerTex(): THREE.Texture {
  return cached('doorSticker', () => {
    const W = 512;
    const H = 128;
    const [c, ctx] = mk(W, H);

    // 中间一条半透明贴膜带
    ctx.fillStyle = 'rgba(238,245,252,0.86)';
    ctx.fillRect(0, 38, W, 42);
    ctx.fillStyle = 'rgba(44,108,190,0.9)';
    ctx.fillRect(0, 38, W, 5);
    ctx.fillStyle = 'rgba(214,74,54,0.9)';
    ctx.fillRect(0, 75, W, 5);

    // 左：店名小字
    ctx.fillStyle = '#2a4864';
    ctx.font = `800 26px ${JP}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('自動ドア', 20, 60);

    // 中：几个小图标（表示禁止吸烟 / 24H / 防盗）
    const icons = ['24H', '防犯', '禁煙'];
    ctx.font = `700 17px ${JP}`;
    icons.forEach((t, i) => {
      const x = 196 + i * 62;
      ctx.fillStyle = 'rgba(120,150,180,0.28)';
      ctx.fillRect(x - 26, 46, 52, 28);
      ctx.fillStyle = '#3a5674';
      ctx.textAlign = 'center';
      ctx.fillText(t, x, 61);
    });

    // 右：OPEN
    ctx.fillStyle = '#c8402c';
    ctx.font = `800 30px ${JP}`;
    ctx.textAlign = 'right';
    ctx.fillText('OPEN', W - 20, 60);

    return finish(c);
  });
}

/** 便利店：天花灯箱发光面板（纯白 + 微网格） */
export function lightPanelTex(): THREE.Texture {
  return cached('lightPanel', () => {
    const W = 256;
    const H = 128;
    const [c, ctx] = mk(W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#f2f6ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(150,170,200,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    return finish(c);
  });
}

export function storeRoofTex(): THREE.Texture {
  return cached('storeRoof', () => {
    const S = 256;
    const [c, ctx] = mk(S, S);
    ctx.fillStyle = '#4a505c';
    ctx.fillRect(0, 0, S, S);
    return finish(c);
  });
}
