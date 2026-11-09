/** Shop lightboxes and a built-up metal entrance canopy. Fine hardware batches with the shell. */
import * as THREE from 'three';
import { P } from '../core/palette';
import { addBox, addCyl, addMesh, group, noOutline, planeGeo, strut } from '../core/geom';
import { additiveClone, decal, glow, glowSprite, radialGlowTex, toon } from '../core/materials';
import * as TX from '../core/textures';
import { CANOPY, L } from './layout';
import { buildStoreAdvertising } from './advertising';

const S = L.store;

/** Bolt heads face local +Z; the washer, head and slot remain part of the static batch. */
function bolt(parent: THREE.Object3D, x: number, y: number, z: number, radius = 0.009): void {
  const silver = toon(0x9ca8aa), dark = toon(0x414d53);
  addCyl(parent, silver, radius * 1.45, radius * 1.45, 0.003, x, y - 0.0015, z, { rx: Math.PI / 2, seg: 8, cast: false });
  addCyl(parent, silver, radius, radius, 0.008, x, y - 0.004, z + 0.005, { rx: Math.PI / 2, seg: 6, cast: false });
  addBox(parent, dark, radius * 1.1, 0.002, 0.001, x, y - 0.001, z + 0.01, { cast: false });
}

function fascia(parent: THREE.Object3D, length: number, map: THREE.Texture, name: string): THREE.MeshBasicMaterial {
  const g = group(parent, 0, 0, 0, name);
  const h = S.fasciaTop - S.glassTop;
  const dark = toon(0x414d53), metal = toon(0x9ca8aa), cream = toon(P.storeCream);
  addBox(g, dark, length + 0.08, h + 0.12, 0.38, 0, -h / 2 - 0.06, -0.19);
  addBox(g, cream, length - 0.012, h - 0.01, 0.018, 0, -h / 2 + 0.005, 0.003, { cast: false });
  // Printed diffuser stays below the bloom threshold; the narrow edge lights
  // provide the glow without bleaching the lettering at night.
  const print = decal(map, 1, 0xd1d1d1).clone();
  const face = addMesh(g, planeGeo(length - 0.065, h - 0.065), print, 0, 0, 0.016, { cast: false });
  face.name = `${name}-print`;
  face.renderOrder = 9;
  noOutline(face);
  for (const sy of [-1, 1]) {
    addBox(g, metal, length + 0.09, 0.034, 0.055, 0, sy * (h / 2 + 0.013) - 0.017, 0.011, { cast: false });
    addBox(g, dark, length + 0.035, 0.009, 0.011, 0, sy * (h / 2 - 0.015) - 0.0045, 0.033, { cast: false });
  }
  for (const side of [-1, 1]) {
    addBox(g, metal, 0.034, h + 0.09, 0.055, side * (length / 2 + 0.013), -h / 2 - 0.045, 0.011, { cast: false });
    addBox(g, metal, 0.04, h + 0.04, 0.35, side * (length / 2 + 0.015), -h / 2 - 0.02, -0.185, { cast: false });
    for (const y of [-h / 2 + 0.075, h / 2 - 0.075]) bolt(g, side * (length / 2 + 0.013), y, 0.043);
  }
  // Narrow expansion joints land in the quiet margins, leaving the lettering intact.
  for (const x of [-length / 2 + 0.085, length / 2 - 0.085]) {
    addBox(g, dark, 0.008, h - 0.025, 0.004, x, -h / 2 + 0.0125, 0.021, { cast: false });
  }
  // The folded top flashing and underside service strip give the lightbox depth.
  addBox(g, metal, length + 0.1, 0.022, 0.43, 0, h / 2 + 0.04, -0.16);
  addBox(g, cream, length - 0.09, 0.016, 0.15, 0, -h / 2 - 0.051, -0.04, { cast: false });
  addBox(g, glow(0xfff0d2, 0.8), length - 0.18, 0.008, 0.025, 0, -h / 2 - 0.055, 0.024, { cast: false });
  for (let x = -length / 2 + 0.45; x < length / 2 - 0.25; x += 0.8) {
    addBox(g, dark, 0.085, 0.005, 0.036, x, -h / 2 - 0.063, -0.15, { cast: false });
  }
  const hatch = group(g, length / 2 - 0.27, -h / 2 - 0.057, -0.18, 'sign-service-hatch');
  addBox(hatch, metal, 0.29, 0.007, 0.2, 0, 0, 0, { cast: false });
  addBox(hatch, dark, 0.06, 0.004, 0.016, 0, -0.004, 0.03, { cast: false });
  return print;
}

