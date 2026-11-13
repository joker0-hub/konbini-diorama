import * as THREE from 'three';
import { addBox, addCyl, addMesh, group, noOutline, planeGeo, sphereGeo } from '../core/geom';
import { decal, RAMP_SOFT, toon } from '../core/materials';
import { umbrellaFoldTex, umbrellaStandLabelTex } from '../core/textures';
import { L } from './layout';
import { mergeStaticMeshes } from './merge';

type Point = [number, number, number];
const TRAY_FLOOR = 0.091;
const TIP = 0.12;
const GUIDE = 0.87;
const SLOT_RADIUS = 0.062;
const SHAFT_RADIUS = 0.008;
const MAX_TILT = Math.atan((SLOT_RADIUS - SHAFT_RADIUS) / (GUIDE - TIP));

const DESIGNS = [
  { name: 'black', color: 0x313c53, grip: 0x332c27, height: 1.05, ribs: 8, turn: -1.05, lean: -0.028, depth: -0.026 },
  { name: 'blue', color: 0x527fab, grip: 0x304357, height: 0.86, ribs: 6, turn: 0.2, lean: 0.023, depth: 0.022 },
  { name: 'red', color: 0xbf5348, grip: 0x765046, height: 1.02, ribs: 8, turn: 0.58, lean: -0.013, depth: 0.038 },
  { name: 'white', color: 0xc0dde3, grip: 0xe4e6dc, height: 1.09, ribs: 8, turn: 1.12, lean: 0.031, depth: -0.013 },
] as const;
type UmbrellaDesign = typeof DESIGNS[number];

function tube(parent: THREE.Object3D, material: THREE.Material, points: Point[], radius: number, fine = false) {
  const path = new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point)));
  const mesh = addMesh(parent, new THREE.TubeGeometry(path, fine ? 16 : 24, radius, fine ? 5 : 8, false),
    material, 0, 0, 0, { cast: !fine });
  if (fine) noOutline(mesh);
}

