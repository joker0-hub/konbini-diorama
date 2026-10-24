/**
 * 街道家具与环境。
 *
 * 层次：近景（自行车、伞架、垃圾桶、护栏）→ 中景（路灯、贩卖机、路牌）
 * → 远景（电线杆、电线、信号灯、小巷霓虹）。
 * 微缩场景好不好看，很大程度取决于这三层有没有叠起来。
 */

import * as THREE from 'three';
import { P } from '../core/palette';
import { addBox, addCyl, addMesh, group, noOutline, planeGeo, sagWire, strut } from '../core/geom';
import { additiveClone, decal, glow, radialGlowTex, toon } from '../core/materials';
import * as TX from '../core/textures';
import { L } from './layout';
import type { SceneCtx } from './base';
import { buildTrafficSignal, type SignalHandles } from './signal';

const CURB = L.curb;

export interface StreetRefs {
  /** 街角信号灯（车灯 + 行人灯 + 循环） */
  signal: SignalHandles;
  streetLamp: THREE.PointLight;
  /** 门口补光（随门开合变化） */
  doorSpill: THREE.PointLight;
}

export function buildStreet(root: THREE.Object3D, ctx: SceneCtx): StreetRefs {
  const g = group(root, 0, 0, 0, 'street');

  /* ================= 自动贩卖机（靠便利店侧墙） ================= */
  // ry = +90° 让商品面朝 +x（街道侧）；用 -90° 会转成背对街道的白盒子。
  buildVending(g, 'blue', L.walk.xInner + 0.62, CURB, -3.1, Math.PI / 2);
  buildVending(g, 'red', L.walk.xInner + 0.62, CURB, -1.9, Math.PI / 2);
  for (const z of [-3.1, -1.9]) {
    const l = new THREE.PointLight(0xffe0b0, 2.2, 3.2, 2);
    l.position.set(L.walk.xInner + 1.35, 1.5, z);
    g.add(l);
  }

  /* ================= 路灯 ================= */
  const lampX = -6.5;
  const lampZ = L.walk.zOuter - 0.55;
  buildStreetLamp(g, lampX, lampZ, ctx);
  const streetLamp = new THREE.PointLight(0xffcf94, 13, 12, 2);
  streetLamp.position.set(lampX + 0.8, 4.05, lampZ - 0.2);
  streetLamp.castShadow = true;
  streetLamp.shadow.mapSize.set(1024, 1024);
  streetLamp.shadow.camera.near = 0.6;
  streetLamp.shadow.camera.far = 16;
  streetLamp.shadow.bias = -0.0015;
  g.add(streetLamp);

  // 门口溢光（随自动门开合微弱变化）
  const doorSpill = new THREE.PointLight(0xffd9a0, 5.0, 7.0, 2);
  doorSpill.position.set((L.door.x0 + L.door.x1) / 2, 2.2, L.store.z1 + 1.4);
  g.add(doorSpill);

  /* ================= 电线杆 + 电线 ================= */
  // 杆位是构图问题：主视角从 (+x,+z) 看向店角，
  // 任何落在 (2.2, 0.8) 与相机连线上的杆都会挡住整块模型的中心。
  // 所以近处的杆放在「右后侧」和「左前（邻楼前）」，
  // 电线从画面上方斜穿过去 —— 既保留日式街区感，也不挡主体。
  // 杆位必须保证「横担两端」也在台座内：
  // 横担半宽 0.85，台座外沿 8.3，所以杆心 |x| 最大只能到 7.45。
  // 原来最左那根放在 -7.7，横担直接探出 0.25m 悬在台座外。
  const poles: [number, number][] = [
    [5.9, 1.6],
    [4.3, -6.6],
    [-7.4, -7.0],
    [-7.2, 2.6],
  ];
  for (const [px, pz] of poles) buildUtilityPole(g, px, pz);
  buildWires(g);

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
  for (let i = 0; i < 4; i++) {
    const x = -3.4 + i * 2.3;
    addCyl(g, toon(0xdde2e8), 0.05, 0.05, 0.74, x, CURB, L.walk.zOuter - 0.42, { seg: 8 });
    addCyl(g, toon(0xd2452f), 0.052, 0.052, 0.095, x, CURB + 0.58, L.walk.zOuter - 0.42, { seg: 8 });
  }

  /* ================= 门口伞架 + 垃圾桶 ================= */
  buildUmbrellaStand(g, L.door.x0 - 0.85, L.store.z1 + 0.7);
  buildTrashBins(g, L.store.x1 + 0.75, L.store.z1 + 1.5);

  /* ================= 对面的行道树 ================= */
  // 树是最容易挡住主体的道具：它又高又大。
  // 必须放在「相机 → 店角」连线的延长线上、且远到不会进入画面中心。
  // 放在底座最远的对角 (x=-7.6, z=7.6)，只作为背景剪影。
  buildTree(g, -7.4, CURB, 7.2);

  /* ================= 排水沟积水 ================= */
  const gutter = new THREE.Mesh(planeGeo(15.8, 0.22), additiveClone(TX.wetSmearTex(false), 0x8fd4ff, 0.24));
  gutter.rotation.x = -Math.PI / 2;
  gutter.position.set(-0.8, 0.022, L.road.z + 0.3);
  gutter.renderOrder = 3;
  g.add(gutter);
  noOutline(gutter);
  ctx.wet.push({ mesh: gutter, base: 0.24 });

  ctx.pieces.push(g);
  return { signal, streetLamp, doorSpill };
}