export function buildStoreSignage(parent: THREE.Object3D) {
  const h = S.fasciaTop - S.glassTop;
  const halos: THREE.MeshBasicMaterial[] = [];
  const midX = (S.x0 + S.x1) / 2, midZ = (S.z0 + S.z1) / 2;
  const front = group(parent, midX, S.glassTop + h / 2, S.z1 + 0.29, 'store-front-sign');
  const frontPrint = fascia(front, S.x1 - S.x0 + 0.32, TX.storeSignTex(), 'front-lightbox');
  const side = group(parent, S.x1 + 0.29, S.glassTop + h / 2, midZ, 'store-side-sign');
  side.rotation.y = Math.PI / 2;
  const sidePrint = fascia(side, S.z1 - S.z0, TX.storeSignSmallTex(), 'side-lightbox');
  for (const [root, w, opacity] of [[front, S.x1 - S.x0 + 1.6, 0.3], [side, S.z1 - S.z0 + 1.2, 0.26]] as const) {
    const halo = addMesh(root, planeGeo(w, h + 0.9), additiveClone(glowSprite(w / (h + 0.9)), 0xfff2d4, opacity), 0, 0, -0.08, { cast: false });
    halo.renderOrder = 8;
    noOutline(halo);
    halos.push(halo.material as THREE.MeshBasicMaterial);
  }

  const vertical = group(parent, S.x1 + 0.58, 2.6, S.z1 + 0.58, 'vertical-sign');
  const metal = toon(0x9ca8aa), dark = toon(0x414d53), cream = toon(P.storeCream);
  addBox(vertical, cream, 0.5, 2.5, 0.5, 0, -1.25, 0, { r: 0.025 });
  const verticalPrint = decal(TX.verticalSignTex(), 1, 0xd1d1d1).clone();
  for (let i = 0; i < 4; i++) {
    const face = group(vertical, 0, 0, 0, 'vertical-sign-face');
    face.rotation.y = i * Math.PI / 2;
    const print = addMesh(face, planeGeo(0.44, 2.4), verticalPrint, 0, 0, 0.26, { cast: false });
    print.renderOrder = 9;
    noOutline(print);
    for (const x of [-0.244, 0.244]) {
      addBox(face, metal, 0.018, 2.48, 0.024, x, -1.24, 0.257, { cast: false });
      for (const y of [-1.15, 1.15]) bolt(face, x, y, 0.272, 0.007);
    }
    for (const y of [-1.22, 1.215]) addBox(face, dark, 0.47, 0.008, 0.009, 0, y, 0.269, { cast: false });
    // Bottom edge ventilation slots and a small removable cover.
    for (const x of [-0.12, -0.06, 0, 0.06, 0.12]) addBox(face, dark, 0.026, 0.008, 0.006, x, -1.265, 0.268, { cast: false });
  }
  for (const y of [-1.3, 1.25]) {
    addBox(vertical, dark, 0.54, 0.05, 0.54, 0, y, 0, { cast: false });
    addBox(vertical, metal, 0.55, 0.012, 0.55, 0, y + 0.025, 0, { cast: false });
  }
  for (const by of [-0.75, 0.65]) {
    const mount = group(parent, S.x1 + 0.03, 2.6 + by, S.z1 + 0.03, 'vertical-sign-wall-mount');
    mount.rotation.y = Math.PI / 4;
    addBox(mount, dark, 0.16, 0.23, 0.035, 0, -0.115, 0, { cast: false });
    for (const y of [-0.075, 0.075]) bolt(mount, 0, y, 0.025);
    const bracket = strut(parent, dark, [S.x1 + 0.03, 2.6 + by, S.z1 + 0.03], [S.x1 + 0.34, 2.6 + by, S.z1 + 0.34], 0.045, true);
    bracket.name = by > 0 ? 'sign-bracket-top' : 'sign-bracket-bottom';
    strut(parent, metal, [S.x1 + 0.03, 2.6 + by - 0.13, S.z1 + 0.03], [S.x1 + 0.29, 2.6 + by, S.z1 + 0.29], 0.018, true).castShadow = false;
  }
  const halo = addMesh(vertical, planeGeo(1.8, 3), additiveClone(radialGlowTex(), 0xffe9c4, 0.22), 0.08, 0, 0.32, { cast: false });
  halo.renderOrder = 8;
  noOutline(halo);
  halos.push(halo.material as THREE.MeshBasicMaterial);
  buildStoreAdvertising(parent);
  return { halos, prints: [frontPrint, sidePrint, verticalPrint] };
}

