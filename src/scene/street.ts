/**
 * 街道家具与环境。
 *
 * 层次：近景（自行车、伞架、垃圾桶、护栏）→ 中景（路灯、贩卖机、路牌）
 * → 远景（电线杆、电线、信号灯、小巷霓虹）。
 * 微缩场景好不好看，很大程度取决于这三层有没有叠起来。
 */

import * as THREE from 'three';
import { P } from '../core/palette';
import { addBox, addCyl, addMesh, group, noOutline, planeGeo, strut } from '../core/geom';
import { additiveClone, decal, glow, radialGlowTex, toon } from '../core/materials';
import * as TX from '../core/textures';
import { L } from './layout';
import type { SceneCtx } from './base';
import { buildTrafficSignal, type SignalHandles } from './signal';
import { buildSakuraTree, type SakuraTreeHandles } from './sakura';
import { buildVendingMachine, type VendingHandles } from './vending';
import { BottlePhysics } from '../core/bottle-physics';
import { buildRecyclingBin } from './recycling-bin';
import { buildBicycle } from './bicycle';
import { buildUmbrellaStand, type UmbrellaStand } from './umbrella-stand';
import { buildUtilityPoles } from './utility-poles';
import { buildPosterFrame } from './advertising';

const CURB = L.curb;

export interface StreetRefs {
  /** 街角信号灯（车灯 + 行人灯 + 循环） */
  signal: SignalHandles;
  streetLamp: THREE.SpotLight;
  sakura: SakuraTreeHandles;
  vending: VendingHandles[];
  recyclingBins: THREE.Object3D[];
  umbrellaStand: UmbrellaStand;
}

