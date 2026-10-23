/**
 * 街角信号灯。
 *
 * 之前的问题：
 * - 行人灯只是两个发光面片，挂在杆子旁边 0.4m 处，没有支架 —— 看起来浮空；
 * - 灯箱只有一个扁盒子，三颗灯全亮着，没有遮光罩，昼夜都像一块黑板；
 * - 杆子立在路口中间，横臂方向也不对，正好横在店面/人行道上方。
 *
 * 现在按日本路口的实际构造重做：
 *
 *   杆脚（人行道转角内侧）→ 抱箍 → 横臂（伸到右侧车道上方）→ 吊架 → 车灯箱
 *   同一根杆上：行人灯（红上绿下，带支架和按钮盒）、反光带、检修门
 *
 * 行人与车辆信号严格互锁：
 *   车绿灯 10s → 车黄灯 3s → 车红灯 13s
 *   车红灯期间行人绿灯 8.5s，最后 3.5s 绿人闪烁，然后回到红人。
 *
 * 灯光本身是「亮/灭」两态，靠阻尼插值；灭灯不是纯黑，而是暗到不参与 bloom 的
 * 底色 —— 三渲二里纯黑的灯面会像三个洞。
 */

import * as THREE from 'three';
import { addBox, addCyl, group, planeGeo, strut } from '../core/geom';
import { additiveClone, radialGlowTex, toon } from '../core/materials';
import { L } from './layout';

const CURB = L.curb;

/* ---------------- 几何常量 ---------------- */
const POLE = { x: 4.18, z: 2.96, h: 4.95 };
const ARM_Y = CURB + 4.52;           // 4.66
const ARM_LEN = 1.96;
const HEAD_X = POLE.x + ARM_LEN;     // 6.14
const HEAD_Z = POLE.z;
const HEAD_Y = CURB + 4.28;          // 4.42（灯箱中心）
const PED_Y = CURB + 2.45;           // 2.59
const PED_Z = POLE.z + 0.17;

/* ---------------- 循环节奏 ---------------- */
const CYCLE = 26;
const GREEN_END = 10;
const YELLOW_END = 13;
const PED_GREEN_START = YELLOW_END;
const PED_GREEN_END = 21.5;
const PED_FLASH_END = 25;
/** 行人灯闪绿频率（Hz） */
const PED_FLASH_HZ = 2.4;
/** 绿人走路帧频率（Hz） */
const WALK_HZ = 2.2;

const VEHICLE_COLORS = [0x49e08a, 0xffc94a, 0xff3b30] as const;

export type VehiclePhase = 'green' | 'yellow' | 'red';
export type PedPhase = 'red' | 'green' | 'flash';

export interface SignalState {
  phase: VehiclePhase;
  ped: PedPhase;
  /** 0..1，已插值的亮度 */
  levels: { green: number; yellow: number; red: number; pedRed: number; pedGreen: number };
  /** 当前循环内的时间（0..CYCLE） */
  cycleT: number;
}

export interface SignalHandles {
  root: THREE.Group;
  head: THREE.Group;
  ped: THREE.Group;
  update: (t: number, dt: number, ambience: { signage: number; wetness: number }) => void;
  state: () => SignalState;
}

/* ------------------------------------------------------------------ */

