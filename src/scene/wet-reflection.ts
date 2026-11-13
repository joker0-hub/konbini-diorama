import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noOutline } from '../core/geom';
import { puddleMaskTex } from '../core/textures';
import { L } from './layout';

const vertexShader = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vReflection;
  varying vec3 vWorld;
  varying float vSidewalk;

  void main() {
    vReflection = textureMatrix * vec4(position, 1.0);
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vSidewalk = step(0.01, position.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D uPuddles;
  uniform float uWetness;
  uniform float uRain;
  uniform float uTime;
  varying vec4 vReflection;
  varying vec3 vWorld;
  varying float vSidewalk;

  void main() {
    vec2 p = vWorld.xz;
    float puddle = smoothstep(0.18, 0.68, texture2D(uPuddles, p / 7.3 + 0.5).r);
    float roughness = mix(1.0 - puddle * 0.75, 0.86, vSidewalk);
    vec2 wave = vec2(
      sin(p.x * 9.0 + p.y * 6.0 + uTime * 3.7) + 0.4 * sin(p.y * 19.0 - uTime * 6.0),
      sin(p.y * 13.0 - p.x * 5.0 - uTime * 4.6) + 0.4 * sin(p.x * 21.0 + uTime * 7.0)
    );
    vec2 uv = vReflection.xy / vReflection.w;
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    float waveStrength = 1.0 - smoothstep(0.025, 0.11, footprint);
    uv += wave * vec2(0.0017, 0.0009) * uRain * waveStrength;
    vec2 blur = vec2(0.0045, 0.0028) * roughness;
    vec3 reflected = texture2D(tDiffuse, uv).rgb * 0.4;
    reflected += texture2D(tDiffuse, uv + vec2(blur.x, 0.0)).rgb * 0.15;
    reflected += texture2D(tDiffuse, uv - vec2(blur.x, 0.0)).rgb * 0.15;
    reflected += texture2D(tDiffuse, uv + vec2(0.0, blur.y)).rgb * 0.15;
    reflected += texture2D(tDiffuse, uv - vec2(0.0, blur.y)).rgb * 0.15;

    // Fade at the camera edges, where the distorted sample can leave the capture.
    vec2 edge = smoothstep(vec2(0.0), vec2(0.018), min(uv, 1.0 - uv));
    float grazing = 1.0 - max(0.0, normalize(cameraPosition - vWorld).y);
    float strength = mix(0.14, 0.82, puddle) * mix(1.0, 0.78, vSidewalk);
    float alpha = uWetness * strength * (0.55 + 0.45 * grazing) * edge.x * edge.y;
    gl_FragColor = vec4(reflected, alpha);
  }
`;

export interface WetReflection {
  resize: (w: number, h: number) => void;
  setWetness: (wetness: number) => void;
  setRain: (rain: number) => void;
  setTime: (time: number) => void;
  captureStats: { calls: number; triangles: number };
}

export function createWetReflection(
  ground: THREE.Object3D,
  weatherEffects: readonly THREE.Object3D[],
): WetReflection {
  const h = L.half;
  // One capture serves the road and raised sidewalk. Both sample it from their own surface.
  const surface = (x0: number, x1: number, z0: number, z1: number, elevation: number) =>
    new THREE.PlaneGeometry(x1 - x0, z1 - z0)
      .translate((x0 + x1) / 2, -(z0 + z1) / 2, elevation);
  const surfaces = [
    surface(-h, h, L.road.z, h, 0),
    surface(L.road.x, h, -h, L.road.z, 0),
    surface(-h, L.walk.xOuter, -h, L.walk.zOuter, L.curb),
  ];
  const geometry = mergeGeometries(surfaces);
  for (const part of surfaces) part.dispose();
  const mesh = new Reflector(geometry, {
    multisample: 0,
    shader: {
      name: 'WetGroundReflection',
      uniforms: {
        color: { value: null },
        tDiffuse: { value: null },
        textureMatrix: { value: null },
        uPuddles: { value: null },
        uWetness: { value: 0 },
        uRain: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader,
      fragmentShader,
    },
  });
  const material = mesh.material as THREE.ShaderMaterial;
  const { uniforms } = material;
  uniforms.uPuddles.value = puddleMaskTex();
  material.transparent = true;
  material.depthWrite = false;
  material.toneMapped = false;
  mesh.name = 'wet-ground-reflection';
  mesh.rotation.x = -Math.PI / 2;
  // Above asphalt and below the paint; the same clearance applies to the pavers.
  mesh.position.y = 0.006;
  mesh.renderOrder = -1;
  mesh.visible = false;
  noOutline(mesh);
  ground.add(mesh);

  const captureStats = { calls: 0, triangles: 0 };
  const capture = mesh.onBeforeRender.bind(mesh);
  const savedVisibility = weatherEffects.map(() => false);
  mesh.onBeforeRender = (...args) => {
    const [renderer, , camera] = args;
    const { calls, triangles } = renderer.info.render;
    const needsShadowUpdate = renderer.shadowMap.needsUpdate;
    // Reflector runs after the main pass has built shadows. Reuse them in the capture.
    renderer.shadowMap.needsUpdate = false;
    mesh.getReflectionCamera(camera).layers.mask = camera.layers.mask;
    for (const [i, effect] of weatherEffects.entries()) {
      savedVisibility[i] = effect.visible;
      effect.visible = false;
    }
    try {
      capture(...args);
    } finally {
      for (const [i, effect] of weatherEffects.entries()) effect.visible = savedVisibility[i];
      renderer.shadowMap.needsUpdate = needsShadowUpdate;
    }
    captureStats.calls = renderer.info.render.calls - calls;
    captureStats.triangles = renderer.info.render.triangles - triangles;
  };

  return {
    captureStats,
    resize(w, h) {
      const scale = Math.min(0.5, 720 / Math.max(w, h));
      mesh.getRenderTarget().setSize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    },
    setWetness(wetness) {
      const strength = THREE.MathUtils.smoothstep(wetness, 0.16, 0.9);
      uniforms.uWetness.value = strength;
      mesh.visible = strength > 0.002;
    },
    setRain(rain) {
      uniforms.uRain.value = rain;
    },
    setTime(time) {
      uniforms.uTime.value = time;
    },
  };
}