export function buildStreet(root: THREE.Object3D, ctx: SceneCtx): StreetRefs {
  const g = group(root, 0, 0, 0, 'street');
  const bottlePhysics = new BottlePhysics();
  const recyclingBins: THREE.Object3D[] = [];

  /* ================= 自动贩卖机（靠便利店侧墙） ================= */
  // ry = +90° 让商品面朝 +x（街道侧）；用 -90° 会转成背对街道的白盒子。
  const vending = [
    buildVending(g, 'blue', L.walk.xInner + 0.62, CURB, -3.1, Math.PI / 2, bottlePhysics, recyclingBins),
    buildVending(g, 'red', L.walk.xInner + 0.62, CURB, -1.9, Math.PI / 2, bottlePhysics, recyclingBins),
  ];
  ctx.ticks.push((_t, dt) => {
    bottlePhysics.step(dt);
    vending.forEach((machine) => machine.update(dt));
  });
  for (const z of [-3.1, -1.9]) {
    const l = new THREE.PointLight(0xffe0b0, 2.2, 3.2, 2);
    l.position.set(L.walk.xInner + 1.35, 1.5, z);
    g.add(l);
  }

  /* ================= 路灯 ================= */
  const streetLamp = buildStreetLamp(g, -6.5, L.walk.zOuter - 0.55, ctx);

  /* ================= 电线杆 + 电线 ================= */
  // The pole builder owns both pole positions and exact conductor terminals.
  // Crossarms stay within the base and each pair of street-side poles aligns.
  buildUtilityPoles(g);

  /* ================= 信号灯（街角路口） ================= */
  // 杆脚放在人行道转角内侧（x≈4.2, z≈2.95），横臂伸到右侧车道上方，
  // 灯箱正对 +z（主视角方向）。行人灯直接挂在同一根杆上，
  // 不再出现"灯箱浮在半空、行人灯和杆子脱开"的问题。
  const signal = buildTrafficSignal(g);

  /* ================= 路牌 ================= */
  buildRoadSigns(g);

  /* ================= 护栏 ================= */
  // 护栏必须给店门口留出口：横在门前的护栏会挡住"入口"这个视觉焦点，
  // 也会让门前的湿地反光少掉一大块。
  buildGuardrail(g, -3.2, L.walk.zOuter - 0.32, -0.3, L.walk.zOuter - 0.32);
  // 原 2.6..4.1 这段护栏正好横在门口三色垃圾桶背后，
  // 白色横杆会从桶顶穿过去，像一条漂在空中的长条 —— 去掉。
  buildGuardrail(g, L.walk.xOuter - 0.32, 3.9, L.walk.xOuter - 0.32, 6.0);

  /* ================= 小巷 ================= */
  buildAlley(g, ctx);

  /* ================= 邻楼 ================= */
  buildNeighbor(g, ctx);

  /* ================= 自行车 ================= */
  buildBicycle(g, -4.9, CURB, 2.1, Math.PI * 0.47);
  buildBicycle(g, -3.95, CURB, 2.22, Math.PI * 0.44);
  // 后轮原来会探进侧墙 2cm（轮心 3.0 - 0.82 = 2.18 < 墙 2.2），
  // 从侧街看就像自行车一半陷在店里；整体向外挪 18cm。
  buildBicycle(g, 3.18, CURB, -4.6, Math.PI * 0.02);

  /* ================= 反光柱 ================= */
  // 只保留护栏「外侧」那几根，不再往门口护栏的跨度里插柱子。
  // 原来的阵列是 x = -3.4 + i*2.3，四根落在 -3.4 / -1.1 / 1.2 / 3.5：
  // 其中 -1.1 那根正好戳在第一段护栏（x ∈ [-3.2, -0.3]）的中间，
  // 从街上看向伞架时，一根带红白条纹的细柱横在护栏和伞架之间 —
  // 既挡视线，又和护栏立柱形成"一粗一细"两根竖线，读起来像建模错位。
  for (const x of [-3.4, 1.2, 3.5]) {
    addCyl(g, toon(0xdde2e8), 0.05, 0.05, 0.74, x, CURB, L.walk.zOuter - 0.42, { seg: 8 });
    addCyl(g, toon(0xd2452f), 0.052, 0.052, 0.095, x, CURB + 0.58, L.walk.zOuter - 0.42, { seg: 8 });
  }

  /* ================= 门口伞架 + 垃圾桶 ================= */
  // Leave the tactile strip along the windows clear and keep the stand left of the mat.
  const umbrellaStand = buildUmbrellaStand(g, L.door.x0 - 0.85, L.store.z1 + 0.96);
  ctx.ticks.push(umbrellaStand.update);
  buildTrashBins(g, L.store.x1 + 0.75, L.store.z1 + 1.5, bottlePhysics, recyclingBins);

  /* ================= 樱花树（板块左下角） ================= */
  // 参考樱花树的原始模型约 7m 高，按街景比例缩到 42%。
  // 位置在板块左下角的车行道上，所以落地高度是沥青面 y = 0，
  // 不是人行道的 curb —— 树池与树共用 L.sakura.baseY。
  // 它保持独立的动态子树，避免被世界的静态几何合并烘焙掉。
  const sakura = buildSakuraTree(g, { x: L.sakura.x, y: L.sakura.baseY, z: L.sakura.z }, 0.42);
  buildTreePit(g, L.sakura.x, L.sakura.z, L.sakura.baseY);

  /* ================= 排水沟积水 ================= */
  const gutter = new THREE.Mesh(planeGeo(15.8, 0.22), additiveClone(TX.wetSmearTex(false), 0x8fd4ff, 0.24));
  gutter.rotation.x = -Math.PI / 2;
  gutter.position.set(-0.8, 0.022, L.road.z + 0.3);
  gutter.renderOrder = 3;
  g.add(gutter);
  noOutline(gutter);
  ctx.wet.push({ mesh: gutter, base: 0.24 });

  ctx.pieces.push(g);
  return { signal, streetLamp, sakura, vending, recyclingBins, umbrellaStand };
}

/* ------------------------------------------------------------------ */

