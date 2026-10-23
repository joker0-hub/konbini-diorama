/**
 * 湿地面系统。
 *
 * 场景里有一批「湿地反光」叠加片（加色混合）和一层「积水暗斑」，
 * 还有一层雨点涟漪。它们以前是常开的 —— 于是晴天里地面仍然湿漉漉，
 * 这是时段/天气互相打架最明显的破绽之一。
 *
 * 现在统一登记到 SceneCtx.wet，由 Environment 的两个独立系数驱动：
 *   wetness —— 天气整体湿度（晴 0.16 / 雨 1 / 雪 0.05）
 *   rain    —— 只有下雨才有的涟漪（0..1）
 *
 * 注意：每个反光片必须用自己的材质实例。材质缓存会让多个反光片共享
 * 一个 MeshBasicMaterial，改一个的 opacity 会连带改掉全部。
 */

import * as THREE from 'three';

export interface WetEntry {
  mesh: THREE.Mesh;
  /** 满湿度时的目标强度（= 材质原本的 opacity） */
  base: number;
  /** 雨点涟漪用 ShaderMaterial 的 uOpacity，而不是 material.opacity */
  ripple?: boolean;
}

export interface WetHandles {
  setWetness: (v: number) => void;
  setRain: (v: number) => void;
  entries: WetEntry[];
}

export function createWet(entries: WetEntry[]): WetHandles {
  let wetness = 0;
  let rain = 0;

  const apply = (): void => {
    for (const e of entries) {
      if (e.ripple) {
        const mat = e.mesh.material as THREE.ShaderMaterial;
        const op = e.base * rain;
        mat.uniforms.uOpacity.value = op;
        e.mesh.visible = op > 0.002;
        continue;
      }
      const mat = e.mesh.material as THREE.MeshBasicMaterial;
      const op = e.base * wetness;
      if (mat) mat.opacity = op;
      e.mesh.visible = op > 0.002;
    }
  };

  return {
    entries,
    setWetness(v) {
      wetness = THREE.MathUtils.clamp(v, 0, 1);
      apply();
    },
    setRain(v) {
      rain = THREE.MathUtils.clamp(v, 0, 1);
      apply();
    },
  };
}
