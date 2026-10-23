/**
 * 底座与街道铺装。
 *
 * 所有坐标从 layout.ts 的 L 读取，不在这里硬编码。
 * 底座是一个"收藏级"石台：顶部铺装，四周石材收边，正面有铭牌。
 */

import * as THREE from 'three';
import { P } from '../core/palette';
import { addBox, addTiled, group, noOutline, uvPlaneGeo } from '../core/geom';
import { additiveClone, decal, toon, RAMP_SMOOTH } from '../core/materials';
import * as TX from '../core/textures';
import { L } from './layout';
import type { WetEntry } from './wet';

const H = L.half;

export interface SceneCtx {
  pieces: THREE.Object3D[];
  ticks: ((t: number, dt: number) => void)[];
  flickers: { mat: THREE.MeshBasicMaterial; base: number; seed: number; amp: number }[];
  /** 需要跟随「湿度 / 降雨」淡入淡出的湿地面层 */
  wet: WetEntry[];
}

export function buildBase(root: THREE.Object3D, ctx: SceneCtx): THREE.Group {
  const g = group(root, 0, 0, 0, 'base');

  /* ---------------- 台座 ---------------- */
  const stone = toon(P.baseStone);
  const stoneLight = toon(P.baseStoneLight);
  addBox(g, stone, H * 2 + 0.6, 0.7, H * 2 + 0.6, 0, -0.78, 0, { r: 0.05 });
  addBox(g, stoneLight, H * 2 + 0.46, 0.12, H * 2 + 0.46, 0, -0.14, 0);
  addBox(g, toon(0x0b0e15), H * 2 + 0.63, 0.045, H * 2 + 0.63, 0, -0.42, 0);
  addBox(g, stone, H * 2 + 0.22, 0.14, H * 2 + 0.22, 0, -0.9, 0, { r: 0.03 });
  // 铭牌
  {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.26), toon(0x9c8a5e));
    plate.position.set(0, -0.52, H + 0.31);
    g.add(plate);
    const txt = new THREE.Mesh(new THREE.PlaneGeometry(1.78, 0.2), decal(namePlateTex(), 1));
    txt.position.set(0, -0.52, H + 0.316);
    g.add(txt);
    noOutline(txt);
  }

  /* ---------------- 沥青 ---------------- */
  const asphalt = toon(0xffffff, { map: TX.asphaltTex(), ramp: RAMP_SMOOTH });
  addTiled(g, asphalt, H * 2, H - L.road.z, 4.5, 0, 0, (H + L.road.z) / 2);
  addTiled(g, asphalt, H - L.road.x, L.road.z + H, 4.5,
    (H + L.road.x) / 2, 0.0015, (L.road.z - H) / 2);

  // 湿斑：只在马路上做。铺在粗糙的砖面上时，这块软边深色贴图看起来
  // 更像"地上有一摊脏东西"而不是水，所以人行道不叠加它，
  // 改由温湿反光贴（additive）来表达。
  // 用独立材质：它的 opacity 要跟随天气湿度变化（晴天不能还是湿的）。
  const wetMask = new THREE.MeshBasicMaterial({
    color: 0x080b12,
    map: TX.puddleMaskTex(),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const wetMaskA = addTiled(g, wetMask, H * 2, H - L.road.z, 8, 0, 0.004, (H + L.road.z) / 2);
  const wetMaskB = addTiled(g, wetMask, H - L.road.x, L.road.z + H, 8, (H + L.road.x) / 2, 0.005, (L.road.z - H) / 2);
  ctx.wet.push({ mesh: wetMaskA, base: 0.34 }, { mesh: wetMaskB, base: 0.34 });

  /* ---------------- 人行道（L 形挤出） ---------------- */
  const walkMat = toon(0xffffff, { map: TX.sidewalkTex(), ramp: RAMP_SMOOTH });
  const shape = new THREE.Shape([
    new THREE.Vector2(-H, H),
    new THREE.Vector2(L.walk.xOuter, H),
    new THREE.Vector2(L.walk.xOuter, -L.walk.zOuter),
    new THREE.Vector2(H, -L.walk.zOuter),
    new THREE.Vector2(H, -H),
    new THREE.Vector2(-H, -H),
  ]);
  const walkGeo = new THREE.ExtrudeGeometry(shape, { depth: L.curb, bevelEnabled: false, curveSegments: 1 });
  walkGeo.rotateX(-Math.PI / 2);
  // 挤出方向是 +Z，rotateX(-90°) 后变成 +Y：几何体本身已经是 0..L.curb 厚。
  // 之前这里又 translate 了 L.curb，整个人行道被抬到 0.14..0.28 ——
  // 自行车、垃圾桶、护栏、信号灯全部按 0.14 摆放，于是轮胎埋进路面 14cm。
  // 人行道顶面必须正好是 L.curb，和 layout / 湿地 / 积雪的高度约定一致。
  {
    const pos = walkGeo.attributes.position as THREE.BufferAttribute;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + H) / 2.4;
      uv[i * 2 + 1] = (pos.getZ(i) + H) / 2.4;
    }
    walkGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    walkGeo.computeVertexNormals();
  }
  const walk = new THREE.Mesh(walkGeo, walkMat);
  walk.name = 'sidewalk';
  walk.receiveShadow = true;
  walk.castShadow = false;
  g.add(walk);

  /* ---------------- 路缘石 ---------------- */
  const curb = toon(P.curb);
  addBox(g, curb, L.walk.xOuter + H + 0.2, 0.07, 0.2, (L.walk.xOuter - H) / 2, L.curb - 0.04, L.walk.zOuter - 0.1);
  addBox(g, curb, 0.2, 0.07, L.walk.zOuter + H + 0.2, L.walk.xOuter - 0.1, L.curb - 0.04, (L.walk.zOuter - H) / 2);
  {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 14, 1, false, 0, Math.PI / 2), curb);
    c.position.set(L.walk.xOuter - 0.1, L.curb, L.walk.zOuter - 0.1);
    c.castShadow = true;
    g.add(c);
  }

  /* ---------------- 排水沟 ---------------- */
  const gutter = toon(0x1c2028);
  addBox(g, gutter, H + L.walk.xOuter - 0.2, 0.016, 0.3, (-H + L.walk.xOuter) / 2, 0.008, L.road.z + 0.3);
  addBox(g, gutter, 0.3, 0.016, H + L.road.z - 0.2, L.road.x + 0.3, 0.008, (-H + L.road.z) / 2);

  const grateMat = toon(0x3d434c);
  const grateBar = toon(0x12151b);
  const mkGrate = (x: number, z: number, ry = 0) => {
    const gg = group(g, x, 0, z);
    gg.rotation.y = ry;
    addBox(gg, grateMat, 0.66, 0.06, 0.42, 0, 0.004, 0);
    for (let i = 0; i < 7; i++) addBox(gg, grateBar, 0.54, 0.055, 0.026, 0, 0.058, -0.16 + i * 0.053);
  };
  mkGrate(-5.4, L.road.z + 0.3);
  mkGrate(-1.6, L.road.z + 0.3);
  mkGrate(2.2, L.road.z + 0.3);
  mkGrate(L.road.x + 0.3, -3.6, Math.PI / 2);
  mkGrate(L.road.x + 0.3, 0.6, Math.PI / 2);

  // 井盖
  const mhMat = toon(0xffffff, { map: TX.manholeTex(), transparent: true });
  const mkManhole = (x: number, z: number, s: number) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 22), mhMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.01, z);
    m.scale.setScalar(s);
    g.add(m);
  };
  mkManhole(-2.6, 5.6, 1);
  mkManhole(6.4, -2.2, 0.8);

  /* ---------------- 路面标线 ---------------- */
  const paint = new THREE.MeshBasicMaterial({ color: 0xc6cdd2, toneMapped: false, transparent: true, opacity: 0.5, depthWrite: false });
  const addPaint = (w: number, d: number, x: number, z: number, op = 0.5, ry = 0) => {
    const m = new THREE.Mesh(uvPlaneGeo(w, d, 1), paint.clone());
    const mm = m.material as THREE.MeshBasicMaterial;
    mm.opacity = op;
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = ry;
    m.position.set(x, 0.014, z);
    g.add(m);
  };
  // 斑马线（横跨前马路）
  for (let i = 0; i < 8; i++) addPaint(0.48, 3.6, -4.6 + i * 0.9, (L.road.z + H) / 2, 0.46);
  // 斑马线（横跨右马路）
  for (let i = 0; i < 8; i++) addPaint(3.6, 0.48, (L.road.x + H) / 2, -3.6 + i * 0.9, 0.46);
  // 中线
  addPaint(H - L.road.x - 0.6, 0.12, (H + L.road.x) / 2, 6.8, 0.34);
  addPaint(0.12, H - L.road.z - 0.6, 7.0, (H + L.road.z) / 2, 0.34);

  // 「止まれ」
  const stop = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({
    map: TX.roadStopTex(), transparent: true, opacity: 0.56, depthWrite: false, toneMapped: false,
  }));
  stop.rotation.x = -Math.PI / 2;
  stop.rotation.z = Math.PI;
  stop.position.set(-2.4, 0.015, 6.8);
  g.add(stop);
  noOutline(stop);

  // 自行车道标记
  const bike = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({
    map: TX.roadMarkTex('bike'), transparent: true, opacity: 0.26, depthWrite: false, toneMapped: false,
  }));
  bike.rotation.x = -Math.PI / 2;
  bike.position.set(0.6, 0.015, 5.4);
  g.add(bike);
  noOutline(bike);

  /* ---------------- 停车位 ---------------- */
  for (let i = 0; i < 2; i++) {
    const x = 5.4 + i * 2.4;
    addPaint(0.12, 3.4, x - 1.2, 6.4, 0.4);
  }
  const pMark = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({
    map: TX.roadMarkTex('P'), transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false,
  }));
  pMark.rotation.x = -Math.PI / 2;
  pMark.position.set(4.75, 0.015, 7.2);
  g.add(pMark);
  noOutline(pMark);

  /* ---------------- 导盲砖 ---------------- */
  const tactile = toon(P.tactile);
  addBox(g, tactile, 15.0, 0.014, 0.3, -0.6, L.curb - 0.007, L.walk.zInner + 0.55);
  addBox(g, tactile, 0.3, 0.014, 12.0, L.walk.xInner + 0.55, L.curb - 0.007, -0.8);

  /* ---------------- 湿地反光 ---------------- */
  // 关键：路面 y≈0，人行道面 y=curb（0.14）。
  // 反光片必须分别贴在这两个高度上 —— 统一放在 0.024 会整个沉到人行道下面，
  // 于是玻璃里透出的暖光在地上完全没有倒影，画面就会显得"干"。
  const warm = TX.wetSmearTex(true);
  const cool = TX.wetSmearTex(false);
  const ROAD_Y = 0.022;
  const WALK_Y = L.curb + 0.008;
  const smear = (
    map: THREE.Texture, w: number, d: number, x: number, z: number,
    op: number, y: number, ry = 0, color = 0xffffff,
  ) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), additiveClone(map, color, op));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = ry;
    m.position.set(x, y, z);
    m.renderOrder = 3;
    g.add(m);
    noOutline(m);
    // 每个反光片独立材质，湿度变化时逐片淡出
    ctx.wet.push({ mesh: m, base: op });
  };
  // 人行道上的主倒影（便利店灯光 → 地面）
  smear(warm, 10.5, 6.4, -1.4, 1.9, 0.85, WALK_Y);
  smear(warm, 6.0, 6.0, 3.5, 0.6, 0.5, WALK_Y);
  smear(cool, 5.4, 4.6, 3.3, -3.0, 0.28, WALK_Y, Math.PI / 2);
  // 门口的强反射
  smear(warm, 5.0, 4.6, 1.0, 3.0, 0.62, WALK_Y, 0, 0xfff2d8);
  // 马路上的倒影
  smear(warm, 6.0, 5.0, -1.0, 5.4, 0.4, ROAD_Y);
  smear(cool, 5.0, 4.2, 6.0, 5.0, 0.24, ROAD_Y);
  smear(cool, 4.4, 3.6, -5.8, 6.4, 0.2, ROAD_Y);
  // 路灯下的长条反光
  smear(warm, 2.4, 5.0, -5.7, 2.4, 0.42, WALK_Y, 0, 0xffd9a3);
  // 小巷口
  smear(warm, 2.2, 3.0, -6.6, -1.5, 0.3, WALK_Y, 0, 0xff9fbf);

  /* ---------------- 积水涟漪 ---------------- */
  const ripple = makeRipples();
  ripple.position.set(0, 0.028, 0);
  ripple.renderOrder = 4;
  noOutline(ripple);
  g.add(ripple);
  // 涟漪只在「下雨」时出现，晴天/雪天由 wet 控制器整体关掉
  ctx.wet.push({ mesh: ripple, base: 0.22, ripple: true });
  ctx.ticks.push((t) => {
    (ripple.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
  });

  ctx.pieces.push(g);
  return g;
}