function buildVending(
  parent: THREE.Object3D, variant: 'blue' | 'red', x: number, y: number, z: number, ry: number,
  physics: BottlePhysics, recyclingBins: THREE.Object3D[],
): VendingHandles {
  const machine = buildVendingMachine(parent, variant, x, y, z, ry, physics);
  const g = machine.root;
  // 回收箱：每台机器都放在自己「外侧」，不要卡在红蓝两台中间。
  // 局部 -x 旋转后朝 +z（面向红机一侧），所以蓝机要翻到 +x。
  const binX = variant === 'blue' ? 0.74 : -0.74;
  buildRecyclingBin(g, binX, 0.14, {
    width: 0.42, height: 0.92, depth: 0.42, color: 0x356da2, kind: 'mixed', name: 'vending-bin',
  });
  recyclingBins.push(registerRecyclingBin(g, new THREE.Vector3(binX, 0.46, 0.14), new THREE.Vector3(0.42, 0.92, 0.42), physics));
  return machine;
}

/** Pick proxies survive the static merge and match the full visible bin envelope. */
function registerRecyclingBin(parent: THREE.Object3D, center: THREE.Vector3, size: THREE.Vector3, physics: BottlePhysics): THREE.Mesh {
  const target = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ visible: false }));
  target.name = 'recycling-bin-target';
  target.position.copy(center);
  target.userData.noMerge = true;
  target.userData.recyclingPick = true;
  parent.add(target);
  parent.updateWorldMatrix(true, true);
  const worldCenter = parent.localToWorld(center.clone());
  const rotation = parent.getWorldQuaternion(new THREE.Quaternion());
  physics.addBox(worldCenter, size, rotation);
  // Include the mouth and a small rim margin, so airborne bottles are collected before impact.
  physics.addRecyclingBox(worldCenter, size.clone().addScalar(0.1), rotation);
  return target;
}

/**
 * 樱花树的方形石框树池。
 *
 * 造型照着参考图来：一圈浅灰石材方框，框内是下沉的深褐土面，
 * 树干根部周围长一圈嫩绿草叶，池边散着落樱。
 *
 * 为什么是方形而不是圆环：参考图就是规整的方框（日式街角花坛的常见做法），
 * 方框四边与地砖缝平行，微缩比例下比圆弧更容易读成"石砌"而不是"装饰圈"。
 *
 * 尺寸全部由 pitHalf / pitBorder / pitBorderH 推出，改大小只改 layout。
 */
