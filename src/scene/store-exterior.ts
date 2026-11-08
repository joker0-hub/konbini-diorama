/** Solid service elevations and small roof fittings, shared by the static batch. */
import * as THREE from 'three';
import { addBox, addCyl, addMesh, group, noOutline, planeGeo, strut } from '../core/geom';
import { decal, glow, toon } from '../core/materials';
import * as TX from '../core/textures';
import { L } from './layout';

const S = L.store;

export function buildStoreExterior(parent: THREE.Object3D): void {
  const g = group(parent, 0, 0, 0, 'store-service-elevations');
  const metal = toon(0x818c91);
  const dark = toon(0x414d53);
  const edge = toon(0xb5b9b3);
  const panel = toon(0xc9cec7);
  const seam = toon(0xb4b9b3);
  const cream = toon(0xe8e2d4);
  const green = toon(0x3c796c);
  const back = S.z0 - 0.035;
  const width = S.x1 - S.x0;
  const midX = (S.x0 + S.x1) / 2;

  // Continue the plinth and cornice around both solid elevations.
  addBox(g, dark, width, 0.3, 0.065, midX, S.floorY, back);
  addBox(g, dark, 0.065, 0.3, S.z1 - S.z0, S.x0 - 0.035, S.floorY, (S.z0 + S.z1) / 2);
  for (const y of [1.35, 2.55, 3.35]) {
    addBox(g, seam, width, 0.016, 0.016, midX, y, back - 0.004, { cast: false });
    addBox(g, seam, 0.016, 0.016, S.z1 - S.z0, S.x0 - 0.04, y, (S.z0 + S.z1) / 2, { cast: false });
  }
  for (let x = S.x0 + 1.25; x < S.x1 - 0.4; x += 1.25) {
    addBox(g, seam, 0.012, S.roofY - S.floorY, 0.014, x, S.floorY, back - 0.006, { cast: false });
  }
  for (let z = S.z0 + 1.3; z < S.z1 - 0.3; z += 1.3) {
    addBox(g, seam, 0.014, S.roofY - S.floorY, 0.012, S.x0 - 0.04, S.floorY, z, { cast: false });
  }
  addBox(g, cream, width + 0.18, 0.19, 0.16, midX, S.roofY - 0.26, S.z0 - 0.08);
  addBox(g, green, width + 0.18, 0.045, 0.17, midX, S.roofY - 0.29, S.z0 - 0.085, { cast: false });
  addBox(g, cream, 0.16, 0.19, S.z1 - S.z0 + 0.18, S.x0 - 0.08, S.roofY - 0.26, (S.z0 + S.z1) / 2);
  addBox(g, green, 0.17, 0.045, S.z1 - S.z0 + 0.18, S.x0 - 0.085, S.roofY - 0.29, (S.z0 + S.z1) / 2, { cast: false });
  for (const x of [S.x0 + 0.04, S.x1 - 0.04]) {
    addBox(g, edge, 0.1, S.roofY - S.floorY, 0.09, x, S.floorY, back);
  }

  // Rear door faces -Z. Its leaf stays closed, with a proper frame and threshold.
  const door = group(g, -3.68, S.floorY, S.z0 - 0.085, 'store-service-door');
  door.rotation.y = Math.PI;
  addBox(door, dark, 1.12, 2.31, 0.1, 0, 0, 0);
  addBox(door, panel, 0.96, 2.19, 0.055, 0, 0.035, 0.065);
  addBox(door, metal, 0.83, 0.36, 0.012, 0, 0.065, 0.101, { cast: false });
  addBox(door, dark, 0.24, 0.04, 0.055, 0.29, 1.05, 0.13);
  for (const y of [0.38, 1.82]) addBox(door, metal, 0.035, 0.14, 0.04, -0.46, y, 0.11);
  for (let i = 0; i < 6; i++) addBox(door, dark, 0.58, 0.017, 0.012, 0, 0.62 + i * 0.055, 0.1, { cast: false });
  addBox(door, edge, 1.22, 0.04, 0.48, 0, -0.02, 0.14);
  addBox(door, metal, 1.38, 0.07, 0.55, 0, 2.36, 0.16);
  const serviceSign = addMesh(door, planeGeo(0.65, 0.25), decal(TX.serviceNoticeTex('door')), 0, 1.69, 0.102);
  noOutline(serviceSign);
  addBox(door, dark, 0.4, 0.08, 0.11, 0, 2.23, 0.14);
  const light = addBox(door, glow(0xffe4b3, 0.85), 0.32, 0.04, 0.045, 0, 2.245, 0.205, { cast: false });
  noOutline(light);

  // Two separate ventilation assemblies: a shallow hood above real angled slats.
  for (const [x, w] of [[-1.45, 1.15], [0.37, 0.95]]) {
    const vent = group(g, x, 2.02, S.z0 - 0.1, 'store-rear-vent');
    vent.rotation.y = Math.PI;
    addBox(vent, metal, w + 0.1, 0.76, 0.1, 0, 0, 0);
    addBox(vent, dark, w - 0.04, 0.61, 0.025, 0, 0.07, 0.07, { cast: false });
    for (let i = 0; i < 8; i++) {
      addBox(vent, edge, w - 0.02, 0.035, 0.09, 0, 0.08 + i * 0.077, 0.1, { rx: -0.3, cast: false });
    }
    addBox(vent, panel, w + 0.18, 0.045, 0.26, 0, 0.77, 0.06);
  }

  const cabinet = group(g, -1.17, 0.64, S.z0 - 0.16, 'store-meter-cabinet');
  cabinet.rotation.y = Math.PI;
  addBox(cabinet, dark, 0.92, 0.91, 0.22, 0, 0, 0);
  for (const x of [-0.225, 0.225]) {
    addBox(cabinet, panel, 0.43, 0.84, 0.045, x, 0.035, 0.135);
    addBox(cabinet, dark, 0.025, 0.1, 0.025, x + 0.12, 0.4, 0.17, { cast: false });
    for (let i = 0; i < 3; i++) addBox(cabinet, metal, 0.27, 0.015, 0.012, x, 0.13 + i * 0.05, 0.16, { cast: false });
  }
  const meter = addMesh(cabinet, new THREE.CircleGeometry(0.093, 16), toon(0x354c4d), 0.22, 0.64, 0.164, { cast: false });
  noOutline(meter);
  const notice = addMesh(cabinet, planeGeo(0.22, 0.17), decal(TX.serviceNoticeTex('electric')), -0.22, 0.64, 0.165);
  noOutline(notice);
  for (const x of [-1.46, -0.87]) {
    addCyl(g, metal, 0.022, 0.022, 1.77, x, 1.55, S.z0 - 0.15, { seg: 8, cast: false });
    for (const y of [1.74, 2.94]) addBox(g, dark, 0.09, 0.035, 0.05, x, y, S.z0 - 0.13, { cast: false });
  }
  strut(g, metal, [-1.46, 3.32, S.z0 - 0.15], [0.84, 3.32, S.z0 - 0.15], 0.044, true).castShadow = false;

  // Rainwater pipe turns out onto the rear drain; clamps visibly attach it to the wall.
  const pipeX = S.x1 - 0.28;
  addCyl(g, metal, 0.052, 0.052, S.roofY - 0.3, pipeX, 0.3, S.z0 - 0.17, { seg: 10 });
  strut(g, metal, [pipeX, 0.3, S.z0 - 0.17], [pipeX, 0.22, S.z0 - 0.37], 0.104, true);
  strut(g, metal, [pipeX, S.roofY, S.z0 - 0.17], [pipeX, S.roofY + 0.16, S.z0 + 0.1], 0.104, true);
  for (const y of [0.6, 1.65, 2.8]) addBox(g, dark, 0.15, 0.04, 0.14, pipeX, y, S.z0 - 0.12, { cast: false });
  addBox(g, dark, 0.4, 0.014, 0.36, pipeX, L.curb + 0.005, S.z0 - 0.43, { cast: false });
  for (let i = 0; i < 6; i++) addBox(g, metal, 0.31, 0.01, 0.016, pipeX, L.curb + 0.019, S.z0 - 0.56 + i * 0.05, { cast: false });

  // The alley elevation gets its own high window and service duct, clear of the existing ACs.
  const alley = group(g, S.x0 - 0.07, 0, -5.48, 'store-alley-service');
  alley.rotation.y = -Math.PI / 2;
  addBox(alley, dark, 1.55, 0.69, 0.06, 0, 2.47, 0);
  addBox(alley, toon(0x71908c), 1.39, 0.52, 0.02, 0, 2.55, 0.045, { cast: false });
  addBox(alley, edge, 1.65, 0.045, 0.15, 0, 2.44, 0.035);
  for (const x of [-0.46, 0, 0.46]) addBox(alley, metal, 0.025, 0.52, 0.025, x, 2.55, 0.062, { cast: false });
  addBox(alley, metal, 0.36, 1.68, 0.28, -0.52, 0.48, 0.13);
  addBox(alley, dark, 0.38, 0.4, 0.3, -0.52, 2.13, 0.14);
  for (let i = 0; i < 5; i++) addBox(alley, edge, 0.3, 0.025, 0.05, -0.52, 2.17 + i * 0.066, 0.31, { cast: false });
}