function buildFold(pivot: THREE.Group, design: UmbrellaDesign, metal: THREE.Material) {
  const { name, color, height, ribs, grip, turn } = design;
  const compact = name === 'blue';
  const vinyl = name === 'white';
  const shaftTop = height - (compact ? 0.065 : 0.18);
  const fabricTop = Math.min(0.71, shaftTop - (compact ? 0.14 : 0.11));
  const profile = [
    [0.015, 0.043], [0.026, 0.115], [0.042, fabricTop * 0.34],
    [0.041, fabricTop * 0.52], [0.050, fabricTop * 0.66], [0.061, fabricTop * 0.92], [0.050, fabricTop],
  ];
  const model = group(pivot);
  model.rotation.y = turn;
  const fabric = (radius: number, y: number, angle: number) => {
    const pleat = Math.cos(angle * ribs);
    const r = radius * (0.78 + 0.22 * pleat);
    const a = angle + y * (compact ? -0.72 : 0.46);
    const scallop = THREE.MathUtils.smoothstep(y / fabricTop, 0.76, 1) * (1 - pleat) * 0.009;
    return new THREE.Vector3(Math.sin(a) * r, y - scallop, Math.cos(a) * r);
  };
  const segments = ribs * 8;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const [row, [radius, y]] of profile.entries()) {
    for (let i = 0; i <= segments; i++) {
      positions.push(...fabric(radius, y, i / segments * Math.PI * 2).toArray());
      uvs.push(i / segments, y / fabricTop);
      if (row < profile.length - 1 && i < segments) {
        const a = row * (segments + 1) + i;
        const b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const cloth = vinyl
    ? new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.40, depthWrite: false, shininess: 74, specular: 0xaecfe2 })
    : toon(color, { ramp: RAMP_SOFT, map: umbrellaFoldTex() });
  const fold = addMesh(model, geometry, cloth, 0, 0, 0, { name: 'folded-canopy', cast: !vinyl });
  if (vinyl) {
    fold.renderOrder = 8;
    noOutline(fold);
  }
  const seam = toon(new THREE.Color(color).lerp(new THREE.Color(0xe4e8dd), vinyl ? 0.38 : 0.15).getHex());
  const handle = toon(grip, { ramp: RAMP_SOFT });
  const strap = toon(new THREE.Color(color).multiplyScalar(0.62).getHex());
  const ferrule = toon(0x333b3e);

  addCyl(model, ferrule, 0.012, 0.008, 0.045, 0, 0, 0, { seg: 10 });
  addCyl(model, metal, SHAFT_RADIUS, SHAFT_RADIUS, shaftTop - 0.018, 0, 0.025, 0, { seg: 10 });
  addCyl(model, handle, 0.015, 0.013, 0.032, 0, fabricTop + 0.016, 0, { seg: 10 });
  for (let i = 0; i < ribs; i++) {
    const angle = i / ribs * Math.PI * 2;
    const ridge = profile.map(([r, y]) => fabric(r + 0.0008, y, angle));
    tube(model, seam, ridge.map(p => [p.x, p.y, p.z]), vinyl ? 0.0016 : 0.001, true);
    const tip = ridge[ridge.length - 1];
    noOutline(addCyl(model, seam, 0.0035, 0.0035, 0.018, tip.x, tip.y - 0.002, tip.z, { seg: 8, cast: false }));
  }
  const bandY = fabricTop * 0.52;
  addMesh(model, new THREE.CylinderGeometry(0.0425, 0.0425, 0.032, 28, 1, true), strap, 0, bandY, 0, { cast: false });
  addBox(model, strap, 0.034, 0.027, 0.007, 0.007, bandY - 0.0135, 0.042, { r: 0.004, cast: false });
  noOutline(addMesh(model, sphereGeo(0.0045, 8), metal, 0.014, bandY, 0.048, { cast: false }));

  addCyl(model, metal, 0.014, 0.014, 0.014, 0, shaftTop - 0.012, 0, { seg: 12 });
  if (compact) {
    addCyl(model, handle, 0.021, 0.022, 0.068, 0, shaftTop, 0, { seg: 14 });
    tube(model, handle, [[0, height - 0.003, 0.012], [0.03, height + 0.01, 0.034],
      [0.038, height - 0.023, 0.064], [0.018, height - 0.055, 0.060], [0, height - 0.003, 0.012]], 0.003, true);
  } else {
    const hook: Point[] = [[0, shaftTop, 0], [0, height - 0.072, 0], [0, height - 0.016, 0.033],
      [0, height, 0.078], [0, height - 0.031, 0.121], [0, height - 0.084, 0.136]];
    tube(model, handle, hook, 0.016);
    addMesh(model, sphereGeo(0.016, 12), handle, ...hook[hook.length - 1], { cast: false });
  }
  mergeStaticMeshes(pivot);
}

export interface UmbrellaStand {
  umbrellas: THREE.Group[];
  nudge: (umbrella: THREE.Object3D, direction: THREE.Vector3) => void;
  update: (time: number, dt: number) => void;
  setRain: (rain: number) => void;
}

