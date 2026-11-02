import * as THREE from 'three';
import { addBox, addCyl, addMesh, group, noOutline } from '../core/geom';
import { RAMP_SOFT, toon } from '../core/materials';

type BinKind = 'mixed' | 'paper' | 'cans' | 'pet';
interface BinOptions {
  width: number;
  height: number;
  depth: number;
  color: number;
  kind: BinKind;
  name?: string;
}

const kinds: BinKind[] = ['mixed', 'paper', 'cans', 'pet'];
let labelMaterial: THREE.MeshToonMaterial | undefined;
const labelGeometries = new Map<string, THREE.PlaneGeometry>();

/** One shared atlas keeps all five bins' signs in the same static material batch. */
function labels(): THREE.MeshToonMaterial {
  if (labelMaterial) return labelMaterial;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const c = canvas.getContext('2d')!;
  const titles = ['びん・缶', '燃えるごみ', '缶・びん', 'ペットボトル'];
  const english = ['BOTTLES / CANS', 'BURNABLE', 'CANS / GLASS', 'PET BOTTLES'];
  const colors = ['#34669b', '#397c64', '#436d9a', '#b9783d'];
  const font = '"Yu Gothic", "Microsoft YaHei", sans-serif';
  kinds.forEach((kind, i) => {
    c.save();
    c.translate((i % 2) * 512, Math.floor(i / 2) * 512);
    c.fillStyle = '#eeeadd'; c.fillRect(0, 0, 512, 512);
    c.fillStyle = colors[i]; c.fillRect(0, 0, 512, 18);
    c.textAlign = 'center';
    c.fillStyle = '#596465'; c.font = `600 21px ${font}`;
    c.fillText('HOSHINO  /  SORT & RECYCLE', 256, 58);
    c.strokeStyle = colors[i]; c.fillStyle = colors[i];
    c.lineWidth = 12; c.lineJoin = 'round'; c.lineCap = 'round';
    const bottle = (x: number) => {
      c.beginPath(); c.moveTo(x - 20, 112); c.lineTo(x + 20, 112);
      c.lineTo(x + 20, 144); c.lineTo(x + 42, 170); c.lineTo(x + 42, 275);
      c.quadraticCurveTo(x + 42, 286, x + 30, 286); c.lineTo(x - 30, 286);
      c.quadraticCurveTo(x - 42, 286, x - 42, 275); c.lineTo(x - 42, 170);
      c.lineTo(x - 20, 144); c.closePath(); c.stroke();
      c.fillRect(x - 24, 97, 48, 14);
      c.fillRect(x - 32, 201, 64, 42);
    };
    const can = (x: number) => {
      c.strokeRect(x - 43, 153, 86, 130);
      c.beginPath(); c.ellipse(x, 153, 43, 11, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(x - 25, 255); c.lineTo(x + 25, 255); c.stroke();
    };
    if (kind === 'paper') {
      c.strokeRect(190, 119, 119, 154);
      c.beginPath(); c.moveTo(174, 142); c.lineTo(174, 292); c.lineTo(293, 292); c.stroke();
      for (const y of [155, 186, 217, 248]) {
        c.beginPath(); c.moveTo(212, y); c.lineTo(283, y); c.stroke();
      }
    } else if (kind === 'pet') bottle(256);
    else { bottle(193); can(322); }
    c.fillStyle = '#263e44'; c.font = `700 ${kind === 'pet' ? 44 : 51}px ${font}`;
    c.fillText(titles[i], 256, 362);
    c.fillStyle = colors[i]; c.font = `700 24px ${font}`;
    c.fillText(english[i], 256, 405);
    c.fillStyle = '#7c8581'; c.fillRect(48, 434, 416, 2);
    c.font = `500 19px ${font}`;
    c.fillText('分別にご協力ください  ·  ' + String(i + 1).padStart(2, '0'), 256, 476);
    c.restore();
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  labelMaterial = toon(0xffffff, { map: texture, ramp: RAMP_SOFT });
  return labelMaterial;
}

function labelGeometry(kind: BinKind, width: number, height: number): THREE.PlaneGeometry {
  const key = `${kind}:${width}:${height}`;
  const cached = labelGeometries.get(key);
  if (cached) return cached;
  const geometry = new THREE.PlaneGeometry(width, height);
  const uv = geometry.attributes.uv;
  const i = kinds.indexOf(kind);
  // A small inset prevents neighbouring atlas tiles bleeding into mip levels.
  for (let n = 0; n < uv.count; n++) {
    uv.setXY(n, (i % 2) * 0.5 + 0.004 + uv.getX(n) * 0.492,
      (1 - Math.floor(i / 2)) * 0.5 + 0.004 + uv.getY(n) * 0.492);
  }
  labelGeometries.set(key, geometry);
  return geometry;
}

/** Grounded, front-loading bin. Dimensions include the lid, rim and feet. */
export function buildRecyclingBin(parent: THREE.Object3D, x: number, z: number, options: BinOptions): THREE.Group {
  const { width: w, height: h, depth: d, color, kind } = options;
  const root = group(parent, x, 0, z, options.name ?? `recycling-bin-${kind}`);
  const shell = toon(color, { ramp: RAMP_SOFT });
  const dark = toon(0x25343b, { ramp: RAMP_SOFT });
  const recess = toon(0x101c23);
  const cream = toon(0xe3e4d9, { ramp: RAMP_SOFT });
  const metal = toon(0x99aaa9, { ramp: RAMP_SOFT });
  const front = d / 2;
  const faceZ = front - 0.022;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) addBox(root, dark, w * 0.17, 0.028, d * 0.17,
      sx * w * 0.32, 0, sz * d * 0.30, { r: 0.006 });
  }
  addBox(root, dark, w * 0.94, 0.055, d * 0.94, 0, 0.025, 0, { r: 0.016 });
  addBox(root, shell, w * 0.94, h * 0.60, d * 0.91, 0, 0.064, -d * 0.015, { r: 0.023 });

  // Side and rear walls leave an actual empty chamber behind the apertures.
  for (const sx of [-1, 1]) {
    addBox(root, shell, 0.023, h * 0.31, d * 0.91, sx * (w * 0.47 - 0.012), h * 0.63, -d * 0.015, { r: 0.006 });
    addBox(root, dark, 0.008, 0.037, d * 0.30, sx * (w * 0.47 + 0.001), h * 0.57, -d * 0.03, { r: 0.003, cast: false });
    addBox(root, metal, 0.010, 0.009, d * 0.24, sx * (w * 0.47 + 0.002), h * 0.598, -d * 0.03, { cast: false });
    for (let n = 0; n < 3; n++) addBox(root, dark, 0.005, 0.006, d * 0.30,
      sx * (w * 0.47 + 0.001), h * 0.16 + n * 0.018, -d * 0.04, { cast: false });
  }
  addBox(root, shell, w * 0.91, h * 0.31, 0.021, 0, h * 0.63, -d * 0.45, { r: 0.006 });
  addBox(root, recess, w * 0.82, h * 0.28, 0.012, 0, h * 0.65, -d * 0.29, { cast: false });

  // A perforated face with extruded edges, instead of black circles over a solid box.
  const face = new THREE.Shape();
  const faceBottom = h * 0.65;
  const faceTop = h * 0.94;
  face.moveTo(-w * 0.45, faceBottom); face.lineTo(w * 0.45, faceBottom);
  face.lineTo(w * 0.45, faceTop); face.lineTo(-w * 0.45, faceTop); face.closePath();
  const mouthY = h * 0.79;
  if (kind === 'paper') {
    const hole = new THREE.Path();
    const hw = w * 0.30, hh = h * 0.044;
    hole.moveTo(-hw, mouthY - hh); hole.lineTo(-hw, mouthY + hh);
    hole.lineTo(hw, mouthY + hh); hole.lineTo(hw, mouthY - hh); hole.closePath();
    face.holes.push(hole);
    addBox(root, dark, w * 0.60, 0.013, d * 0.22, 0, mouthY - hh - 0.008, faceZ - d * 0.11, { cast: false });
    addBox(root, metal, w * 0.65, 0.009, 0.024, 0, mouthY - hh - 0.005, faceZ, { cast: false });
  } else {
    const dual = kind === 'mixed';
    const radius = w * (dual ? 0.155 : 0.215);
    for (const mx of dual ? [-w * 0.235, w * 0.235] : [0]) {
      const hole = new THREE.Path();
      hole.absarc(mx, mouthY, radius, 0, Math.PI * 2, true);
      face.holes.push(hole);
      addMesh(root, new THREE.TorusGeometry(radius + 0.002, 0.007, 6, 24), metal,
        mx, mouthY, faceZ + 0.017, { cast: false });
      const throat = new THREE.CylinderGeometry(radius, radius * 0.87, d * 0.23, 24, 1, true);
      addMesh(root, throat, toon(0x25343b, { side: THREE.DoubleSide, ramp: RAMP_SOFT }),
        mx, mouthY, faceZ - d * 0.10, { rx: Math.PI / 2, cast: false });
    }
  }
  addMesh(root, new THREE.ExtrudeGeometry(face, { depth: 0.014, bevelEnabled: false, curveSegments: 16 }),
    cream, 0, 0, faceZ, { name: 'bin-aperture-panel' });
  // A gasket and overhanging rain lid read clearly even at the wide scene view.
  addBox(root, dark, w * 0.98, 0.014, d * 0.98, 0, h - 0.054, 0, { r: 0.012 });
  addBox(root, shell, w, 0.040, d, 0, h - 0.040, 0, { r: 0.017 });
  addBox(root, cream, w * 0.87, 0.009, 0.018, 0, h - 0.047, front - 0.009, { r: 0.003, cast: false });

  // Service door: dark reveal, painted inset, flush sign and small working hardware.
  addBox(root, dark, w * 0.81, h * 0.49, 0.010, 0, h * 0.12, front - 0.028, { r: 0.016, cast: false });
  addBox(root, shell, w * 0.77, h * 0.475, 0.012, 0, h * 0.128, front - 0.022, { r: 0.014, cast: false });
  const sign = addMesh(root, labelGeometry(kind, w * 0.64, h * 0.275), labels(),
    0, h * 0.405, front - 0.014, { cast: false, receive: false, name: 'bin-sorting-label' });
  noOutline(sign);
  addBox(root, dark, w * 0.24, 0.025, 0.009, 0, h * 0.196, front - 0.012, { r: 0.005, cast: false });
  addBox(root, metal, w * 0.20, 0.008, 0.011, 0, h * 0.218, front - 0.009, { r: 0.003, cast: false });
  for (const hy of [0.20, 0.53]) addCyl(root, metal, 0.008, 0.008, h * 0.065,
    -w * 0.395, h * hy, front - 0.016, { seg: 8, cast: false });
  addMesh(root, new THREE.CircleGeometry(0.009, 12), metal, w * 0.31, h * 0.215, front - 0.008, { cast: false });
  addBox(root, recess, 0.0025, 0.009, 0.002, w * 0.31, h * 0.215 - 0.0045, front - 0.006, { cast: false });
  return root;
}
