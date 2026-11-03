import * as THREE from 'three';
import { RAMP_SOFT } from './materials';

const finishes = new Map<string, THREE.Material>();
let anisotropy = 8;
const maps = new Set<THREE.Texture>();

/** Vending details share the renderer's texture quality, including late purchases. */
export function applyVendingTextureQuality(renderer: THREE.WebGLRenderer): void {
  anisotropy = renderer.capabilities.getMaxAnisotropy();
  for (const map of maps) { map.anisotropy = anisotropy; map.needsUpdate = true; }
}

export function finishVendingTexture(map: THREE.CanvasTexture): THREE.CanvasTexture {
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = anisotropy;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  maps.add(map);
  return map;
}

/** A local highlight shoulder keeps enamel and small plastics below the bloom threshold. */
export function vendingFinish(color: number, polished = false, map?: THREE.Texture): THREE.MeshToonMaterial | THREE.MeshPhongMaterial {
  const key = `${color}:${polished}:${map?.uuid ?? ''}`;
  const cached = finishes.get(key);
  if (cached) return cached as THREE.MeshToonMaterial | THREE.MeshPhongMaterial;
  const material = polished
    ? new THREE.MeshPhongMaterial({ color, map: map ?? null, shininess: 85, specular: 0x68818c })
    : new THREE.MeshToonMaterial({ color, map: map ?? null, gradientMap: RAMP_SOFT });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
      'outgoingLight = 0.86 * (vec3(1.0) - exp(-outgoingLight * 1.35));\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'vending-finish-v1';
  finishes.set(key, material);
  return material;
}

/** View-dependent glass: broad reflected lights and a quiet, clear center. */
export function vendingGlassMaterial(): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {},
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vViewWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormalWorld = normalize(mat3(modelMatrix) * normal);
        vViewWorld = cameraPosition - world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vNormalWorld;
      varying vec3 vViewWorld;
      void main() {
        vec3 view = normalize(vViewWorld);
        vec3 normal = normalize(vNormalWorld);
        float facing = abs(dot(view, normal));
        float fresnel = pow(1.0 - facing, 3.0);
        vec3 reflected = reflect(-view, normal);
        float sweep = vUv.x + vUv.y * 0.25 + reflected.x * 0.16;
        float band = smoothstep(0.08, 0.14, sweep) * (1.0 - smoothstep(0.20, 0.31, sweep));
        float thin = smoothstep(0.33, 0.34, sweep) * (1.0 - smoothstep(0.36, 0.38, sweep));
        float rim = pow(abs(vUv.x - 0.5) * 2.0, 14.0);
        vec3 color = mix(vec3(0.26, 0.48, 0.57), vec3(0.82, 0.93, 0.98), band * 0.75 + fresnel * 0.25);
        float alpha = 0.018 + fresnel * 0.16 + band * 0.075 + thin * 0.045 + rim * 0.13;
        gl_FragColor = vec4(color, min(alpha, 0.28));
        #include <colorspace_fragment>
      }`,
  });
  material.name = 'vending-clear-reflective-glass';
  return material;
}