export function buildUmbrellaStand(parent: THREE.Object3D, x: number, z: number): UmbrellaStand {
  const stand = group(parent, x, L.curb + 0.003, z, 'umbrella-stand');
  const frame = toon(0x46746d, { ramp: RAMP_SOFT });
  const metal = toon(0xa3b6bb, { ramp: RAMP_SOFT });
  const rubber = toon(0x263638);
  const tray = toon(0x33464b);
  const labelBacking = toon(0xe7e3cc);
  const halfWidth = 0.422, halfDepth = 0.226;

  const rack = group(stand, 0, 0, 0, 'stand-frame');
  for (const side of [-1, 1]) {
    const sx = side * (halfWidth - 0.026);
    tube(rack, frame, [[sx, 0.031, -0.18], [sx, GUIDE - 0.19, -0.18], [sx, GUIDE, -0.13],
      [sx, GUIDE, 0.13], [sx, GUIDE - 0.19, 0.18], [sx, 0.031, 0.18]], 0.018);
    for (const sz of [-0.18, 0.18]) addBox(rack, rubber, 0.058, 0.033, 0.071, sx, 0, sz, { r: 0.008 });
    addBox(rack, frame, 0.026, 0.25, 0.30, sx, 0.118, 0, { r: 0.012 });
    for (const sy of [0.16, 0.32]) {
      noOutline(addCyl(rack, metal, 0.007, 0.007, 0.008, sx + side * 0.014, sy, 0.092, { rz: Math.PI / 2, seg: 8, cast: false }));
    }
  }
  for (const sz of [-0.104, 0.104]) {
    addBox(rack, metal, 0.79, 0.025, 0.025, 0, GUIDE - 0.0125, sz, { r: 0.006 });
  }
  addBox(rack, frame, 0.79, 0.046, 0.024, 0, 0.23, -0.17, { r: 0.005 });
  addBox(rack, frame, 0.79, 0.109, 0.024, 0, GUIDE - 0.114, 0.159, { r: 0.01 });
  addBox(rack, labelBacking, 0.32, 0.087, 0.008, 0, GUIDE - 0.103, 0.172, { r: 0.003, cast: false });
  const label = addMesh(rack, planeGeo(0.256, 0.080), decal(umbrellaStandLabelTex()), 0, GUIDE - 0.0595, 0.177, { cast: false });
  noOutline(label);

  const pan = group(stand, 0, 0, 0, 'stand-drip-tray');
  addBox(pan, tray, 0.79, 0.021, 0.421, 0, TRAY_FLOOR - 0.021, 0, { r: 0.008 });
  for (const sz of [-halfDepth + 0.025, halfDepth - 0.025]) {
    addBox(pan, frame, 0.79, 0.047, 0.017, 0, TRAY_FLOOR - 0.01, sz, { r: 0.006 });
  }
  for (const sx of [-0.387, 0.387]) addBox(pan, frame, 0.018, 0.047, 0.39, sx, TRAY_FLOOR - 0.01, 0, { r: 0.006 });
  for (const sx of [-0.34, -0.17, 0, 0.17, 0.34]) {
    noOutline(addBox(pan, metal, 0.008, 0.007, 0.33, sx, TRAY_FLOOR, 0, { r: 0.002, cast: false }));
  }
  addBox(pan, metal, 0.142, 0.014, 0.031, 0, TRAY_FLOOR, 0.215, { r: 0.006 });

  const umbrellaGroup = group(stand, 0, 0, 0, 'stand-umbrellas');
  const water = group(stand, 0, 0, 0, 'stand-drainage');
  water.visible = false;
  const dropGeo = sphereGeo(0.008, 10);
  const dropMat = new THREE.MeshPhongMaterial({
    color: 0xb9dcf1, emissive: 0x547b94, emissiveIntensity: 0.45,
    shininess: 65, transparent: true, opacity: 0.75, depthWrite: false,
  });
  const ringGeo = new THREE.RingGeometry(0.74, 1, 22).rotateX(-Math.PI / 2);
  const guideGeo = new THREE.TorusGeometry(SLOT_RADIUS + 0.008, 0.008, 8, 28).rotateX(-Math.PI / 2);
  const socketGeo = new THREE.TorusGeometry(0.014, 0.006, 8, 18).rotateX(-Math.PI / 2);

  const slots = DESIGNS.map((design, i) => {
    const sx = (i - 1.5) * 0.181;
    addMesh(rack, guideGeo, rubber, sx, GUIDE, 0);
    for (const sz of [-0.09, 0.09]) addBox(rack, frame, 0.043, 0.025, 0.041, sx, GUIDE - 0.0125, sz, { r: 0.004 });
    addCyl(pan, rubber, 0.026, 0.027, TIP - TRAY_FLOOR, sx, TRAY_FLOOR, 0, { seg: 14 });
    addMesh(pan, socketGeo, rubber, sx, TIP, 0, { cast: false });
    const pivot = group(umbrellaGroup, sx, TIP, 0, 'umbrella-' + design.name);
    buildFold(pivot, design, metal);
    const rest = new THREE.Vector2(design.depth, design.lean);
    pivot.rotation.set(rest.x, 0, rest.y);

    const drop = addMesh(water, dropGeo, dropMat, sx, 0, 0, { cast: false, receive: false });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xbdddef, transparent: true, opacity: 0, depthWrite: false,
    });
    const ring = addMesh(water, ringGeo, ringMat, sx, TRAY_FLOOR + 0.0015, 0, { cast: false, receive: false });
    noOutline(drop);
    noOutline(ring);
    drop.visible = ring.visible = false;
    return { pivot, rest, tilt: rest.clone(), velocity: new THREE.Vector2(), drop, ring, ringMat,
      fallSpeed: 0, splashAge: 1, nextDrop: 0.18 + 0.24 * i, period: 1.22 + 0.31 * i };
  });
  mergeStaticMeshes(rack);
  mergeStaticMeshes(pan);

  let rain = 0;
  let accumulator = 0;
  const step = 1 / 120;
  const limit = new THREE.Vector2();
  const push = new THREE.Vector3();
  const inverse = new THREE.Quaternion();
  const origin = new THREE.Vector3();

  return {
    umbrellas: slots.map(({ pivot }) => pivot),
    nudge(umbrella, direction) {
      const slot = slots.find(({ pivot }) => pivot === umbrella);
      if (!slot) return;
      stand.getWorldQuaternion(inverse).invert();
      push.copy(direction).applyQuaternion(inverse).setY(0).normalize();
      slot.velocity.addScaledVector(limit.set(push.z, -push.x), 1.35).clampLength(0, 1.55);
      slot.nextDrop = Math.min(slot.nextDrop, 0.06);
    },
    setRain(value) {
      rain = value;
      water.visible = value > 0.02;
    },
    update(t, dt) {
      accumulator += dt;
      for (; accumulator >= step; accumulator -= step) {
        const time = t - accumulator + step;
        for (const [i, slot] of slots.entries()) {
          // The ferrule pivots in its cup. The rubber guide stops the shaft at the rim.
          const gust = rain * (Math.sin(time * 2.4 + i * 0.8) + 0.4 * Math.sin(time * 6.4 - i));
          slot.velocity.x += ((slot.rest.x - slot.tilt.x) * 59 - slot.velocity.x * 6.2 + gust * 0.6) * step;
          slot.velocity.y += ((slot.rest.y - slot.tilt.y) * 59 - slot.velocity.y * 6.2 - gust * 0.9) * step;
          slot.tilt.addScaledVector(slot.velocity, step);
          if (slot.tilt.lengthSq() > MAX_TILT * MAX_TILT) {
            limit.copy(slot.tilt).normalize();
            slot.tilt.copy(limit).multiplyScalar(MAX_TILT);
            slot.velocity.addScaledVector(limit, -1.28 * Math.max(0, slot.velocity.dot(limit)));
          }
          slot.pivot.rotation.set(slot.tilt.x, 0, slot.tilt.y);

          if (!water.visible) {
            slot.drop.visible = slot.ring.visible = false;
            continue;
          }
          slot.nextDrop -= step * rain;
          if (slot.nextDrop <= 0 && !slot.drop.visible) {
            origin.set(0.015 * (i % 2 ? 1 : -1), 0.285 + i * 0.034, 0.046);
            slot.drop.position.copy(origin).applyQuaternion(slot.pivot.quaternion).add(slot.pivot.position);
            slot.drop.visible = true;
            slot.fallSpeed = 0;
            slot.nextDrop += slot.period;
          }
          if (slot.drop.visible) {
            slot.fallSpeed += 9.81 * step;
            slot.drop.position.y -= slot.fallSpeed * step;
            slot.drop.scale.y = 1 + slot.fallSpeed * 0.16;
            if (slot.drop.position.y <= TRAY_FLOOR + 0.008) {
              slot.drop.visible = false;
              slot.ring.position.x = slot.drop.position.x;
              slot.ring.position.z = slot.drop.position.z;
              slot.splashAge = 0;
            }
          }
          slot.splashAge += step;
          slot.ring.visible = slot.splashAge < 0.32;
          if (slot.ring.visible) {
            slot.ring.scale.setScalar(0.008 + 0.14 * slot.splashAge);
            slot.ringMat.opacity = (1 - slot.splashAge / 0.32) * rain * 0.67;
          }
        }
      }
      dropMat.opacity = 0.75 * rain;
    },
  };
}
