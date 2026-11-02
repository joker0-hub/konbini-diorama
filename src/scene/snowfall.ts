/**
 * 飘雪。
 *
 * 和雨不同：雨是细长竖条、速度快、几乎是直线；雪是圆点、速度慢、
 * 有明显的横向飘动。所以这里不复用雨的着色器，单独写一套：
 *
 * - 实例化四边形，每个粒子的位置在顶点着色器里算，
 *   因此 CPU 每帧只更新一个 uniform（时间），没有逐粒子的 JS 开销。
 * - 雪花绕自身做缓慢旋转 + 左右摇摆（两路不同频率的正弦叠加），
 *   这是"雪"最关键的视觉特征；只下落不摇摆看起来像白点雨。
 * - 用圆形的软边贴片（着色器里按 uv 距离裁剪），而不是方形面片。
 */

import * as THREE from 'three';
import { L } from './layout';
import type { SnowPatch } from './snow';

const VERT = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec3 aRand;

  uniform float uTime;
  uniform float uHeight;
  uniform float uArea;
  uniform float uFallSpeed;
  uniform sampler2D uSurfaceMap;

  varying float vAlpha;
  varying vec2 vUv;

  void main() {
    vUv = uv;

    // 下落：从顶部循环回底部
    float speed = uFallSpeed * (0.65 + aRand.x * 0.7);
    float y = aOffset.y - uTime * speed;
    y = mod(y, uHeight);

    // 横向摇摆：两路不同频率的正弦叠加，避免整齐划一的往复
    float sway = sin(uTime * (0.7 + aRand.y * 0.9) + aRand.z * 6.28) * 0.35
               + sin(uTime * (1.9 + aRand.z * 1.3) + aRand.x * 6.28) * 0.12;

    vec3 p = vec3(aOffset.x + sway, y, aOffset.z + sin(uTime * 0.43 + aRand.x * 6.28) * 0.18);
    float surfaceY = texture2D(uSurfaceMap, clamp(p.xz / 16.6 + 0.5, 0.0, 1.0)).r;

    // 世界坐标 -> 摄像机朝向的四边形
    vec4 mvCenter = modelViewMatrix * vec4(p, 1.0);
    float size = 0.026 + aRand.y * 0.038;
    // 远处的雪花缩小一点，控制"雪片大小不随距离爆炸"
    size *= clamp(10.0 / -mvCenter.z, 0.25, 1.2);

    mvCenter.xy += position.xy * size;
    gl_Position = projectionMatrix * mvCenter;

    // 靠近地面淡出，避免在地砖上留一层生硬的白点
    // Snow lands on the highest roof/hood/pavement instead of falling through the shop.
    vAlpha = smoothstep(surfaceY + 0.015, surfaceY + 0.13, y)
      * (1.0 - smoothstep(uHeight * 0.88, uHeight, y));
    vAlpha *= 0.62 + 0.38 * abs(sin(uTime * 1.4 + aRand.z * 6.28));
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying float vAlpha;
  varying vec2 vUv;
  uniform float uOpacity;
  uniform vec3 uColor;

  void main() {
    // 圆形软边
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float mask = 1.0 - smoothstep(0.55, 1.0, r);
    float a = mask * vAlpha * uOpacity;
    if (a <= 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export interface Snowfall {
  update: (t: number, opacity: number) => void;
  setOpacity: (v: number) => void;
}

export function buildSnowfall(
  root: THREE.Object3D,
  opts: { count?: number; height?: number; area?: number; surfaces?: readonly SnowPatch[] } = {},
): Snowfall {
  const count = opts.count ?? 1800;
  const height = opts.height ?? 11;
  const area = opts.area ?? 15;

  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = count;

  const offs = new Float32Array(count * 3);
  const rands = new Float32Array(count * 3);
  let seed = 7391;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) {
    offs[i * 3] = (random() - 0.5) * area;
    offs[i * 3 + 1] = random() * height;
    offs[i * 3 + 2] = (random() - 0.5) * area;
    rands[i * 3] = random();
    rands[i * 3 + 1] = random();
    rands[i * 3 + 2] = random();
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 3));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 3));

  const resolution = 256;
  const heights = new Float32Array(resolution * resolution);
  for (let iz = 0; iz < resolution; iz++) for (let ix = 0; ix < resolution; ix++) {
    const x = ((ix + 0.5) / resolution - 0.5) * 16.6;
    const z = ((iz + 0.5) / resolution - 0.5) * 16.6;
    let top = x < L.walk.xOuter && z < L.walk.zOuter ? L.curb : 0;
    for (const s of opts.surfaces ?? []) {
      if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) top = Math.max(top, s.y);
    }
    heights[iz * resolution + ix] = top;
  }
  const surfaceMap = new THREE.DataTexture(heights, resolution, resolution, THREE.RedFormat, THREE.FloatType);
  surfaceMap.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: height },
      uArea: { value: area },
      uFallSpeed: { value: 0.62 },
      uSurfaceMap: { value: surfaceMap },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xf2f7ff) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    fog: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'snowfall';
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  // Layer 2 is excluded from the depth-outline pass.
  mesh.layers.set(2);
  root.add(mesh);

  return {
    update(t, opacity) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uOpacity.value = opacity;
      mesh.visible = opacity > 0.004;
    },
    setOpacity(v) {
      mat.uniforms.uOpacity.value = v;
    },
  };
}