function iconTexture(kind: 'stand' | 'walkA' | 'walkB'): THREE.Texture {
  const W = 96;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const head = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
  };
  const line = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };

  if (kind === 'stand') {
    // 站立的红人：双手自然下垂，双腿并拢
    head(48, 20);
    line(48, 33, 48, 78, 16);
    line(48, 44, 35, 70, 10);
    line(48, 44, 61, 70, 10);
    line(48, 78, 43, 116, 12);
    line(48, 78, 53, 116, 12);
  } else if (kind === 'walkA') {
    // 走路帧 A：左腿在前、右臂向前
    head(53, 19);
    line(52, 32, 46, 76, 15);
    line(50, 44, 66, 58, 10);
    line(48, 46, 33, 66, 10);
    line(46, 76, 31, 108, 12);
    line(46, 76, 62, 100, 12);
  } else {
    // 走路帧 B：换腿、换手
    head(49, 19);
    line(50, 32, 51, 76, 15);
    line(51, 44, 37, 62, 10);
    line(52, 46, 66, 56, 10);
    line(51, 76, 38, 104, 12);
    line(51, 76, 64, 110, 12);
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/* ------------------------------------------------------------------ */

export function buildTrafficSignal(parent: THREE.Object3D): SignalHandles {
  const root = group(parent, 0, 0, 0, 'traffic-signal');

  const poleMat = toon(0x2a313a);
  const dark = toon(0x151a21);
  const housing = toon(0x1c222a);
  const plate = toon(0x4f5965);
  const metal = toon(0x8f98a4);

  /* ================= 杆 + 基础 ================= */
  addCyl(root, dark, 0.22, 0.25, 0.07, POLE.x, CURB, POLE.z, { seg: 16 });
  addCyl(root, dark, 0.155, 0.18, 0.34, POLE.x, CURB, POLE.z, { seg: 16 });
  addCyl(root, poleMat, 0.075, 0.1, POLE.h, POLE.x, CURB, POLE.z, { seg: 14 });

  // 反光带 + 检修门（朝向街道一侧）
  addCyl(root, toon(0xd9dee5), 0.083, 0.083, 0.075, POLE.x, CURB + 0.98, POLE.z, { seg: 14 });
  addBox(root, dark, 0.13, 0.3, 0.018, POLE.x, CURB + 1.3, POLE.z + 0.095, { cast: false });
  addBox(root, metal, 0.035, 0.035, 0.012, POLE.x + 0.04, CURB + 1.36, POLE.z + 0.108, { cast: false });

  /* ================= 横臂 + 斜撑 ================= */
  strut(root, poleMat, [POLE.x, ARM_Y, POLE.z], [HEAD_X + 0.12, ARM_Y, POLE.z], 0.085, true);
  // 杆顶盖
  addCyl(root, dark, 0.088, 0.088, 0.09, POLE.x, CURB + POLE.h - 0.06, POLE.z, { seg: 14 });
  // 斜撑：从杆身斜拉到横臂
  strut(root, poleMat, [POLE.x, ARM_Y - 0.62, POLE.z], [HEAD_X - 0.38, ARM_Y - 0.02, POLE.z], 0.04, true);
  // 横臂末端的横担夹
  addCyl(root, dark, 0.06, 0.06, 0.12, HEAD_X + 0.1, ARM_Y, POLE.z, { rz: Math.PI / 2, seg: 12 });
  // 灯箱吊架
  addBox(root, dark, 0.08, 0.12, 0.08, HEAD_X, HEAD_Y + 0.2, HEAD_Z, { cast: false });
  addBox(root, dark, 0.16, 0.05, 0.12, HEAD_X, HEAD_Y + 0.17, HEAD_Z, { cast: false });

  /* ================= 车灯箱 ================= */
  const head = group(root, HEAD_X, HEAD_Y, HEAD_Z, 'signal-head');
  // 背板：比灯箱大一圈，让灯箱在夜空/树影前仍有清楚的轮廓
  addBox(head, plate, 1.18, 0.52, 0.035, 0, -0.26, -0.13, { r: 0.03 });
  // 灯箱本体
  addBox(head, housing, 1.08, 0.4, 0.24, 0, -0.2, 0, { r: 0.05 });
  addBox(head, dark, 1.14, 0.05, 0.28, 0, 0.2, 0, { r: 0.02 });
  addBox(head, dark, 1.12, 0.04, 0.26, 0, -0.24, 0, { r: 0.02 });
  // 顶部小檐，防止从正上方看灯箱是一条平线
  addBox(head, toon(0x20262e), 0.4, 0.035, 0.1, 0, 0.25, 0.05, { cast: false });

  const hoodGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.13, 16, 1, true, Math.PI / 2, Math.PI);
  hoodGeo.rotateX(Math.PI / 2);
  const hoodMat = toon(0x232932, { side: THREE.DoubleSide });

  const lamps: {
    mat: THREE.MeshBasicMaterial;
    haloMat: THREE.MeshBasicMaterial;
    base: THREE.Color;
    level: number;
  }[] = [];

  for (let i = 0; i < 3; i++) {
    const x = -0.34 + i * 0.34;
    // 灯圈
    const bezel = new THREE.Mesh(new THREE.RingGeometry(0.098, 0.132, 24), toon(0x1a2028));
    bezel.position.set(x, 0.02, 0.123);
    head.add(bezel);
    // 灯面：灭时保留深色，亮时颜色 >1 交给 bloom
    const base = new THREE.Color(VEHICLE_COLORS[i]);
    const mat = new THREE.MeshBasicMaterial({
      color: base.clone().multiplyScalar(0.1),
      toneMapped: false,
      fog: false,
    });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.097, 24), mat);
    lens.position.set(x, 0.02, 0.127);
    lens.layers.set(1);
    lens.name = ['lamp-green', 'lamp-yellow', 'lamp-red'][i];
    head.add(lens);
    // 遮光罩
    const hood = new THREE.Mesh(hoodGeo, hoodMat);
    hood.position.set(x, 0.02, 0.075);
    hood.castShadow = false;
    hood.receiveShadow = false;
    head.add(hood);
    // 灯面外晕
    const haloMat = additiveClone(radialGlowTex(), base.getHex(), 0);
    const halo = new THREE.Mesh(planeGeo(0.52, 0.52), haloMat);
    halo.position.set(x, 0.02, 0.19);
    halo.renderOrder = 8;
    halo.layers.set(1);
    head.add(halo);
    lamps.push({ mat, haloMat, base, level: i === 0 ? 1 : 0 });
  }

  /* ================= 行人信号 ================= */
  // 行人灯箱用不受光照影响的深色，避免被店门口的暖光染成一块米色板；
  // 亮着的红/绿人才是视觉焦点。
  const pedBoxMat = new THREE.MeshBasicMaterial({ color: 0x1b2129, toneMapped: false, fog: true });
  const pedDarkMat = new THREE.MeshBasicMaterial({ color: 0x0c1015, toneMapped: false, fog: true });
  const ped = group(root, POLE.x, PED_Y, PED_Z, 'ped-signal');
  addBox(ped, pedBoxMat, 0.3, 0.66, 0.16, 0, -0.33, 0, { r: 0.03 });
  addBox(ped, pedDarkMat, 0.32, 0.04, 0.18, 0, 0.33, 0, { r: 0.015 });
  addBox(ped, pedDarkMat, 0.32, 0.04, 0.18, 0, -0.37, 0, { r: 0.015 });

  // 两个窗口：上红下绿
  const windowY = [0.16, -0.16];
  const windowMats: THREE.MeshBasicMaterial[] = [
    new THREE.MeshBasicMaterial({ color: 0x0d0909, toneMapped: false, fog: false }),
    new THREE.MeshBasicMaterial({ color: 0x070f0b, toneMapped: false, fog: false }),
  ];
  for (let i = 0; i < 2; i++) {
    addBox(ped, pedDarkMat, 0.235, 0.265, 0.012, 0, windowY[i] - 0.1325, 0.078, { cast: false });
    const glass = new THREE.Mesh(planeGeo(0.205, 0.235), windowMats[i]);
    glass.position.set(0, windowY[i], 0.086);
    glass.layers.set(1);
    ped.add(glass);
  }

  const standTex = iconTexture('stand');
  const walkTexs = [iconTexture('walkA'), iconTexture('walkB')];

  const redOn = new THREE.Color(0xff5a4a).multiplyScalar(1.55);
  const redOff = new THREE.Color(0x2a1517);
  const greenOn = new THREE.Color(0x49e08a).multiplyScalar(1.65);
  const greenOff = new THREE.Color(0x0f2a1e);

  const pedRedMat = new THREE.MeshBasicMaterial({
    map: standTex,
    color: redOff.clone(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    alphaTest: 0.04,
  });
  const pedGreenMat = new THREE.MeshBasicMaterial({
    map: walkTexs[0],
    color: greenOff.clone(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    alphaTest: 0.04,
  });

  const pedRed = new THREE.Mesh(planeGeo(0.19, 0.225), pedRedMat);
  pedRed.position.set(0, 0.16, 0.093);
  pedRed.layers.set(1);
  pedRed.name = 'ped-red';
  ped.add(pedRed);

  const pedGreen = new THREE.Mesh(planeGeo(0.19, 0.225), pedGreenMat);
  pedGreen.position.set(0, -0.16, 0.093);
  pedGreen.layers.set(1);
  pedGreen.name = 'ped-green';
  ped.add(pedGreen);

  const pedHaloRedMat = additiveClone(radialGlowTex(), 0xff5a4a, 0);
  const pedHaloRed = new THREE.Mesh(planeGeo(0.32, 0.32), pedHaloRedMat);
  pedHaloRed.position.set(0, 0.16, 0.1);
  pedHaloRed.renderOrder = 8;
  pedHaloRed.layers.set(1);
  ped.add(pedHaloRed);

  const pedHaloGreenMat = additiveClone(radialGlowTex(), 0x49e08a, 0);
  const pedHaloGreen = new THREE.Mesh(planeGeo(0.32, 0.32), pedHaloGreenMat);
  pedHaloGreen.position.set(0, -0.16, 0.1);
  pedHaloGreen.renderOrder = 8;
  pedHaloGreen.layers.set(1);
  ped.add(pedHaloGreen);

  // 把行人灯夹在杆上的抱箍和支架（让"浮空"变成"装上去"）
  addCyl(root, dark, 0.1, 0.1, 0.055, POLE.x, PED_Y - 0.27, POLE.z, { seg: 12 });
  addCyl(root, dark, 0.1, 0.1, 0.055, POLE.x, PED_Y + 0.27, POLE.z, { seg: 12 });
  addBox(root, dark, 0.075, 0.6, 0.075, POLE.x, PED_Y - 0.3, POLE.z + 0.075, { cast: false });
  // 侧面两根短支架：行人灯在 z 方向比杆子靠前 17cm，侧视角下会露出空隙；
  // 这两根横撑把箱体右后侧和杆子连起来，任何角度都能看出是"装上去的"。
  for (const dy of [-0.2, 0.2]) {
    strut(
      root,
      dark,
      [POLE.x + 0.04, PED_Y + dy, POLE.z + 0.01],
      [POLE.x + 0.16, PED_Y + dy, PED_Z - 0.02],
      0.034,
      true,
    );
  }

  // 行人按钮盒
  addBox(root, toon(0xcfd6df), 0.105, 0.16, 0.05, POLE.x, CURB + 1.16, POLE.z + 0.09, { cast: false });
  addBox(root, toon(0x1d242d), 0.08, 0.12, 0.01, POLE.x, CURB + 1.18, POLE.z + 0.117, { cast: false });
  addBox(root, toon(0xf5c542), 0.055, 0.055, 0.012, POLE.x, CURB + 1.21, POLE.z + 0.124, { cast: false });

  /* ================= 地面湿反光 ================= */
  const groundReflMat = additiveClone(radialGlowTex(), 0x49e08a, 0);
  const groundRefl = new THREE.Mesh(planeGeo(1.9, 3.6), groundReflMat);
  groundRefl.rotation.x = -Math.PI / 2;
  groundRefl.position.set(HEAD_X, 0.034, HEAD_Z + 0.4);
  groundRefl.renderOrder = 4;
  groundRefl.layers.set(1);
  root.add(groundRefl);

  /* ================= 灯箱内的点光 ================= */
  const light = new THREE.PointLight(0x49e08a, 2.0, 9.0, 2);
  light.position.set(HEAD_X, HEAD_Y - 0.16, HEAD_Z + 0.32);
  light.castShadow = false;
  root.add(light);

  /* ================= 运行状态 ================= */
  const state: SignalState = {
    phase: 'green',
    ped: 'red',
    levels: { green: 1, yellow: 0, red: 0, pedRed: 1, pedGreen: 0 },
    cycleT: 0,
  };

  const lightColor = new THREE.Color(VEHICLE_COLORS[0]);
  let walkFrame = 0;
  let currentWalkTex = walkTexs[0];

  const damp = (x: number, target: number, rate: number, dt: number): number =>
    x + (target - x) * (1 - Math.exp(-rate * dt));

  const setHaloColor = (mat: THREE.MeshBasicMaterial, c: THREE.Color, level: number, size: number): void => {
    mat.color.copy(c);
    mat.opacity = level * 0.5 * size;
  };

  const update = (t: number, dt: number, ambience: { signage: number; wetness: number }): void => {
    const step = Math.max(1e-4, Math.min(dt, 0.05));
    const cycleT = ((t % CYCLE) + CYCLE) % CYCLE;
    const phase: VehiclePhase = cycleT < GREEN_END ? 'green' : cycleT < YELLOW_END ? 'yellow' : 'red';
    const pedGreenOn = cycleT >= PED_GREEN_START && cycleT < PED_GREEN_END;
    const pedFlash = cycleT >= PED_GREEN_END && cycleT < PED_FLASH_END;
    const pedPhase: PedPhase = pedGreenOn ? 'green' : pedFlash ? 'flash' : 'red';

    const targets = [phase === 'green' ? 1 : 0, phase === 'yellow' ? 1 : 0, phase === 'red' ? 1 : 0];
    for (let i = 0; i < 3; i++) {
      lamps[i].level = damp(lamps[i].level, targets[i], 17, step);
    }
    state.phase = phase;
    state.ped = pedPhase;
    state.cycleT = cycleT;
    state.levels.green = lamps[0].level;
    state.levels.yellow = lamps[1].level;
    state.levels.red = lamps[2].level;

    // 灯面 + 外晕
    for (let i = 0; i < 3; i++) {
      const l = lamps[i];
      l.mat.color.copy(l.base).multiplyScalar(0.09 + l.level * 1.55);
      setHaloColor(l.haloMat, l.base, l.level, 0.35 + 0.65 * ambience.signage);
    }

    // 点光：取当前最亮的灯色，避免"灯已经变红、地面还是绿的"
    const sum = lamps[0].level + lamps[1].level + lamps[2].level;
    if (sum > 0.01) {
      lightColor.setRGB(
        (lamps[0].base.r * lamps[0].level + lamps[1].base.r * lamps[1].level + lamps[2].base.r * lamps[2].level) / sum,
        (lamps[0].base.g * lamps[0].level + lamps[1].base.g * lamps[1].level + lamps[2].base.g * lamps[2].level) / sum,
        (lamps[0].base.b * lamps[0].level + lamps[1].base.b * lamps[1].level + lamps[2].base.b * lamps[2].level) / sum,
      );
    }
    light.color.copy(lightColor);
    const maxLevel = Math.max(lamps[0].level, lamps[1].level, lamps[2].level);
    light.intensity = maxLevel * (0.7 + 1.5 * ambience.signage);

    // 地面反光：只有湿地才明显；白天也保留一点，和"水洼"的物理一致
    groundReflMat.color.copy(lightColor);
    groundReflMat.opacity = maxLevel * ambience.wetness * (0.12 + 0.5 * ambience.signage);

    // 行人灯
    const blinkOn = pedFlash ? Math.floor(t * PED_FLASH_HZ * 2) % 2 === 0 : true;
    const redTarget = pedPhase === 'red' ? 1 : 0;
    const greenTarget = pedPhase === 'green' ? 1 : pedPhase === 'flash' && blinkOn ? 1 : 0;
    state.levels.pedRed = damp(state.levels.pedRed, redTarget, 14, step);
    state.levels.pedGreen = damp(state.levels.pedGreen, greenTarget, 18, step);

    pedRedMat.color.copy(redOff).lerp(redOn, state.levels.pedRed);
    pedGreenMat.color.copy(greenOff).lerp(greenOn, state.levels.pedGreen);
    pedHaloRedMat.opacity = state.levels.pedRed * 0.24;
    pedHaloGreenMat.opacity = state.levels.pedGreen * 0.3;

    // 绿人走路：只在亮着的时候换帧；灭灯时回到第一帧
    if (state.levels.pedGreen > 0.08) {
      const f = Math.floor(t * WALK_HZ) % 2;
      if (f !== walkFrame) {
        walkFrame = f;
        currentWalkTex = walkTexs[f];
        pedGreenMat.map = currentWalkTex;
        pedGreenMat.needsUpdate = true;
      }
    } else if (walkFrame !== 0) {
      walkFrame = 0;
      currentWalkTex = walkTexs[0];
      pedGreenMat.map = currentWalkTex;
      pedGreenMat.needsUpdate = true;
    }
  };

  // 初始帧直接亮起绿灯，避免第一帧三盏全灭
  update(0, 1, { signage: 0.7, wetness: 1 });

  return {
    root,
    head,
    ped,
    update,
    state: () => ({
      ...state,
      levels: { ...state.levels },
    }),
  };
}