/* ------------------------------------------------------------------ */

function buildVending(
  parent: THREE.Object3D, variant: 'blue' | 'red', x: number, y: number, z: number, ry: number,
): THREE.Group {
  const g = group(parent, x, y, z, 'vending-' + variant);
  g.rotation.y = ry;
  addBox(g, toon(variant === 'blue' ? 0xdbe3ee : 0xe5ded6), 0.98, 1.86, 0.74, 0, 0, 0, { r: 0.045 });
  const face = new THREE.Mesh(planeGeo(0.96, 1.84), decal(TX.vendingTex(variant), 1));
  face.position.set(0, 0.93, 0.373);
  g.add(face);
  noOutline(face);
  addBox(g, glow(0xfff3d6, 1.15), 1.02, 0.09, 0.78, 0, 1.9, 0, { cast: false });
  addBox(g, toon(0x1b1f26), 1.04, 0.075, 0.8, 0, 1.81, 0, { cast: false });
  const halo = new THREE.Mesh(planeGeo(2.2, 2.6), additiveClone(radialGlowTex(), 0xffe6bc, 0.3));
  halo.position.set(0, 1.12, 0.5);
  halo.renderOrder = 8;
  g.add(halo);
  noOutline(halo);
  // 侧面格栅
  addBox(g, toon(0xb4bbc4), 0.018, 0.48, 0.58, 0.5, 0.48, 0, { cast: false });
  for (let i = 0; i < 5; i++) addBox(g, toon(0x8d949c), 0.016, 0.018, 0.54, 0.505, 0.52 + i * 0.085, 0, { cast: false });
  // 回收箱：每台机器都放在自己「外侧」，不要卡在红蓝两台中间。
  // 局部 -x 旋转后朝 +z（面向红机一侧），所以蓝机要翻到 +x。
  const binX = variant === 'blue' ? 0.74 : -0.74;
  const bin = addBox(g, toon(0x2f6bd8), 0.42, 0.92, 0.42, binX, 0, 0.14, { r: 0.04 });
  bin.name = 'vending-bin';
  addBox(g, toon(0x1e232b), 0.32, 0.11, 0.02, binX, 0.64, 0.355, { cast: false });
  addMesh(g, new THREE.CircleGeometry(0.068, 12), toon(0x12151b), binX, 0.7, 0.362).castShadow = false;
  return g;
}

