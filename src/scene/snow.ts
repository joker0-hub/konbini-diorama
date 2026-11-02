/** Patchy, shallow snow: coverage and depth grow together; exposed travel paths stay readable. */
import * as THREE from 'three';
import { L } from './layout';
import { toon, RAMP_SOFT } from '../core/materials';
import { snowSurfaceTex } from '../core/snowTex';

export interface SnowPatch {
  x0: number; x1: number; z0: number; z1: number;
  y: number;
  scale?: number;
  kind?: 'road' | 'walk' | 'cap';
  name?: string;
}
export interface SnowHandles {
  root: THREE.Group;
  update: (snowAmount: number) => void;
  setMaxDepth: (d: number) => void;
  surfaces: readonly SnowPatch[];
}
const MAX_DEPTH = 0.045;

const FIELD = /* glsl */ `
  uniform float uSnowAmount;
  uniform float uSurfaceKind;
  varying vec3 vSnowWorld;
  float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float snowNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(snowHash(i), snowHash(i + vec2(1., 0.)), f.x),
      mix(snowHash(i + vec2(0., 1.)), snowHash(i + vec2(1., 1.)), f.x), f.y);
  }
`;

export function buildSnow(extraSurfaces: SnowPatch[] = []): SnowHandles {
  const root = new THREE.Group();
  root.name = 'snow-layer';
  root.layers.set(2);
  const progress = { value: 0 };
  const materials = new Map<string, THREE.MeshToonMaterial>();
  const patches: { mesh: THREE.Mesh; surface: SnowPatch }[] = [];
  const surfaces: SnowPatch[] = [];
  let maxDepth = 0.04;
  let amount = 0;

  const material = (kind: SnowPatch['kind']) => {
    const key = kind ?? 'cap';
    const cached = materials.get(key);
    if (cached) return cached;
    const mat = toon(0xeaf0f8, { map: snowSurfaceTex(), ramp: RAMP_SOFT }).clone();
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSnowAmount = progress;
      shader.uniforms.uSurfaceKind = { value: kind === 'road' ? 0 : kind === 'walk' ? 1 : 2 };
      shader.vertexShader = 'varying vec3 vSnowWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvSnowWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = FIELD + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        vec2 p = vSnowWorld.xz;
        float field = snowNoise(p * 2.4) * 0.68 + snowNoise(p * 12.0) * 0.24 + snowNoise(p * 42.0) * 0.08;
        float wear = 0.0;
        if (uSurfaceKind < 0.5) {
          float lanes = min(min(abs(p.y - 5.0), abs(p.y - 6.25)), min(abs(p.x - 5.7), abs(p.x - 7.0)));
          wear = (1.0 - smoothstep(0.13, 0.30, lanes)) * 0.72;
        } else if (uSurfaceKind < 1.5) {
          // Alternating compressed footprints on the open front pavement.
          float stepId = floor((p.x + 8.0) / 0.46);
          vec2 foot = vec2(mod(p.x + 8.0, 0.46) - 0.23, p.y - 2.5 - mod(stepId, 2.0) * 0.20);
          wear = (1.0 - smoothstep(0.65, 1.0, length(foot / vec2(0.13, 0.065)))) * 0.9;
          // The entrance under the canopy is sheltered, even when outdoor snow is full.
          if (p.x > -0.02 && p.x < 2.04 && p.y > 0.8 && p.y < 2.18) discard;
        }
        float cover = smoothstep(field - 0.06, field + 0.06, uSnowAmount * 1.18 - wear);
        if (cover < 0.45) discard;
        diffuseColor.rgb *= mix(0.78, 1.0, cover) * (0.95 + 0.05 * snowNoise(p * 7.0));
      `);
    };
    mat.customProgramCacheKey = () => 'snow-coverage-v1-' + key;
    materials.set(key, mat);
    return mat;
  };

  const add = (surface: SnowPatch): void => {
    const { x0, x1, z0, z1, y } = surface;
    const w = x1 - x0, d = z1 - z0;
    if (w <= 0.01 || d <= 0.01) return;
    const geo = new THREE.BoxGeometry(w, 1, d, Math.max(2, Math.ceil(w / 0.32)), 1, Math.max(2, Math.ceil(d / 0.32)));
    geo.translate(0, 0.5, 0);
    const position = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      if (position.getY(i) > 0.5) {
        const edge = Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z));
        const rolloff = THREE.MathUtils.smoothstep(edge, 0, Math.min(0.16, w * 0.25, d * 0.25));
        const ripple = 0.90 + 0.10 * Math.sin((x + x0) * 5.3) * Math.cos((z + z0) * 4.7);
        position.setY(i, ripple * (0.38 + 0.62 * rolloff));
      }
      uv.setXY(i, (x + (x0 + x1) / 2) / 1.2, (z + (z0 + z1) / 2) / 1.2);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material(surface.kind));
    mesh.name = surface.name ?? 'snow-surface';
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    // Layer 2 is omitted from the outline pass; granular snow edges must stay soft.
    mesh.layers.set(2);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.noMerge = true;
    mesh.userData.snowSurface = surface;
    root.add(mesh);
    patches.push({ mesh, surface });
    surfaces.push(surface);
  };

  const H = L.half, S = L.store, C = L.curb;
  add({ x0: -H, x1: H, z0: L.road.z, z1: H, y: 0.017, kind: 'road', name: 'snow-front-road' });
  add({ x0: L.road.x, x1: H, z0: -H, z1: L.road.z, y: 0.017, kind: 'road', name: 'snow-side-road' });
  add({ x0: -H, x1: L.walk.xOuter - 0.20, z0: L.walk.zInner, z1: L.walk.zOuter - 0.20, y: C + 0.009, kind: 'walk' });
  add({ x0: L.walk.xInner, x1: L.walk.xOuter - 0.20, z0: -H, z1: L.walk.zInner, y: C + 0.009, kind: 'walk' });
  // Curb tops are 3 cm above the pavement. Separate strips avoid overlapping snow slabs.
  add({ x0: -H, x1: L.walk.xOuter, z0: L.walk.zOuter - 0.20, z1: L.walk.zOuter, y: C + 0.034, scale: 0.72 });
  add({ x0: L.walk.xOuter - 0.20, x1: L.walk.xOuter, z0: -H, z1: L.walk.zOuter - 0.20, y: C + 0.034, scale: 0.72 });
  // The roof slab is 18 cm thick; roofY is its bottom, not its top.
  const roofY = S.roofY + 0.18;
  add({ x0: S.x0 - 0.10, x1: S.x1 + 0.10, z0: S.z0 - 0.10, z1: S.z1 + 0.10, y: roofY + 0.003, name: 'snow-store-roof' });
  for (const z of [S.z0 - 0.17, S.z1 + 0.17]) add({ x0: S.x0 - 0.23, x1: S.x1 + 0.23, z0: z - 0.065, z1: z + 0.065, y: roofY + 0.423, scale: 0.7 });
  for (const x of [S.x0 - 0.17, S.x1 + 0.17]) add({ x0: x - 0.065, x1: x + 0.065, z0: S.z0 - 0.10, z1: S.z1 + 0.10, y: roofY + 0.423, scale: 0.7 });
  for (const x of [-3.9, -1.9]) add({ x0: x - 0.54, x1: x + 0.54, z0: -5.62, z1: -4.98, y: roofY + 0.758, scale: 0.8 });
  add({ x0: 0.26, x1: 1.54, z0: -6.34, z1: -5.06, y: roofY + 1.193, scale: 0.8 });
  const canX = (L.door.x0 + L.door.x1) / 2;
  const canW = Math.min(2.3, 2 * (S.x1 - 0.16 - canX));
  add({ x0: canX - canW / 2 + 0.02, x1: canX + canW / 2 - 0.02, z0: S.z1 + 0.32, z1: S.z1 + 1.38, y: S.glassTop - 0.22 + 0.003, scale: 0.8, name: 'snow-canopy' });
  const N = L.neighbor;
  add({ x0: N.x0, x1: N.x1, z0: N.z0, z1: N.z1, y: N.h + 0.403 });
  extraSurfaces.forEach(add);

  const apply = (snowAmount: number): void => {
    amount = THREE.MathUtils.clamp(snowAmount, 0, 1);
    progress.value = amount;
    root.visible = amount > 0.001;
    root.userData.coverage = amount;
    for (const { mesh, surface } of patches) {
      mesh.scale.y = Math.max(0.0001, Math.min(MAX_DEPTH, maxDepth * (surface.scale ?? 1) * amount));
    }
  };
  apply(0);
  return {
    root, surfaces, update: apply,
    setMaxDepth(d) { maxDepth = THREE.MathUtils.clamp(d, 0, MAX_DEPTH); apply(amount); },
  };
}
