import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CANOPY_CLOUD_CENTERS, MAIN_BRANCH_DEFS } from './sakura-data';
import { DETAIL_LAYER, OUTLINE_PROXY_LAYER } from '../core/geom';

export interface SakuraParameters {
  /** Scale of each blossom within its cloud. */
  blossomScale: number;
  /** Front-to-back fullness multiplier, applied to the skeleton and canopy. */
  depthFullness: number;
  /** 0..1 probability of thinning blossoms in the front trunk window. */
  frontThinning: number;
  /** 0..2.5 falling petal density and speed. */
  petalIntensity: number;
}

export interface SakuraTreeHandles {
  root: THREE.Group;
  /** The visible trunk and canopy only, used by the click-to-open interaction. */
  pickRoot: THREE.Group;
  update: (elapsed: number, dt: number) => void;
  setParameters: (patch: Partial<SakuraParameters>) => void;
  getParameters: () => SakuraParameters;
}

interface BlossomInstance {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
  phase: number;
  frontBlocking: boolean;
  thinThreshold: number;
}

interface FallingPetal {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  phase: number;
}

const DEFAULT_PARAMETERS: SakuraParameters = {
  // 初始值必须与 ui/sakura-panel.ts 的 CONTROLS 保持一致：
  // 面板滑块显示的是 CONTROLS 里的 value，模型用的是这里的值，
  // 两边不一致时会出现"滑块显示 0.80×，实际却是 1.45×"的错位。
  blossomScale: 0.8,
  depthFullness: 1.2,
  frontThinning: 0.8,
  petalIntensity: 0.85,
};
// 花形降到 10 面/朵后，密度可以回到能盖住枝条的量级：
// 每朵 10 个三角形，3 万朵 = 30 万面，加场景本体仍在 900k 预算内。
const FLOWER_DENSITY_FACTOR = 1.0;

/**
 * 主干拔高系数（只作用于 y 轴）。
 *
 * 1.16 → 树干由 3.02m 拉到约 3.50m。
 * 原来的比例里树干偏矮、花团偏大，整棵树显得"蹲"着；
 * 拔高后树颈露出来，花团位置相对上移，和街景的竖线条（电线杆、招牌）
 * 更协调。只改这一个数就能整体调高度。
 */
const TRUNK_STRETCH = 1.16;

function createBarkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable for sakura bark texture.');

  ctx.fillStyle = '#5c4638';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const w = 1.5 + Math.random() * 4;
    const h = 25 + Math.random() * 90;
    ctx.fillStyle = Math.random() > 0.45
      ? 'rgba(38, 27, 20, 0.48)'
      : 'rgba(115, 92, 74, 0.35)';
    ctx.fillRect(x, y, w, h);
  }
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const w = 8 + Math.random() * 18;
    const h = 1.5 + Math.random() * 2;
    ctx.fillStyle = 'rgba(42, 30, 24, 0.55)';
    ctx.fillRect(x, y, w, h);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 6);
  return texture;
}

function createTubeFromPoints(
  points: THREE.Vector3[],
  radiusStart: number,
  radiusEnd: number,
  radialSegments = 10,
  tubularSegments = 24,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, 1, radialSegments, false);
  const position = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  const center = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, center);
    let rootFlare = 1;
    if (t < 0.15 && radiusStart > 0.25) {
      rootFlare = 1 + Math.pow((0.15 - t) / 0.15, 1.8) * 0.55;
    }
    const radius = THREE.MathUtils.lerp(radiusStart, radiusEnd, Math.pow(t, 0.85)) * rootFlare;

    for (let j = 0; j <= radialSegments; j++) {
      const index = i * (radialSegments + 1) + j;
      vertex.fromBufferAttribute(position, index);
      const direction = vertex.clone().sub(center).normalize();
      const angle = (j / radialSegments) * Math.PI * 2;
      const ridge = Math.sin(angle * 5 + t * 8) * 0.08 * (1 - t * 0.5);
      const gnarl = Math.cos(t * 18 + angle * 2) * 0.04;
      vertex.copy(center).addScaledVector(direction, radius * (1 + ridge + gnarl));
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }

  geometry.computeVertexNormals();
  return geometry;
}

function createSakuraFlowerGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const numPetals = 5;
  const localVertices = [
    [0, 0.01, 0.02],
    [-0.058, 0.035, 0.09],
    [-0.045, 0.055, 0.165],
    [0, 0.048, 0.138],
    [0.045, 0.055, 0.165],
    [0.058, 0.035, 0.09],
  ];
  // 每瓣 2 个三角形（原来 4 个）。
  // 花径只有 4cm、在 0.42 缩放下只有 1.7cm，玩家看到的是色块不是花瓣细节，
  // 而每朵省下的 2 个三角面在 3 万朵的量级上就是 6 万面 ——
  // 这笔预算换给"幅面覆盖"（花团连续、枝条不穿出）更值。
  const triangles = [[0, 2, 3], [0, 3, 5]];

  for (let petal = 0; petal < numPetals; petal++) {
    const angle = (petal / numPetals) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = localVertices.map(([x, y, z]) => [x * cos - z * sin, y, x * sin + z * cos]);
    for (const triangle of triangles) {
      for (const vertexIndex of triangle) {
        const vertex = rotated[vertexIndex];
        positions.push(vertex[0], vertex[1], vertex[2]);
        uvs.push(0.5, 0.5);
      }
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function setBlossomMatrices(
  mesh: THREE.InstancedMesh,
  data: BlossomInstance[],
  parameters: SakuraParameters,
  elapsed: number,
  dummy: THREE.Object3D,
): void {
  const thinThreshold = parameters.frontThinning * 0.78;
  for (let i = 0; i < data.length; i++) {
    const blossom = data[i];
    const hidden = blossom.frontBlocking && blossom.thinThreshold < thinThreshold;
    if (hidden) {
      dummy.scale.setScalar(0.0001);
      dummy.position.set(blossom.x, blossom.y, blossom.z * parameters.depthFullness);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      continue;
    }

    const sway = Math.sin(elapsed * 2.1 + blossom.phase) * 0.018;
    dummy.position.set(
      blossom.x + sway,
      blossom.y + sway * 0.4,
      blossom.z * parameters.depthFullness + sway * 0.6,
    );
    dummy.rotation.set(blossom.rx + sway * 1.8, blossom.ry + sway * 1.2, blossom.rz);
    dummy.scale.setScalar(blossom.scale * parameters.blossomScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

export function buildSakuraTree(
  parent: THREE.Object3D,
  position: { x: number; y: number; z: number },
  scale = 0.42,
): SakuraTreeHandles {
  const root = new THREE.Group();
  root.name = 'sakura-tree';
  root.position.set(position.x, position.y, position.z);
  // Keep the source model's proportions; the depth slider adjusts fullness separately.
  root.scale.setScalar(scale);
  parent.add(root);

  const pickRoot = new THREE.Group();
  pickRoot.name = 'sakura-pickable';
  root.add(pickRoot);

  /**
   * 主干拔高组。
   *
   * 作用位置：pickRoot → 本组 → skeleton（树皮）与 blossoms（花簇）。
   * 只拉伸 y，所以树干变高、花冠整体上移，而树根仍然压在地面 y = 0
   * （缩放锚点在组的原点，正好是树根）。
   *
   * 为什么不直接改 `root.scale`：那是等比缩放，会把树同时变胖；
   * 也不改 `skeleton.scale`：那行每帧都被 `update()` 重写成
   * `(1, 1, depthFullness)`，改上去会被立刻覆盖。
   */
  const trunkStretch = new THREE.Group();
  trunkStretch.name = 'sakura-trunk-stretch';
  trunkStretch.scale.set(1, TRUNK_STRETCH, 1);
  pickRoot.add(trunkStretch);

  const skeleton = new THREE.Group();
  skeleton.name = 'sakura-skeleton';
  trunkStretch.add(skeleton);

  const barkTexture = createBarkTexture();
  const barkMaterial = new THREE.MeshStandardMaterial({
    map: barkTexture,
    color: 0x7b6250,
    roughness: 0.86,
    metalness: 0.04,
    bumpMap: barkTexture,
    bumpScale: 0.035,
  });

  const branchDefs = MAIN_BRANCH_DEFS.map((branch) => ({ ...branch, pts: branch.pts.map((p) => p.clone()) }));
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.3;
    branchDefs.push({
      pts: [
        new THREE.Vector3(Math.cos(angle) * 0.15, 0.32, Math.sin(angle) * 0.15),
        new THREE.Vector3(Math.cos(angle) * 0.28, 0.12, Math.sin(angle) * 0.28),
        new THREE.Vector3(Math.cos(angle) * 0.44, 0.02, Math.sin(angle) * 0.44),
      ],
      rStart: 0.095,
      rEnd: 0.02,
      radSeg: 7,
      tubSeg: 10,
    });
  }

  const random = seededRandom(1337);
  const secondarySubBranches: { mid: THREE.Vector3; tip: THREE.Vector3 }[] = [];
  const branchGeometries: THREE.BufferGeometry[] = [];
  const mainBranchCount = MAIN_BRANCH_DEFS.length;
  for (let index = 0; index < branchDefs.length; index++) {
    const branch = branchDefs[index];
    const curve = new THREE.CatmullRomCurve3(branch.pts);
    branchGeometries.push(
      createTubeFromPoints(branch.pts, branch.rStart, branch.rEnd, branch.radSeg, branch.tubSeg),
    );

    if (index >= mainBranchCount) continue;
    const subCount = 9;
    for (let sub = 0; sub < subCount; sub++) {
      const t = 0.26 + (sub / subCount) * 0.7;
      const origin = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const direction = new THREE.Vector3(
        tangent.x + (random() - 0.5) * 1.35,
        Math.abs(tangent.y) * 0.55 + 0.22 + (random() - 0.4) * 0.65,
        tangent.z + (random() - 0.5) * 1.55,
      ).normalize();
      const length = 0.55 + random() * 0.82;
      const mid = origin.clone().addScaledVector(direction, length * 0.52);
      mid.y += (random() - 0.3) * 0.22;
      const tip = origin.clone().addScaledVector(direction, length);
      const branchStart = THREE.MathUtils.lerp(branch.rStart, branch.rEnd, t) * 0.58;
      branchGeometries.push(createTubeFromPoints([origin, mid, tip], branchStart, 0.012, 6, 10));
      secondarySubBranches.push({ mid, tip });
    }
  }

  const barkGeometry = mergeGeometries(branchGeometries, false);
  if (!barkGeometry) throw new Error('Unable to combine sakura branch geometry.');
  for (const geometry of branchGeometries) geometry.dispose();
  const barkMesh = new THREE.Mesh(barkGeometry, barkMaterial);
  barkMesh.name = 'sakura-bark';
  barkMesh.castShadow = true;
  barkMesh.receiveShadow = true;
  skeleton.add(barkMesh);

  const cloudCenters = CANOPY_CLOUD_CENTERS.map((cloud) => ({ ...cloud, pos: [...cloud.pos] as [number, number, number] }));

  /**
   * 沿每根主枝「串珠」式补花团。
   *
   * 这是"枝条从花冠里透出来"的真正根因：原来的花团是几十个离散球体，
   * 球与球之间留着缝，13 根主枝正好从这些缝里穿出去。
   * 解法是沿枝条逐段放小球，让花团贴着骨架长成连续的一层。
   *
   * 密度是按三角面预算定的：每朵花 20 个三角形，
   * 全树花簇必须压在 ~2.6 万朵以内才能守住 900k 的预算。
   */
  const FLOWER_TRI_BUDGET_HINT = 0; void FLOWER_TRI_BUDGET_HINT;
  for (const branch of MAIN_BRANCH_DEFS) {
    const curve = new THREE.CatmullRomCurve3(branch.pts);
    // 每根主枝串 6 颗，越靠枝梢球越小（贴合锥形的枝形）
    const beads = 6;
    for (let i = 0; i < beads; i++) {
      // 从 0.28 开始：树干根部不该被花包住，要露出树颈
      const t = 0.28 + (i / (beads - 1)) * 0.72;
      const p = curve.getPointAt(t);
      const taper = THREE.MathUtils.lerp(1.0, 0.62, t);
      const radius = 0.62 * taper;
      cloudCenters.push({
        pos: [p.x, p.y, p.z],
        rx: radius,
        ry: radius * 0.82,
        rz: radius,
        density: 30,
        role: 'shell',
      });
    }
  }

  /**
   * 枝梢再补一组稍大的球，把细枝的末端也包住。
   *
   * 细枝长度 0.55~1.37，花团半径必须盖住整根细枝，
   * 否则枝梢赤裸着伸在花团外面。半径按枝长给。
   */
  for (const branch of secondarySubBranches) {
    const isFrontCenterBranch = branch.tip.z > 0.25 && Math.abs(branch.tip.x) < 1.05 && branch.tip.y < 4.5;
    // 以细枝中段为心：以枝梢为心会让花团整体偏到枝条末端外侧
    const cx = branch.mid.x * 0.7 + branch.tip.x * 0.3;
    const cy = branch.mid.y * 0.55 + branch.tip.y * 0.45;
    const cz = branch.mid.z * 0.7 + branch.tip.z * 0.3;
    const len = branch.tip.distanceTo(branch.mid) * 2;
    const radius = Math.max(0.5, len * 0.58);
    cloudCenters.push({
      pos: [cx, cy, cz],
      rx: radius,
      ry: radius * 0.78,
      rz: radius,
      density: isFrontCenterBranch ? 22 : 34,
      role: isFrontCenterBranch ? 'frontWindow' : 'sub',
    });
  }

  const cloudFlowerCounts = cloudCenters.map((cloud) => Math.round(cloud.density * FLOWER_DENSITY_FACTOR));
  const totalBlossoms = cloudFlowerCounts.reduce((sum, count) => sum + count, 0);
  const flowerGeometry = createSakuraFlowerGeometry();
  /**
   * 花冠材质。
   *
   * 关键是 `emissive`：这套场景的主预设是「白天 + 雨」，方向光只有 1.1，
   * 单靠漫反射时整团花会压成灰紫 —— 和参考图那种"阳光透过花瓣"的
   * 明亮玫粉完全不是一个东西。给一点自发光把中间调托起来，
   * 花冠才会显得通透而不是一团脏色。
   *
   * roughness 调低一点让受光面出现柔和高光，避免整团花糊成一片平面色。
   */
  const flowerMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.42,
    metalness: 0,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0xffe8f0),
    emissiveIntensity: 0.22,
  });
  const blossoms = new THREE.InstancedMesh(flowerGeometry, flowerMaterial, totalBlossoms);
  blossoms.name = 'sakura-blossoms';
  // Hundreds of thousands of instanced flower faces make shadow-map passes
  // disproportionately expensive; the branches provide the tree's readable shadow.
  blossoms.castShadow = false;
  // 不再接收阴影：花冠内部互相投影会把整团花压暗成紫灰色，
  // 而参考图里花团是通透的。层次靠 instanceColor 的明暗梯度表达。
  blossoms.receiveShadow = false;
  // 花簇所在的图层：详见 geom.ts 的 DETAIL_LAYER。
  // 这一层正常着色，只是不参与「描边用的深度 pass」——
  // 几千片互相穿插的小花深度处处断层，直接拿去算描边会把整棵树描成黑团。
  blossoms.layers.set(DETAIL_LAYER);
  blossoms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // 挂在拔高组下：花簇必须跟着树干一起上移，否则拔高后花团会留在原地、
  // 树干从花团顶部戳出来。
  trunkStretch.add(blossoms);

  /**
   * 花冠的「描边遮罩代理体」。
   *
   * 问题链条：花簇被排除在描边深度 pass 之外（否则逐片花瓣被描黑边），
   * 于是描边图里花冠所在的像素记的是**它背后的枝条深度** ——
   * 描边器看到那里有枝条的深度断层，就把枝条轮廓画到花团上，
   * 看起来像枝条长在花冠前面。用绿色替换花簇的对照实验证实了这一点。
   *
   * 解法：放一组只出现在「遮罩 pass」里的椭球，输出纯白。
   * pipeline 读到白色就把该像素的描边强度压到 0 ——
   * 花团内部干净、枝条轮廓被正确遮住。
   *
   * 它们**不进入主渲染**：只挂在 OUTLINE_PROXY_LAYER（层 3），
   * 而相机默认只启用 0/1/2，所以玩家永远看不到这些椭球本身。
   */
  const proxyDummy = new THREE.Object3D();
  const proxyProxies = (() => {
    const proxyMat = new THREE.MeshBasicMaterial({
      // 遮罩里必须是纯白，着色器用 R 通道判断"这里是花团"
      color: 0xffffff,
      depthWrite: true,
      depthTest: true,
      toneMapped: false,
      fog: false,
    });
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      proxyMat,
      cloudCenters.length,
    );
    mesh.name = 'sakura-outline-proxy';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.layers.set(OUTLINE_PROXY_LAYER);
    // 必须和花簇挂同一个父级（trunkStretch）：代理体要精确盖住花团的屏幕区域，
    // 一旦父级不同，拔高系数就只作用在其中一个上，描边遮罩会整体错位。
    trunkStretch.add(mesh);
    return mesh;
  })();

  /** 按给定参数重排代理体（depthFullness 会拉伸花簇的 z，两者必须同步） */
  const syncOutlineProxy = (p: SakuraParameters): void => {
    cloudCenters.forEach((cloud, i) => {
      proxyDummy.position.set(cloud.pos[0], cloud.pos[1], cloud.pos[2] * p.depthFullness);
      // 略微收小：代理体不该比实际花团还大，
      // 否则描边会在花团外圈画出一圈并不存在的轮廓。
      proxyDummy.scale.set(
        cloud.rx * 0.9,
        cloud.ry * 0.9,
        cloud.rz * 0.9 * p.depthFullness,
      );
      proxyDummy.rotation.set(0, 0, 0);
      proxyDummy.updateMatrix();
      proxyProxies.setMatrixAt(i, proxyDummy.matrix);
    });
    proxyProxies.instanceMatrix.needsUpdate = true;
  };
  syncOutlineProxy(DEFAULT_PARAMETERS);

  // 花色照参考图取：受光面接近白米粉，背光/团簇内部压成深玫红。
  // 关键：暗面不用黑，用高饱和深玫红（参考 "#d45988" 那一档）。
  // 暗部带颜色，花团才会"通透鲜艳"，而不是糊成灰黑一块。
  const highlight = new THREE.Color(0xffffff);
  const softPink = new THREE.Color(0xffd9e6);
  const vibrantPink = new THREE.Color(0xf8a8c8);
  const deepShadow = new THREE.Color(0xd45988);
  const tempColor = new THREE.Color();
  const dummy = new THREE.Object3D();
  const blossomData: BlossomInstance[] = [];
  let instanceIndex = 0;

  for (let cloudIndex = 0; cloudIndex < cloudCenters.length; cloudIndex++) {
    const cloud = cloudCenters[cloudIndex];
    const flowerCount = cloudFlowerCounts[cloudIndex];
    const [cx, cy, cz] = cloud.pos;
    const lobes = [
      { x: 0, y: 0, z: 0 },
      { x: (random() - 0.5) * cloud.rx * 0.45, y: (random() - 0.3) * cloud.ry * 0.4, z: (random() - 0.5) * cloud.rz * 0.55 },
      { x: (random() - 0.5) * cloud.rx * 0.45, y: (random() - 0.3) * cloud.ry * 0.4, z: (random() - 0.5) * cloud.rz * 0.55 },
    ];

    for (let i = 0; i < flowerCount; i++) {
      const lobe = lobes[i % 3];
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = 0.25 + 0.75 * Math.pow(random(), 0.38);
      const lx = lobe.x + radius * Math.sin(phi) * Math.cos(theta) * cloud.rx;
      const ly = lobe.y + radius * Math.cos(phi) * cloud.ry;
      const lz = lobe.z + radius * Math.sin(phi) * Math.sin(theta) * cloud.rz;
      const x = cx + lx;
      const y = cy + ly;
      const z = cz + lz;
      const distanceToTrunkWindow = Math.hypot((x + 0.15) / 1.15, (y - 3.35) / 1.35);
      const frontBlocking = (z > 0.12 && distanceToTrunkWindow < 1) || cloud.role === 'frontWindow';
      const thinThreshold = frontBlocking ? random() : 1;
      const rotationX = (random() - 0.5) * Math.PI * 1.6;
      const rotationY = random() * Math.PI * 2;
      const rotationZ = (random() - 0.5) * Math.PI * 1.6;
      const baseScale = 0.72 + random() * 0.68;

      const localVertical = (ly / cloud.ry + 1) * 0.5;
      const globalSunFactor = THREE.MathUtils.clamp((y - 2.2) / 4.4 - x * 0.12 + z * 0.06, 0, 1);
      // 阈值整体下移：参考图里树冠大面积是受光的亮粉，
      // 只有团簇底部和内部才出现深档。原来 0.76/0.42 的分界让
      // 近半数花落在深档，整棵树看起来脏。
      const lightScore = localVertical * 0.58 + globalSunFactor * 0.42 + (random() - 0.5) * 0.16;
      if (lightScore > 0.62) {
        tempColor.copy(softPink).lerp(highlight, (lightScore - 0.62) / 0.38);
      } else if (lightScore > 0.3) {
        tempColor.copy(vibrantPink).lerp(softPink, (lightScore - 0.3) / 0.32);
      } else {
        tempColor.copy(deepShadow).lerp(vibrantPink, Math.max(0, lightScore / 0.3));
      }

      dummy.position.set(x, y, z * DEFAULT_PARAMETERS.depthFullness);
      dummy.rotation.set(rotationX, rotationY, rotationZ);
      const hidden = frontBlocking && thinThreshold < DEFAULT_PARAMETERS.frontThinning * 0.78;
      dummy.scale.setScalar(hidden ? 0.0001 : baseScale * DEFAULT_PARAMETERS.blossomScale);
      dummy.updateMatrix();
      blossoms.setMatrixAt(instanceIndex, dummy.matrix);
      blossoms.setColorAt(instanceIndex, tempColor);
      blossomData.push({
        x, y, z,
        rx: rotationX,
        ry: rotationY,
        rz: rotationZ,
        scale: baseScale,
        phase: x * 0.7 + y * 0.5 + cloudIndex * 0.3,
        frontBlocking,
        thinThreshold,
      });
      instanceIndex++;
    }
  }
  blossoms.instanceMatrix.needsUpdate = true;
  if (blossoms.instanceColor) blossoms.instanceColor.needsUpdate = true;

  const fallingCount = 220;
  // 落樱用和树冠相同的五瓣花形。原来是 0.075×0.055 的矩形片，
  // 近景下能明显看出是"纸片"，和花冠的花形对不上。
  const fallingGeometry = createSakuraFlowerGeometry();
  const fallingMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff1f6,
    roughness: 0.5,
    metalness: 0,
    side: THREE.DoubleSide,
    // 和花冠同一套逻辑：阴雨天下单靠漫反射会压成灰片，
    // 给一点自发光，飘落的花瓣才有参考图那种"亮片"感。
    emissive: new THREE.Color(0xffe3ee),
    emissiveIntensity: 0.5,
  });
  /**
   * 落樱活动范围（相对树干，单位 m）—— 由树冠投影决定，不是对称的。
   * 树冠实测 x [-1.42, +1.22]、z [-1.62, +1.44]，
   * 花瓣再加一点风飘余量；树干落在板块左下角时，
   * 这些范围正好把花瓣关在铺装面内，不会飘出台座。
   */
  const FALL_X = 1.6;
  const FALL_FRONT = 1.6;
  const FALL_BACK = 1.7;
  const fallingPetals = new THREE.InstancedMesh(fallingGeometry, fallingMaterial, fallingCount);
  fallingPetals.name = 'sakura-falling-petals';
  fallingPetals.castShadow = false;
  fallingPetals.receiveShadow = false;
  // 同样归入细节层：空中飘的小面片不该被描边
  fallingPetals.layers.set(DETAIL_LAYER);
  fallingPetals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // 挂在拔高组下：落樱是从花冠飘下来的，起点必须跟着花冠一起上移。
  trunkStretch.add(fallingPetals);

  const fallingRandom = seededRandom(2027);
  const fallingData: FallingPetal[] = [];
  for (let i = 0; i < fallingCount; i++) {
    const petal: FallingPetal = {
      // 初值落在树冠投影内，开场第一帧不会有一圈花瓣飘在台座外
      x: (fallingRandom() - 0.5) * 2 * FALL_X,
      y: fallingRandom() * 6.2,
      z: THREE.MathUtils.lerp(-FALL_FRONT, FALL_BACK, fallingRandom()),
      vx: 0.25 + fallingRandom() * 0.35,
      vy: -(0.35 + fallingRandom() * 0.45),
      vz: (fallingRandom() - 0.5) * 0.25,
      rx: fallingRandom() * Math.PI,
      ry: fallingRandom() * Math.PI,
      rz: fallingRandom() * Math.PI,
      phase: fallingRandom() * Math.PI * 2,
    };
    fallingData.push(petal);
    dummy.position.set(petal.x, petal.y, petal.z);
    dummy.scale.setScalar(0.0001);
    dummy.updateMatrix();
    fallingPetals.setMatrixAt(i, dummy.matrix);
  }
  fallingPetals.instanceMatrix.needsUpdate = true;

  const parameters = { ...DEFAULT_PARAMETERS };
  const setParameters = (patch: Partial<SakuraParameters>): void => {
    if (patch.blossomScale !== undefined) parameters.blossomScale = THREE.MathUtils.clamp(patch.blossomScale, 0.5, 1.5);
    if (patch.depthFullness !== undefined) parameters.depthFullness = THREE.MathUtils.clamp(patch.depthFullness, 0.7, 1.5);
    if (patch.frontThinning !== undefined) parameters.frontThinning = THREE.MathUtils.clamp(patch.frontThinning, 0, 1);
    if (patch.petalIntensity !== undefined) parameters.petalIntensity = THREE.MathUtils.clamp(patch.petalIntensity, 0, 2.5);
    setBlossomMatrices(blossoms, blossomData, parameters, 0, dummy);
    skeleton.scale.set(1, 1, parameters.depthFullness);
    // depthFullness 改了以后，描边代理体必须跟着重排，
    // 否则描边和花团会错位（花团被拉长，代理体没动）。
    syncOutlineProxy(parameters);
  };

  const update = (elapsed: number, dt: number): void => {
    pickRoot.rotation.z = Math.sin(elapsed * 1.3) * 0.004;
    pickRoot.rotation.x = Math.cos(elapsed) * 0.0025;
    skeleton.scale.set(1, 1, parameters.depthFullness);
    setBlossomMatrices(blossoms, blossomData, parameters, elapsed, dummy);

    const intensity = parameters.petalIntensity;
    const activeCount = Math.min(fallingCount, Math.round(fallingCount * intensity));
    for (let i = 0; i < fallingCount; i++) {
      const petal = fallingData[i];
      if (i >= activeCount) {
        dummy.position.set(petal.x, petal.y, petal.z);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        fallingPetals.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const speed = 0.55 + intensity * 0.75;
      petal.x += (petal.vx * 0.28 + Math.sin(elapsed * 1.8 + petal.phase) * 0.12) * dt * speed;
      petal.y += petal.vy * dt * speed;
      petal.z += (petal.vz + Math.cos(elapsed * 1.4 + petal.phase) * 0.1) * dt * speed;
      petal.rx += dt * 1.8;
      petal.ry += dt * 2.2;
      if (petal.y < -0.2) {
        petal.y = 5.2 + fallingRandom() * 1.4;
        petal.x = (fallingRandom() - 0.5) * 2 * FALL_X;
        petal.z = THREE.MathUtils.lerp(-FALL_FRONT, FALL_BACK, fallingRandom());
      }

      // 落樱挂在树根下，坐标是「相对树干」的局部值。横向飘出树冠投影后，
      // 花瓣会飘到台座外，所以按树冠范围做一次软夹取：
      // 撞到边界就反向，而不是硬贴边（硬夹会在边缘堆成一排）。
      if (petal.x > FALL_X || petal.x < -FALL_X) {
        petal.vx = -petal.vx;
        petal.x = THREE.MathUtils.clamp(petal.x, -FALL_X, FALL_X);
      }
      if (petal.z > FALL_BACK || petal.z < -FALL_FRONT) {
        petal.vz = -petal.vz;
        petal.z = THREE.MathUtils.clamp(petal.z, -FALL_FRONT, FALL_BACK);
      }

      dummy.position.set(petal.x, petal.y, petal.z);
      dummy.rotation.set(petal.rx, petal.ry, petal.rz);
      // 落花比树上的花小一圈，和地面那批尺寸呼应
      dummy.scale.setScalar(0.62);
      dummy.updateMatrix();
      fallingPetals.setMatrixAt(i, dummy.matrix);
    }
    fallingPetals.instanceMatrix.needsUpdate = true;
  };

  return {
    root,
    pickRoot,
    update,
    setParameters,
    getParameters: () => ({ ...parameters }),
  };
}
