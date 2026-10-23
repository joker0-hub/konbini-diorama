/**
 * 便利店建筑本体。
 *
 * 从 layout.ts 读占地范围；前脸 z=0.8 与侧脸 x=2.2 都是通高玻璃，
 * 转角 (2.2, 0.8) 无柱 —— 这是"便利店街角"最标志性的构形，
 * 也让两条街都能看透店内。
 */

import * as THREE from 'three';
import { P } from '../core/palette';
import { addBox, addCyl, addMesh, group, noOutline, planeGeo, strut } from '../core/geom';
import { additiveClone, decal, glass, glow, glowSprite, radialGlowTex, toon } from '../core/materials';
import * as TX from '../core/textures';
import { L } from './layout';
import type { SceneCtx } from './base';

const S = L.store;
export const STORE = S;
export const DOOR = L.door;

/**
 * 把一段水平范围按门洞切成左右两段（门洞范围内不生成任何几何）。
 *
 * 店门是**滑门**：门扇会横向滑到门洞两侧。任何横跨门洞的静止构件
 * （踢脚板、磨砂贴膜、横向装饰梁、下沿收边）在门打开后都会留在原位，
 * 看上去就像门口多了一道"门槛"或一块不会动的门板。所有沿立面的
 * 通长构件都必须走这个函数，才能保证门洞是真的通透。
 */
function frontGaps(a0: number, a1: number, door: { x0: number; x1: number }): [number, number][] {
  const out: [number, number][] = [];
  if (door.x0 > a0 + 1e-3) out.push([a0, door.x0]);
  if (door.x1 < a1 - 1e-3) out.push([door.x1, a1]);
  return out;
}

export interface StoreParts {
  root: THREE.Group;
  doorL: THREE.Object3D;
  doorR: THREE.Object3D;
  signMats: THREE.MeshBasicMaterial[];
  /** 店面前脸的玻璃面板（用于雨痕对齐） */
  frontGlass: { x: number; z: number; w: number; h: number };
  sideGlass: { x: number; z: number; w: number; h: number };
}

