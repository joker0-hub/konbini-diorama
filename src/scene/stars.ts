/** 用一个天空球着色器绘制天色、星带和星点。 */

import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // 天空只有方向。主镜头和倒影镜头各自转动，平移时星位保持稳定。
    gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position.z = gl_Position.w * 0.999999;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform float uTime;
  uniform float uStarOpacity;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;

  float hash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  // 在立方体的六个面上分布星点，避免经纬坐标在两极把星点拉成细线。
  vec3 skyFace(vec3 d) {
    vec3 a = abs(d);
    if (a.x >= max(a.y, a.z)) return vec3(d.zy / a.x, step(0.0, d.x));
    if (a.y >= a.z) return vec3(d.xz / a.y, 2.0 + step(0.0, d.y));
    return vec3(d.xy / a.z, 4.0 + step(0.0, d.z));
  }

  vec3 starlight(vec3 d, float band) {
    vec3 face = skyFace(d);
    vec2 grid = face.xy * 73.0;
    vec3 cell = vec3(floor(grid), face.z);
    float seed = hash(cell);
    float magnitude = pow(hash(cell + 7.13), 4.0);
    vec2 center = 0.26 + 0.48 * vec2(hash(cell + 5.2), hash(cell + 9.4));
    float distanceToStar = length(fract(grid) - center);
    float radius = mix(0.034, 0.123, magnitude);
    float feather = clamp(length(fwidth(grid)) * 0.46, 0.01, 0.11);
    float core = 1.0 - smoothstep(max(0.0, radius - feather), radius + feather, distanceToStar);
    float halo = (1.0 - smoothstep(radius, 0.24, distanceToStar)) * magnitude * magnitude * 0.15;

    float density = mix(0.17, 0.32, band);
    float intensity = mix(0.105, 1.12, magnitude);
    float shimmer = 1.0 + 0.08 * magnitude * sin(uTime * 0.85 + seed * 62.8);
    float warmth = hash(cell + 3.7);
    vec3 tint = mix(vec3(0.66, 0.81, 1.0), vec3(1.0, 0.92, 0.77), warmth * warmth);
    return tint * (core + halo) * intensity * shimmer * step(seed, density);
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = d.y;
    float grad = smoothstep(-0.55, 0.6, up);
    vec3 skyCol = mix(uHorizon, uZenith, grad);
    float skyA = smoothstep(-0.62, -0.34, up);

    if (uStarOpacity > 0.001) {
      // 俯视时画面上方仍能看见星空，往低处逐渐隐去。
      float visibleSky = smoothstep(-0.42, -0.10, up);
      float bend = 0.033 * sin(dot(d, vec3(12.0, 7.0, 8.0)));
      float band = 1.0 - smoothstep(0.025, 0.24, abs(dot(d, vec3(0.75, 0.42, -0.51)) + bend));
      float dust = 0.62 + 0.22 * sin(dot(d, vec3(19.0, -12.0, 27.0)));
      vec3 haze = vec3(0.015, 0.023, 0.055) * band * dust;
      skyCol += (starlight(d, band) + haze) * visibleSky * uStarOpacity;
    }

    if (skyA <= 0.002) discard;
    gl_FragColor = vec4(skyCol, skyA);
    #include <colorspace_fragment>
  }
`;

export interface Starfield {
  mesh: THREE.Mesh;
  update: (t: number, opacity: number) => void;
  /** 让天空渐变跟着时段走 */
  setSky: (zenith: number, horizon: number) => void;
}

export function buildStarfield(): Starfield {
  const geo = new THREE.SphereGeometry(1, 32, 24);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uStarOpacity: { value: 0 },
      uZenith: { value: new THREE.Color(0x0a1020) },
      uHorizon: { value: new THREE.Color(0x1b2740) },
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'starfield';
  mesh.frustumCulled = false;
  // 不透明物体用深度遮住天空，玻璃和降水随后叠加。
  mesh.renderOrder = -10;
  mesh.layers.set(1);

  return {
    mesh,
    setSky(zenith, horizon) {
      mat.uniforms.uZenith.value.setHex(zenith);
      mat.uniforms.uHorizon.value.setHex(horizon);
    },
    update(t, starOpacity) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uStarOpacity.value = starOpacity;
    },
  };
}
