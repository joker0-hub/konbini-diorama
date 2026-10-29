/** 相机：自由轨道（拖拽旋转 / 滚轮缩放 / 右键平移），无任何 UI。 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraRig {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  update: (dt: number) => void;
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
   * 只在初始化时做一次：之后用户拖拽/缩放不再被强制拉回。
   */
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  if (aspect < 0.82) {
    const dir = camera.position.clone().sub(controls.target);
    // 竖屏更窄，需要退得更远才能同时装下店铺和树；上限提到 1.9
    const k = Math.min(1.9, 1.15 / Math.max(0.4, aspect));
    dir.multiplyScalar(k);
    controls.target.set(-2.6, 1.1, 0.6);
    camera.position.copy(controls.target).add(dir);
    camera.fov = 32;
    camera.updateProjectionMatrix();
  }

  controls.update();

  return {
    camera,
    controls,
    update() {
      controls.update();
    },
  };
}