function buildStreetLamp(parent: THREE.Object3D, x: number, z: number, ctx: SceneCtx): void {
  const pole = toon(P.poleConcrete);
  addCyl(parent, pole, 0.07, 0.095, 4.5, x, CURB, z, { seg: 12 });
  addCyl(parent, toon(0x282d36), 0.13, 0.15, 0.22, x, CURB, z, { seg: 12 });
  addCyl(parent, toon(0x282d36), 0.1, 0.12, 0.09, x, CURB + 4.4, z, { seg: 12 });
  strut(parent, toon(0x363d4a), [x, CURB + 4.42, z], [x + 0.8, CURB + 4.56, z - 0.22], 0.055, true);

  const head = group(parent, x + 0.88, CURB + 4.5, z - 0.24);
  addBox(head, toon(0x363d4a), 0.15, 0.11, 0.48, 0, 0, 0, { r: 0.03 });
  addBox(head, toon(0x282d36), 0.2, 0.065, 0.54, 0, 0.09, 0, { r: 0.03 });
  const face = new THREE.Mesh(planeGeo(0.38, 0.15), glow(0xfff0c8, 2.2));
  face.rotation.x = Math.PI / 2;
  face.position.set(0, -0.055, 0);
  head.add(face);
  noOutline(face);

  const halo = new THREE.Mesh(planeGeo(1.7, 1.7), additiveClone(radialGlowTex(), 0xffd9a0, 0.44));
  halo.position.set(0, -0.22, 0);
  halo.rotation.x = -Math.PI / 2;
  halo.renderOrder = 8;
  head.add(halo);
  noOutline(halo);
  ctx.flickers.push({ mat: halo.material as THREE.MeshBasicMaterial, base: 0.44, seed: 4.1, amp: 0.03 });

  // 灯下湿地反光
  const refl = new THREE.Mesh(planeGeo(1.5, 4.6), additiveClone(TX.wetSmearTex(true), 0xffd9a0, 0.46));
  refl.rotation.x = -Math.PI / 2;
  refl.position.set(x + 0.88, 0.026, z + 1.4);
  refl.renderOrder = 3;
  parent.add(refl);
  noOutline(refl);
  ctx.wet.push({ mesh: refl, base: 0.46 });
}

function buildUtilityPole(parent: THREE.Object3D, x: number, z: number): void {
  // 组的原点必须放在杆子的落地面上。
  //
  // 之前这里写的是 group(parent, x, 0, z)，而杆体从 CURB 开始 ——
  // 于是整根杆子在 y 方向凭空高了 0.14m，从低角度看就是"杆子离地悬着"。
  // 现在让组原点落在杆脚，杆体从 0 开始，其余部件全部相对杆脚定位。
  const g = group(parent, x, CURB, z, 'utility-pole');
  const conc = toon(0xffffff, { map: TX.concreteTex() });
  addCyl(g, conc, 0.095, 0.14, 7.2, 0, 0, 0, { seg: 10 });
  for (let i = 0; i < 2; i++) {
    const y = 5.9 + i * 0.55;
    addBox(g, toon(0x464c57), 1.7, 0.065, 0.065, 0, y, 0);
    for (let k = -1; k <= 1; k++) {
      addCyl(g, toon(0xd4d8de), 0.048, 0.056, 0.12, k * 0.6, y + 0.065, 0, { seg: 8 });
    }
  }
  addCyl(g, toon(0x6b7280), 0.23, 0.23, 0.72, 0.35, 4.35, 0, { seg: 12 });
  addCyl(g, toon(0x464c57), 0.25, 0.25, 0.055, 0.35, 5.07, 0, { seg: 12 });
  addCyl(g, toon(0x464c57), 0.045, 0.045, 0.18, 0.35, 5.13, 0, { seg: 8 });
  for (let i = 0; i < 6; i++) addBox(g, toon(0x464c57), 0.28, 0.028, 0.028, 0, 1.6 + i * 0.8, 0.12);
  // 杆号牌
  addBox(g, toon(0xeeeade), 0.16, 0.26, 0.018, 0, 3.0, 0.14, { cast: false });
  addBox(g, toon(0x282d36), 0.1, 0.19, 0.005, 0, 3.05, 0.152, { cast: false });
  // 拉线
  addCyl(g, toon(0x6b7280), 0.011, 0.011, 3.0, 0.2, 5.4, 0.2, { rx: 0.24, rz: -0.17, seg: 4 });
}