function buildTreePit(parent: THREE.Object3D, cx: number, cz: number, baseY: number): THREE.Group {
  const g = group(parent, cx, baseY, cz, 'tree-pit');
  const half = L.sakura.pitHalf;
  const border = L.sakura.pitBorder;
  const borderH = L.sakura.pitBorderH;

  // 石材取近白的两档：顶面亮、侧面略深。
  // 参考图里树圈是浅灰白的石材，靠"顶面亮 / 侧面暗"这条明暗界线
  // 读出立体感；原来两档都偏中灰，在阴雨光下几乎和沥青混在一起。
  const stoneTop = toon(0xe8e6e0);
  const stoneSide = toon(0xb9b5ac);
  const soilMat = toon(0x453428);

  /* ---- 1. 池底夯土：略低于地面，四周被石框挡住 ---- */
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), soilMat);
  soil.rotation.x = -Math.PI / 2;
  // 只下沉 1.5cm：池子落在车道上时，压得比这更深会从沥青面下方露出来
  soil.position.y = -0.015;
  soil.receiveShadow = true;
  soil.castShadow = false;
  g.add(soil);

  /* ---- 2. 四周石框：四条独立的石条，转角处正好搭接 ----
   * 参考图的边框是"立起来的一圈石条"，所以这里不再用薄板贴面，
   * 而是直接给足高度 + 顶面单独压一层亮色板：
   * 侧面暗一档、顶面亮一档，转角处自然形成一条清晰的高光线。
   */
  const outer = half;
  const inner = half - border;
  // 前后两条（沿 x 布置），左右两条（沿 z 布置）
  const bars: [number, number, number, number][] = [
    // [w, d, x, z]
    [outer * 2, border, 0, outer - border / 2],
    [outer * 2, border, 0, -(outer - border / 2)],
    [border, inner * 2, outer - border / 2, 0],
    [border, inner * 2, -(outer - border / 2), 0],
  ];
  for (const [w, d, x, z] of bars) {
    // 侧面主体：从地面直接立起来
    addBox(g, stoneSide, w, borderH, d, x, 0, z, { r: 0.006 });
    // 顶面压顶：外扩 8mm 形成一道薄薄的悬挑，
    // 位置贴在框顶（borderH - 0.022 起、厚 0.022），顶面正好与 borderH 齐平。
    // 之前写成 borderH - 0.02 起、厚 0.022 → 顶面高出框体 2mm，
    // 视觉上反而糊成一条亮边，读不出"这是一圈立起来的石框"。
    addBox(g, stoneTop, w + 0.008, 0.022, d + 0.008, x, borderH - 0.022, z, {
      r: 0.005, cast: false,
    });
  }

  /* ---- 3. 框内壁：四条薄板，把土面和石框之间的空隙封住 ---- */
  const wallH = 0.14;
  const walls: [number, number, number, number][] = [
    [inner * 2, 0.012, 0, -(inner)],
    [inner * 2, 0.012, 0, inner],
    [0.012, inner * 2, -(inner), 0],
    [0.012, inner * 2, inner, 0],
  ];
  for (const [w, d, x, z] of walls) {
    addBox(g, stoneSide, w, wallH, d, x, -0.015, z, { cast: false });
  }

  /* ---- 4. 根部嫩绿草丛：参考图里树干周围一圈细长草叶 ---- */
  const grassMat = toon(0x7fb04a, { side: THREE.DoubleSide });
  const grassDark = toon(0x5b8a36, { side: THREE.DoubleSide });
  const bladeCount = 64;
  for (let i = 0; i < bladeCount; i++) {
    // 用确定的伪随机，保证每次渲染一致（不能用 Math.random，否则截图对不上）
    const t = i * 2.399963;                       // 黄金角，散布均匀
    const rr = 0.16 + ((i * 37) % 17) / 17 * 0.22;
    const bx = Math.cos(t) * rr;
    const bz = Math.sin(t) * rr;
    const h = 0.075 + ((i * 53) % 11) / 11 * 0.075;
    const lean = 0.12 + ((i * 29) % 13) / 13 * 0.22;
    // 草叶做成细长三角片，往外倾斜
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.012, h, 3, 1), i % 3 === 0 ? grassDark : grassMat);
    blade.position.set(bx, h / 2 - 0.014, bz);
    blade.rotation.z = Math.cos(t) * lean;
    blade.rotation.x = -Math.sin(t) * lean;
    blade.castShadow = false;
    blade.receiveShadow = true;
    g.add(blade);
  }

  return g;
}

