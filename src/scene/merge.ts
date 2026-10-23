/**
 * 静态几何合并。
 *
 * 问题：整个场景约有 830 个 Mesh，加上阴影 pass 后 draw call 接近 1700。
 * 微缩模型里有大量小件（货架层板、护栏立柱、商品价签、砖缝……），
 * 它们共用少数几个材质，但每个都是一次 draw call。
 *
 * 做法：入场动画播完后，把所有**不会动**的 toon 材质网格，
 * 按「材质 + 描边层 + 阴影开关」分桶，烘焙世界矩阵后合并成一个几何体。
 * 材质种类不多，因此桶数很少，draw call 能降一个数量级。
 *
 * 安全边界（很重要）：
 * - 只合并 MeshToonMaterial。灯光、发光体、玻璃、雨、波纹用的都是
 *   Basic / Shader 材质，且大多是每帧改透明度或位置的，一律不碰。
 * - 跳过 InstancedMesh（商品本来就是 2 个 draw call，合并反而更差）。
 * - 跳过 exclude 列表里的子树（自动门、信号灯等有动画的部件）。
 * - 合并后网格的 transform 归一，位置烘焙进顶点，所以父级变换仍有效。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MergeOptions {
  /** 这些 name 的子树不参与合并（含其全部子孙） */
  excludeNames?: string[];
  /** 统计回调 */
  onMerged?: (before: number, after: number) => void;
}

interface Bucket {
  material: THREE.Material;
  layerMask: number;
  cast: boolean;
  receive: boolean;
  renderOrder: number;
  geos: THREE.BufferGeometry[];
}

function isExcluded(obj: THREE.Object3D, exclude: Set<string>): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (p.name && exclude.has(p.name)) return true;
    p = p.parent;
  }
  return false;
}

/**
 * 合并 root 下所有静态 toon 网格。
 * 返回合并前后的网格数量，便于断言。
 */
export function mergeStaticMeshes(
  root: THREE.Object3D,
  opts: MergeOptions = {},
): { before: number; after: number; buckets: number } {
  const exclude = new Set(opts.excludeNames ?? []);
  const buckets = new Map<string, Bucket>();
  const victims: THREE.Mesh[] = [];

  // 先把世界矩阵更新到最新，否则烘焙出来的位置是旧的
  root.updateMatrixWorld(true);

  let before = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    if (!m.geometry) return;
    if (m.children.length > 0) return; // 有子节点的网格不合并（通常是有意组织）
    const mat = m.material as THREE.Material;
    if (!mat) return;
    if (!(mat as THREE.MeshToonMaterial).isMeshToonMaterial) return;
    if (isExcluded(m, exclude)) return;
    // 显式标记为动态的网格（例如积雪面，每帧改 scale.y）不参与合并。
    // 否则会被并入 merged-static 并从原组摘除，动画就失效了。
    if (m.userData.noMerge) return;
    before++;
    victims.push(m);

    // 用几何体自身 uuid + 材质 uuid 决定桶；几何体可能被多个网格共享，
    // 因此必须在烘焙时 clone。
    const key = [
      mat.uuid,
      m.layers.mask,
      m.castShadow ? 1 : 0,
      m.receiveShadow ? 1 : 0,
      m.renderOrder,
    ].join('|');

    let b = buckets.get(key);
    if (!b) {
      b = {
        material: mat,
        layerMask: m.layers.mask,
        cast: m.castShadow,
        receive: m.receiveShadow,
        renderOrder: m.renderOrder,
        geos: [],
      };
      buckets.set(key, b);
    }

    const g = m.geometry.clone();
    // 只保留合并所需的最小属性集，避免不同网格属性集不一致导致合并失败
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    if (!g.index) {
      // 统一成索引几何，避免 mergeGeometries 因混合索引/非索引失败
      const idx = new Uint32Array(g.attributes.position.count);
      for (let i = 0; i < idx.length; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    // 烘焙世界矩阵（合并结果挂在 root 上，root 自身的变换要抵消掉）
    const mtx = new THREE.Matrix4();
    root.updateMatrixWorld(true);
    mtx.copy(root.matrixWorld).invert().multiply(m.matrixWorld);
    g.applyMatrix4(mtx);
    b.geos.push(g);
  });

  let after = before;
  let bucketCount = 0;

  for (const b of buckets.values()) {
    if (b.geos.length < 2) continue;
    let merged: THREE.BufferGeometry | null = null;
    try {
      merged = mergeGeometries(b.geos, false);
    } catch {
      merged = null;
    }
    if (!merged) {
      for (const g of b.geos) g.dispose();
      continue;
    }
    merged.computeBoundingSphere();
    merged.computeBoundingBox();

    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.renderOrder = b.renderOrder;
    mesh.layers.mask = b.layerMask;
    mesh.name = 'merged-static';
    root.add(mesh);

    // 原来那一批几何体（clone 的）已经并进 merged，可以释放
    for (const g of b.geos) g.dispose();

    bucketCount++;
    after -= b.geos.length - 1;
    // 源头网格的几何是共享缓存，不能 dispose；只从场景里摘掉
    for (const v of victims) {
      const vm = v.material as THREE.Material;
      if (vm === b.material) v.removeFromParent();
    }
  }

  // 未被合并的单件仍留在场景里
  opts.onMerged?.(before, after);
  return { before, after, buckets: bucketCount };
}