function buildWires(parent: THREE.Object3D): void {
  const wireMat = toon(0x111419);
  const A = new THREE.Vector3(5.9, 6.6, 1.6);     // 右前杆
  const B = new THREE.Vector3(4.3, 6.5, -6.6);    // 右后杆
  // 左侧两根必须和上面 poles 里的坐标严格一致，
  // 否则电线端点会飘在杆子外面。
  const C = new THREE.Vector3(-7.4, 6.55, -7.0);  // 左后杆
  const D = new THREE.Vector3(-7.2, 6.5, 2.6);    // 左前杆
  const routes: [THREE.Vector3, THREE.Vector3, number][] = [
    // 右侧沿街三根（从画面上方斜穿）
    [A.clone().setY(6.62), B.clone().setY(6.55), 0.55],
    [A.clone().setY(6.08), B.clone().setY(6.0), 0.5],
    [A.clone().setY(5.55), B.clone().setY(5.45), 0.44],
    // 横跨前街（最高处，只在画面上缘出现）
    [D, A, 0.75],
    [D.clone().setY(6.0), A.clone().setY(6.05), 0.7],
    // 后侧
    [C, D, 0.6],
    [C, B, 0.55],
  ];
  for (const [a, b, sag] of routes) {
    const pts = sagWire([a.x, a.y, a.z], [b.x, b.y, b.z], sag, 16);
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 22, 0.017, 5, false), wireMat);
    tube.castShadow = false;
    parent.add(tube);
  }
  // 入户线：从右前杆接到便利店屋顶
  const drop = sagWire([5.7, 5.3, 1.75], [L.store.x1 + 0.15, 4.2, L.store.z1 - 0.6], 0.28, 12);
  parent.add(new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(drop), 16, 0.013, 4, false),
    toon(0x181c23),
  ));
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
  const neon = new THREE.Mesh(planeGeo(0.62, 2.2), decal(TX.alleyNeonTex('酒処', '#ff5f9e'), 1));
  neon.position.set(cx, 2.9, A.z0 + 0.03);
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
    const po = new THREE.Mesh(planeGeo(0.44, 0.66), decal(TX.posterTex(i + 3), 1));
    po.position.set(A.x1 - 0.03, 1.4 + i * 0.05, A.z1 - 1.5 - i * 0.9);
    po.rotation.y = -Math.PI / 2;
    g.add(po);
    noOutline(po);
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

function buildTree(parent: THREE.Object3D, x: number, y: number, z: number): void {
  const g = group(parent, x, y, z, 'tree');
  addCyl(g, toon(0x453629), 0.085, 0.12, 2.4, 0, 0, 0, { seg: 8 });
  const leaf = toon(0x2c4739);
  for (const [bx, by, bz, r] of [
    [0, 2.7, 0, 0.66],
    [-0.4, 2.4, 0.18, 0.46],
    [0.38, 2.46, -0.16, 0.44],
    [0.08, 3.0, 0.1, 0.4],
  ] as [number, number, number, number][]) {
    addMesh(g, new THREE.IcosahedronGeometry(r, 0), leaf, bx, by, bz);
  }
}

