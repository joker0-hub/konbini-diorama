/** Pole hardware and conductors use the same attachment coordinates. */
import * as THREE from 'three';
import { addBox, addCyl, addMesh, group, noOutline, planeGeo, sagWire, strut } from '../core/geom';
import { decal, toon } from '../core/materials';
import * as TX from '../core/textures';
import { L } from './layout';

export const POLES = {
  rightFront: [4.3, 1.55], rightBack: [4.3, -6.6],
  leftBack: [-7.4, -7.0], leftFront: [-7.4, 2.6],
} as const;
type PoleName = keyof typeof POLES;
const ARM_Y = [5.9, 6.45] as const;
const INSULATOR_TOP = 0.31;

function attachment(pole: PoleName, level: number, lane: number): [number, number, number] {
  const [x, z] = POLES[pole];
  return [x + lane * 0.62, L.curb + ARM_Y[level] + INSULATOR_TOP, z];
}

function cable(parent: THREE.Object3D, a: [number, number, number], b: [number, number, number], sag: number, radius = 0.013): void {
  const points = sagWire(a, b, sag, 14);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, radius, 5, false), toon(0x181e24));
  mesh.name = 'utility-cable';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
}

export function buildUtilityPoles(parent: THREE.Object3D): void {
  const steel = toon(0x515f66);
  const silver = toon(0x9ca8aa);
  const ceramic = toon(0xd8ddd2);
  const dark = toon(0x303e45);
  const concrete = toon(0xffffff, { map: TX.concreteTex() });
  const ochre = toon(0xd4ad55);

  Object.entries(POLES).forEach(([name, [x, z]], index) => {
    const g = group(parent, x, L.curb, z, 'utility-pole');
    addCyl(g, concrete, 0.095, 0.14, 7.2, 0, 0, 0, { seg: 12 });
    addCyl(g, silver, 0.097, 0.097, 0.035, 0, 7.19, 0, { seg: 12, cast: false });
    addCyl(g, dark, 0.145, 0.145, 0.075, 0, 0, 0, { seg: 12, cast: false });

    ARM_Y.forEach(y => {
      addBox(g, steel, 1.7, 0.075, 0.09, 0, y, 0);
      addBox(g, silver, 0.075, 0.015, 0.095, -0.81, y + 0.025, 0, { cast: false });
      addBox(g, silver, 0.075, 0.015, 0.095, 0.81, y + 0.025, 0, { cast: false });
      addCyl(g, steel, 0.117, 0.117, 0.065, 0, y - 0.02, 0, { seg: 12, cast: false });
      for (const side of [-1, 1]) {
        strut(g, steel, [0, y - 0.38, 0.035], [side * 0.64, y + 0.015, 0.035], 0.028, true).castShadow = false;
        addCyl(g, silver, 0.023, 0.023, 0.025, side * 0.64, y - 0.002, 0.065, { rx: Math.PI / 2, seg: 6, cast: false });
      }
      for (const lane of [-1, 0, 1]) {
        const ix = lane * 0.62;
        addCyl(g, steel, 0.022, 0.022, 0.24, ix, y + 0.07, 0, { seg: 8, cast: false });
        for (let rib = 0; rib < 3; rib++) {
          addCyl(g, ceramic, 0.067 - rib * 0.006, 0.073 - rib * 0.006, 0.042, ix, y + 0.1 + rib * 0.057, 0, { seg: 10, cast: false });
        }
        addCyl(g, dark, 0.034, 0.034, 0.035, ix, y + INSULATOR_TOP - 0.035, 0, { seg: 8, cast: false, name: 'utility-wire-terminal' });
      }
    });

    // A bracketed oil transformer: rolled rims, cooling ribs, bushings and jumpers.
    const tx = 0.37;
    for (const y of [4.37, 4.94]) {
      addCyl(g, steel, 0.127, 0.127, 0.055, 0, y, 0, { seg: 12, cast: false });
      strut(g, steel, [0.08, y + 0.02, 0], [tx, y + 0.02, 0], 0.07);
    }
    addBox(g, steel, 0.4, 0.055, 0.43, tx, 4.3, 0);
    addCyl(g, silver, 0.228, 0.228, 0.72, tx, 4.35, 0, { seg: 16 });
    for (const y of [4.34, 4.44, 5.035]) addCyl(g, steel, 0.247, 0.247, 0.032, tx, y, 0, { seg: 16, cast: false });
    addCyl(g, dark, 0.251, 0.251, 0.048, tx, 5.07, 0, { seg: 16 });
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI / 8;
      addBox(g, steel, 0.024, 0.43, 0.032, tx + Math.cos(a) * 0.23, 4.53, Math.sin(a) * 0.23, { ry: -a, cast: false });
    }
    for (const bx of [0.24, 0.49]) {
      addCyl(g, dark, 0.027, 0.027, 0.23, bx, 5.11, 0, { seg: 8, cast: false });
      for (let i = 0; i < 3; i++) addCyl(g, ceramic, 0.05, 0.056, 0.035, bx, 5.15 + i * 0.05, 0, { seg: 8, cast: false });
    }
    cable(g, [0.62, ARM_Y[0] + INSULATOR_TOP, 0], [0.49, 5.34, 0], 0.12, 0.012);
    cable(g, [0, ARM_Y[0] + INSULATOR_TOP, 0], [0.24, 5.34, 0], 0.09, 0.012);
    const warning = addMesh(g, planeGeo(0.16, 0.12), decal(TX.serviceNoticeTex('electric')), tx, 4.77, 0.231);
    noOutline(warning);

    // Telecom box, conduit, cable loops and climbing pegs are attached to the shaft.
    addBox(g, steel, 0.24, 0.45, 0.16, -0.04, 3.8, 0.16);
    addBox(g, silver, 0.2, 0.39, 0.025, -0.04, 3.83, 0.255, { cast: false });
    addCyl(g, dark, 0.017, 0.017, 3.63, -0.07, 0.17, 0.135, { seg: 6, cast: false });
    for (const y of [0.7, 2.65, 3.72, 4.25, 5.4]) addCyl(g, steel, 0.145 - y * 0.006, 0.145 - y * 0.006, 0.035, 0, y, 0, { seg: 12, cast: false });
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      strut(g, steel, [side * 0.08, 1.48 + i * 0.47, -0.015], [side * 0.24, 1.48 + i * 0.47, -0.015], 0.025, true).castShadow = false;
      strut(g, steel, [side * 0.24, 1.48 + i * 0.47, -0.015], [side * 0.24, 1.53 + i * 0.47, -0.015], 0.025, true).castShadow = false;
    }
    for (const y of [3.43, 3.49]) {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.012, 4, 18), dark);
      loop.position.set(-0.17, y, 0.12);
      loop.castShadow = false;
      g.add(loop);
    }
    addBox(g, ceramic, 0.18, 0.34, 0.025, 0, 2.77, 0.14, { cast: false });
    const id = addMesh(g, planeGeo(0.16, 0.32), decal(TX.serviceNoticeTex('pole', `0${index + 1}`)), 0, 2.94, 0.155);
    noOutline(id);
    // Reflective bands at walking height, with a dark break between the strips.
    for (const y of [0.62, 0.86]) addCyl(g, ochre, 0.143, 0.143, 0.12, 0, y, 0, { seg: 12, cast: false });
    g.userData.poleId = name;
  });

  const wires = group(parent, 0, 0, 0, 'utility-wires');
  for (const [a, b] of [['rightFront', 'rightBack'], ['leftFront', 'leftBack']] as const) {
    for (const lane of [-1, 0, 1]) cable(wires, attachment(a, 1, lane), attachment(b, 1, lane), 0.48 + 0.06 * (lane + 1));
  }
  for (const [a, b] of [['leftFront', 'rightFront'], ['leftBack', 'rightBack']] as const) {
    for (const lane of [-1, 1]) cable(wires, attachment(a, 0, lane), attachment(b, 0, lane), 0.56 + (lane + 1) * 0.08);
  }
  // Lower communication line terminates at the junction box on each shaft.
  for (const [a, b] of [['rightFront', 'rightBack'], ['leftFront', 'leftBack']] as const) {
    cable(wires, [POLES[a][0] - 0.04, L.curb + 4.15, POLES[a][1] + 0.17], [POLES[b][0] - 0.04, L.curb + 4.15, POLES[b][1] + 0.17], 0.42, 0.017);
  }
  const mast: [number, number, number] = [L.store.x1 - 0.07, L.store.roofY + 0.87, L.store.z1 - 0.64];
  const [px, pz] = POLES.rightFront;
  cable(wires, [px - 0.04, L.curb + 4.15, pz + 0.17], mast, 0.24, 0.012);
  addCyl(wires, steel, 0.027, 0.027, 0.69, mast[0], L.store.roofY + 0.18, mast[2], { seg: 8 });
  addBox(wires, dark, 0.18, 0.045, 0.18, mast[0], L.store.roofY + 0.18, mast[2]);
  addCyl(wires, ceramic, 0.055, 0.055, 0.065, mast[0], mast[1] - 0.065, mast[2], { seg: 8, cast: false });
}
