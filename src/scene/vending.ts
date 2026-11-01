import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { addBox, addCyl, addMesh, group, noOutline, planeGeo, cylGeo, DETAIL_LAYER } from '../core/geom';
import { toon, glow, decal, RAMP_SOFT } from '../core/materials';
import { VENDING_DRINKS, type Drink, type VendingVariant } from '../core/vending-products';
import { mergeStaticMeshes } from './merge';
import { BottlePhysics } from '../core/bottle-physics';

export interface BottleState {
  id: number;
  drinkId: string;
  state: 'dispensing' | 'tray' | 'held' | 'ground';
  position: [number, number, number];
  velocity: [number, number, number];
  quaternion: [number, number, number, number];
  remaining: number | null;
  sleeping: boolean;
}

export interface VendingHandles {
  id: string;
  variant: VendingVariant;
  root: THREE.Group;
  pickRoot: THREE.Object3D;
  products: readonly Drink[];
  purchase: (drinkId: string) => boolean;
  isBusy: () => boolean;
  getBottles: () => readonly { id: number; drinkId: string }[];
  getDraggableBottles: () => readonly { id: number; mesh: THREE.Group }[];
  getBottleState: (id: number) => BottleState | undefined;
  grabBottle: (id: number) => boolean;
  moveBottle: (id: number, worldPosition: THREE.Vector3) => void;
  releaseBottle: (id: number, worldVelocity: THREE.Vector3, recycle?: boolean) => void;
  update: (dt: number) => void;
}

const textures = new Map<string, THREE.CanvasTexture>();
const bottleLabels = new Map<string, THREE.MeshBasicMaterial>();
const FONT = '"Yu Gothic", "Microsoft YaHei", sans-serif';

function texture(key: string, width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const old = textures.get(key);
  if (old) return old;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  textures.set(key, tex);
  return tex;
}

