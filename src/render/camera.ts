/** 相机：自由轨道（拖拽旋转 / 滚轮缩放 / 右键平移），无任何 UI。 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraRig {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  update: (dt: number) => void;
  focus: (object: THREE.Object3D, onArrival: () => void) => void;
  cancelFocus: () => void;
  reset: () => void;
  isFocusing: () => boolean;
  getMode: () => 'orbit' | 'first-person';
  setMode: (mode: 'orbit' | 'first-person') => void;
}

export function createCameraRig(canvas: HTMLCanvasElement): CameraRig {
  const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.5, 140);
  // 机位要把「店角」和「左下角的樱花树」同时框进来：
  // 树移到板块左下角后，原来那组以店角为中心的机位会把树整个切出画面，
  // 用户既看不到树、也点不开樱花参数面板。
  // 因此相机左移、目标点跟着左移，并把距离略微拉远。
  camera.position.set(9.6, 12.4, 17.6);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(-2.6, 0.9, 0.6);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.58;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.55;
  controls.minDistance = 8;
  controls.maxDistance = 60;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.enablePan = true;
  controls.screenSpacePanning = false;
  controls.autoRotate = false;

  /**
   * 竖屏/手机上，28° 的窄视角会把微缩模型裁得只剩店角，
   * 默认机位看起来像"相机卡在墙里"。这里按宽高比把机位往后退、
   * 视角放宽一点 —— 竖屏首屏要同时看到招牌、店角和左下角的樱花树，
   * 用户再自己缩放。
   *
   * 关键：目标点必须和桌面端一致地偏向 -x。
   * 原来这里设成 (0.4, 1.15, -0.2)（偏店角），竖屏横向视野本来就窄，
   * 树直接被挤到画面外，用户连点都点不到。
   * 初始化和主动归位时计算；拖拽、缩放及窗口变化不会自动拉回镜头。
   */
  const homeView = () => {
    const position = new THREE.Vector3(9.6, 12.4, 17.6);
    const target = new THREE.Vector3(-2.6, 0.9, 0.6);
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    if (aspect >= 0.82) return { position, target, fov: 28 };
    const dir = position.clone().sub(target);
    // 竖屏更窄，需要退得更远才能同时装下店铺和树；上限提到 1.9
    const k = Math.min(1.9, 1.15 / Math.max(0.4, aspect));
    dir.multiplyScalar(k);
    target.set(-2.6, 1.1, 0.6);
    return { position: target.clone().add(dir), target, fov: 32 };
  };
  const initial = homeView();
  camera.position.copy(initial.position);
  controls.target.copy(initial.target);
  camera.fov = initial.fov;
  camera.updateProjectionMatrix();

  controls.update();

  let mode: 'orbit' | 'first-person' = 'orbit';
  let flight: {
    from: THREE.Vector3; to: THREE.Vector3;
    fromTarget: THREE.Vector3; target: THREE.Vector3;
    elapsed: number; duration: number; enabled: boolean;
    onArrival: () => void;
  } | null = null;
  const cancelFocus = (): void => {
    if (!flight) return;
    controls.enabled = flight.enabled;
    flight = null;
  };

  return {
    camera,
    controls,
    getMode: () => mode,
    setMode(next) {
      cancelFocus();
      mode = next;
      controls.enabled = next === 'orbit';
    },
    cancelFocus,
    reset() {
      cancelFocus();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      mode = 'orbit';
      controls.enabled = true;
      controls.autoRotate = false;
      // Clear accumulated rotation/pan inertia before starting the return flight.
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = damping;
      controls.minDistance = 8;
      const home = homeView();
      camera.fov = home.fov;
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      flight = {
        from: camera.position.clone(), to: home.position,
        fromTarget: controls.target.clone(), target: home.target,
        elapsed: 0,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.85,
        enabled: true, onArrival: () => {},
      };
      controls.enabled = false;
    },
    isFocusing: () => flight !== null,
    focus(object, onArrival) {
      cancelFocus();
      // Pointer lock also covers first-person controllers added outside this rig.
      if (mode === 'first-person' || document.pointerLockElement === canvas) {
        onArrival();
        return;
      }
      object.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(object);
      if (bounds.isEmpty()) { onArrival(); return; }
      const target = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const direction = camera.position.clone().sub(target);
      const previousDistance = direction.length();
      if (previousDistance < 0.001) direction.set(0, 0.4, 1);
      direction.normalize();
      // Keep the approach on the clicked side; account for narrow mobile viewports.
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const fit = Math.max(size.y, Math.max(size.x, size.z) / camera.aspect) /
        (2 * Math.tan(halfFov)) * 1.15;
      const distance = Math.max(2, Math.min(previousDistance, fit));
      controls.minDistance = Math.min(controls.minDistance, distance, 2);
      // Flush orbit inertia before taking over the camera.
      const damping = controls.enableDamping;
      const rotate = controls.autoRotate;
      controls.enableDamping = false;
      controls.autoRotate = false;
      controls.update();
      controls.enableDamping = damping;
      controls.autoRotate = rotate;
      flight = {
        from: camera.position.clone(), to: target.clone().addScaledVector(direction, distance),
        fromTarget: controls.target.clone(), target, elapsed: 0,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.85,
        enabled: controls.enabled, onArrival,
      };
      controls.enabled = false;
    },
    update(dt) {
      if (flight) {
        const current = flight;
        current.elapsed += dt;
        const t = current.duration ? Math.min(1, current.elapsed / current.duration) : 1;
        const eased = t * t * t * (t * (t * 6 - 15) + 10);
        camera.position.lerpVectors(current.from, current.to, eased);
        controls.target.lerpVectors(current.fromTarget, current.target, eased);
        camera.lookAt(controls.target);
        if (t === 1) {
          cancelFocus();
          current.onArrival();
        }
      } else if (mode === 'orbit' && controls.enabled && document.pointerLockElement !== canvas) {
        controls.update();
      }
    },
  };
}
