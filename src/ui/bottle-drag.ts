import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { VendingHandles } from '../scene/vending';
import { L } from '../scene/layout';
import './bottle-drag.css';

interface BottleDragOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  controls: OrbitControls;
  worldRoot: THREE.Object3D;
  machines: readonly VendingHandles[];
  recyclingBins: readonly THREE.Object3D[];
  canInteract: () => boolean;
}

const HOLD_MS = 360;
const MOVE_TOLERANCE = 10;

/** Capture bottle gestures before OrbitControls or the machine's click-to-buy handler. */
export function createBottleDrag(options: BottleDragOptions) {
  const { canvas, camera, controls, worldRoot, machines, recyclingBins, canInteract } = options;
  const raycaster = new THREE.Raycaster();
  raycaster.layers.enable(2);
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0));
  const offset = new THREE.Vector3();
  const point = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const hint = document.createElement('div');
  hint.className = 'bottle-drag-hint';
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');
  hint.hidden = true;
  document.body.append(hint);
  const binHighlight = new THREE.BoxHelper(new THREE.Object3D(), 0xa8e4c2);
  binHighlight.name = 'bottle-recycling-highlight';
  binHighlight.visible = false;
  (binHighlight.material as THREE.LineBasicMaterial).depthTest = false;
  binHighlight.renderOrder = 10;
  worldRoot.add(binHighlight);

  type Gesture = {
    id: number;
    machine: VendingHandles;
    bottleId: number;
    mesh: THREE.Group;
    x: number;
    y: number;
    grabbed: boolean;
    cancelled: boolean;
    controlsEnabled: boolean;
    samples: { position: THREE.Vector3; time: number }[];
  };
  let gesture: Gesture | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let hoveredBin: THREE.Object3D | null = null;

  function showHint(text: string, transient = false): void {
    clearTimeout(hintTimer);
    hint.textContent = text;
    hint.hidden = false;
    hint.dataset.recycle = String(Boolean(hoveredBin));
    if (transient) hintTimer = setTimeout(() => { hint.hidden = true; }, 2800);
  }

  function setRay(x: number, y: number): void {
    const rect = canvas.getBoundingClientRect();
    pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
    camera.updateMatrixWorld();
    worldRoot.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
  }

  function belongsTo(object: THREE.Object3D, root: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = object; p; p = p.parent) if (p === root) return true;
    return false;
  }

  function visible(object: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = object; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  function occluded(distance: number, ignored?: THREE.Object3D): boolean {
    raycaster.far = Math.max(0, distance - 0.07);
    const blocked = raycaster.intersectObject(worldRoot, true).some((hit) => {
      const mesh = hit.object as THREE.Mesh;
      if (!mesh.isMesh || !visible(mesh) || mesh.userData.vendingPick || mesh.userData.recyclingPick ||
          (ignored && belongsTo(mesh, ignored))) return false;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const material = materials[hit.face?.materialIndex ?? 0];
      return material?.visible && (!material.transparent || material.opacity >= 0.98);
    });
    raycaster.far = Infinity;
    return blocked;
  }

  function pickBottle(event: PointerEvent) {
    const candidates = machines.flatMap((machine) => machine.getDraggableBottles().map((bottle) => ({ machine, ...bottle })));
    setRay(event.clientX, event.clientY);
    const exact = raycaster.intersectObjects(candidates.map(({ mesh }) => mesh), true)[0];
    if (exact) {
      const match = candidates.find(({ mesh }) => belongsTo(exact.object, mesh));
      if (match && visible(match.mesh) && !occluded(exact.distance, match.mesh)) return match;
    }
    // Tiny miniature bottles need a finger-sized target, but still respect scene occlusion.
    const rect = canvas.getBoundingClientRect();
    const radius = event.pointerType === 'touch' ? 22 : 13;
    const near = candidates.map((candidate) => {
      const position = candidate.mesh.getWorldPosition(new THREE.Vector3());
      const projected = position.clone().project(camera);
      const x = rect.left + (projected.x + 1) * 0.5 * rect.width;
      const y = rect.top + (1 - projected.y) * 0.5 * rect.height;
      return { candidate, position, projected, distance: Math.hypot(event.clientX - x, event.clientY - y) };
    }).filter(({ candidate, projected, distance }) => visible(candidate.mesh) && projected.z > -1 && projected.z < 1 && distance < radius)
      .sort((a, b) => a.distance - b.distance);
    for (const match of near) {
      raycaster.ray.direction.copy(match.position).sub(raycaster.ray.origin).normalize();
      if (!occluded(raycaster.ray.origin.distanceTo(match.position), match.candidate.mesh)) {
        setRay(event.clientX, event.clientY);
        return match.candidate;
      }
    }
    return null;
  }

  function consume(event: PointerEvent): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function moveHeld(x: number, y: number): void {
    const current = gesture;
    if (!current?.grabbed) return;
    setRay(x, y);
    if (raycaster.ray.intersectPlane(plane, point)) {
      point.add(offset);
      // When the screen-facing drag plane reaches the ground, follow the cursor
      // across a horizontal plane instead of clamping Y and drifting off-pointer.
      const height = THREE.MathUtils.clamp(point.y, L.curb + 0.13, 4);
      if (height !== point.y) {
        floorPlane.constant = -(height - offset.y);
        if (raycaster.ray.intersectPlane(floorPlane, point)) point.add(offset);
      }
      point.x = THREE.MathUtils.clamp(point.x, -L.half + 0.15, L.half - 0.15);
      point.z = THREE.MathUtils.clamp(point.z, -L.half + 0.15, L.half - 0.15);
      point.y = THREE.MathUtils.clamp(point.y, L.curb + 0.13, 4);
      current.machine.moveBottle(current.bottleId, point);
      const now = performance.now();
      current.samples.push({ position: current.mesh.getWorldPosition(new THREE.Vector3()), time: now });
      current.samples = current.samples.filter((sample) => now - sample.time <= 120);
    }
    hoveredBin = null;
    const hit = raycaster.intersectObjects([...recyclingBins], true).find(({ object }) => visible(object));
    if (hit && !occluded(hit.distance, current.mesh)) hoveredBin = hit.object;
    binHighlight.visible = Boolean(hoveredBin);
    if (hoveredBin) binHighlight.setFromObject(hoveredBin);
    showHint(hoveredBin ? '松手投入垃圾桶 · 立即回收' : '拖动饮料 · 松手抛下 · 地上 10 秒后清理');
  }

  function finish(cancelled: boolean): void {
    clearTimeout(holdTimer);
    const current = gesture;
    if (!current) return;
    gesture = null;
    const recycle = !cancelled && Boolean(hoveredBin);
    if (current.grabbed) {
      const velocity = new THREE.Vector3();
      const first = current.samples[0];
      const last = current.samples.at(-1);
      if (!cancelled && first && last && last !== first && performance.now() - last.time < 100) {
        const seconds = (last.time - first.time) / 1000;
        if (seconds > 0.008) velocity.copy(last.position).sub(first.position).divideScalar(seconds).clampLength(0, 4);
      }
      current.machine.releaseBottle(current.bottleId, velocity, recycle);
    }
    controls.enabled = current.controlsEnabled;
    canvas.style.removeProperty('cursor');
    binHighlight.visible = false;
    hoveredBin = null;
    if (canvas.hasPointerCapture(current.id)) canvas.releasePointerCapture(current.id);
    if (current.grabbed) showHint(recycle ? '已回收 ♻' : '饮料已放下 · 10 秒后清理，可再次长按拾起', true);
    else hint.hidden = true;
  }

  function onDown(event: PointerEvent): void {
    if (gesture) {
      consume(event);
      finish(true);
      return;
    }
    if (event.button !== 0 || !event.isPrimary || !canInteract()) return;
    const bottle = pickBottle(event);
    if (!bottle) return;
    consume(event);
    gesture = {
      id: event.pointerId, machine: bottle.machine, bottleId: bottle.id, mesh: bottle.mesh,
      x: event.clientX, y: event.clientY, grabbed: false, cancelled: false,
      controlsEnabled: controls.enabled, samples: [],
    };
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'progress';
    showHint('长按拾起饮料');
    holdTimer = setTimeout(() => {
      const current = gesture;
      if (!current || current.cancelled || !canInteract() || !current.machine.grabBottle(current.bottleId)) {
        finish(true);
        return;
      }
      current.grabbed = true;
      const position = current.mesh.getWorldPosition(new THREE.Vector3());
      camera.getWorldDirection(direction);
      plane.setFromNormalAndCoplanarPoint(direction, position);
      setRay(current.x, current.y);
      offset.set(0, 0, 0);
      if (raycaster.ray.intersectPlane(plane, point)) offset.copy(position).sub(point);
      canvas.style.cursor = 'grabbing';
      moveHeld(current.x, current.y);
    }, HOLD_MS);
  }

  function onMove(event: PointerEvent): void {
    const current = gesture;
    if (!current || current.id !== event.pointerId) return;
    consume(event);
    if (current.grabbed) moveHeld(event.clientX, event.clientY);
    else if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > MOVE_TOLERANCE) {
      clearTimeout(holdTimer);
      current.cancelled = true;
      showHint('按住片刻再拖动饮料');
    }
  }

  function onUp(event: PointerEvent): void {
    if (gesture?.id !== event.pointerId) return;
    consume(event);
    if (gesture.grabbed) moveHeld(event.clientX, event.clientY);
    finish(false);
  }
  function onCancel(event: PointerEvent): void {
    if (gesture?.id !== event.pointerId) return;
    consume(event);
    finish(true);
  }
  const onBlur = () => finish(true);
  const onHidden = () => { if (document.hidden) finish(true); };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && gesture) finish(true); };
  const onLostCapture = () => finish(true);
  const onContextMenu = (event: Event) => { if (gesture) event.preventDefault(); };
  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onCancel, true);
  canvas.addEventListener('lostpointercapture', onLostCapture);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('blur', onBlur);
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onHidden);

  return {
    isActive: () => Boolean(gesture),
    notifyAvailable: () => showHint('饮料掉落后可长按拖动 · 投入垃圾桶即可回收', true),
    destroy() {
      finish(true);
      clearTimeout(hintTimer);
      hint.remove();
      binHighlight.removeFromParent();
      binHighlight.geometry.dispose();
      (binHighlight.material as THREE.Material).dispose();
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointercancel', onCancel, true);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHidden);
    },
  };
}