export function buildStore(root: THREE.Object3D, ctx: SceneCtx): StoreParts {
  const g = group(root, 0, 0, 0, 'store');
  const wall = toon(P.storeWall);
  const trim = toon(P.storeTrim);
  const cream = toon(P.storeCream);
  const interiorWall = toon(P.interiorWall);

  /* ============ 地板 / 天花 / 实体墙 ============ */
  addBox(g, toon(0xffffff, { map: TX.interiorFloorTex() }), S.x1 - S.x0, 0.16, S.z1 - S.z0,
    (S.x0 + S.x1) / 2, 0, (S.z0 + S.z1) / 2);
  // 店面下沿的收边条也要在门洞处断开 —— 它只比室内地面高 2.5cm，
  // 但横在门口时仍会被读成一条"门槛"。门洞内只保留本来就有高差的楼板边。
  for (const [a, b] of frontGaps(S.x0 - 0.05, S.x1 + 0.05, DOOR)) {
    addBox(g, trim, b - a, 0.055, 0.18, (a + b) / 2, S.floorY - 0.03, S.z1 + 0.05);
  }

  const ceil = addBox(g, interiorWall, S.x1 - S.x0 - 0.04, 0.1, S.z1 - S.z0 - 0.04,
    (S.x0 + S.x1) / 2, S.ceilY, (S.z0 + S.z1) / 2);
  ceil.castShadow = false;
  ceil.name = 'store-ceiling';

  const h = S.ceilY - S.floorY;
  addBox(g, wall, S.x1 - S.x0, h, S.wallT, (S.x0 + S.x1) / 2, S.floorY, S.z0 + S.wallT / 2);
  addBox(g, wall, S.wallT, h, S.z1 - S.z0, S.x0 + S.wallT / 2, S.floorY, (S.z0 + S.z1) / 2);
  addBox(g, interiorWall, S.x1 - S.x0 - 0.04, h, 0.02, (S.x0 + S.x1) / 2, S.floorY, S.z0 + S.wallT + 0.012, { cast: false });
  addBox(g, interiorWall, 0.02, h, S.z1 - S.z0 - 0.04, S.x0 + S.wallT + 0.012, S.floorY, (S.z0 + S.z1) / 2, { cast: false });

  /* ============ 玻璃幕墙 ============ */
  buildFacade(g, { axis: 'z', plane: S.z1, a0: S.x0, a1: S.x1, door: DOOR });
  buildFacade(g, { axis: 'x', plane: S.x1, a0: S.z0, a1: S.z1 });

  // 右墙在玻璃之上的一段实墙 + 立柱：让侧街看进来时有个"框"，
  // 否则整个侧面会通透到能看见对面墙的外侧，空间就没有围合感了。
  addBox(g, wall, 0.16, S.ceilY - S.glassTop + 0.32, S.z1 - S.z0,
    S.x1 - 0.02, S.glassTop - 0.16, (S.z0 + S.z1) / 2, { cast: false });
  // 侧墙内侧的墙裙（室内看到的白色饰面）
  addBox(g, interiorWall, 0.02, 0.16, S.z1 - S.z0 - 0.06,
    S.x1 - 0.11, S.glassTop - 0.16, (S.z0 + S.z1) / 2, { cast: false });

  // 玻璃磨砂带 + 贴纸。
  // 注意高度：磨砂带只做最下面 ~0.75m（真实便利店也只在踢脚线附近贴膜），
  // 一旦拉到 1.1m 以上，从中景看过去整片玻璃都像糊了层白雾。
  // 前脸贴膜必须绕开自动门：门扇滑开后，中间若还留一段静止的磨砂膜，
  // 就会像门口卡着一块不会动的门板（和踢脚板一起构成"门槛"错觉）。
  const filmH = 0.75;
  const filmY = S.floorY + filmH / 2 - 0.02;
  const filmMat = decal(TX.glassFilmTex(), 0.9);
  // 贴膜上的字（ホシノマート / 24時間営業）原本横跨整个前脸。
  // 切开之后每段不能各自铺满整张贴图，否则左边被横向拉伸、右边被压成
  // 一条细纹，还会重复出现四张贴纸。这里把每段的 UV 收窄到整张图的
  // 对应横向区间，门洞只是"挖掉"，图案仍然连续。
  const filmA = S.x0 + 0.06;
  const filmB = S.x1 - 0.06;
  const filmSpan = filmB - filmA;
  for (const [a, b] of frontGaps(filmA, filmB, DOOR)) {
    const geo = planeGeo(b - a, filmH).clone();
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const u0 = (a - filmA) / filmSpan;
    const u1 = (b - filmA) / filmSpan;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + (u1 - u0) * uv.getX(i));
    uv.needsUpdate = true;
    const film = new THREE.Mesh(geo, filmMat);
    film.position.set((a + b) / 2, filmY, S.z1 + 0.032);
    film.renderOrder = 6;
    g.add(film);
    noOutline(film);
  }
  const filmSide = new THREE.Mesh(planeGeo(S.z1 - S.z0 - 0.12, filmH), decal(TX.glassFilmTex(), 0.9));
  filmSide.position.set(S.x1 + 0.032, S.floorY + filmH / 2 - 0.02, (S.z0 + S.z1) / 2);
  filmSide.rotation.y = Math.PI / 2;
  filmSide.renderOrder = 6;
  g.add(filmSide);
  noOutline(filmSide);

  /* ============ 招牌檐口 ============ */
  const signMats: THREE.MeshBasicMaterial[] = [];
  const fasciaH = S.fasciaTop - S.glassTop;

  addBox(g, cream, S.x1 - S.x0 + 0.42, fasciaH + 0.2, 0.42, (S.x0 + S.x1) / 2, S.glassTop - 0.1, S.z1 + 0.07);
  addBox(g, cream, 0.42, fasciaH + 0.2, S.z1 - S.z0 + 0.42, S.x1 + 0.07, S.glassTop - 0.1, (S.z0 + S.z1) / 2);

  const signFace = new THREE.Mesh(planeGeo(S.x1 - S.x0 + 0.32, fasciaH), decal(TX.storeSignTex(), 1));
  signFace.position.set((S.x0 + S.x1) / 2, S.glassTop + fasciaH / 2, S.z1 + 0.29);
  signFace.renderOrder = 9;
  g.add(signFace);
  noOutline(signFace);

  // 招牌光晕：只做招牌自身的溢光。
  // 平面尺寸必须贴着招牌走 —— 若比招牌高出一大截，
  // 径向渐变会在招牌上方画出一个明显的半圆"穹顶"。
  const haloW = S.x1 - S.x0 + 1.6;
  const haloH = fasciaH + 0.9;
  const signHalo = new THREE.Mesh(
    planeGeo(haloW, haloH),
    additiveClone(glowSprite(haloW / haloH), 0xfff2d4, 0.3),
  );
  signHalo.position.set((S.x0 + S.x1) / 2, S.glassTop + fasciaH / 2, S.z1 + 0.2);
  signHalo.renderOrder = 8;
  g.add(signHalo);
  noOutline(signHalo);
  signMats.push(signHalo.material as THREE.MeshBasicMaterial);

  const sideSign = new THREE.Mesh(planeGeo(S.z1 - S.z0, fasciaH), decal(TX.storeSignSmallTex(), 1));
  sideSign.position.set(S.x1 + 0.29, S.glassTop + fasciaH / 2, (S.z0 + S.z1) / 2);
  sideSign.rotation.y = Math.PI / 2;
  sideSign.renderOrder = 9;
  g.add(sideSign);
  noOutline(sideSign);

  const sideHaloW = S.z1 - S.z0 + 1.2;
  const sideHaloH = fasciaH + 0.9;
  const sideHalo = new THREE.Mesh(
    planeGeo(sideHaloW, sideHaloH),
    additiveClone(glowSprite(sideHaloW / sideHaloH), 0xfff2d4, 0.26),
  );
  sideHalo.position.set(S.x1 + 0.19, S.glassTop + fasciaH / 2, (S.z0 + S.z1) / 2);
  sideHalo.rotation.y = Math.PI / 2;
  sideHalo.renderOrder = 8;
  g.add(sideHalo);
  noOutline(sideHalo);
  signMats.push(sideHalo.material as THREE.MeshBasicMaterial);

  /* ============ 转角竖招牌 ============ */
  // 位置：从店角向外让出 0.58m，并把招牌整体抬高。
  // 旧位置 (S.x1+0.4, 2.1, S.z1+0.4) 的招牌会：
  //   1) 背后插进侧面/正面的招牌檐口（x/z 都落在 fascia 的包围盒里）；
  //   2) 底边 0.85m 挂在玻璃前，下面露出大片店内玻璃，像"招牌下半截是透明的"。
  // 现在底边 1.35m、顶边 3.85m，正好挂在檐口高度内，并用两根短支架连到店角。
  const vert = group(g, S.x1 + 0.58, 2.6, S.z1 + 0.58, 'vertical-sign');
  // addBox 的 y 是"底边"，而 face plane 的原点在几何中心。
  // 这里必须把箱体底边放到 -1.25，让箱体与四面贴图共心；
  // 旧版写成 yBottom=0，箱体整体比贴图高 1.25m，贴图下半截直接悬在玻璃前，
  // 看起来就是"招牌下面有一截透明的"。
  addBox(vert, cream, 0.5, 2.5, 0.5, 0, -1.25, 0, { r: 0.04 });
  for (const [sx, sz, ry] of [
    [0.26, 0, Math.PI / 2],
    [0, 0.26, 0],
    [-0.26, 0, -Math.PI / 2],
    [0, -0.26, Math.PI],
  ] as [number, number, number][]) {
    const face = new THREE.Mesh(planeGeo(0.44, 2.4), decal(TX.verticalSignTex(), 1));
    face.position.set(sx, 0, sz);
    face.rotation.y = ry;
    face.renderOrder = 2;
    vert.add(face);
    noOutline(face);
  }
  // 上下金属收边：让招牌是一个封口的实体，而不是一块悬空的发光板
  addBox(vert, toon(0x2a313b), 0.54, 0.05, 0.54, 0, -1.3, 0, { cast: false });
  addBox(vert, toon(0x2a313b), 0.54, 0.05, 0.54, 0, 1.25, 0, { cast: false });

  // 招牌和店角之间的两根支架：旧招牌是"悬空的"，现在从檐口/角柱伸出来。
  const signBracket = toon(0x3c434f);
  for (const by of [-0.75, 0.65]) {
    const bracket = strut(
      g,
      signBracket,
      [S.x1 + 0.03, 2.6 + by, S.z1 + 0.03],
      [S.x1 + 0.34, 2.6 + by, S.z1 + 0.34],
      0.045,
      true,
    );
    bracket.name = by > 0 ? 'sign-bracket-top' : 'sign-bracket-bottom';
  }

  const vHalo = new THREE.Mesh(planeGeo(1.8, 3.0), additiveClone(radialGlowTex(), 0xffe9c4, 0.22));
  vHalo.position.set(0.08, 0, 0.32);
  vHalo.renderOrder = 8;
  vert.add(vHalo);
  noOutline(vHalo);
  signMats.push(vHalo.material as THREE.MeshBasicMaterial);

  /* ============ 入口雨棚 ============ */
  const canopy = group(g, 0, 0, 0, 'canopy');
  const canX = (DOOR.x0 + DOOR.x1) / 2;
  // 宽度必须由"到店角还剩多少"反推，不能写死。
  // 写死 3.4 时雨棚右端到 x=2.65，而店角在 2.2、转角竖招牌占 2.35..2.85，
  // 于是雨棚既戳出立面又埋进竖招牌里。
  const canW = Math.min(2.3, 2 * (S.x1 - 0.16 - canX));
  const canZ = S.z1 + 0.85;   // 中心 z
  const canD = 1.1;
  const canFront = canZ + canD / 2;          // 前沿 z
  const canBack = canZ - canD / 2;           // 后沿 z（贴在招牌下沿）
  // 高度：整个雨棚必须落在招牌板底面（glassTop - 0.1）以下，
  // 否则会和招牌实体相交，形成插进招牌的"半截板"。
  const canTop = S.glassTop - 0.22;
  const canopyTop = toon(0x9c937f);
  const canopyUnder = toon(0x5d5445);
  addBox(canopy, canopyTop, canW, 0.055, canD, canX, canTop - 0.055, canZ);
  // 底面内檐
  addBox(canopy, canopyUnder, canW - 0.1, 0.03, canD - 0.08, canX, canTop - 0.085, canZ, { cast: false });
  // 灯槽：底面靠外沿的一条暖光
  addBox(canopy, glow(0xffe9c0, 0.85), canW - 0.45, 0.012, 0.09,
    canX, canTop - 0.09, canFront - 0.08, { cast: false });
  // 前沿翻边
  addBox(canopy, toon(0x8a806c), canW, 0.09, 0.045, canX, canTop - 0.1, canFront);
  addBox(canopy, canopyTop, 0.03, 0.1, canD, canX - canW / 2, canTop - 0.085, canZ);
  addBox(canopy, canopyTop, 0.03, 0.1, canD, canX + canW / 2, canTop - 0.085, canZ);
  // 拉杆：从雨棚前沿斜拉到招牌下沿。
  // 起点必须在雨棚底面以下、终点必须在招牌板前表面（z1+0.28）之外，
  // 否则杆件会从招牌里穿出来 —— 这正是之前"斜撑插进招牌"的原因。
  for (const sx of [canX - canW / 2 + 0.12, canX + canW / 2 - 0.12]) {
    strut(canopy, trim,
      [sx, canTop - 0.015, canFront - 0.07],
      [sx, S.glassTop - 0.06, S.z1 + 0.29],
      0.026);
  }

  /* ============ 自动门 ============ */
  // 门的原点必须落在门洞中心（canX），不是场景原点。
  // 之前 doorRoot 建在 x=0，而门洞中心在 canX≈0.95：
  // 于是两扇门整体偏左 0.95m，滑动时会滑到门洞外面 —— 看起来"门打不开"。
  const doorRoot = group(g, canX, 0, S.z1 - 0.03, 'auto-door');
  const doorL = new THREE.Group();
  const doorR = new THREE.Group();
  const doorHalf = (DOOR.x1 - DOOR.x0) / 2;
  const makeLeaf = (target: THREE.Group, sign: -1 | 1) => {
    const leaf = group(target, sign * (doorHalf / 2), 0, 0);
    const glassH = S.glassTop - S.floorY;
    addBox(leaf, trim, doorHalf - 0.02, 0.09, 0.09, 0, S.floorY + 0.02, 0);
    addBox(leaf, trim, doorHalf - 0.02, 0.09, 0.09, 0, S.glassTop - 0.1, 0);
    addBox(leaf, trim, 0.055, glassH - 0.13, 0.09, -(doorHalf - 0.02) / 2, S.floorY + 0.06, 0);
    addBox(leaf, trim, 0.055, glassH - 0.13, 0.09, (doorHalf - 0.02) / 2, S.floorY + 0.06, 0);
    const pane = new THREE.Mesh(planeGeo(doorHalf - 0.1, glassH - 0.2), glass());
    pane.position.set(0, (S.floorY + S.glassTop) / 2, 0);
    pane.renderOrder = 5;
    leaf.add(pane);
    noOutline(pane);
    // 贴纸带：让门的开合看得出来
    const sticker = new THREE.Mesh(planeGeo(doorHalf - 0.1, 0.34), decal(TX.doorStickerTex(), 0.92));
    sticker.position.set(0, S.floorY + 1.28, 0.008);
    sticker.renderOrder = 7;
    leaf.add(sticker);
    noOutline(sticker);
    const stickerBack = new THREE.Mesh(planeGeo(doorHalf - 0.1, 0.34), decal(TX.doorStickerTex(), 0.55));
    stickerBack.position.set(0, S.floorY + 1.28, -0.008);
    stickerBack.rotation.y = Math.PI;
    stickerBack.renderOrder = 7;
    leaf.add(stickerBack);
    noOutline(stickerBack);
    target.add(leaf);
    return leaf;
  };
  makeLeaf(doorL, -1);
  makeLeaf(doorR, 1);
  doorRoot.add(doorL, doorR);

  // 门头感应器（相对 doorRoot，所以用局部坐标）
  addBox(doorRoot, toon(0x191d24), 0.3, 0.1, 0.13, 0.75, 2.66, 0.07);
  addMesh(doorRoot, planeGeo(0.055, 0.055), glow(0xff4030, 2.0), 0.75, 2.66, 0.14).castShadow = false;

  // 地垫
  addBox(g, toon(0x222933), 1.9, 0.04, 1.05, canX, L.curb, S.z1 + 0.62, { r: 0.012 });
  addBox(g, toon(0x333e4c), 1.7, 0.015, 0.9, canX, L.curb + 0.04, S.z1 + 0.62, { r: 0.02 });

  /* ============ 屋面 ============ */
  const roof = group(g, 0, 0, 0, 'roof');
  // 屋面板用较浅的灰色：从俯视角度看，屋顶占了画面的很大一块，
  // 全黑会让整块模型失去"微缩建筑"的体积感。
  addBox(roof, toon(0x7b828e), S.x1 - S.x0 + 0.46, 0.18, S.z1 - S.z0 + 0.46,
    (S.x0 + S.x1) / 2, S.roofY, (S.z0 + S.z1) / 2);
  const paraH = 0.42;
  addBox(roof, trim, S.x1 - S.x0 + 0.46, paraH, 0.13, (S.x0 + S.x1) / 2, S.roofY + 0.18, S.z1 + 0.17);
  addBox(roof, trim, S.x1 - S.x0 + 0.46, paraH, 0.13, (S.x0 + S.x1) / 2, S.roofY + 0.18, S.z0 - 0.17);
  addBox(roof, trim, 0.13, paraH, S.z1 - S.z0 + 0.46, S.x0 - 0.17, S.roofY + 0.18, (S.z0 + S.z1) / 2);
  addBox(roof, trim, 0.13, paraH, S.z1 - S.z0 + 0.46, S.x1 + 0.17, S.roofY + 0.18, (S.z0 + S.z1) / 2);

  const rY = S.roofY + 0.18;
  // 屋顶空调
  for (let i = 0; i < 2; i++) {
    const bx = -3.9 + i * 2.0;
    addBox(roof, toon(0xc0c6ce), 1.05, 0.72, 0.62, bx, rY, -5.3);
    const gr = new THREE.Mesh(planeGeo(0.92, 0.36), toon(0xffffff, { map: TX.acGrilleTex() }));
    gr.position.set(bx, rY + 0.46, -5.3 + 0.315);
    roof.add(gr);
    noOutline(gr);
    addBox(roof, toon(0x8d949c), 1.1, 0.055, 0.66, bx, rY + 0.7, -5.3);
  }
  // 检修口
  addBox(roof, toon(0xb4b9c1), 1.2, 1.1, 1.2, 0.9, rY, -5.7);
  addBox(roof, toon(0x969da6), 1.3, 0.09, 1.3, 0.9, rY + 1.1, -5.7);
  addBox(roof, toon(0x474d59), 0.64, 1.2, 0.055, 0.9, rY, -5.11);
  // 排风
  addCyl(roof, toon(0x8d949c), 0.1, 0.1, 0.85, -1.8, rY, -6.0);
  addCyl(roof, toon(0x8d949c), 0.13, 0.13, 0.1, -1.8, rY + 0.85, -6.0);
  // 天线
  addCyl(roof, toon(0x6b7280), 0.028, 0.028, 2.2, -4.9, rY, -5.9);
  for (let i = 0; i < 3; i++) addBox(roof, toon(0x6b7280), 0.72 - i * 0.16, 0.022, 0.022, -4.9, rY + 1.5 + i * 0.22, -5.9);
  // 太阳能板
  addBox(roof, toon(0x28374c), 1.7, 0.055, 1.0, 0.1, rY + 0.02, -3.6, { cast: false });

  /* ============ 侧墙细节 ============ */
  for (let i = 0; i < 8; i++) {
    addBox(g, toon(0xc6cad1), 0.018, 0.5, 0.022, S.x1 + 0.29, S.glassTop + 0.22, S.z0 + 0.7 + i * 0.85, { cast: false });
  }
  for (const dz of [S.z0 + 0.3, S.z1 - 0.3]) {
    addCyl(g, toon(0x969da6), 0.05, 0.05, S.roofY + 0.25, S.x1 + 0.26, L.curb, dz, { seg: 10 });
  }
  for (let i = 0; i < 4; i++) {
    addBox(g, glow(0xfff0cf, 0.95), 0.025, 0.045, 1.0, S.x1 + 0.31, 2.66, S.z0 + 1.1 + i * 1.6, { cast: false });
  }

  ctx.pieces.push(g, roof);

  return {
    root: g,
    doorL,
    doorR,
    signMats,
    frontGlass: { x: (S.x0 + S.x1) / 2, z: S.z1 + 0.035, w: S.x1 - S.x0 - 0.3, h: S.glassTop - S.floorY - 0.4 },
    sideGlass: { x: S.x1 + 0.035, z: (S.z0 + S.z1) / 2, w: S.z1 - S.z0 - 0.3, h: S.glassTop - S.floorY - 0.4 },
  };
}