function buildStreetLamp(parent: THREE.Object3D, x: number, z: number, ctx: SceneCtx): THREE.SpotLight {
  const pole = toon(P.poleConcrete);
  addCyl(parent, pole, 0.07, 0.095, 4.5, x, CURB, z, { seg: 12 });
  addCyl(parent, toon(0x282d36), 0.13, 0.15, 0.22, x, CURB, z, { seg: 12 });
  addCyl(parent, toon(0x282d36), 0.1, 0.12, 0.09, x, CURB + 4.4, z, { seg: 12 });
  strut(parent, toon(0x363d4a), [x, CURB + 4.42, z], [x + 0.8, CURB + 4.56, z - 0.22], 0.055, true);

  const head = group(parent, x + 0.88, CURB + 4.5, z - 0.24);
  addBox(head, toon(0x363d4a), 0.15, 0.11, 0.48, 0, 0, 0, { r: 0.03 });
  addBox(head, toon(0x282d36), 0.2, 0.065, 0.54, 0, 0.09, 0, { r: 0.03 });
  const face = new THREE.Mesh(planeGeo(0.126, 0.39), glow(0xffe6bf, 1.9));
  face.rotation.x = Math.PI / 2;
  face.position.y = -0.008;
  head.add(face);
  noOutline(face);
  const light = new THREE.SpotLight(0xffd39e, 35, 8.0, 0.80, 0.78);
  light.name = 'street-lamp-downlight';
  light.position.y = -0.028;
  light.target.position.set(0.3, -head.position.y, 1.4);
  head.add(light, light.target);

  const halo = new THREE.Mesh(planeGeo(1.25, 1.25), additiveClone(radialGlowTex(), 0xffd9a0, 0.23));
  halo.position.set(0, -0.085, 0);
  halo.rotation.x = -Math.PI / 2;
  halo.renderOrder = 8;
  head.add(halo);
  noOutline(halo);
  ctx.flickers.push({ mat: halo.material as THREE.MeshBasicMaterial, base: 0.23, seed: 4.1, amp: 0.014 });

  // 灯下湿地反光
  const refl = new THREE.Mesh(planeGeo(1.5, 4.6), additiveClone(TX.wetSmearTex(true), 0xffd9a0, 0.19));
  refl.rotation.x = -Math.PI / 2;
  refl.position.set(x + 0.88, 0.026, z + 1.4);
  refl.renderOrder = 3;
  parent.add(refl);
  noOutline(refl);
  ctx.wet.push({ mesh: refl, base: 0.19 });
  return light;
}

function buildRoadSigns(parent: THREE.Object3D): void {
  const g = group(parent, 0, 0, 0, 'road-signs');
  const pole = toon(0x969da6);

  // 禁止停车
  // 禁止停车（放在台座最左端，退到背景）
  const s1 = group(g, -7.9, CURB, L.walk.zOuter - 0.5);
  addCyl(s1, pole, 0.04, 0.04, 2.9, 0, 0, 0, { seg: 8 });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.24, 20), toon(0x2f6bd8));
  disc.position.set(0, 2.66, 0.045);
  s1.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.203, 0.24, 20), toon(0xd2452f));
  ring.position.set(0, 2.66, 0.05);
  s1.add(ring);
  addBox(s1, toon(0xd2452f), 0.4, 0.048, 0.01, 0, 2.63, 0.055, { rz: -Math.PI / 4, cast: false });
  // 背面给浅灰 + 细边框，避免从店角方向看过去是一整块深色板
  const back = new THREE.Mesh(new THREE.CircleGeometry(0.24, 20), toon(0xb9bec6));
  back.position.set(0, 2.66, 0);
  back.rotation.y = Math.PI;
  s1.add(back);

  // 路口预告（放在店门左侧的空档，不要挡住入口）
  // 抬高到 2.9 以上并缩小 —— 2.1~2.7 这个区间正好和雨棚/招牌下沿打架，
  // 从低角度看会有一条深色板横切主体。
  const s2 = group(g, -5.3, CURB, L.walk.zOuter - 0.42);
  addCyl(s2, pole, 0.034, 0.034, 3.2, 0, 0, 0, { seg: 8 });
  addBox(s2, toon(0x2f6bd8), 0.66, 0.46, 0.05, 0, 2.86, 0, { r: 0.025 });
  addBox(s2, toon(0xf0eee2), 0.6, 0.4, 0.018, 0, 2.89, 0.03, { cast: false });
  addBox(s2, toon(0x2f6bd8), 0.36, 0.07, 0.01, 0, 3.16, 0.042, { cast: false });
  addBox(s2, toon(0x282d36), 0.26, 0.045, 0.01, 0, 2.98, 0.042, { cast: false });
  addBox(s2, toon(0x282d36), 0.36, 0.045, 0.01, 0, 2.89, 0.042, { cast: false });

  // 街名牌（移到右侧人行道中段，避开街角信号灯）
  // 原来放在 (4.6, 2.98) —— 正好和信号灯杆（4.18, 2.96）抢同一个角，
  // 从街对面看过去两块牌子叠在一起。现在退到贩卖机前方的路缘侧。
  const s3 = group(g, 4.02, CURB, -2.4);
  addCyl(s3, pole, 0.042, 0.042, 3.3, 0, 0, 0, { seg: 8 });
  addBox(s3, toon(0xf0eee2), 0.86, 0.26, 0.04, 0.2, 3.0, 0);
  addBox(s3, toon(0x2f6bd8), 0.86, 0.042, 0.05, 0.2, 3.0, 0.01, { cast: false });
  addMesh(s3, new THREE.CircleGeometry(0.048, 10), glow(0xffcf6a, 1.0), 0.54, 3.07, 0.032).castShadow = false;
}