export function buildRoofDetails(roof: THREE.Object3D): void {
  const g = group(roof, 0, 0, 0, 'store-roof-fittings');
  const y = S.roofY + 0.18;
  const metal = toon(0x9ca6ac);
  const dark = toon(0x414d53);
  // AC service rails and refrigerant trunking.
  for (const x of [-3.9, -1.9]) {
    for (const dx of [-0.36, 0.36]) addBox(g, dark, 0.09, 0.065, 0.88, x + dx, y - 0.02, -5.3);
    for (const dx of [-0.35, 0.35]) addCyl(g, dark, 0.023, 0.023, 0.04, x + dx, y + 0.75, -5.3, { seg: 6, cast: false });
  }
  addBox(g, metal, 4.8, 0.08, 0.15, -1.1, y + 0.02, -6.12);
  addBox(g, metal, 0.15, 0.08, 1.05, 1.23, y + 0.02, -6.6);
  for (const x of [-3.9, -1.9]) addBox(g, metal, 0.1, 0.07, 0.48, x, y + 0.035, -5.86);
  // Solar frame/cell divisions are geometry, with sparse spacing to avoid shimmer.
  for (const x of [-0.77, 0.97]) addBox(g, metal, 0.025, 0.025, 1.05, x, y + 0.071, -3.6, { cast: false });
  for (const z of [-4.12, -3.08]) addBox(g, metal, 1.77, 0.025, 0.025, 0.1, y + 0.071, z, { cast: false });
  for (let i = 1; i < 5; i++) addBox(g, metal, 0.009, 0.005, 1.0, -0.75 + i * 0.34, y + 0.077, -3.6, { cast: false });
  addBox(g, metal, 1.7, 0.005, 0.009, 0.1, y + 0.077, -3.6, { cast: false });
  // Low roof seams and a drain next to the downpipe.
  const seam = toon(0x6b7580);
  for (const z of [-4.55, -2.5, -0.5]) addBox(g, seam, 6.9, 0.006, 0.018, -1.6, y + 0.002, z, { cast: false });
  addBox(g, dark, 0.28, 0.014, 0.28, S.x1 - 0.28, y + 0.002, S.z0 + 0.28, { cast: false });
  for (let i = 0; i < 4; i++) addBox(g, metal, 0.22, 0.006, 0.017, S.x1 - 0.28, y + 0.016, S.z0 + 0.2 + i * 0.055, { cast: false });
}