/* ------------------------------------------------------------------ */

interface FacadeSpec {
  axis: 'x' | 'z';
  plane: number;
  a0: number;
  a1: number;
  door?: { x0: number; x1: number };
}

/**
 * 玻璃幕墙：通高玻璃 + 深色竖挺 + 底部踢脚板。
 * 玻璃用极低不透明度 Basic 材质 —— 三渲二不需要折射，
 * 要的是"一眼看透店内"。
 */
function buildFacade(parent: THREE.Object3D, spec: FacadeSpec): THREE.Group {
  const f = group(parent, 0, 0, 0, 'facade');
  const trim = toon(P.storeTrim);
  const kickMat = toon(0x212833);
  const span = spec.a1 - spec.a0;
  const mid = (spec.a0 + spec.a1) / 2;
  const isZ = spec.axis === 'z';
  const out = 0.02;

  const boxAt = (w: number, hh: number, dd: number, a: number, yBottom: number) => {
    const geo = isZ ? new THREE.BoxGeometry(w, hh, dd) : new THREE.BoxGeometry(dd, hh, w);
    const m = new THREE.Mesh(geo, trim);
    m.position.set(isZ ? a : spec.plane + out, yBottom + hh / 2, isZ ? spec.plane + out : a);
    m.castShadow = true;
    m.receiveShadow = true;
    f.add(m);
    return m;
  };

  const kickH = 0.4;
  // 踢脚板在门洞处断开。旧版是一整块 span 宽的板，门滑开后它仍然
  // 横在门口（0.4m 高），正是"看起来像一个门槛"的来源。
  const spans = spec.door ? frontGaps(spec.a0, spec.a1, spec.door) : [[spec.a0, spec.a1] as [number, number]];
  for (const [a, b] of spans) {
    const w = b - a;
    if (w <= 0.01) continue;
    const geo = isZ ? new THREE.BoxGeometry(w, kickH, 0.17) : new THREE.BoxGeometry(0.17, kickH, w);
    const m = new THREE.Mesh(geo, kickMat);
    m.position.set(isZ ? (a + b) / 2 : spec.plane, L.store.floorY + kickH / 2, isZ ? spec.plane : (a + b) / 2);
    m.castShadow = true;
    f.add(m);
  }

  const studs: number[] = [];
  const n = Math.max(2, Math.round(span / 2.0));
  for (let i = 0; i <= n; i++) studs.push(spec.a0 + (span * i) / n);
  if (spec.door) studs.push(spec.door.x0, spec.door.x1);
  const uniq = Array.from(new Set(studs.map((v) => Math.round(v * 1000) / 1000))).sort((a, b) => a - b);

  const glassMat = glass();
  for (let i = 0; i < uniq.length - 1; i++) {
    const a = uniq[i];
    const b = uniq[i + 1];
    if (spec.door && a >= spec.door.x0 - 0.001 && b <= spec.door.x1 + 0.001) continue;
    const w = b - a - 0.09;
    if (w <= 0.05) continue;
    const gh = L.store.glassTop - (L.store.floorY + kickH);
    const m = new THREE.Mesh(planeGeo(w, gh), glassMat);
    if (isZ) m.position.set((a + b) / 2, L.store.floorY + kickH + gh / 2, spec.plane + out);
    else {
      m.position.set(spec.plane + out, L.store.floorY + kickH + gh / 2, (a + b) / 2);
      m.rotation.y = Math.PI / 2;
    }
    m.renderOrder = 5;
    f.add(m);
    noOutline(m);
  }

  for (const a of uniq) boxAt(0.085, L.store.glassTop - L.store.floorY, 0.14, a, L.store.floorY);

  const beamH = 0.12;
  {
    const geo = isZ ? new THREE.BoxGeometry(span, beamH, 0.16) : new THREE.BoxGeometry(0.16, beamH, span);
    const m = new THREE.Mesh(geo, trim);
    m.position.set(isZ ? mid : spec.plane, L.store.glassTop - beamH / 2, isZ ? spec.plane : mid);
    m.castShadow = true;
    f.add(m);
    // 中横梁同样不能横穿门洞，否则门扇滑开后它会挂在门洞中间。
    const beamY = L.store.floorY + kickH + (L.store.glassTop - L.store.floorY - kickH) * 0.76;
    for (const [a, b] of spans) {
      const w = b - a;
      if (w <= 0.01) continue;
      const g2 = isZ ? new THREE.BoxGeometry(w, beamH, 0.16) : new THREE.BoxGeometry(0.16, beamH, w);
      const m2 = new THREE.Mesh(g2, trim);
      m2.position.set(isZ ? (a + b) / 2 : spec.plane, beamY, isZ ? spec.plane : (a + b) / 2);
      m2.castShadow = true;
      f.add(m2);
    }
  }

  if (spec.door) {
    const dw = spec.door.x1 - spec.door.x0;
    boxAt(dw + 0.14, 0.14, 0.2, (spec.door.x0 + spec.door.x1) / 2, L.store.glassTop - 0.14);
  }

  return f;
}
