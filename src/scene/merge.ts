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
 * - 默认只合并 MeshToonMaterial，静态子树可用 includePhong 加入高光材质。灯光、发光体、玻璃、雨、波纹用的都是
 *   Basic / Shader 材质，且大多是每帧改透明度或位置的，一律不碰。
 * - 跳过 InstancedMesh（商品本来就是 2 个 draw call，合并反而更差）。
 * - 跳过 exclude 列表里的子树（自动门、信号灯等有动画的部件）。
 * - 合并后网格的 transform 归一，位置烘焙进顶点，所以父级变换仍有效。
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface MergeOptions {
  /** Opt in for a static subtree whose polished parts use Phong materials. */
  includePhong?: boolean;
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
  /** 这个桶里真正被合并的网格。删除时必须按桶删，不能按材质删。 */
  meshes: THREE.Mesh[];
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
 * 合并 root 下所有静态 toon 网格，或显式启用的 Phong 网格。
 * 返回合并前后的网格数量，便于断言。
 */
export function mergeStaticMeshes(
  root: THREE.Object3D,
  opts: MergeOptions = {},
): MergeStats {
  const batches = mergeStaticMeshBatches(root, opts);
  let next = batches.next();
  while (!next.done) next = batches.next();
  return next.value;
}

interface MergeStats {
  before: number;
  after: number;
  buckets: number;
}

/** Advance static batching between frames when the assembled scene is already visible. */
export function* mergeStaticMeshBatches(
  root: THREE.Object3D,
  opts: MergeOptions = {},
): Generator<void, MergeStats> {
  const exclude = new Set(opts.excludeNames ?? []);
  const buckets = new Map<string, Bucket>();

  // 先把世界矩阵更新到最新，否则烘焙出来的位置是旧的
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const mtx = new THREE.Matrix4();

  let before = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if ((m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    if (!m.geometry) return;
    if (m.children.length > 0) return; // 有子节点的网格不合并（通常是有意组织）
    const mat = m.material as THREE.Material;
    if (!mat) return;
    if (!(mat as THREE.MeshToonMaterial).isMeshToonMaterial &&
        !(opts.includePhong && (mat as THREE.MeshPhongMaterial).isMeshPhongMaterial)) return;
    if (isExcluded(m, exclude)) return;
    // 显式标记为动态的网格（例如积雪面，每帧改 scale.y）不参与合并。
    // 否则会被并入 merged-static 并从原组摘除，动画就失效了。
    if (m.userData.noMerge) return;
    before++;

    // Bucket meshes that share a material and render settings.
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
        meshes: [],
      };
      buckets.set(key, b);
    }
    b.meshes.push(m);
  });

  let after = before;
  let bucketCount = 0;

  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    const geos: THREE.BufferGeometry[] = [];
    for (const m of b.meshes) {
      const g = m.geometry.clone();
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      }
      if (!g.attributes.uv) {
        const count = g.attributes.position.count;
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
      }
      if (!g.index) {
        // Use indexed geometry consistently within each batch.
        const idx = new Uint32Array(g.attributes.position.count);
        for (let i = 0; i < idx.length; i++) idx[i] = i;
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      mtx.copy(rootInverse).multiply(m.matrixWorld);
      geos.push(g.applyMatrix4(mtx));
      yield;
    }
    let merged: THREE.BufferGeometry | null = null;
    try {
      merged = mergeGeometries(geos, false);
    } catch {
      merged = null;
    } finally {
      for (const g of geos) g.dispose();
    }
    if (!merged) continue;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();

    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.renderOrder = b.renderOrder;
    mesh.layers.mask = b.layerMask;
    mesh.name = 'merged-static';
    root.add(mesh);

    bucketCount++;
    after -= b.meshes.length - 1;
    // 只摘掉这个桶里确实被合并的网格。
    // 旧版按“材质相同”删除：同一个材质可能因为 castShadow / receiveShadow /
    // 图层不同而被分到另一个桶，而那个桶可能只有 1 个网格、根本没合并 ——
    // 结果它的原件也被一起删掉，表现为“刚生成时在，过一会儿消失”。
    // 热食柜的柜体就是被这样误删的。
    // 源头网格的几何是共享缓存，不能 dispose；只从场景里摘掉。
    for (const v of b.meshes) v.removeFromParent();
    yield;
  }

  // 未被合并的单件仍留在场景里
  opts.onMerged?.(before, after);
  return { before, after, buckets: bucketCount };
}