export function buildEntranceCanopy(parent: THREE.Object3D): THREE.SpotLight {
  const { x, w, d, z, top } = CANOPY;
  const front = z + d / 2, back = z - d / 2;
  const g = group(parent, 0, 0, 0, 'canopy');
  const frame = toon(0x414d53), edge = toon(0x9ca8aa), topMat = toon(0xb2ad99), under = toon(0x6e756c);
  // The flat top retains the existing snow surface and sheltered entrance bounds.
  for (let i = 0; i < 4; i++) {
    const panelW = w / 4;
    addBox(g, topMat, panelW - 0.012, 0.035, d - 0.07, x - w / 2 + panelW * (i + 0.5), top - 0.035, z, { name: 'canopy-roof-panel' });
  }
  addBox(g, under, w - 0.07, 0.02, d - 0.08, x, top - 0.059, z, { cast: false });
  for (let i = 0; i <= 4; i++) {
    const sx = x - w / 2 + i * w / 4;
    addBox(g, edge, 0.018, 0.012, d - 0.04, sx, top - 0.003, z, { cast: false });
    addBox(g, frame, 0.035, 0.055, d - 0.07, sx, top - 0.11, z, { cast: false });
  }
  for (const rz of [front - 0.018, back + 0.015]) addBox(g, frame, w + 0.035, 0.075, 0.055, x, top - 0.12, rz);
  for (const sx of [x - w / 2, x + w / 2]) {
    addBox(g, edge, 0.033, 0.11, d + 0.035, sx, top - 0.1, z);
    for (const rz of [back + 0.08, front - 0.08]) {
      addCyl(g, frame, 0.009, 0.009, 0.004, sx, top + 0.007, rz, { seg: 6, cast: false });
    }
  }
  // Open U-shaped gutter: the dark channel is recessed between raised lips.
  const gutter = group(g, x, top - 0.106, front + 0.018, 'canopy-gutter');
  addBox(gutter, edge, w + 0.045, 0.018, 0.105, 0, 0, 0);
  for (const side of [-1, 1]) addBox(gutter, edge, w + 0.045, 0.06, 0.012, 0, 0.018, side * 0.047, { cast: false });
  addBox(gutter, frame, w - 0.025, 0.004, 0.075, 0, 0.019, 0, { cast: false });
  for (const sx of [-w / 2 - 0.016, w / 2 + 0.016]) addBox(gutter, edge, 0.012, 0.06, 0.105, sx, 0.018, 0, { cast: false });
  const drainX = x + w / 2 - 0.095;
  addCyl(g, edge, 0.027, 0.027, 0.115, drainX, top - 0.205, front + 0.014, { seg: 10, name: 'canopy-rain-outlet' });
  addCyl(g, frame, 0.02, 0.02, 0.004, drainX, top - 0.206, front + 0.014, { seg: 10, cast: false });

  // Recessed LED diffuser, housing and end plugs; no additional shadow-casting light.
  addBox(g, frame, w - 0.24, 0.035, 0.11, x, top - 0.105, front - 0.15, { cast: false });
  const led = addBox(g, glow(0xffead1, 1.34), w - 0.32, 0.011, 0.075, x, top - 0.111, front - 0.15, { cast: false, name: 'canopy-led-diffuser' });
  noOutline(led);
  const downlight = new THREE.SpotLight(0xffdfb2, 15.4, 5.8, 0.91, 0.78);
  downlight.name = 'canopy-downlight';
  downlight.position.copy(led.position).add(new THREE.Vector3(0, -0.02, 0));
  downlight.target.position.set(x, L.curb, front - 0.1);
  g.add(downlight, downlight.target);
  for (const sx of [x - (w - 0.27) / 2, x + (w - 0.27) / 2]) addBox(g, edge, 0.035, 0.03, 0.12, sx, top - 0.103, front - 0.15, { cast: false });
  // Articulated tie rods terminate in bolted mounting plates at both ends.
  for (const sx of [x - w / 2 + 0.12, x + w / 2 - 0.12]) {
    const a = new THREE.Vector3(sx, top + 0.009, front - 0.075);
    const b = new THREE.Vector3(sx, S.glassTop - 0.06, S.z1 + 0.32);
    strut(g, frame, a.toArray() as [number,number,number], b.toArray() as [number,number,number], 0.023, true);
    const coupling = a.clone().lerp(b, 0.34), end = a.clone().lerp(b, 0.49);
    strut(g, edge, coupling.toArray() as [number,number,number], end.toArray() as [number,number,number], 0.043, true).castShadow = false;
    addBox(g, edge, 0.115, 0.14, 0.022, sx, b.y - 0.105, b.z - 0.013, { cast: false });
    for (const by of [b.y - 0.075, b.y + 0.005]) bolt(g, sx, by, b.z + 0.003);
    addBox(g, frame, 0.095, 0.018, 0.105, sx, top + 0.007, a.z, { cast: false });
    addCyl(g, edge, 0.02, 0.02, 0.055, sx, a.y - 0.0275, a.z, { rz: Math.PI / 2, seg: 10, cast: false });
  }
  return downlight;
}
