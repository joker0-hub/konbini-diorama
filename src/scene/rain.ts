/**
 * 降雨系统。
 *
 * 一个 InstancedBufferGeometry 装全部雨丝，顶点着色器里做公告板 + 垂直循环，
 * CPU 每帧只更新一个 uTime —— 8000 条雨丝也只有 1 个 draw call。
 * 雨丝按 Y 分两段颜色：高处是冷蓝，落到店门口附近被暖光染成金，这是
 * "雨夜便利店" 最标志性的一笔。
 */

import * as THREE from 'three';
import { CANOPY, L } from './layout';

const VERT = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec3 iParams; // x = speed, y = length, z = seed
  uniform float uTime;
  uniform float uHeight;
  uniform vec3 uRight;
  uniform vec3 uCamPos;
  uniform float uWind;
  varying float vAlpha;
  varying float vWarm;
  varying vec2 vUv;
  varying vec3 vRainPosition;

  void main() {
    vUv = uv;
    float speed = iParams.x;
    float len = iParams.y;

    // 垂直循环：把时间折算成下落距离后取模，永远在场内
    float y = mod(iOffset.y - uTime * speed, uHeight);
    vec3 center = vec3(iOffset.x, y, iOffset.z);
    // 风：越往下越被吹偏
    center.x += uWind * (1.0 - y / uHeight) * 1.4;
    center.z += uWind * 0.35 * (1.0 - y / uHeight) * 1.4;

    // 公告板：横向用摄像机右向量，纵向沿世界 Y（略带倾斜）
    vec3 pos = center + uRight * position.x * 1.0 + vec3(0.06 * uWind, -1.0, 0.0) * position.y * len;
    vRainPosition = pos;

    // 距离衰减 + 顶部淡出，避免"雨从天而降突然出现"的硬边
    float dist = distance(center, uCamPos);
    vAlpha = smoothstep(0.6, 2.3, dist) * (1.0 - smoothstep(13.0, 26.0, dist)) * 0.62;
    // 高度越接近地面越淡（雨丝在灯下更明显，落地前消失）
    vAlpha *= smoothstep(0.0, 0.7, y);

    // 便利店暖光区（x∈[-6,4], z∈[-5,4]）附近的雨丝染暖色
    vec2 d = vec2(center.x + 1.0, center.z - 0.0);
    vWarm = clamp(1.0 - length(d) / 6.0, 0.0, 1.0) * smoothstep(1.0, 4.0, y);

    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uCold;
  uniform vec3 uWarm;
  uniform float uOpacity;
  uniform vec4 uStoreBounds;
  uniform vec4 uCanopyBounds;
  uniform float uRoofHeight;
  uniform float uCanopyHeight;
  varying float vAlpha;
  varying float vWarm;
  varying vec2 vUv;
  varying vec3 vRainPosition;

  bool underCover(vec4 bounds, float height) {
    return vRainPosition.y < height
      && all(greaterThan(vRainPosition.xz, bounds.xy))
      && all(lessThan(vRainPosition.xz, bounds.zw));
  }

  void main() {
    if (underCover(uStoreBounds, uRoofHeight) || underCover(uCanopyBounds, uCanopyHeight)) discard;
    // 雨丝两端收细：横向硬边、纵向渐变，接近手绘动画里的雨
    float edge = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
    float taper = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
    float a = vAlpha * edge * taper * uOpacity;
    if (a < 0.004) discard;
    vec3 col = mix(uCold, uWarm, vWarm * 0.85);
    gl_FragColor = vec4(col, a);
  }
`;

export interface RainHandles {
  mesh: THREE.Mesh;
  update(t: number, dt: number, cam: THREE.Camera): void;
  setDensity(v: number): void;
}

export function buildRain(root: THREE.Object3D, opts: { count?: number; height?: number; area?: number } = {}): RainHandles {
  const count = opts.count ?? 2600;
  const height = opts.height ?? 11;
  const area = opts.area ?? 17;

  const base = new THREE.PlaneGeometry(0.018, 1, 1, 1);
  // 把 UV 收成 0..1 保留即可，顶点着色器自己用 position.y 当长度
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = count;

  const offs = new Float32Array(count * 3);
  const params = new Float32Array(count * 3);
  let seed = 20240607;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i++) {
    offs[i * 3 + 0] = (rnd() - 0.5) * area;
    offs[i * 3 + 1] = rnd() * height;
    offs[i * 3 + 2] = (rnd() - 0.5) * area;
    params[i * 3 + 0] = 7.5 + rnd() * 6.5;
    params[i * 3 + 1] = 0.22 + rnd() * 0.42;
    params[i * 3 + 2] = rnd();
  }
  geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(offs, 3));
  geo.setAttribute('iParams', new THREE.InstancedBufferAttribute(params, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), area);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: height },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uCamPos: { value: new THREE.Vector3() },
      uWind: { value: 0.55 },
      uCold: { value: new THREE.Color(0x9ecbff).multiplyScalar(1.15) },
      uWarm: { value: new THREE.Color(0xffdca8).multiplyScalar(1.5) },
      uOpacity: { value: 0.95 },
      uStoreBounds: { value: new THREE.Vector4(L.store.x0, L.store.z0, L.store.x1, L.store.z1) },
      uCanopyBounds: { value: new THREE.Vector4(
        CANOPY.x - CANOPY.w / 2, CANOPY.z - CANOPY.d / 2,
        CANOPY.x + CANOPY.w / 2, CANOPY.z + CANOPY.d / 2,
      ) },
      uRoofHeight: { value: L.store.roofY },
      uCanopyHeight: { value: CANOPY.top },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  mesh.layers.set(1);
  mesh.name = 'rain-streaks';
  root.add(mesh);

  const camRight = new THREE.Vector3();

  return {
    mesh,
    update(t, dt, cam) {
      mat.uniforms.uTime.value = t;
      camRight.setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
      mat.uniforms.uRight.value.copy(camRight);
      mat.uniforms.uCamPos.value.copy(cam.position);
      mat.uniforms.uWind.value = 0.5 + Math.sin(t * 0.21) * 0.22;
    },
    setDensity(v) {
      mat.uniforms.uOpacity.value = v;
      mesh.visible = v > 0.02;
    },
  };
}

/* ============================================================
 * 屋檐滴水 + 溅落
 * ============================================================ */

export function buildDrips(root: THREE.Object3D, ctx: { ticks: ((t: number, dt: number) => void)[] }) {
  // 雨棚前缘 + 招牌下缘的滴水
  const spots: { x: number; z: number; y: number; period: number; phase: number }[] = [];
  const gutterZ = CANOPY.z + CANOPY.d / 2 + 0.018;
  for (let i = 0; i < 7; i++) {
    spots.push({
      x: CANOPY.x - CANOPY.w / 2 + 0.06 + (i / 6) * (CANOPY.w - 0.12),
      z: gutterZ,
      y: CANOPY.top - 0.106,
      period: 0.85 + (i % 4) * 0.2,
      phase: i * 0.7,
    });
  }
  spots.push({ x: CANOPY.x + CANOPY.w / 2 - 0.095, z: gutterZ - 0.004,
    y: CANOPY.top - 0.205, period: 0.65, phase: 0.42 });
  // 招牌下缘
  for (let i = 0; i < 5; i++) {
    spots.push({ x: L.store.x0 + 0.8 + i * 1.5, z: L.store.z1 + 0.33, y: 3.76, period: 1.5 + (i % 3) * 0.38, phase: i * 1.3 });
  }

  const g = new THREE.Group();
  g.name = 'drips-layer';
  g.layers.set(1);
  root.add(g);

  const dropGeo = new THREE.SphereGeometry(0.012, 8, 6);
  const dropMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xcfe6ff).multiplyScalar(1.3),
    toneMapped: false, transparent: true, opacity: 0.6, depthWrite: false,
  });
  const drops = spots.map((spot) => {
    const m = new THREE.Mesh(dropGeo, dropMat);
    m.userData.dripOrigin = spot;
    m.visible = false;
    m.layers.set(1);
    g.add(m);
    return m;
  });

  // 落点水花：一圈小环
  const splashGeo = new THREE.RingGeometry(0.03, 0.041, 16);
  const splashMats = spots.map(() => new THREE.MeshBasicMaterial({
    color: 0xa8d4ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  const splashes = spots.map((s, i) => {
    const m = new THREE.Mesh(splashGeo, splashMats[i]);
    m.rotation.x = -Math.PI / 2;
    m.position.set(s.x, L.curb + 0.009, s.z);
    m.renderOrder = 6;
    m.layers.set(1);
    g.add(m);
    return m;
  });

  let rain = 0;
  ctx.ticks.push((t) => {
    if (!g.visible) return;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const cyc = (t / s.period + s.phase) % 1;
      const fall = cyc / 0.72;
      const d = drops[i];
      if (cyc < 0.72) {
        const yy = s.y - fall * fall * (s.y - splashes[i].position.y);
        d.visible = true;
        d.position.set(s.x, yy, s.z);
        const sc = 0.7 + fall * 0.9;
        d.scale.set(sc, sc * (1 + fall * 2.2), sc);
      } else {
        d.visible = false;
      }
      const sp = splashes[i];
      const st = (cyc - 0.72) / 0.28;
      if (cyc >= 0.72) {
        sp.visible = true;
        const k = 1 + st * 2.2;
        sp.scale.set(k, k, k);
        splashMats[i].opacity = (1 - st) * 0.34 * rain;
      } else {
        sp.visible = false;
      }
    }
  });
  return {
    root: g,
    setDensity(value: number) {
      rain = value;
      g.visible = value > 0.02;
      dropMat.opacity = value * 0.6;
    },
  };
}

/* ============================================================
 * 雨中的灯光锥（体积光的廉价做法）
 * ============================================================ */

export function buildLightCone(
  light: THREE.SpotLight,
  radius: number,
  height: number,
): THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: light.color },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        // vUv.y: 0 = 底部（地面），1 = 顶部（灯）
        float v = vUv.y;
        // 越靠灯越亮
        float along = smoothstep(0.0, 0.9, v);
        // 边缘柔化：正对镜头的面片最亮
        float edge = pow(abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 1.2);
        // 关键：底部必须淡出。
        // 锥体底面贴到地面会画出一圈硬边的圆盘，看起来像渲染错误而不是体积光。
        float foot = smoothstep(0.0, 0.35, v);
        float a = along * edge * foot * uOpacity;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const geo = new THREE.ConeGeometry(radius, height, 20, 1, true);
  const m = new THREE.Mesh(geo, mat);
  const direction = light.target.position.clone().sub(light.position).normalize();
  m.position.copy(direction).multiplyScalar(height / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), direction);
  m.renderOrder = 9;
  m.layers.set(1);
  light.add(m);
  return m;
}
