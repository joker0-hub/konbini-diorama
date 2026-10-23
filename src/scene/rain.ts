/**
 * 降雨系统。
 *
 * 一个 InstancedBufferGeometry 装全部雨丝，顶点着色器里做公告板 + 垂直循环，
 * CPU 每帧只更新一个 uTime —— 8000 条雨丝也只有 1 个 draw call。
 * 雨丝按 Y 分两段颜色：高处是冷蓝，落到店门口附近被暖光染成金，这是
 * "雨夜便利店" 最标志性的一笔。
 */

import * as THREE from 'three';
import { L } from './layout';

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

    // 距离衰减 + 顶部淡出，避免"雨从天而降突然出现"的硬边
    float dist = distance(center, uCamPos);
    vAlpha = smoothstep(0.0, 1.0, y) * (1.0 - smoothstep(13.0, 26.0, dist)) * 0.62;
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
  varying float vAlpha;
  varying float vWarm;
  varying vec2 vUv;

  void main() {
    // 雨丝两端收细：横向硬边、纵向渐变，接近手绘动画里的雨
    float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    float taper = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
    float a = vAlpha * edge * taper * uOpacity;
    if (a < 0.004) discard;
    vec3 col = mix(uCold, uWarm, vWarm * 0.85);
    gl_FragColor = vec4(col, a);
  }
