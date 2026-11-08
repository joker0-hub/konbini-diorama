/** Printed advertising with real backing panels, clips and pavement-safe feet. */
import * as THREE from 'three';
import { addBox, addCyl, addMesh, group, noOutline, planeGeo, strut } from '../core/geom';
import { decal, toon } from '../core/materials';
import * as TX from '../core/textures';
import { L } from './layout';

export function buildPosterFrame(parent: THREE.Object3D, options: {
  x: number; y: number; z: number; w: number; h: number; ry?: number;
  kind: 'coffee' | 'fresh'; name?: string;
}): THREE.Group {
  const { x, y, z, w, h, ry = 0, kind } = options;
  const g = group(parent, x, y, z, options.name ?? 'framed-advertisement');
  g.rotation.y = ry;
  const metal = toon(0x9ca8aa), dark = toon(0x414d53), paper = toon(0xe8e2d4);
  addBox(g, dark, w + 0.065, h + 0.065, 0.044, 0, -h / 2 - 0.0325, 0);
  addBox(g, paper, w + 0.022, h + 0.022, 0.015, 0, -h / 2 - 0.011, 0.026, { cast: false });
  const print = addMesh(g, planeGeo(w, h), decal(TX.promoPosterTex(kind)), 0, 0, 0.036, { cast: false });
  print.name = 'advertisement-print';
  print.renderOrder = 6;
  noOutline(print);
  for (const sx of [-1, 1]) addBox(g, metal, 0.021, h + 0.058, 0.024, sx * (w / 2 + 0.019), -h / 2 - 0.029, 0.035, { cast: false });
  for (const sy of [-1, 1]) {
    addBox(g, metal, w + 0.062, 0.021, 0.024, 0, sy * (h / 2 + 0.019) - 0.0105, 0.035, { cast: false });
    for (const sx of [-1, 1]) {
      addCyl(g, dark, 0.007, 0.007, 0.006, sx * (w / 2 + 0.018), sy * (h / 2 + 0.018) - 0.003, 0.052, { rx: Math.PI / 2, seg: 6, cast: false });
    }
  }
  // Two spring clips visibly retain the paper in the frame.
  for (const sx of [-1, 1]) addBox(g, dark, 0.035, 0.04, 0.012, sx * w * 0.27, h / 2 - 0.025, 0.047, { cast: false });
  return g;
}

export function buildStoreAdvertising(parent: THREE.Object3D): void {
  const S = L.store;
  const g = group(parent, 0, 0, 0, 'store-advertising');
  for (const [x, kind] of [[-4.45, 'coffee'], [-2.55, 'fresh']] as const) {
    buildPosterFrame(g, { x, y: 1.5, z: S.z1 + 0.072, w: 0.57, h: 0.83, kind, name: 'store-window-advertisement' });
  }

  // The A-board occupies the gap left of the umbrella stand, clear of the door.
  const board = group(g, -1.91, L.curb, S.z1 + 1.15, 'store-pavement-advertisement');
  const frame = toon(0x414d53), rubber = toon(0x303e45), metal = toon(0x9ca8aa);
  const height = 1.11, halfDepth = 0.27;
  for (const side of [-1, 1]) {
    const face = group(board, 0, 0.59, side * 0.145, 'advertisement-board-face');
    // Both panels lean onto the top hinge, opening into a stable A shape.
    face.rotation.set(side * -0.18, side < 0 ? Math.PI : 0, 0);
    buildPosterFrame(face, { x: 0, y: 0, z: 0, w: 0.53, h: 0.76, kind: side > 0 ? 'coffee' : 'fresh' });
    for (const x of [-0.31, 0.31]) {
      strut(board, frame, [x, 0.035, side * halfDepth], [x, height, 0], 0.035);
      addBox(board, rubber, 0.075, 0.035, 0.1, x, 0, side * halfDepth, { cast: false });
    }
    addBox(board, frame, 0.64, 0.035, 0.035, 0, 0.13, side * 0.245, { cast: false });
  }
  for (const x of [-0.31, 0.31]) {
    addCyl(board, metal, 0.025, 0.025, 0.065, x, height - 0.0325, 0, { rz: Math.PI / 2, seg: 10, cast: false });
    strut(board, metal, [x, 0.36, -0.18], [x, 0.36, 0.18], 0.017).castShadow = false;
  }
  addBox(board, frame, 0.64, 0.035, 0.055, 0, height - 0.02, 0);
}