function namePlateTex(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 72;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 640, 72);
  ctx.fillStyle = '#f0e6cc';
  ctx.font = '500 30px "Yu Gothic", Meiryo, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('雨 の 夜 の コ ン ビ ニ  —  1 / 100', 320, 38);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * 雨点涟漪：整片地面按格子切开，每格一个周期性圆环。
 * 一个 ShaderMaterial + 一块平面，比几十个 ring mesh 便宜得多。
 */
function makeRipples(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xa8d8ff) },
      uOpacity: { value: 0.22 },
      uArea: { value: L.half * 2 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vWorld;
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uArea;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 345.45));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
      }

      float ring(vec2 center, vec2 f, float t, float seed) {
        float period = 0.8 + seed * 0.85;
        float phase = fract(t / period + seed * 7.13);
        float r = phase * 0.42;
        float d = length(f - center);
        // 环要细：宽一点就变成"地上的圆圈"而不是雨点
        float w = 0.006 + phase * 0.009;
        float a = smoothstep(w, 0.0, abs(d - r));
        float fade = (1.0 - smoothstep(0.28, 1.0, phase)) * smoothstep(0.0, 0.05, phase);
        return a * fade;
      }

      void main() {
        float cell = 0.85;
        vec2 uv = vWorld / cell;
        vec2 gc = floor(uv);
        vec2 f = fract(uv);
        float acc = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 gid = gc + vec2(float(x), float(y));
            float h = hash(gid);
            vec2 center = vec2(hash(gid + 3.7), hash(gid + 11.3)) * 0.64 + 0.18;
            acc += ring(center, f - vec2(float(x), float(y)), uTime + h * 3.1, h);
          }
        }
        float edge = smoothstep(uArea * 0.5, uArea * 0.42, max(abs(vWorld.x), abs(vWorld.y)));
        float a = clamp(acc, 0.0, 1.0) * uOpacity * edge;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(L.half * 2, L.half * 2, 1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}
