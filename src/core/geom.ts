import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/* ---------------------------------------------------------------
 * 几何工厂：所有尺寸单位 = 1m，y 轴向上。
 * 约定：addBox / addCyl 的 y 传入的是「底面高度」，内部转成中心高度，
 * 这样摆放地面上的家具时不用一直心算 /2。
 * --------------------------------------------------------------- */

const geoCache = new Map<string, THREE.BufferGeometry>();

export function boxGeo(w: number, h: number, d: number, r = 0): THREE.BufferGeometry {
  const key = r > 0 ? `rb:${w}:${h}:${d}:${r}` : `b:${w}:${h}:${d}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  let g: THREE.BufferGeometry;
  if (r > 0) {
    const rr = Math.min(r, Math.min(w, h, d) * 0.45);
    g = new RoundedBoxGeometry(w, h, d, 2, rr);
  } else {
    g = new THREE.BoxGeometry(w, h, d);
  }
  geoCache.set(key, g);
  return g;
}

export function cylGeo(rt: number, rb: number, h: number, seg = 20): THREE.BufferGeometry {
  const key = `c:${rt}:${rb}:${h}:${seg}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  geoCache.set(key, g);
  return g;
}

export function sphereGeo(r: number, seg = 16): THREE.BufferGeometry {
  const key = `s:${r}:${seg}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, Math.floor(seg * 0.6)));
  geoCache.set(key, g);
  return g;
}

export function planeGeo(w: number, h: number): THREE.BufferGeometry {
  const key = `p:${w}:${h}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = new THREE.PlaneGeometry(w, h);
  geoCache.set(key, g);
  return g;
}

/**
 * 按世界尺寸平铺的平面：UV 直接乘 tile 数，材质里的 repeat 保持 1。
 * 这样同一张贴图可以被不同大小的地面共享，不会拉伸。
 */
export function uvPlaneGeo(w: number, h: number, tile: number): THREE.BufferGeometry {
  const key = `up:${w}:${h}:${tile}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  }
  uv.needsUpdate = true;
  geoCache.set(key, g);
  return g;
}

/** 平铺于 XZ 平面的多边形（points 为 [x,z]），UV 按整块底座归一化。 */
export function flatPolygon(points: [number, number][], extent = 18): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) + extent / 2) / extent;
    uv[i * 2 + 1] = (pos.getZ(i) + extent / 2) / extent;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export interface PlaceOpts {
  ry?: number;
  rx?: number;
  rz?: number;
  cast?: boolean;
  receive?: boolean;
  name?: string;
}

function apply(m: THREE.Mesh, o: PlaceOpts = {}): THREE.Mesh {
  m.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
  m.castShadow = o.cast ?? true;
  m.receiveShadow = o.receive ?? true;
  if (o.name) m.name = o.name;
  return m;
}

/** 以「底面 y」放置的盒体。 */
export function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  yBottom: number,
  z: number,
  o: PlaceOpts & { r?: number } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo(w, h, d, o.r), material);
  m.position.set(x, yBottom + h / 2, z);
  apply(m, o);
  parent.add(m);
  return m;
}

/** 以「底面 y」放置的圆柱。 */
export function addCyl(
  parent: THREE.Object3D,
  material: THREE.Material,
  rt: number,
  rb: number,
  h: number,
  x: number,
  yBottom: number,
  z: number,
  o: PlaceOpts & { seg?: number } = {},
): THREE.Mesh {
  const m = new THREE.Mesh(cylGeo(rt, rb, h, o.seg ?? 20), material);
  m.position.set(x, yBottom + h / 2, z);
  apply(m, o);
  parent.add(m);
  return m;
}

export function addMesh(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  o: PlaceOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  apply(m, o);
  parent.add(m);
  return m;
}

/** 平放于地面的面片（接收阴影、不投影）。 */
/** 平铺平面（地面、人行道、湿痕），自带 UV 缩放。 */
export function addTiled(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  d: number,
  tile: number,
  x: number,
  y: number,
  z: number,
  o: PlaceOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(uvPlaneGeo(w, d, tile), material);
  m.rotation.x = -Math.PI / 2;
  m.rotation.y = o.ry ?? 0;
  m.rotation.z = o.rz ?? 0;
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = o.receive ?? true;
  parent.add(m);
  return m;
}

export function addFlat(
  parent: THREE.Object3D,
  material: THREE.Material,
  w: number,
  d: number,
  x: number,
  y: number,
  z: number,
  o: PlaceOpts = {},
): THREE.Mesh {
  const m = new THREE.Mesh(planeGeo(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = o.rz ?? 0;
  m.rotation.y = o.ry ?? 0;
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = o.receive ?? true;
  parent.add(m);
  return m;
}

export function group(parent: THREE.Object3D, x = 0, y = 0, z = 0, name = ''): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.name = name;
  parent.add(g);
  return g;
}

export function setLayer(obj: THREE.Object3D, layer: number): void {
  obj.traverse((o) => o.layers.set(layer));
}

/** 让整棵树不参与描边法线预渲染（玻璃、雨、辉光等）。 */
export function noOutline(obj: THREE.Object3D): void {
  setLayer(obj, 1);
}

type Vec3 = [number, number, number];

/**
 * 用细长体连接两点（电线杆横担、自行车车架、栏杆、信号灯横臂等）。
 *
 * 注意方向约定：
 * - `round=false` 用盒子，盒子长轴是 local +Z，所以 `lookAt(bv)` 正好对上；
 * - `round=true` 用圆柱，圆柱长轴是 local +Y。以前这里也直接 `lookAt(bv)`，
 *   会把圆柱"横着立起来"：信号灯横臂变成一根竖杆、自行车车架变成几片立着的圆片。
 *   现在用 from-Y-to-direction 的四元数，把圆柱轴真正对齐到 a→b。
 */
export function strut(
  parent: THREE.Object3D,
  material: THREE.Material,
  a: Vec3,
  b: Vec3,
  thickness: number,
  round = false,
): THREE.Mesh {
  const av = new THREE.Vector3(...a);
  const bv = new THREE.Vector3(...b);
  const dir = bv.clone().sub(av);
  const len = dir.length();
  const g = round ? cylGeo(thickness / 2, thickness / 2, len, 8) : boxGeo(thickness, thickness, len);
  const m = new THREE.Mesh(g, material);
  m.position.copy(av).add(bv).multiplyScalar(0.5);
  if (round) {
    if (len > 1e-6) {
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }
  } else {
    m.lookAt(bv);
  }
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** 悬垂电线（CatmullRom 采样点）。 */
export function sagWire(a: Vec3, b: Vec3, sag: number, steps = 10): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const y = a[1] + (b[1] - a[1]) * t - Math.sin(Math.PI * t) * sag;
    const z = a[2] + (b[2] - a[2]) * t;
    pts.push(new THREE.Vector3(x, y, z));
  }
  return pts;
}