function buildUmbrellaStand(parent: THREE.Object3D, x: number, z: number): void {
  /* 参考图里的黑框伞架：
   *   底部实心盘 + 四角立柱 + 顶部一圈方管框，四把合拢的伞
   *   （黑 / 蓝 / 红 / 白）插在框里，J 形伞柄露在框顶上方。
   * 旧版是一个水泥圆柱 + 四根细棍，和参考图完全不是一类东西。
   */
  const g = group(parent, x, CURB + 0.003, z, 'umbrella-stand');
  const frame = toon(0x1b2027);
  const frameHi = toon(0x303843);
  const tray = toon(0x0e1116);
  const shaftMat = toon(0x7d848f);

  const W = 0.84;
  const D = 0.46;
  const baseH = 0.1;
  const frameH = 0.86;

  // 底座 + 内托盘 + 上沿
  addBox(g, frame, W, baseH, D, 0, 0, 0, { r: 0.012 });
  addBox(g, tray, W - 0.1, 0.012, D - 0.1, 0, baseH, 0, { cast: false });
  addBox(g, frameHi, W + 0.02, 0.025, D + 0.02, 0, baseH - 0.01, 0, { r: 0.008 });

  // 四角立柱 + 顶部方框
  for (const sx of [-W / 2 + 0.02, W / 2 - 0.02]) {
    for (const sz of [-D / 2 + 0.02, D / 2 - 0.02]) {
      addBox(g, frame, 0.04, frameH, 0.04, sx, baseH, sz);
    }
  }
  addBox(g, frameHi, W - 0.02, 0.04, 0.04, 0, baseH + frameH - 0.04, -D / 2 + 0.02);
  addBox(g, frameHi, W - 0.02, 0.04, 0.04, 0, baseH + frameH - 0.04, D / 2 - 0.02);
  addBox(g, frameHi, 0.04, 0.04, D - 0.02, -W / 2 + 0.02, baseH + frameH - 0.04, 0);
  addBox(g, frameHi, 0.04, 0.04, D - 0.02, W / 2 - 0.02, baseH + frameH - 0.04, 0);

  // 四把合拢的伞。参考图从左到右：黑、蓝、红、白。
  const canopyProfile = [
    [0.014, 0.0],
    [0.02, 0.04],
    [0.038, 0.12],
    [0.052, 0.24],
    [0.058, 0.37],
    [0.051, 0.49],
    [0.035, 0.61],
    [0.018, 0.68],
  ] as [number, number][];
  const umbrellas: [string, number, number][] = [
    ['black', 0x262b34, -0.27],
    ['blue', 0x2f5fb8, -0.09],
    ['red', 0xc73e35, 0.09],
    ['white', 0xe7e3d8, 0.27],
  ];

  for (const [name, color, ux] of umbrellas) {
    const ug = group(g, ux, baseH, 0, 'umbrella-' + name);
    const mat = toon(color, { side: THREE.DoubleSide, map: TX.umbrellaFoldTex() });
    const handleMat = toon(color, { side: THREE.DoubleSide });
    const bandColor = new THREE.Color(color).multiplyScalar(0.58).getHex();

    // 伞杆（大部分藏在伞面里）
    addCyl(ug, shaftMat, 0.009, 0.009, 0.93, 0, 0.05, 0, { seg: 6 });

    // 合拢的伞面：8 边形 lathe + 平面法线，折面在 toon 色阶下读作伞布褶皱
    let canopyGeo: THREE.BufferGeometry = new THREE.LatheGeometry(
      canopyProfile.map(([r, y]) => new THREE.Vector2(r, y)),
      12,
    );
    canopyGeo = canopyGeo.toNonIndexed();
    canopyGeo.computeVertexNormals();
    const canopy = new THREE.Mesh(canopyGeo, mat);
    canopy.position.y = 0.06;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    ug.add(canopy);

    // 中段束带
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.026, 12, 1, true),
      toon(bandColor, { side: THREE.DoubleSide }),
    );
    band.position.y = 0.42;
    band.castShadow = false;
    ug.add(band);

    // 底部金属伞尖
    addCyl(ug, shaftMat, 0.01, 0.003, 0.06, 0, 0.02, 0, { seg: 6 });

    // J 形伞柄，朝街道方向弯
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.94, 0),
      new THREE.Vector3(0, 1.04, 0.0),
      new THREE.Vector3(0, 1.11, 0.04),
      new THREE.Vector3(0, 1.135, 0.1),
      new THREE.Vector3(0, 1.08, 0.16),
      new THREE.Vector3(0, 1.0, 0.175),
    ]);
    const handle = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.018, 6, false), handleMat);
    handle.castShadow = true;
    ug.add(handle);
    addMesh(ug, new THREE.SphereGeometry(0.018, 8, 6), handleMat, 0, 1.0, 0.175).castShadow = false;
  }
}

function buildTrashBins(parent: THREE.Object3D, x: number, z: number): void {
  const g = group(parent, x, CURB, z, 'trash');
  const colors = [P.trashGreen, P.trashBlue, P.trashOrange];
  colors.forEach((c, i) => {
    const bx = i * 0.33 - 0.33;
    addBox(g, toon(c), 0.3, 0.72, 0.33, bx, 0, 0, { r: 0.03 });
    addBox(g, toon(0x1e232b), 0.32, 0.055, 0.35, bx, 0.72, 0, { r: 0.02 });
    addBox(g, toon(0x181c23), 0.18, 0.12, 0.018, bx, 0.48, 0.17);
  });
  // 三只桶背后原本还有一块 1.06×0.28 的浅灰背板，顶边高过桶盖，
  // 从街上看像一块白色长条贴在桶顶上 —— 去掉。
}