function label(parent: THREE.Object3D, key: string, width: number, height: number, x: number, y: number, z: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.Mesh {
  const map = texture(key, 1024, Math.max(96, Math.round(1024 * height / width)), paint);
  const m = addMesh(parent, planeGeo(width, height), decal(map), x, y, z);
  m.castShadow = false;
  m.receiveShadow = false;
  noOutline(m);
  return m;
}

// A bottle is centred on its long axis, so it can tip naturally into the tray.
const bottleBody = new THREE.LatheGeometry([
  new THREE.Vector2(0, -0.091),
  new THREE.Vector2(0.027, -0.091),
  new THREE.Vector2(0.033, -0.084),
  new THREE.Vector2(0.034, -0.073),
  new THREE.Vector2(0.034, 0.029),
  new THREE.Vector2(0.032, 0.045),
  new THREE.Vector2(0.023, 0.06),
  new THREE.Vector2(0.016, 0.067),
  new THREE.Vector2(0.016, 0.08),
  new THREE.Vector2(0, 0.08),
], 16);

function bottleLabel(drink: Drink): THREE.CanvasTexture {
  return texture('bottle-' + drink.id, 512, 256, (c) => {
    c.fillStyle = drink.color;
    c.fillRect(0, 0, 512, 256);
    // Broad coloured packaging stays readable at the miniature's normal viewing distance.
    c.fillStyle = '#f4f0df';
    c.fillRect(0, 25, 512, 10);
    c.fillRect(0, 221, 512, 10);
    for (const x of [128, 384]) {
      c.fillStyle = '#f4f0df';
      c.beginPath(); c.arc(x, 113, 59, 0, Math.PI * 2); c.fill();
      c.fillStyle = drink.color;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${drink.label.length > 2 ? 28 : 48}px ${FONT}`;
      c.fillText(drink.label, x, 112);
      c.fillStyle = '#fff7e5';
      c.font = `bold 13px ${FONT}`;
      c.fillText('HOSHINO  ·  350 ml', x, 190);
    }
    // A baked soft roll-off keeps the unlit label looking cylindrical, even in the
    // machine's bright showcase where lit white packaging otherwise clips to white.
    const shading = c.createLinearGradient(0, 0, 512, 0);
    for (const [stop, alpha] of [[0, 0.18], [0.25, 0], [0.5, 0.18], [0.75, 0], [1, 0.18]]) {
      shading.addColorStop(stop, `rgba(10, 20, 25, ${alpha})`);
    }
    c.fillStyle = shading; c.fillRect(0, 0, 512, 256);
  });
}

function bottleLabelMaterial(drink: Drink): THREE.MeshBasicMaterial {
  let material = bottleLabels.get(drink.id);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ map: bottleLabel(drink), color: 0xe8e8e8, toneMapped: false });
    bottleLabels.set(drink.id, material);
  }
  return material;
}

function makeBottle(drink: Drink, dynamic: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bottle-' + drink.id;
  const bodyColor = new THREE.Color(drink.color).multiplyScalar(0.72);
  addMesh(g, bottleBody, toon(bodyColor.getHex(), { ramp: RAMP_SOFT }), 0, 0, 0, { cast: false });
  addMesh(g, cylGeo(0.0345, 0.0345, 0.086, 16), bottleLabelMaterial(drink), 0, -0.015, 0, { cast: false });
  const cap = new THREE.Color(drink.capColor ?? '#eff1e9').getHex();
  addCyl(g, toon(cap, { ramp: RAMP_SOFT }), 0.0185, 0.0185, 0.021, 0, 0.073, 0, { seg: 16, cast: false });
  addCyl(g, toon(0xe2e6e1), 0.02, 0.02, 0.006, 0, 0.066, 0, { seg: 16, cast: false });
  addCyl(g, toon(0xf0eee4), 0.032, 0.032, 0.006, 0, -0.079, 0, { seg: 16, cast: false });
  // The actual outline pass includes layers 0 AND 1. Layer 2 preserves the bottle's
  // coloured detail without thick black rings swallowing these very small labels.
  g.traverse((o) => o.layers.set(DETAIL_LAYER));
  if (dynamic) g.traverse((o) => { o.userData.noMerge = true; });
  return g;
}

interface DeliveredBottle {
  id: number;
  drinkId: string;
  mesh: THREE.Group;
  body: CANNON.Body;
  state: BottleState['state'];
  remaining: number | null;
  expiresAt: number | null;
}

/** Cabinet dimensions and position match the original machines; only their contents change. */
export function buildVendingMachine(
  parent: THREE.Object3D, variant: VendingVariant,
  x: number, y: number, z: number, ry: number,
  sharedPhysics?: BottlePhysics,
): VendingHandles {
  const root = group(parent, x, y, z, 'vending-' + variant);
  root.rotation.y = ry;
  const cabinet = group(root, 0, 0, 0, 'vending-cabinet');
  const accentColor = variant === 'blue' ? 0x315eaa : 0xb94e43;
  const accent = toon(accentColor, { ramp: RAMP_SOFT });
  const enamel = toon(variant === 'blue' ? 0xe5e9e7 : 0xece5dc, { ramp: RAMP_SOFT });
  const metal = toon(0xaab5bc, { ramp: RAMP_SOFT });
  const brightMetal = toon(0xd9dfdd, { ramp: RAMP_SOFT });
  const charcoal = toon(0x26333d);
  const inset = toon(0x141e28);

  // The rear cabinet ends behind both recesses: no solid box fills the collection bay.
  addBox(cabinet, enamel, 0.98, 1.85, 0.49, 0, 0.055, -0.125, { r: 0.035 });
  for (const sx of [-1, 1]) {
    addBox(cabinet, enamel, 0.065, 1.79, 0.25, sx * 0.457, 0.07, 0.245, { r: 0.012 });
    addBox(cabinet, accent, 0.026, 1.74, 0.027, sx * 0.423, 0.09, 0.388, { r: 0.006 });
    addBox(cabinet, charcoal, 0.13, 0.065, 0.48, sx * 0.34, 0, -0.01, { r: 0.009 });
  }
  addBox(cabinet, accent, 0.85, 0.12, 0.27, 0, 0.057, 0.25, { r: 0.012 });
  addBox(cabinet, enamel, 0.85, 0.13, 0.27, 0, 1.73, 0.25, { r: 0.012 });
  addBox(cabinet, charcoal, 1.02, 0.052, 0.78, 0, 1.85, 0, { r: 0.016 });
  addBox(cabinet, enamel, 1.02, 0.086, 0.78, 0, 1.902, 0, { r: 0.018 });
  addBox(cabinet, glow(0xffedc9, 1.1), 0.9, 0.014, 0.035, 0, 1.884, 0.391, { cast: false });

  label(cabinet, 'vending-header-' + variant, 0.81, 0.123, 0, 1.792, 0.392, (c) => {
    c.fillStyle = variant === 'blue' ? '#315eaa' : '#b94e43'; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    c.fillStyle = '#f8f3df'; c.textBaseline = 'middle';
    c.font = `700 83px ${FONT}`; c.fillText('DRINK', 37, c.canvas.height / 2);
    c.font = `600 28px ${FONT}`; c.textAlign = 'right'; c.fillText('つめた〜い', 974, c.canvas.height / 2 - 14);
    c.font = `500 15px ${FONT}`; c.fillText('HOSHINO SELECT', 974, c.canvas.height / 2 + 25);
  });

  // Deep illuminated showcase with independent bottles and selection buttons.
  // A softly lit backing preserves label contrast under the existing nearby street lights.
  addBox(cabinet, new THREE.MeshBasicMaterial({ color: 0xbac6bf }), 0.806, 0.94, 0.025, 0, 0.762, 0.17, { cast: false });
  for (const sx of [-1, 1]) {
    addBox(cabinet, brightMetal, 0.021, 0.96, 0.22, sx * 0.403, 0.75, 0.283, { cast: false });
    addBox(cabinet, glow(0xfff4dc, 0.72), 0.009, 0.91, 0.011, sx * 0.385, 0.78, 0.29, { cast: false });
  }
  for (let row = 0; row < 3; row++) {
    const shelfY = 0.784 + row * 0.302;
    addBox(cabinet, brightMetal, 0.8, 0.025, 0.19, 0, shelfY, 0.277, { cast: false });
    addBox(cabinet, enamel, 0.8, 0.054, 0.025, 0, shelfY - 0.018, 0.38, { cast: false, r: 0.004 });
    const products = Array.from({ length: 5 }, (_, col) => VENDING_DRINKS[(col + row * 2) % VENDING_DRINKS.length]);
    for (let col = 0; col < 5; col++) {
      const px = -0.317 + col * 0.1585;
      const bottle = makeBottle(products[col], false);
      bottle.position.set(px, shelfY + 0.12, 0.29);
      cabinet.add(bottle);
      addBox(cabinet, charcoal, 0.095, 0.026, 0.026, px, shelfY - 0.047, 0.387, { r: 0.01, cast: false });
      const lamp = addBox(cabinet, glow(0x8abda6, 0.86), 0.066, 0.009, 0.028, px, shelfY - 0.039, 0.392, { r: 0.004, cast: false });
      noOutline(lamp);
    }
    label(cabinet, 'vending-prices-' + row, 0.78, 0.033, 0, shelfY + 0.006, 0.397, (c) => {
      c.fillStyle = '#f1eddf'; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `600 45px ${FONT}`; c.fillStyle = '#394e60';
      for (let i = 0; i < 5; i++) c.fillText('¥' + products[i].price, (i + 0.5) * 204.8, c.canvas.height * 0.52);
    });
  }
  const glass = new THREE.Mesh(planeGeo(0.79, 0.92), new THREE.MeshBasicMaterial({
    color: 0xc6e5e5, transparent: true, opacity: 0.055, depthWrite: false, side: THREE.DoubleSide,
  }));
  glass.position.set(0, 1.239, 0.376); glass.renderOrder = 2; cabinet.add(glass); noOutline(glass);
  // Thin reflected strips suggest glass without washing out the bottles.
  for (const gx of [-0.351, 0.346]) {
    const shine = addBox(cabinet, glow(0xffffff, 1, 0.2), 0.012, 0.86, 0.002, gx, 0.81, 0.378, { cast: false });
    noOutline(shine);
  }

  // Recessed payment strip: display, coins, change return and contactless reader.
  addBox(cabinet, enamel, 0.85, 0.257, 0.265, 0, 0.476, 0.25, { r: 0.012 });
  addBox(cabinet, charcoal, 0.79, 0.188, 0.026, 0, 0.512, 0.39, { r: 0.008, cast: false });
  addBox(cabinet, inset, 0.225, 0.068, 0.022, -0.235, 0.613, 0.407, { r: 0.004, cast: false });
  label(cabinet, 'vending-credit', 0.202, 0.045, -0.235, 0.649, 0.422, (c) => {
    c.fillStyle = '#b1d9ac'; c.font = `600 130px monospace`; c.textAlign = 'right'; c.textBaseline = 'middle'; c.fillText('¥ 0', 960, c.canvas.height / 2);
  });
  addBox(cabinet, metal, 0.11, 0.07, 0.025, -0.036, 0.612, 0.411, { r: 0.004, cast: false });
  addBox(cabinet, inset, 0.064, 0.008, 0.012, -0.036, 0.643, 0.429, { cast: false });
  addBox(cabinet, brightMetal, 0.075, 0.031, 0.025, 0.075, 0.629, 0.417, { r: 0.008, cast: false });
  addBox(cabinet, toon(0x516a76), 0.13, 0.127, 0.029, 0.258, 0.544, 0.416, { r: 0.013, cast: false });
  label(cabinet, 'vending-ic', 0.116, 0.11, 0.258, 0.607, 0.435, (c) => {
    c.strokeStyle = '#c7e7db'; c.lineWidth = 24;
    for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(440, 340, 95 + i * 86, -0.8, 0.8); c.stroke(); }
    c.fillStyle = '#dfebde'; c.font = `600 140px ${FONT}`; c.textAlign = 'center'; c.fillText('IC', 512, 800);
  });
  label(cabinet, 'vending-payment-labels', 0.47, 0.032, -0.122, 0.559, 0.421, (c) => {
    c.fillStyle = '#c4cfcc'; c.font = `500 48px ${FONT}`; c.textBaseline = 'middle';
    c.fillText('硬貨  ·  COIN', 25, c.canvas.height / 2); c.textAlign = 'right'; c.fillText('おつり', 990, c.canvas.height / 2);
  });

  // An actual open collection pocket with a low lip and sloped back wall.
  addBox(cabinet, inset, 0.79, 0.286, 0.025, 0, 0.18, 0.158, { cast: false });
  addBox(cabinet, charcoal, 0.79, 0.023, 0.25, 0, 0.177, 0.29, { cast: false });
  addBox(cabinet, accent, 0.85, 0.035, 0.04, 0, 0.155, 0.399, { r: 0.008, cast: false });
  addBox(cabinet, metal, 0.782, 0.014, 0.024, 0, 0.19, 0.418, { r: 0.004, cast: false });
  for (const sx of [-1, 1]) addBox(cabinet, charcoal, 0.024, 0.28, 0.25, sx * 0.391, 0.184, 0.29, { cast: false });
  addBox(cabinet, metal, 0.79, 0.018, 0.032, 0, 0.463, 0.39, { cast: false });
  label(cabinet, 'vending-pickup', 0.34, 0.031, 0, 0.125, 0.392, (c) => {
    c.fillStyle = '#f3e8cf'; c.font = `600 63px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('取り出し口  /  PICK UP', 512, c.canvas.height / 2);
  });
  const trayLight = addBox(cabinet, glow(0xffe2b0, 0.8), 0.65, 0.008, 0.018, 0, 0.451, 0.262, { cast: false });
  noOutline(trayLight);

  // Service-panel seams, recessed ventilation and small fasteners on both sides.
  for (const sx of [-1, 1]) {
    addBox(cabinet, metal, 0.009, 0.43, 0.44, sx * 0.494, 0.37, -0.03, { r: 0.004, cast: false });
    for (let i = 0; i < 7; i++) addBox(cabinet, charcoal, 0.011, 0.015, 0.365, sx * 0.5, 0.408 + i * 0.051, -0.03, { cast: false });
    for (const hy of [0.79, 1.59]) addBox(cabinet, metal, 0.022, 0.102, 0.055, sx * 0.49, hy, 0.27, { r: 0.005, cast: false });
    for (const sy of [0.235, 1.708]) {
      const screw = addCyl(cabinet, brightMetal, 0.009, 0.009, 0.005, sx * 0.457, sy, 0.377, { seg: 8, rx: Math.PI / 2, cast: false });
      noOutline(screw);
    }
  }

  // Merge this cabinet in its own coordinates before the world's later merge.
  // This keeps the much richer geometry inexpensive and leaves dynamic bottles untouched.
  mergeStaticMeshes(cabinet);

  // Transparent hit volume survives static mesh merging, but never enters any render pass.
  const pickRoot = new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.99, 0.86), new THREE.MeshBasicMaterial({ visible: false }));
  pickRoot.name = 'vending-hit-' + variant;
  pickRoot.position.set(0, 0.995, 0.015);
  pickRoot.userData.noMerge = true;
  pickRoot.userData.vendingPick = true;
  root.add(pickRoot);

  const collection = group(root, 0, 0, 0, 'vending-delivered-' + variant);
  const loose = group(parent, 0, 0, 0, 'vending-loose-' + variant);
  const physics = sharedPhysics ?? new BottlePhysics();
  const bottles = new Map<number, DeliveredBottle>();
  const tray: DeliveredBottle[] = [];
  let nextId = 1;
  let active: DeliveredBottle | undefined;
  let dropTime = 0;
  const slots = [-0.255, 0, 0.255];
  let collidersReady = false;
  const position = new THREE.Vector3();
  const worldRotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion();

  function ensureColliders(): void {
    if (collidersReady) return;
    collidersReady = true;
    root.updateWorldMatrix(true, false);
    const rotation = root.getWorldQuaternion(new THREE.Quaternion());
    const scale = root.getWorldScale(new THREE.Vector3());
    const box = (w: number, h: number, d: number, px: number, bottom: number, pz: number): void => {
      const center = root.localToWorld(new THREE.Vector3(px, bottom + h / 2, pz));
      physics.addBox(center, new THREE.Vector3(w, h, d).multiply(scale), rotation);
    };
    // Exactly match the visible cabinet and collection pocket, rather than a solid
    // collision cube across the opening. The low metal lip allows a lively bounce.
    box(0.98, 1.85, 0.49, 0, 0.055, -0.125);
    box(0.85, 1.51, 0.265, 0, 0.476, 0.25);
    box(0.85, 0.177, 0.27, 0, 0, 0.25);
    box(0.79, 0.023, 0.25, 0, 0.177, 0.29);
    box(0.79, 0.286, 0.025, 0, 0.18, 0.158);
    box(0.782, 0.014, 0.024, 0, 0.19, 0.418);
    for (const sx of [-1, 1]) {
      box(0.065, 1.79, 0.25, sx * 0.457, 0.07, 0.245);
      box(0.024, 0.28, 0.25, sx * 0.391, 0.184, 0.29);
    }
  }

  function removeBottle(bottle: DeliveredBottle): void {
    const index = tray.indexOf(bottle);
    if (index >= 0) tray.splice(index, 1);
    if (active === bottle) active = undefined;
    bottles.delete(bottle.id);
    physics.world.removeBody(bottle.body);
    bottle.mesh.removeFromParent();
    // Geometry and materials are shared by all bottles; never dispose them here.
  }

  function syncMesh(bottle: DeliveredBottle): void {
    const mesh = bottle.mesh;
    const body = bottle.body;
    position.set(body.position.x, body.position.y, body.position.z);
    mesh.position.copy(mesh.parent!.worldToLocal(position));
    worldRotation.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    mesh.parent!.getWorldQuaternion(parentRotation).invert();
    mesh.quaternion.copy(parentRotation.multiply(worldRotation));
  }

  function startGroundTimer(bottle: DeliveredBottle): void {
    const index = tray.indexOf(bottle);
    if (index >= 0) tray.splice(index, 1);
    if (active === bottle) active = undefined;
    loose.attach(bottle.mesh);
    bottle.state = 'ground';
    bottle.remaining = 10;
    bottle.expiresAt = performance.now() + 10_000;
  }

  function purchase(drinkId: string): boolean {
    if (active) return false;
    const drink = VENDING_DRINKS.find((d) => d.id === drinkId);
    if (!drink) return false;
    ensureColliders();
    // Fourth purchase removes only the oldest bottle still in the tray, immediately.
    if (tray.length === 3) removeBottle(tray[0]);
    const mesh = makeBottle(drink, true);
    collection.add(mesh);
    // Spawn into the most open part of the tray. Existing bottles never snap into slots.
    const slot = slots.reduce((best, candidate) => {
      const clearance = (px: number): number => Math.min(...tray.map((b) => Math.abs(b.mesh.position.x - px)), 1);
      return clearance(candidate) > clearance(best) ? candidate : best;
    });
    const jitter = (amount: number): number => (Math.random() * 2 - 1) * amount;
    mesh.position.set(slot + jitter(0.007), 0.407, 0.254 + jitter(0.009));
    mesh.rotation.set(jitter(0.15), jitter(0.15), -Math.PI / 2 + jitter(0.12));
    const body = new CANNON.Body({
      mass: 0.35, material: physics.bottleMaterial,
      linearDamping: 0.14, angularDamping: 0.35,
      allowSleep: true, sleepSpeedLimit: 0.08, sleepTimeLimit: 0.7,
    });
    // Compound tapered cylinder: the narrower shoulder/cap produces uneven
    // contacts, so spins and bounces emerge from contact forces and gravity.
    body.addShape(new CANNON.Cylinder(0.033, 0.033, 0.138, 16), new CANNON.Vec3(0, -0.017, 0));
    body.addShape(new CANNON.Cylinder(0.019, 0.033, 0.022, 12), new CANNON.Vec3(0, 0.054, 0));
    body.addShape(new CANNON.Cylinder(0.019, 0.019, 0.033, 12), new CANNON.Vec3(0, 0.0775, 0));
    mesh.getWorldPosition(position);
    mesh.getWorldQuaternion(worldRotation);
    body.position.set(position.x, position.y, position.z);
    body.quaternion.set(worldRotation.x, worldRotation.y, worldRotation.z, worldRotation.w);
    const velocity = new THREE.Vector3(jitter(0.05), -0.025, 0.25 + jitter(0.05)).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    body.angularVelocity.set(1.8 + jitter(1.3), jitter(2.8), jitter(2.2));
    physics.world.addBody(body);
    const delivered: DeliveredBottle = { id: nextId++, drinkId, mesh, body, state: 'dispensing', remaining: null, expiresAt: null };
    mesh.userData.bottleId = delivered.id;
    mesh.userData.vendingId = 'vending-' + variant;
    bottles.set(delivered.id, delivered);
    tray.push(delivered);
    active = delivered;
    dropTime = 0;
    return true;
  }

  function grabBottle(id: number): boolean {
    const bottle = bottles.get(id);
    if (!bottle || bottle.state === 'held') return false;
    const index = tray.indexOf(bottle);
    if (index >= 0) tray.splice(index, 1);
    if (active === bottle) active = undefined;
    loose.attach(bottle.mesh);
    bottle.state = 'held';
    bottle.remaining = null;
    bottle.expiresAt = null;
    bottle.body.type = CANNON.Body.KINEMATIC;
    bottle.body.collisionResponse = false;
    bottle.body.velocity.setZero();
    bottle.body.angularVelocity.setZero();
    bottle.body.wakeUp();
    return true;
  }

  function moveBottle(id: number, worldPosition: THREE.Vector3): void {
    const bottle = bottles.get(id);
    if (!bottle || bottle.state !== 'held' || !worldPosition.toArray().every(Number.isFinite)) return;
    const body = bottle.body;
    body.updateAABB();
    const half = new THREE.Vector3(
      Math.max(body.position.x - body.aabb.lowerBound.x, body.aabb.upperBound.x - body.position.x),
      Math.max(body.position.y - body.aabb.lowerBound.y, body.aabb.upperBound.y - body.position.y),
      Math.max(body.position.z - body.aabb.lowerBound.z, body.aabb.upperBound.z - body.position.z),
    ).addScalar(0.003);
    const safe = physics.resolveHeldPosition(worldPosition, half);
    body.position.set(safe.x, safe.y, safe.z);
    body.previousPosition.copy(body.position);
    body.interpolatedPosition.copy(body.position);
    body.aabbNeedsUpdate = true;
    syncMesh(bottle);
  }

  function releaseBottle(id: number, worldVelocity: THREE.Vector3, recycle = false): void {
    const bottle = bottles.get(id);
    if (!bottle) return;
    if (recycle) { removeBottle(bottle); return; }
    if (bottle.state !== 'held') return;
    startGroundTimer(bottle);
    const body = bottle.body;
    body.type = CANNON.Body.DYNAMIC;
    body.collisionResponse = true;
    body.updateMassProperties();
    const velocity = worldVelocity.clone();
    if (!velocity.toArray().every(Number.isFinite)) velocity.set(0, 0, 0);
    velocity.clampLength(0, 3.5);
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    body.angularVelocity.set(-velocity.z * 4, velocity.x * 2, velocity.x * 4);
    body.wakeUp();
    if (physics.isInRecyclingBin(new THREE.Vector3(body.position.x, body.position.y, body.position.z))) removeBottle(bottle);
  }

  function update(dt: number): void {
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (elapsed > 0 && !sharedPhysics) physics.step(elapsed);
    const now = performance.now();
    for (const bottle of bottles.values()) {
      if (elapsed > 0) syncMesh(bottle);
      if (bottle.state === 'ground') {
        // Keep deterministic simulation stepping, but never stretch ten real seconds
        // when rendering is throttled or the tab resumes after being backgrounded.
        bottle.remaining = Math.max(0, Math.min(bottle.remaining! - elapsed, (bottle.expiresAt! - now) / 1000));
        position.set(bottle.body.position.x, bottle.body.position.y, bottle.body.position.z);
        if (bottle.remaining <= 1e-9 || physics.isInRecyclingBin(position)) removeBottle(bottle);
      } else if (bottle.state === 'tray' || bottle.state === 'dispensing') {
        // If a collision genuinely pushes a drink over the low lip, it becomes a
        // loose drink with the same pickup and cleanup rules as a manually thrown one.
        if (bottle.mesh.position.y < 0.15 || bottle.mesh.position.z > 0.5) startGroundTimer(bottle);
      }
    }
    if (active) {
      dropTime += Math.min(elapsed, 0.1);
      if (dropTime > 0.65 && (active.body.sleepState === CANNON.Body.SLEEPING || dropTime > 1.25)) {
        active.state = 'tray';
        active = undefined;
      }
    }
  }

  // Register both cabinets before assembly animates them. A machine is already a
  // solid obstacle even when no drink has yet been purchased from that machine.
  ensureColliders();

  return {
    id: 'vending-' + variant,
    variant,
    root,
    pickRoot,
    products: VENDING_DRINKS,
    purchase,
    isBusy: () => Boolean(active),
    getBottles: () => tray.map(({ id, drinkId }) => ({ id, drinkId })),
    getDraggableBottles: () => [...bottles.values()].map(({ id, mesh }) => ({ id, mesh })),
    getBottleState: (id) => {
      const bottle = bottles.get(id);
      if (!bottle) return undefined;
      const body = bottle.body;
      return {
        id, drinkId: bottle.drinkId, state: bottle.state,
        position: [body.position.x, body.position.y, body.position.z],
        velocity: [body.velocity.x, body.velocity.y, body.velocity.z],
        quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
        remaining: bottle.remaining, sleeping: body.sleepState === CANNON.Body.SLEEPING,
      };
    },
    grabBottle,
    moveBottle,
    releaseBottle,
    update,
  };
}