function buildGuardrail(parent: THREE.Object3D, x0: number, z0: number, x1: number, z1: number): void {
  const g = group(parent);
  const rail = toon(P.guardrail);
  const post = toon(P.guardrailPost);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.round(len / 1.6));
  const ang = Math.atan2(z1 - z0, x1 - x0);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    addCyl(g, post, 0.033, 0.033, 0.8, px, CURB, pz, { seg: 8 });
    addCyl(g, post, 0.055, 0.065, 0.035, px, CURB, pz, { seg: 8 });
  }
  const bar = (y: number, hh: number) => {
    const m = addBox(g, rail, len, hh, 0.055, (x0 + x1) / 2, y, (z0 + z1) / 2);
    m.rotation.y = -ang;
    return m;
  };
  bar(CURB + 0.76, 0.065);
  bar(CURB + 0.44, 0.045);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    addBox(g, glow(0xffe0a0, 0.8), 0.06, 0.06, 0.008,
      x0 + (x1 - x0) * t, CURB + 0.76, z0 + (z1 - z0) * t + 0.032, { cast: false, ry: -ang });
  }
}

function buildAlley(parent: THREE.Object3D, ctx: SceneCtx): void {
  const g = group(parent, 0, 0, 0, 'alley');
  const A = L.alley;
  const brick = toon(0xffffff, { map: TX.brickTex() });
  const cx = (A.x0 + A.x1) / 2;

  // 巷道地面
  addBox(g, toon(0xffffff, { map: TX.sidewalkTex() }), A.x1 - A.x0, CURB, A.z1 - A.z0 + 0.4, cx, 0, (A.z0 + A.z1) / 2 - 0.2);
  // 尽头墙
  addBox(g, brick, A.x1 - A.x0 + 0.4, 5.6, 0.4, cx, CURB, A.z0 - 0.2);

  // 巷道两侧的墙面细节（便利店左墙外侧 + 邻楼右墙外侧由各自模块提供）
  // 这里补：管道、空调、壁灯、垃圾袋、海报
  for (let i = 0; i < 2; i++) {
    const az = A.z1 - 2.0 - i * 1.6;
    addBox(g, toon(0xacb2ba), 0.26, 0.46, 0.62, A.x1 - 0.02, CURB + 1.9, az);
    const gr = new THREE.Mesh(new THREE.CircleGeometry(0.17, 12), toon(0xffffff, { map: TX.acGrilleTex() }));
    gr.position.set(A.x1 - 0.16, CURB + 2.12, az);
    gr.rotation.y = -Math.PI / 2;
    g.add(gr);
    noOutline(gr);
  }
  for (let i = 0; i < 2; i++) {
    addCyl(g, toon(0x6f7683), 0.055, 0.055, 5.4, A.x0 + 0.06, CURB, A.z1 - 1.4 - i * 0.22, { seg: 8 });
  }

  // 尽头霓虹招牌
  const neonFrame = group(g, cx, 2.9, A.z0 + 0.025, 'alley-neon-lightbox');
  const signMetal = toon(0x9ca8aa), signDark = toon(0x414d53);
  addBox(neonFrame, signDark, 0.72, 2.3, 0.1, 0, -1.15, 0);
  for (const x of [-0.35, 0.35]) addBox(neonFrame, signMetal, 0.025, 2.3, 0.04, x, -1.15, 0.06, { cast: false });
  for (const y of [-1.14, 1.12]) addBox(neonFrame, signMetal, 0.72, 0.025, 0.04, 0, y, 0.06, { cast: false });
  for (const y of [-0.8, 0.8]) addBox(neonFrame, signDark, 0.94, 0.07, 0.07, 0, y, -0.04);
  const neon = new THREE.Mesh(planeGeo(0.62, 2.2), decal(TX.alleyNeonTex('酒処', '#ff5f9e'), 1));
  neon.position.set(cx, 2.9, A.z0 + 0.103);
  g.add(neon);
  noOutline(neon);
  const halo = new THREE.Mesh(planeGeo(2.4, 3.6), additiveClone(radialGlowTex(), 0xff5f9e, 0.42));
  halo.position.set(cx, 2.8, A.z0 + 0.16);
  halo.renderOrder = 8;
  g.add(halo);
  noOutline(halo);
  ctx.flickers.push({ mat: halo.material as THREE.MeshBasicMaterial, base: 0.42, seed: 9.3, amp: 0.22 });
  const nl = new THREE.PointLight(0xff6fa5, 5.0, 6.0, 2);
  nl.position.set(cx, 2.5, A.z0 + 0.8);
  g.add(nl);

  // 壁灯
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glow(0xffdfa8, 1.9));
  bulb.position.set(A.x0 + 0.16, CURB + 3.0, A.z1 - 2.4);
  g.add(bulb);
  noOutline(bulb);
  addBox(g, toon(0x282d36), 0.055, 0.14, 0.055, A.x0 + 0.1, CURB + 3.04, A.z1 - 2.4, { cast: false });
  const al = new THREE.PointLight(0xffcf94, 3.0, 4.6, 2);
  al.position.set(A.x0 + 0.5, CURB + 2.9, A.z1 - 2.4);
  g.add(al);

  // 海报
  for (let i = 0; i < 2; i++) {
    buildPosterFrame(g, { x: A.x1 - 0.035, y: 1.4 + i * 0.05, z: A.z1 - 1.5 - i * 0.9,
      w: 0.44, h: 0.66, ry: -Math.PI / 2, kind: i === 0 ? 'coffee' : 'fresh' });
  }
  // 垃圾袋
  for (let i = 0; i < 3; i++) {
    addBox(g, toon(0x454f5a), 0.32, 0.38, 0.32, A.x0 + 0.3, CURB, A.z1 - 1.6 - i * 0.4, { r: 0.08, ry: i * 0.4 });
  }
  // 积水
  const wet = new THREE.Mesh(planeGeo(1.1, 2.6), additiveClone(TX.wetSmearTex(true), 0xffd0a0, 0.26));
  wet.rotation.x = -Math.PI / 2;
  wet.position.set(cx, CURB + 0.012, A.z1 - 1.6);
  wet.renderOrder = 3;
  g.add(wet);
  noOutline(wet);
  ctx.wet.push({ mesh: wet, base: 0.26 });
}