/**
 * 自行车。
 *
 * `y` 是"车轮应该压住的地面高度"，不是组原点。
 *
 * 早期版本直接把 y 传给 group()，但自行车的最低点是轮胎外缘：
 * 轮心在 0.33、轮胎半径 0.32 + 管径 0.026 = 0.346，
 * 所以轮胎底部比组原点低 0.016 —— 整车会陷进地面 1.6cm。
 * 截图里就是"轮子下半截被地砖吃掉了"。
 *
 * 现在改成构建完成后用世界包围盒量一次真实最低点，
 * 再把整组抬起来。这样以后改轮径、改挡泥板都不会再陷。
 */
function buildBicycle(parent: THREE.Object3D, x: number, y: number, z: number, ry: number): THREE.Group {
  const g = group(parent, x, y, z, 'bicycle');
  g.rotation.y = ry;
  const frame = toon(0x2a3850);
  const tire = toon(0x171a1f);
  const rim = toon(0x969da6);

  const wheel = (wx: number) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.026, 6, 18), tire);
    t.position.set(wx, 0.33, 0);
    g.add(t);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.272, 0.011, 5, 16), rim);
    r.position.set(wx, 0.33, 0);
    g.add(r);
    for (let i = 0; i < 4; i++) addBox(g, rim, 0.53, 0.006, 0.006, wx, 0.33, 0, { rz: (i / 4) * Math.PI, cast: false });
  };
  wheel(-0.5);
  wheel(0.5);

  strut(g, frame, [-0.5, 0.33, 0], [-0.02, 0.58, 0], 0.032, true);
  strut(g, frame, [-0.02, 0.58, 0], [0.4, 0.82, 0], 0.032, true);
  strut(g, frame, [0.4, 0.82, 0], [0.5, 0.33, 0], 0.032, true);
  strut(g, frame, [-0.02, 0.58, 0], [0.42, 0.33, 0], 0.032, true);
  strut(g, frame, [-0.5, 0.33, 0], [0.42, 0.33, 0], 0.028, true);
  strut(g, toon(0x8d949c), [0.4, 0.82, 0], [0.42, 0.97, 0], 0.028, true);
  addBox(g, toon(0x1e232b), 0.11, 0.032, 0.44, 0.42, 0.97, 0, { r: 0.02 });
  const saddle = addBox(g, toon(0x1e232b), 0.24, 0.065, 0.13, -0.06, 0.82, 0, { r: 0.04 });
  saddle.name = 'bike-saddle';
  // 座管顶端必须顶到坐垫底面（0.82）。旧版停在 0.78，坐垫下面空 4cm，
  // 远看就是"坐垫浮在车架上"。
  const seatPost = strut(g, toon(0x8d949c), [-0.06, 0.82, 0], [-0.02, 0.58, 0], 0.028, true);
  seatPost.name = 'bike-seat-post';
  // 车筐
  const basket = group(g, 0.55, 0.68, 0);
  addBox(basket, toon(0x8d949c), 0.26, 0.19, 0.32, 0, 0, 0);
  for (let i = 0; i < 3; i++) addBox(basket, toon(0x6b7280), 0.25, 0.018, 0.028, 0, 0.05 + i * 0.055, -0.13 + i * 0.13, { cast: false });
  // 挡泥板
  const f1 = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.017, 4, 14, Math.PI * 0.7), toon(0x454f5a));
  f1.position.set(-0.5, 0.33, 0);
  f1.rotation.z = Math.PI * 0.15;
  g.add(f1);
  const f2 = f1.clone();
  f2.position.set(0.5, 0.33, 0);
  f2.rotation.z = -Math.PI * 0.4;
  g.add(f2);
  strut(g, toon(0x6b7280), [-0.36, 0.33, 0], [-0.44, 0.0, 0.15], 0.023, true);

  // 按真实最低点落地：量一次包围盒，把整组抬到轮胎正好压住 y。
  // 再加 1.2cm 的离地间隙 —— 轮胎和地砖完全相切时，描边 + 抗锯齿会把
  // 最下面一截"吃"进地面，看起来像陷进去了。微缩比例下这个间隙几乎看不见。
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  if (Number.isFinite(box.min.y)) {
    g.position.y += y - box.min.y + 0.012;
  }
  return g;
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
