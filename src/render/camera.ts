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
  camera.position.set(11.0, 11.2, 15.2);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(-0.8, 0.8, -1.2);
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
   * 视角放宽一点，并把目标移到店角与信号灯之间 —— 竖屏首屏能同时看到
   * 招牌、店角和红绿灯，用户再自己缩放。
   *
   * 只在初始化时做一次：之后用户拖拽/缩放不再被强制拉回。
   */
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  if (aspect < 0.82) {
    const dir = camera.position.clone().sub(controls.target);
    const k = Math.min(1.35, 1.0 / Math.max(0.4, aspect));
    dir.multiplyScalar(k);
    controls.target.set(0.4, 1.15, -0.2);
    camera.position.copy(controls.target).add(dir);
    camera.fov = 30;
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