/** 左侧邻楼：只有靠街的立面 + 楼顶，作为左侧的高度层次 */
function buildNeighbor(parent: THREE.Object3D, ctx: SceneCtx): void {
  const N = L.neighbor;
  const g = group(parent, 0, 0, 0, 'neighbor');
  const wall = toon(0xffffff, { map: TX.brickTex() });
  const h = N.h;

  // 主体
  addBox(g, wall, N.x1 - N.x0, h, N.z1 - N.z0, (N.x0 + N.x1) / 2, 0, (N.z0 + N.z1) / 2);
  // 楼顶女儿墙
  addBox(g, toon(0x3d434e), N.x1 - N.x0 + 0.12, 0.4, N.z1 - N.z0 + 0.12, (N.x0 + N.x1) / 2, h, (N.z0 + N.z1) / 2);
  // 朝街一面的窗户（暖冷混合）
  const rnd = (i: number) => {
    const v = Math.sin(i * 127.1) * 43758.5453;
    return v - Math.floor(v);
  };
  let li = 0;
  for (let fy = 0; fy < 3; fy++) {
    for (let fz = 0; fz < 4; fz++) {
      const lit = rnd(fy * 5 + fz) > 0.42;
      const wz = N.z0 + 1.2 + fz * 2.0;
      const wy = 1.8 + fy * 1.9;
      // 窗框
      addBox(g, toon(0x6f7683), 0.06, 1.05, 1.15, N.x1 + 0.01, wy, wz, { cast: false });
      const pane = new THREE.Mesh(planeGeo(0.98, 0.9), glow(lit ? 0xffca82 : 0x26303f, lit ? 0.7 : 0.5));
      pane.position.set(N.x1 + 0.045, wy + 0.52, wz);
      pane.rotation.y = Math.PI / 2;
      g.add(pane);
      noOutline(pane);
      if (lit) li++;
      // 空调外机
      if (rnd(fy * 11 + fz) > 0.6) {
        addBox(g, toon(0xacb2ba), 0.3, 0.46, 0.72, N.x1 + 0.18, wy - 0.5, wz);
      }
    }
  }
  // 屋顶水塔
  addCyl(g, toon(0x3d434e), 0.44, 0.44, 0.8, N.x1 - 0.55, h + 0.4, N.z0 + 2.0, { seg: 12 });
  addCyl(g, toon(0x4a505c), 0.48, 0.48, 0.07, N.x1 - 0.55, h + 1.2, N.z0 + 2.0, { seg: 12 });
  // 底部卷帘门 + 台阶
  addBox(g, toon(0xffffff, { map: TX.shutterTex() }), 0.07, 2.0, 2.2, N.x1 + 0.02, 0, N.z1 - 1.6);
  addBox(g, toon(0x363d4a), 0.5, 0.14, 2.4, N.x1 + 0.25, 0, N.z1 - 1.6);

  ctx.pieces.push(g);
}

