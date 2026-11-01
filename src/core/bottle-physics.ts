import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { L } from '../scene/layout';

/** One small shared rigid-body world for both vending machines and loose drinks. */
export class BottlePhysics {
  readonly world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0), allowSleep: true });
  readonly bottleMaterial = new CANNON.Material('drink-plastic');
  private readonly surfaceMaterial = new CANNON.Material('street-and-tray');
  private readonly recycling: { center: THREE.Vector3; half: THREE.Vector3; inverse: THREE.Quaternion }[] = [];

  constructor() {
    const solver = this.world.solver as CANNON.GSSolver;
    solver.iterations = 20;
    solver.tolerance = 0.0001;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.bottleMaterial, this.surfaceMaterial, {
      friction: 0.38, restitution: 0.24,
      contactEquationStiffness: 1e7, contactEquationRelaxation: 4,
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.bottleMaterial, this.bottleMaterial, {
      friction: 0.3, restitution: 0.2,
      contactEquationStiffness: 1e7, contactEquationRelaxation: 4,
    }));

    // Physical surfaces use the same heights as the street layout, including the curb.
    this.addBox(new THREE.Vector3(0, -0.35, 0), new THREE.Vector3(L.half * 2 + 0.46, 0.7, L.half * 2 + 0.46));
    this.addBox(
      new THREE.Vector3((L.walk.xOuter - L.half) / 2, L.curb / 2, (L.walk.zOuter - L.half) / 2),
      new THREE.Vector3(L.half + L.walk.xOuter, L.curb, L.half + L.walk.zOuter),
    );
    // A thrown drink cannot pass through the shop or its neighbouring building.
    this.addBox(
      new THREE.Vector3((L.store.x0 + L.store.x1) / 2, (L.store.floorY + L.store.roofY) / 2, (L.store.z0 + L.store.z1) / 2),
      new THREE.Vector3(L.store.x1 - L.store.x0, L.store.roofY - L.store.floorY, L.store.z1 - L.store.z0),
    );
    this.addBox(
      new THREE.Vector3((L.neighbor.x0 + L.neighbor.x1) / 2, L.curb + L.neighbor.h / 2, (L.neighbor.z0 + L.neighbor.z1) / 2),
      new THREE.Vector3(L.neighbor.x1 - L.neighbor.x0, L.neighbor.h, L.neighbor.z1 - L.neighbor.z0),
    );
  }

  addBox(center: THREE.Vector3, size: THREE.Vector3, quaternion = new THREE.Quaternion()): CANNON.Body {
    const body = new CANNON.Body({ mass: 0, material: this.surfaceMaterial });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)));
    body.position.set(center.x, center.y, center.z);
    body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    this.world.addBody(body);
    return body;
  }

  addRecyclingBox(center: THREE.Vector3, size: THREE.Vector3, quaternion = new THREE.Quaternion()): void {
    this.recycling.push({ center: center.clone(), half: size.clone().multiplyScalar(0.5), inverse: quaternion.clone().invert() });
  }

  /** Keep a held bottle outside static solids even though its body is kinematic. */
  resolveHeldPosition(position: THREE.Vector3, margin: number | THREE.Vector3 = 0.1): THREE.Vector3 {
    const extent = typeof margin === 'number' ? new THREE.Vector3(margin, margin, margin) : margin;
    const boxes: { center: THREE.Vector3; half: THREE.Vector3; rotation: THREE.Quaternion; inverse: THREE.Quaternion }[] = [];
    for (const body of this.world.bodies) {
      if (body.type !== CANNON.Body.STATIC) continue;
      const bodyRotation = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      body.shapes.forEach((shape, index) => {
        if (!(shape instanceof CANNON.Box)) return;
        const offset = body.shapeOffsets[index];
        const orientation = body.shapeOrientations[index];
        const center = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(bodyRotation)
          .add(new THREE.Vector3(body.position.x, body.position.y, body.position.z));
        const rotation = bodyRotation.clone().multiply(new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));
        const inverse = rotation.clone().invert();
        const e = new THREE.Matrix4().makeRotationFromQuaternion(inverse).elements;
        // Express the bottle's world AABB in this box's rotated local frame.
        const half = new THREE.Vector3(
          shape.halfExtents.x + Math.abs(e[0]) * extent.x + Math.abs(e[4]) * extent.y + Math.abs(e[8]) * extent.z,
          shape.halfExtents.y + Math.abs(e[1]) * extent.x + Math.abs(e[5]) * extent.y + Math.abs(e[9]) * extent.z,
          shape.halfExtents.z + Math.abs(e[2]) * extent.x + Math.abs(e[6]) * extent.y + Math.abs(e[10]) * extent.z,
        );
        boxes.push({ center, half, rotation, inverse });
      });
    }
    const result = position.clone();
    const local = new THREE.Vector3();
    const contains = (point: THREE.Vector3, box: typeof boxes[number]): boolean => {
      local.copy(point).sub(box.center).applyQuaternion(box.inverse);
      return Math.abs(local.x) < box.half.x && Math.abs(local.y) < box.half.y && Math.abs(local.z) < box.half.z;
    };
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (const box of boxes) {
        if (!contains(result, box)) continue;
        const distances = [box.half.x - Math.abs(local.x), box.half.y - Math.abs(local.y), box.half.z - Math.abs(local.z)];
        const axis = distances.indexOf(Math.min(...distances));
        local.setComponent(axis, (local.getComponent(axis) < 0 ? -1 : 1) * (box.half.getComponent(axis) + 0.0005));
        result.copy(local).applyQuaternion(box.rotation).add(box.center);
        moved = true;
      }
      if (!moved) return result;
    }
    // Adjacent cabinet pieces can project back into one another in a narrow gap.
    // Choose the closest clear face instead of returning an embedded bottle.
    if (!boxes.some((box) => contains(result, box))) return result;
    let best: THREE.Vector3 | undefined;
    let distance = Infinity;
    for (const box of boxes) {
      const origin = position.clone().sub(box.center).applyQuaternion(box.inverse);
      for (let axis = 0; axis < 3; axis++) for (const direction of [-1, 1]) {
        const candidate = origin.clone().setComponent(axis, direction * (box.half.getComponent(axis) + 0.0005))
          .applyQuaternion(box.rotation).add(box.center);
        const d = candidate.distanceToSquared(position);
        if (d < distance && !boxes.some((other) => contains(candidate, other))) { best = candidate; distance = d; }
      }
    }
    // A clear point always exists above this finite miniature, even for overlapping
    // user-added boxes whose nearest-face projections have no common solution.
    if (best) return best;
    let top = position.y;
    for (const box of boxes) {
      const e = new THREE.Matrix4().makeRotationFromQuaternion(box.rotation).elements;
      top = Math.max(top, box.center.y + Math.abs(e[1]) * box.half.x + Math.abs(e[5]) * box.half.y + Math.abs(e[9]) * box.half.z + 0.0005);
    }
    return position.clone().setY(top);
  }

  isInRecyclingBin(worldPosition: THREE.Vector3): boolean {
    return this.recycling.some(({ center, half, inverse }) => {
      const p = worldPosition.clone().sub(center).applyQuaternion(inverse);
      return Math.abs(p.x) <= half.x && Math.abs(p.y) <= half.y && Math.abs(p.z) <= half.z;
    });
  }

  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Small bottles and shallow tray walls require substeps, especially after a flick.
    this.world.step(1 / 120, Math.min(dt, 0.1), 12);
  }
}