`;

export interface RainHandles {
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
    update(t, dt, cam) {
      mat.uniforms.uTime.value = t;
      camRight.setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize();
      mat.uniforms.uRight.value.copy(camRight);
      mat.uniforms.uCamPos.value.copy(cam.position);
      mat.uniforms.uWind.value = 0.5 + Math.sin(t * 0.21) * 0.22;
    },
    setDensity(v) {
      mat.uniforms.uOpacity.value = v;
    },
  };
}

/* ============================================================
 * 屋檐滴水 + 溅落
 * ============================================================ */

export function buildDrips(root: THREE.Object3D, ctx: { ticks: ((t: number, dt: number) => void)[] }): void {
  // 雨棚前缘 + 招牌下缘的滴水
  const spots: { x: number; z: number; y: number; period: number; phase: number }[] = [];
  const canopyY = 2.6;
  const doorCX = 0.9;
  for (let i = 0; i < 9; i++) {
    spots.push({
      x: doorCX - 1.6 + (i / 8) * 3.2,
      z: L.store.z1 + 1.33,
      y: canopyY,
      period: 0.85 + (i % 4) * 0.2,
      phase: i * 0.7,
    });
  }
  // 招牌下缘
  for (let i = 0; i < 5; i++) {
    spots.push({ x: L.store.x0 + 0.8 + i * 1.5, z: L.store.z1 + 0.33, y: 3.76, period: 1.5 + (i % 3) * 0.38, phase: i * 1.3 });
  }

  const g = new THREE.Group();
  g.name = 'drips-layer';
  g.layers.set(1);
  root.add(g);

  const dropGeo = new THREE.SphereGeometry(0.022, 6, 6);
  const dropMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xcfe6ff).multiplyScalar(1.3), toneMapped: false, transparent: true, opacity: 0.85 });
  const drops = spots.map(() => {
    const m = new THREE.Mesh(dropGeo, dropMat);
    m.visible = false;
    g.add(m);
    return m;
  });

  // 落点水花：一圈小环
  const splashGeo = new THREE.RingGeometry(0.03, 0.055, 12);
  const splashMats = spots.map(() => new THREE.MeshBasicMaterial({
    color: 0xa8d4ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  }));
  const splashes = spots.map((s, i) => {
    const m = new THREE.Mesh(splashGeo, splashMats[i]);
    m.rotation.x = -Math.PI / 2;
    m.position.set(s.x, 0.18, s.z);
    m.renderOrder = 6;
    g.add(m);
    return m;
  });

  ctx.ticks.push((t) => {
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const cyc = (t / s.period + s.phase) % 1;
      const fall = cyc / 0.72;
      const d = drops[i];
      if (cyc < 0.72) {
        const yy = s.y - fall * fall * (s.y - 0.18);
        d.visible = true;
        d.position.set(s.x, yy, s.z);
        const sc = 0.7 + fall * 0.9;
        d.scale.set(sc, sc * (1 + fall * 2.2), sc);
        (d.material as THREE.MeshBasicMaterial).opacity = 0.85;
      } else {
        d.visible = false;
      }
      const sp = splashes[i];
      const st = (cyc - 0.72) / 0.28;
      if (cyc >= 0.72) {
        sp.visible = true;
        const k = 1 + st * 2.2;
        sp.scale.set(k, k, k);
        (sp.material as THREE.MeshBasicMaterial).opacity = (1 - st) * 0.42;
      } else {
        sp.visible = false;
      }
    }
  });
}

/* ============================================================
 * 玻璃上的雨痕（沿玻璃滑落）
 * ============================================================ */

export function buildGlassRain(
  root: THREE.Object3D,
  front: { x: number; z: number; w: number; h: number },
  side: { x: number; z: number; w: number; h: number },
  ctx: { ticks: ((t: number, dt: number) => void)[] },
): void {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;

      float hash(vec2 p) {
        p = fract(p * vec2(233.34, 851.73));
        p += dot(p, p + 23.45);
        return fract(p.x * p.y);
      }

      void main() {
        vec2 uv = vUv;
        float acc = 0.0;
        // 3 层不同速度的雨痕，叠出"下滑的水珠拖尾"
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          float cols = 26.0 + fi * 15.0;
          float x = floor(uv.x * cols);
          float h = hash(vec2(x, fi * 13.0));
          float speed = 0.06 + h * 0.13;
          float y = fract(uv.y + uTime * speed + h);
          // 拖尾
          float trail = smoothstep(0.0, 0.06, y) * smoothstep(0.42, 0.0, y);
          // 横向位置抖动
          float cx = mod(x / cols + 0.5 / cols, 1.0);
          float dx = abs(uv.x - cx) * cols;
          float line = smoothstep(0.5, 0.0, dx) * trail;
          acc += line * (0.5 + h * 0.5);
        }
        // 静态的细密水膜
        float film = hash(floor(uv * vec2(120.0, 180.0))) * 0.05;
        float a = clamp(acc * 0.42 + film, 0.0, 1.0);
        gl_FragColor = vec4(vec3(0.72, 0.86, 1.0), a * 0.5);
      }
    `,
  });

  // 前立面玻璃
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(front.w, front.h), mat);
  fg.name = 'glass-rain-front';
  fg.position.set(front.x, front.h / 2 + 0.5, front.z);
  fg.renderOrder = 7;
  fg.layers.set(1);
  root.add(fg);

  const mb = mat.clone();
  mb.uniforms.uTime = mat.uniforms.uTime;
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(side.w, side.h), mb);
  sg.name = 'glass-rain-side';
  sg.position.set(side.x, side.h / 2 + 0.5, side.z);
  sg.rotation.y = Math.PI / 2;
  sg.renderOrder = 7;
  sg.layers.set(1);
  root.add(sg);

  ctx.ticks.push((t) => {
    mat.uniforms.uTime.value = t;
  });
}

/* ============================================================
 * 雨中的灯光锥（体积光的廉价做法）
 * ============================================================ */

export function buildLightCone(
  root: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  color: number,
  opacity: number,
): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vPos = position;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        // vUv.y: 0 = 底部（地面），1 = 顶部（灯）
        float v = vUv.y;
        // 越靠灯越亮
        float along = smoothstep(0.0, 1.0, v);
        // 边缘柔化：正对镜头的面片最亮
        float edge = pow(abs(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0))), 1.2);
        // 关键：底部必须淡出。
        // 锥体底面贴到地面会画出一圈硬边的圆盘，看起来像渲染错误而不是体积光。
        float foot = smoothstep(0.0, 0.35, v);
        float a = (1.0 - along) * edge * foot * uOpacity;
        if (a < 0.002) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const geo = new THREE.ConeGeometry(radius, height, 20, 1, true);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y - height / 2, z);
  m.renderOrder = 9;
  m.layers.set(1);
  root.add(m);
  return m;
}
