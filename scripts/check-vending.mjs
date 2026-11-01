/**
 * Vending model contract checks (no browser / WebGL required).
 * Canvas2D drawing is stubbed only to construct procedural texture objects.
 * These checks exercise real rigid bodies, geometry, merging and inventory;
 * they do not verify text, shading, rendering or the purchase dialog.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createServer } from 'vite';

const previousDocument = globalThis.document;
globalThis.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas', 'The model should only request a texture canvas.');
    const canvas = { width: 0, height: 0 };
    const noop = () => {};
    const context = {
      canvas, fillRect: noop, fillText: noop, beginPath: noop,
      arc: noop, fill: noop, stroke: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
    };
    canvas.getContext = (kind) => {
      assert.equal(kind, '2d');
      return context;
    };
    return canvas;
  },
};

const server = await createServer({
  root: fileURLToPath(new URL('../', import.meta.url)),
  configFile: false,
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
}

try {
  const { buildVendingMachine } = await server.ssrLoadModule('/src/scene/vending.ts');
  const { BottlePhysics } = await server.ssrLoadModule('/src/core/bottle-physics.ts');
  const { L } = await server.ssrLoadModule('/src/scene/layout.ts');
  const { mergeStaticMeshes } = await server.ssrLoadModule('/src/scene/merge.ts');
  const scene = new THREE.Group();
  const physics = new BottlePhysics();
  const blue = buildVendingMachine(scene, 'blue', 2.82, 0.14, -3.1, Math.PI / 2, physics);
  const red = buildVendingMachine(scene, 'red', 2.82, 0.14, -1.9, Math.PI / 2, physics);
  const machines = [blue, red];
  const collection = (machine) => machine.root.getObjectByName(`vending-delivered-${machine.variant}`);
  const inventory = (machine) => machine.getBottles().map((bottle) => bottle.drinkId);
  const bottle = (machine, id) => machine.getDraggableBottles().find((candidate) => candidate.id === id);
  const position = (machine, id) => bottle(machine, id).mesh.getWorldPosition(new THREE.Vector3());

  function geometryBounds(mesh) {
    mesh.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3();
    const vertex = new THREE.Vector3();
    mesh.traverse((part) => {
      if (!part.isMesh) return;
      const positions = part.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        bounds.expandByPoint(vertex.fromBufferAttribute(positions, i).applyMatrix4(part.matrixWorld));
      }
    });
    return bounds;
  }

  function outsideSolid(mesh, solid) {
    const bounds = geometryBounds(mesh);
    // Collision cylinders approximate the sculpted shoulder/cap within 6 mm.
    const tolerance = 0.006;
    return ['x', 'y', 'z'].some((axis) => bounds.min[axis] >= solid.max[axis] - tolerance || bounds.max[axis] <= solid.min[axis] + tolerance);
  }

  function withVirtualClock(fn) {
    const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    let now = performance.now();
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
    try { fn((milliseconds) => { now += milliseconds; }); }
    finally {
      if (descriptor) Object.defineProperty(performance, 'now', descriptor);
      else delete performance.now;
    }
  }

  function step(dt) {
    physics.step(dt);
    for (const machine of machines) machine.update(dt);
  }

  function advance(seconds, frame = 1 / 120) {
    const frames = Math.floor(seconds / frame);
    for (let i = 0; i < frames; i++) step(frame);
    const rest = seconds - frames * frame;
    if (rest > 1e-9) step(rest);
  }

  function inspectWorld() {
    for (const machine of machines) inspect(machine);
    assert.equal(physics.world.bodies.filter((body) => body.mass > 0).length, machines.reduce((count, machine) => count + machine.getDraggableBottles().length, 0), 'Each live bottle has exactly one physics body; removed bottles leave none.');
  }

  function inspect(machine) {
    const tray = collection(machine);
    assert.ok(tray, 'The collection tray is still attached.');
    assert.ok(machine.getBottles().length <= 3, 'Inventory never exceeds three.');
    const live = machine.getDraggableBottles();
    assert.equal(new Set(live.map((b) => b.id)).size, live.length, 'Live bottle IDs are unique.');
    for (const retained of machine.getBottles()) assert.ok(live.some((b) => b.id === retained.id), 'Each inventory entry has a live mesh.');
    for (const { mesh } of live) {
      assert.ok(mesh.parent, 'Every live bottle is attached.');
      mesh.traverse((object) => {
        assert.ok([...object.position, ...object.rotation.toArray().slice(0, 3), ...object.scale].every(Number.isFinite), 'All bottle transforms stay finite.');
        if (object.isMesh) assert.equal(object.userData.noMerge, true, 'Every dynamic mesh is protected.');
      });
    }
  }

  function settle(machine) {
    // Deliberately uneven frame durations exercise frame-rate independence.
    const durations = [1 / 120, 1 / 60, 0.041, 0.008, 0.05];
    for (let frame = 0; machine.isBusy() && frame < 200; frame++) {
      step(durations[frame % durations.length]);
      inspect(machine);
    }
    assert.equal(machine.isBusy(), false, 'Dispensing completes within a bounded duration.');
    inspect(machine);
  }

  check('Both machines start empty and expose six valid drink choices', () => {
    for (const machine of [blue, red]) {
      assert.equal(machine.isBusy(), false);
      assert.deepEqual(inventory(machine), []);
      assert.equal(machine.products.length, 6);
      assert.equal(new Set(machine.products.map((drink) => drink.id)).size, 6);
      assert.ok(machine.products.every((drink) => drink.name && drink.price > 0));
      inspect(machine);
    }
  });

  check('Invalid choices do not create a bottle or lock the machine', () => {
    for (const id of ['', 'unknown-drink', '__proto__']) assert.equal(blue.purchase(id), false);
    assert.deepEqual(inventory(blue), []);
    assert.equal(blue.isBusy(), false);
    inspect(blue);
  });

  check('A purchase starts dispensing; repeated clicks while busy are ignored', () => {
    assert.equal(blue.purchase('water'), true);
    assert.equal(blue.isBusy(), true);
    const before = blue.getBottles();
    assert.equal(blue.purchase('tea'), false);
    assert.equal(blue.purchase('water'), false);
    assert.deepEqual(blue.getBottles(), before);
    inspect(blue);
  });

  check('The other machine can dispense independently at the same time', () => {
    assert.equal(red.purchase('coffee'), true);
    assert.equal(red.isBusy(), true);
    assert.equal(blue.isBusy(), true);
    assert.deepEqual(inventory(blue), ['water']);
    assert.deepEqual(inventory(red), ['coffee']);
  });

  check('Bottle falls visibly and does not move on zero or negative frame time', () => {
    const bottle = collection(blue).children[0];
    const start = bottle.position.clone();
    step(0);
    step(-1);
    assert.ok(bottle.position.distanceTo(start) < 1e-9, 'Zero/negative time does not advance physics (apart from coordinate roundoff).');
    for (let frame = 0; frame < 12; frame++) step(1 / 60);
    assert.ok(bottle.position.y < start.y - 0.005, 'The bottle descends.');
    inspect(blue);
  });

  check('Global static merging preserves active bottles and clickable hit proxies', () => {
    const dynamic = [];
    for (const machine of [blue, red]) collection(machine).traverse((object) => {
      if (object.isMesh) dynamic.push(object);
    });
    mergeStaticMeshes(scene);
    for (const mesh of dynamic) assert.ok(mesh.parent, 'A live bottle mesh was not stripped by merging.');
    for (const machine of [blue, red]) {
      assert.equal(machine.pickRoot.parent, machine.root);
      scene.updateMatrixWorld(true);
      const origin = machine.root.localToWorld(new THREE.Vector3(0, 1, 3));
      const direction = machine.root.localToWorld(new THREE.Vector3(0, 1, 0)).sub(origin).normalize();
      assert.ok(new THREE.Raycaster(origin, direction).intersectObject(machine.pickRoot, true).length > 0);
      inspect(machine);
    }
  });

  check('Both drops finish without locking either machine', () => {
    settle(blue);
    settle(red);
    advance(1);
    inspectWorld();
  });

  check('Fourth and later purchases retain exactly the newest three bottles', () => {
    const purchases = ['water'];
    for (const id of ['tea', 'ramune', 'peach', 'orange', 'coffee', 'water', 'tea']) {
      const oldIds = blue.getBottles().map((bottle) => bottle.id);
      const oldRoots = oldIds.map((id) => bottle(blue, id).mesh);
      assert.equal(blue.purchase(id), true);
      purchases.push(id);
      inspect(blue); // Check immediately, including the incoming animated bottle.
      assert.deepEqual(inventory(blue), purchases.slice(-3));
      if (oldRoots.length === 3) {
        assert.equal(oldRoots[0].parent, null, 'The oldest actual scene object is removed.');
        assert.equal(bottle(blue, oldIds[0]), undefined, 'The oldest bottle cannot still be picked.');
        assert.equal(blue.getBottleState(oldIds[0]), undefined, 'The oldest bottle has no remaining state.');
        assert.deepEqual(blue.getBottles().slice(0, 2).map((bottle) => bottle.id), oldIds.slice(1));
        assert.ok(collection(blue).children.includes(oldRoots[1]));
        assert.ok(collection(blue).children.includes(oldRoots[2]));
      }
      settle(blue);
      inspectWorld();
    }
    assert.deepEqual(inventory(red), ['coffee'], 'Blue purchases do not alter red inventory.');
    const ids = blue.getBottles().map((bottle) => bottle.id);
    assert.equal(new Set(ids).size, 3);
    assert.ok(ids[0] < ids[1] && ids[1] < ids[2]);
  });

  check('Physical tray walls and floor keep settled bottles inside the pocket', () => {
    advance(2);
    scene.updateMatrixWorld(true);
    const inverse = blue.root.matrixWorld.clone().invert();
    const boxes = collection(blue).children.map((bottle) => {
      const box = new THREE.Box3();
      bottle.traverse((mesh) => {
        if (!mesh.isMesh) return;
        // Rotated cylinders have empty bounding-box corners. Inspect actual
        // vertices so irregular resting angles do not invent floor penetration.
        const transform = inverse.clone().multiply(mesh.matrixWorld);
        const vertices = mesh.geometry.getAttribute('position');
        const point = new THREE.Vector3();
        for (let i = 0; i < vertices.count; i++) {
          box.expandByPoint(point.fromBufferAttribute(vertices, i).applyMatrix4(transform));
        }
      });
      assert.ok(box.min.x >= -0.39 && box.max.x <= 0.39, `Bottle fits between side walls (${box.min.x}, ${box.max.x}).`);
      assert.ok(box.min.y >= 0.19 && box.max.y <= 0.49, `Bottle stays above floor and below opening top (${box.min.y}, ${box.max.y}).`);
      assert.ok(box.min.z >= 0.16 && box.max.z <= 0.44, `Bottle stays inside the tray depth (${box.min.z}, ${box.max.z}).`);
      return box;
    });
    assert.equal(boxes.length, 3);
  });

  check('Inventory snapshots cannot mutate retained bottle metadata', () => {
    const before = blue.getBottles();
    const snapshot = blue.getBottles();
    snapshot[0].drinkId = 'changed-outside-model';
    snapshot.length = 0;
    assert.deepEqual(blue.getBottles(), before);
  });

  check('Long frame delays remain finite and dispensing recovers', () => {
    assert.equal(red.purchase('orange'), true);
    step(3600);
    inspect(red);
    settle(red);
    assert.deepEqual(inventory(red), ['coffee', 'orange']);
  });

  check('Full trays remain intact through another global merge', () => {
    const before = [blue.getBottles(), red.getBottles()];
    mergeStaticMeshes(scene);
    assert.deepEqual([blue.getBottles(), red.getBottles()], before);
    inspect(blue);
    inspect(red);
  });

  check('Grabbing removes a bottle from tray capacity and rejects invalid IDs', () => {
    assert.equal(blue.grabBottle(-1), false);
    const id = blue.getBottles()[0].id;
    assert.equal(blue.grabBottle(id), true);
    assert.equal(blue.getBottles().length, 2);
    assert.ok(bottle(blue, id));
    blue.moveBottle(id, new THREE.Vector3(6, 2, 4));
    advance(0.1);
    assert.ok(position(blue, id).distanceTo(new THREE.Vector3(6, 2, 4)) < 0.005, 'Held bottle follows the world-space target.');
    blue.releaseBottle(id, new THREE.Vector3(), true);
    inspectWorld();
  });

  check('A released bottle accelerates under gravity and collides with the road', () => {
    const id = blue.getBottles()[0].id;
    assert.equal(blue.grabBottle(id), true);
    blue.moveBottle(id, new THREE.Vector3(6, 2, 4));
    blue.releaseBottle(id, new THREE.Vector3());
    const y0 = position(blue, id).y;
    advance(0.1);
    const y1 = position(blue, id).y;
    advance(0.1);
    const y2 = position(blue, id).y;
    assert.ok(y1 < y0 - 0.02, 'The bottle starts falling after release.');
    assert.ok(y1 - y2 > (y0 - y1) * 1.8, 'Gravity increases downward displacement each interval.');
    advance(2);
    const resting = position(blue, id);
    assert.ok(resting.y > 0.015 && resting.y < 0.13, `The bottle rests on the road, not through it (${resting.y}).`);
    inspectWorld();
    blue.grabBottle(id);
    blue.releaseBottle(id, new THREE.Vector3(), true);
  });

  check('Dropped bottles remain for ten seconds then remove mesh and body', () => {
    const id = blue.getBottles()[0].id;
    const mesh = bottle(blue, id).mesh;
    assert.equal(blue.grabBottle(id), true);
    blue.moveBottle(id, new THREE.Vector3(6, 0.5, 4));
    blue.releaseBottle(id, new THREE.Vector3());
    advance(9.8);
    assert.ok(bottle(blue, id), 'A dropped bottle survives until its ten-second deadline.');
    advance(0.22);
    assert.equal(bottle(blue, id), undefined);
    assert.equal(mesh.parent, null);
    assert.equal(blue.getBottleState(id), undefined);
    inspectWorld();
  });

  check('Regrabbing pauses cleanup; a later ground release starts a fresh ten seconds', () => {
    assert.equal(blue.purchase('water'), true);
    settle(blue);
    const id = blue.getBottles()[0].id;
    blue.grabBottle(id);
    blue.moveBottle(id, new THREE.Vector3(6, 0.5, 4));
    blue.releaseBottle(id, new THREE.Vector3());
    advance(9);
    assert.equal(blue.grabBottle(id), true, 'A bottle on the ground remains draggable.');
    advance(12);
    assert.ok(bottle(blue, id), 'The expiry timer does not delete a held bottle.');
    blue.releaseBottle(id, new THREE.Vector3());
    advance(9.8);
    assert.ok(bottle(blue, id), 'Releasing again resets the ground timer.');
    advance(0.22);
    assert.equal(bottle(blue, id), undefined);
    inspectWorld();
  });

  check('Recycling removes a held bottle immediately, with no lingering physics body', () => {
    assert.equal(blue.purchase('tea'), true);
    settle(blue);
    const id = blue.getBottles()[0].id;
    const mesh = bottle(blue, id).mesh;
    blue.grabBottle(id);
    blue.moveBottle(id, new THREE.Vector3(3.1, 1, -3.8));
    blue.releaseBottle(id, new THREE.Vector3(), true);
    assert.equal(mesh.parent, null, 'No frame delay is needed for recycling.');
    assert.equal(bottle(blue, id), undefined);
    assert.equal(blue.getBottleState(id), undefined);
    inspectWorld();
  });

  check('Repeated purchases have varied rotation and travel, not one canned trajectory', () => {
    const traces = [];
    for (let trial = 0; trial < 3; trial++) {
      assert.equal(blue.purchase('water'), true);
      const id = blue.getBottles()[0].id;
      const mesh = bottle(blue, id).mesh;
      const trace = [];
      for (let frame = 0; frame < 12; frame++) {
        step(1 / 120);
        trace.push(...mesh.position.toArray(), ...mesh.quaternion.toArray());
      }
      traces.push(trace);
      settle(blue);
      blue.grabBottle(id);
      blue.releaseBottle(id, new THREE.Vector3(), true);
    }
    assert.ok(traces.some((trace) => trace.some((value, i) => Math.abs(value - traces[0][i]) > 0.001)), 'Identical purchases have different physical trajectories.');
    inspectWorld();
  });

  check('Tray replacement does not delete an earlier bottle dropped on the ground', () => {
    blue.purchase('water');
    settle(blue);
    const groundId = blue.getBottles()[0].id;
    blue.grabBottle(groundId);
    blue.moveBottle(groundId, new THREE.Vector3(6, 0.5, 4));
    blue.releaseBottle(groundId, new THREE.Vector3());
    for (const drinkId of ['tea', 'ramune', 'peach', 'orange']) {
      assert.equal(blue.purchase(drinkId), true);
      settle(blue);
    }
    assert.deepEqual(inventory(blue), ['ramune', 'peach', 'orange']);
    assert.ok(bottle(blue, groundId), 'Tray FIFO only replaces bottles still in the tray.');
    blue.grabBottle(groundId);
    blue.releaseBottle(groundId, new THREE.Vector3(), true);
    inspectWorld();
  });

  check('Bottles from different machines collide in the shared physics world', () => {
    const blueId = blue.getBottles()[0].id;
    const redId = red.getBottles()[0].id;
    blue.grabBottle(blueId);
    red.grabBottle(redId);
    blue.moveBottle(blueId, new THREE.Vector3(6, 0.4, 5));
    red.moveBottle(redId, new THREE.Vector3(6, 0.75, 5));
    blue.releaseBottle(blueId, new THREE.Vector3());
    red.releaseBottle(redId, new THREE.Vector3());
    advance(3);
    const first = position(blue, blueId);
    const second = position(red, redId);
    assert.ok(first.y >= 0.015 && second.y >= 0.015, 'Both bottles remain above the road.');
    assert.ok(first.distanceTo(second) > 0.05, 'The two rigid bodies do not settle through each other.');
    blue.releaseBottle(blueId, new THREE.Vector3(), true);
    red.releaseBottle(redId, new THREE.Vector3(), true);
    inspectWorld();
  });

  check('A drink physically entering a recycling volume disappears without an explicit recycle flag', () => {
    physics.addRecyclingBox(new THREE.Vector3(6, 0.7, 6), new THREE.Vector3(0.8, 0.5, 0.8));
    const id = blue.getBottles()[0].id;
    blue.grabBottle(id);
    blue.moveBottle(id, new THREE.Vector3(6, 1.2, 6));
    blue.releaseBottle(id, new THREE.Vector3());
    advance(0.6);
    assert.equal(bottle(blue, id), undefined, 'The physics sensor recycles a falling drink.');
    inspectWorld();
  });

  check('Standalone machines advance their own physics without a street owner', () => {
    const standalone = buildVendingMachine(new THREE.Group(), 'blue', 2.82, 0.14, -3.1, Math.PI / 2);
    standalone.purchase('water');
    const id = standalone.getBottles()[0].id;
    const startY = position(standalone, id).y;
    for (let frame = 0; frame < 15; frame++) standalone.update(1 / 120);
    assert.ok(position(standalone, id).y < startY - 0.02);
    for (let frame = 0; standalone.isBusy() && frame < 600; frame++) standalone.update(1 / 120);
    assert.equal(standalone.isBusy(), false);
    inspect(standalone);
  });

  check('An unpurchased neighbouring machine already blocks falling bottles', () => {
    const testScene = new THREE.Group();
    const testPhysics = new BottlePhysics();
    const source = buildVendingMachine(testScene, 'blue', 2.82, L.curb, -3.1, Math.PI / 2, testPhysics);
    const untouched = buildVendingMachine(testScene, 'red', 2.82, L.curb, -1.9, Math.PI / 2, testPhysics);
    source.purchase('water');
    const id = source.getBottles()[0].id;
    source.grabBottle(id);
    source.moveBottle(id, untouched.root.localToWorld(new THREE.Vector3(0, 2.8, 0.25)));
    source.releaseBottle(id, new THREE.Vector3());
    let roofContact = false;
    for (let frame = 0; frame < 240; frame++) {
      testPhysics.step(1 / 120);
      source.update(1 / 120);
      untouched.update(1 / 120);
      const state = source.getBottleState(id);
      // A bottle may subsequently roll off a roof. The upward collision response
      // above two metres proves it hit the cabinet rather than falling through it.
      if (state.position[1] > 2 && state.velocity[1] > 0.01) roofContact = true;
    }
    assert.ok(roofContact, 'The bottle collides with the empty machine roof before it can roll off.');
    assert.deepEqual(untouched.getBottles(), [], 'Collider registration does not require purchasing from the machine.');
    source.releaseBottle(id, new THREE.Vector3(), true);
    assert.equal(testPhysics.world.bodies.filter((body) => body.mass > 0).length, 0);
  });

  check('Dragging into the shop or cabinet resolves to a clear release position', () => {
    const testScene = new THREE.Group();
    const testPhysics = new BottlePhysics();
    const machine = buildVendingMachine(testScene, 'blue', 2.82, L.curb, -3.1, Math.PI / 2, testPhysics);
    const untouched = buildVendingMachine(testScene, 'red', 2.82, L.curb, -1.9, Math.PI / 2, testPhysics);
    machine.purchase('water');
    const id = machine.getBottles()[0].id;
    const shop = new THREE.Box3(new THREE.Vector3(L.store.x0, L.store.floorY, L.store.z0), new THREE.Vector3(L.store.x1, L.store.roofY, L.store.z1));
    untouched.root.updateWorldMatrix(true, false);
    const cabinet = new THREE.Box3(new THREE.Vector3(-0.425, 0.476, 0.1175), new THREE.Vector3(0.425, 1.986, 0.3825)).applyMatrix4(untouched.root.matrixWorld);
    for (const [target, solid] of [
      [shop.getCenter(new THREE.Vector3()), shop],
      [cabinet.getCenter(new THREE.Vector3()), cabinet],
    ]) {
      assert.equal(machine.grabBottle(id), true);
      machine.moveBottle(id, target);
      assert.ok(outsideSolid(bottle(machine, id).mesh, solid), 'The whole held bottle is projected clear of the solid.');
      machine.releaseBottle(id, new THREE.Vector3());
      for (let frame = 0; frame < 60; frame++) {
        testPhysics.step(1 / 120);
        machine.update(1 / 120);
      }
      assert.ok(outsideSolid(bottle(machine, id).mesh, solid), 'The released bottle does not become embedded in the solid.');
    }
    machine.releaseBottle(id, new THREE.Vector3(), true);
  });

  check('Dragging under the road or sidewalk clamps the whole bottle above the surface', () => {
    blue.purchase('water');
    const id = blue.getBottles().at(-1).id;
    for (const [target, floor] of [
      [new THREE.Vector3(6, -0.15, 4), 0],
      [new THREE.Vector3(3.8, 0.01, 0), L.curb],
    ]) {
      assert.equal(blue.grabBottle(id), true);
      blue.moveBottle(id, target);
      assert.ok(geometryBounds(bottle(blue, id).mesh).min.y >= floor - 0.006, 'The visual bottle clears the selected floor.');
      blue.releaseBottle(id, new THREE.Vector3());
      advance(0.5);
      assert.ok(geometryBounds(bottle(blue, id).mesh).min.y >= floor - 0.006, 'A safe drop stays above the floor after settling.');
    }
    blue.releaseBottle(id, new THREE.Vector3(), true);
    inspectWorld();
  });

  check('Ten real seconds expire ground bottles even with tiny or zero simulation deltas', () => {
    withVirtualClock((elapse) => {
      for (const dt of [0.001, 0]) {
        assert.equal(blue.purchase('coffee'), true);
        const id = blue.getBottles().at(-1).id;
        const mesh = bottle(blue, id).mesh;
        blue.grabBottle(id);
        blue.moveBottle(id, new THREE.Vector3(6, 0.5, 4));
        blue.releaseBottle(id, new THREE.Vector3());
        elapse(9_990);
        blue.update(dt);
        assert.ok(bottle(blue, id), 'A nearly ten-second-old bottle still exists.');
        elapse(20);
        blue.update(dt);
        assert.equal(bottle(blue, id), undefined, 'Real elapsed time cleans up after a stalled or backgrounded frame.');
        assert.equal(mesh.parent, null);
        inspectWorld();
      }
    });
  });

  check('Grabbing cancels the old real deadline and releasing creates a fresh deadline', () => {
    withVirtualClock((elapse) => {
      assert.equal(blue.purchase('water'), true);
      const id = blue.getBottles().at(-1).id;
      blue.grabBottle(id);
      blue.moveBottle(id, new THREE.Vector3(6, 0.5, 4));
      blue.releaseBottle(id, new THREE.Vector3());
      elapse(9_000);
      blue.update(0);
      assert.equal(blue.grabBottle(id), true);
      elapse(21_000);
      blue.update(0);
      assert.equal(blue.getBottleState(id)?.state, 'held', 'A held bottle survives past the cancelled deadline.');
      assert.equal(blue.getBottleState(id)?.remaining, null);
      blue.releaseBottle(id, new THREE.Vector3());
      elapse(9_990);
      blue.update(0.001);
      assert.ok(bottle(blue, id), 'The new release gets its own full deadline.');
      elapse(20);
      blue.update(0);
      assert.equal(bottle(blue, id), undefined);
      inspectWorld();
    });
  });

  console.log(`\n${passed}/${passed} model checks passed. Rendering and dialog behavior require browser QA.`);
} finally {
  await server.close();
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}
