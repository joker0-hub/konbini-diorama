/**
 * 底座与街道铺装。
 *
 * 所有坐标从 layout.ts 的 L 读取，不在这里硬编码。
 * 底座是一个"收藏级"石台：顶部铺装，四周石材收边，正面有铭牌。
 */

import * as THREE from 'three';
import { P } from '../core/palette';
import { addBox, addCyl, flatPolygon, group, noOutline, uvPlaneGeo } from '../core/geom';
import { decal, toon, RAMP_SMOOTH } from '../core/materials';
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

export function buildBase(root: THREE.Object3D, ctx: SceneCtx) {
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
  const road = new THREE.Mesh(roadGeometry(4.5), asphalt);
  road.name = 'asphalt';
  road.receiveShadow = true;
  g.add(road);

  // 沥青湿了会变深，先压暗底色，再叠加实时倒影。
  const wetMask = new THREE.MeshBasicMaterial({
    color: 0x080b12,
    alphaMap: TX.puddleMaskTex(),
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const puddles = new THREE.Mesh(roadGeometry(7.3), wetMask);
  puddles.renderOrder = -2;
  noOutline(puddles);
  g.add(puddles);
  ctx.wet.push({ mesh: puddles, base: 0.34 });

  /* ---------------- 人行道（L 形挤出） ---------------- */
  const walkMat = toon(0xffffff, { map: TX.sidewalkTex(), ramp: RAMP_SMOOTH });
  const shape = new THREE.Shape([
    new THREE.Vector2(-H, H),
    new THREE.Vector2(L.walk.xOuter, H),
    new THREE.Vector2(L.walk.xOuter, -L.walk.zOuter),
    // Everything beyond zOuter is roadway. The old polygon extended to z=8,
    // hiding the asphalt/snow and visually burying bottles resting on the road.
    new THREE.Vector2(-H, -L.walk.zOuter),
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
  const curbPath = new THREE.Shape([
    new THREE.Vector2(-H, -L.walk.zOuter),
    new THREE.Vector2(L.walk.xOuter, -L.walk.zOuter),
    new THREE.Vector2(L.walk.xOuter, H),
    new THREE.Vector2(L.walk.xOuter - 0.2, H),
    new THREE.Vector2(L.walk.xOuter - 0.2, -L.walk.zOuter + 0.2),
    new THREE.Vector2(-H, -L.walk.zOuter + 0.2),
  ]);
  const curbMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(curbPath, { depth: 0.03, bevelEnabled: false }), curb);
  curbMesh.rotation.x = -Math.PI / 2;
  curbMesh.position.y = L.curb;
  curbMesh.castShadow = curbMesh.receiveShadow = true;
  g.add(curbMesh);
  const curbJoint = toon(0x777d83);
  for (let x = -H + 0.6; x < L.walk.xOuter - 0.2; x += 0.75) {
    noOutline(addBox(g, curbJoint, 0.009, 0.002, 0.19, x, L.curb + 0.03, L.walk.zOuter - 0.1, { cast: false }));
  }
  for (let z = -H + 0.6; z < L.walk.zOuter - 0.2; z += 0.75) {
    noOutline(addBox(g, curbJoint, 0.19, 0.002, 0.009, L.walk.xOuter - 0.1, L.curb + 0.03, z, { cast: false }));
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
    addBox(gg, grateMat, 0.66, 0.018, 0.42, 0, 0.005, 0, { r: 0.006 });
    for (let i = 0; i < 7; i++) addBox(gg, grateBar, 0.54, 0.003, 0.026, 0, 0.023, -0.16 + i * 0.053, { cast: false });
    for (const sx of [-1, 1]) addBox(gg, grateMat, 0.015, 0.005, 0.35, sx * 0.20, 0.025, 0, { cast: false });
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
    noOutline(m);
  };
  mkManhole(-2.6, 5.6, 1);
  mkManhole(6.4, -2.2, 0.8);

  /* ---------------- 路面标线 ---------------- */
  const markings = group(g, 0, 0, 0, 'road-markings');
  const paint = new THREE.MeshBasicMaterial({ color: 0xc6cdd2, toneMapped: false, transparent: true, opacity: 0.5, depthWrite: false });
  const addPaint = (w: number, d: number, x: number, z: number, op = 0.5, ry = 0) => {
    const m = new THREE.Mesh(uvPlaneGeo(w, d, 1), paint.clone());
    const mm = m.material as THREE.MeshBasicMaterial;
    mm.opacity = op;
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = ry;
    m.position.set(x, 0.014, z);
    markings.add(m);
    noOutline(m);
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
  markings.add(stop);
  noOutline(stop);

  // 自行车道标记
  const bike = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({
    map: TX.roadMarkTex('bike'), transparent: true, opacity: 0.26, depthWrite: false, toneMapped: false,
  }));
  bike.rotation.x = -Math.PI / 2;
  bike.position.set(0.6, 0.015, 5.4);
  markings.add(bike);
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
  markings.add(pMark);
  noOutline(pMark);

  /* ---------------- 导盲砖 ----------------
   * 只铺在人行道上。旧版两条都是写死的固定长度：
   *  - 横向那条往右铺到 x = 6.9，直接压在右侧斑马线上（斑马线 x ∈ [4.4, 8]）；
   *  - 纵向那条往南铺到 z = 5.2，越过路缘石（z = 3.4）躺在车行道上。
   * 现在两端都按人行道边界收口，并在路缘一侧留 15cm 安全带 ——
   * 盲道紧贴路缘石会被误读成"路面标线"，而这正是它之前看起来像黄线的原因。
   */
  const tactile = toon(P.tactile);
  const tactileRib = toon(0xe2bd59);
  const tactileJoint = toon(0x9e873e);
  const tactileStrip = (length: number, x: number, z: number, rotation = 0): void => {
    const strip = group(g, x, L.curb, z, 'tactile-paving');
    strip.rotation.y = rotation;
    addBox(strip, tactile, length, 0.009, 0.3, 0, 0, 0, { cast: false });
    for (let i = -1.5; i <= 1.5; i++) {
      noOutline(addBox(strip, tactileRib, length - 0.016, 0.006, 0.023, 0, 0.009, i * 0.062, { r: 0.003, cast: false }));
    }
    for (let pos = -length / 2 + 0.3; pos < length / 2 - 0.03; pos += 0.3) {
      noOutline(addBox(strip, tactileJoint, 0.006, 0.001, 0.292, pos, 0.009, 0, { cast: false }));
    }
  };
  const TACTILE_INSET = 0.15;
  // 横向：沿店面前沿走，从台座左缘到右侧人行道内边
  {
    const x0 = -H + 0.1;
    const x1 = L.walk.xOuter - TACTILE_INSET;
    tactileStrip(x1 - x0, (x0 + x1) / 2, L.walk.zInner + 0.55);
  }
  // 纵向：沿侧街走，从前侧路缘石内侧收口到后侧
  {
    const z0 = -6.8;
    const z1 = L.walk.zOuter - TACTILE_INSET;
    // Stop at the junction tile so the two sets of ribs never overlap.
    const junctionZ = L.walk.zInner + 0.55;
    tactileStrip(junctionZ - 0.15 - z0, L.walk.xInner + 0.55, (junctionZ - 0.15 + z0) / 2, Math.PI / 2);
    tactileStrip(z1 - junctionZ - 0.15, L.walk.xInner + 0.55, (z1 + junctionZ + 0.15) / 2, Math.PI / 2);
  }

  const junctionX = L.walk.xInner + 0.55, junctionZ = L.walk.zInner + 0.55;
  addBox(g, tactile, 0.3, 0.008, 0.3, junctionX, L.curb + 0.016, junctionZ, { cast: false });
  for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 4; iz++) {
    addCyl(g, tactileRib, 0.013, 0.016, 0.006, junctionX - 0.105 + ix * 0.07,
      L.curb + 0.024, junctionZ - 0.105 + iz * 0.07, { seg: 8, cast: false });
  }
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
  return { root: g, markings };
}

function roadGeometry(tile: number): THREE.BufferGeometry {
  return flatPolygon([
    [-H, L.road.z], [L.road.x, L.road.z], [L.road.x, -H],
    [H, -H], [H, H], [-H, H],
  ], tile);
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

      float ring(vec2 center, vec2 f, float t, float seed, float pixel) {
        float period = 0.8 + seed * 0.85;
        float phase = fract(t / period + seed * 7.13);
        float r = phase * 0.42;
        float d = length(f - center);
        // 环要细：宽一点就变成"地上的圆圈"而不是雨点
        float w = 0.006 + phase * 0.009;
        float filterWidth = max(w, pixel);
        float a = (1.0 - smoothstep(0.0, filterWidth, abs(d - r))) * (w / filterWidth);
        float fade = (1.0 - smoothstep(0.28, 1.0, phase)) * smoothstep(0.0, 0.05, phase);
        return a * fade;
      }

      void main() {
        float cell = 0.85;
        vec2 uv = vWorld / cell;
        float pixel = max(length(dFdx(uv)), length(dFdy(uv)));
        vec2 gc = floor(uv);
        vec2 f = fract(uv);
        float acc = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 gid = gc + vec2(float(x), float(y));
            float h = hash(gid);
            vec2 center = vec2(hash(gid + 3.7), hash(gid + 11.3)) * 0.64 + 0.18;
            acc += ring(center, f - vec2(float(x), float(y)), uTime + h * 3.1, h, pixel);
          }
        }
        float edge = 1.0 - smoothstep(uArea * 0.42, uArea * 0.5, max(abs(vWorld.x), abs(vWorld.y)));
        edge *= 1.0 - smoothstep(0.045, 0.13, pixel);
        float a = clamp(acc, 0.0, 1.0) * uOpacity * edge;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  return new THREE.Mesh(roadGeometry(1), mat);
}