function buildTrashBins(parent: THREE.Object3D, x: number, z: number, physics: BottlePhysics, recyclingBins: THREE.Object3D[]): void {
  const g = group(parent, x, CURB, z, 'trash');
  const colors = [P.trashGreen, P.trashBlue, P.trashOrange];
  colors.forEach((c, i) => {
    const bx = i * 0.33 - 0.33;
    buildRecyclingBin(g, bx, 0, {
      width: 0.32, height: 0.775, depth: 0.35, color: c,
      kind: (['paper', 'cans', 'pet'] as const)[i],
    });
    recyclingBins.push(registerRecyclingBin(g, new THREE.Vector3(bx, 0.3875, 0), new THREE.Vector3(0.32, 0.775, 0.35), physics));
  });
  // 三只桶背后原本还有一块 1.06×0.28 的浅灰背板，顶边高过桶盖，
  // 从街上看像一块白色长条贴在桶顶上 —— 去掉。
}

/** 店铺正面的空调外机（挂在侧墙上，从街上可见） */
export function buildAcUnit(parent: THREE.Object3D, x: number, y: number, z: number, ry: number): THREE.Group {
  const g = group(parent, x, y, z);
  g.rotation.y = ry;
  addBox(g, toon(0xb4bbc4), 0.32, 0.58, 0.8, 0, -0.29, 0);
  addBox(g, toon(0x8d949c), 0.34, 0.035, 0.82, 0, 0.29, 0);
  const gr = new THREE.Mesh(new THREE.CircleGeometry(0.21, 16), toon(0xffffff, { map: TX.acGrilleTex() }));
  gr.position.set(0.165, -0.02, 0.07);
  gr.rotation.y = Math.PI / 2;
  g.add(gr);
  noOutline(gr);
  addCyl(g, toon(0x6b7280), 0.018, 0.018, 0.4, -0.1, -0.6, -0.2);
  addCyl(g, toon(0x6b7280), 0.018, 0.018, 0.28, -0.1, -0.6, 0.2);
  return g;
}
