import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ProductKind } from './products';

const bodies = new Map<string, THREE.BufferGeometry>();
const details = new Map<string, THREE.BufferGeometry>();
const rounded = (w: number, h: number, d: number, radius = 0.04, lowDetail = false) =>
  new RoundedBoxGeometry(w, h, d, lowDetail ? 1 : 2, radius);

function lathe(points: number[][], lowDetail: boolean): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), lowDetail ? 10 : 20);
  const uv = geo.getAttribute('uv');
  const position = geo.getAttribute('position');
  // Map by physical height so shoulder profile points do not stretch the label.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + 0.5, position.getY(i) + 0.5);
  return geo;
}

/** Unit envelopes: bottom -0.5, top +0.5; actual dimensions come from ProductSpec. */
export function productGeometry(kind: ProductKind, lowDetail = false): THREE.BufferGeometry {
  const key = `${kind}:${lowDetail}`;
  const hit = bodies.get(key);
  if (hit) return hit;
  let geo: THREE.BufferGeometry;
  switch (kind) {
    case 'bottle':
      geo = lathe([[0,-0.5],[0.35,-0.5],[0.46,-0.47],[0.49,-0.4],
        [0.49,0.14],[0.46,0.23],[0.25,0.34],[0.19,0.37],[0.19,0.44],[0,0.44]], lowDetail);
      break;
    case 'can':
      geo = lathe([[0,-0.5],[0.4,-0.5],[0.47,-0.46],[0.49,-0.4],
        [0.49,0.39],[0.45,0.45],[0.44,0.48],[0,0.48]], lowDetail);
      break;
    case 'cup':
      geo = lathe([[0,-0.5],[0.33,-0.5],[0.37,-0.46],[0.47,0.4],[0.49,0.44],[0,0.44]], lowDetail);
      break;
    case 'chips': {
      geo = rounded(1, 1, 1, 0.16, lowDetail);
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const pinch = 0.25 + 0.75 * Math.pow(Math.cos(y * Math.PI), 0.55);
        pos.setZ(i, pos.getZ(i) * pinch);
        pos.setX(i, pos.getX(i) * (0.9 + 0.1 * Math.cos(y * Math.PI)));
      }
      geo.computeVertexNormals();
      break;
    }
    case 'onigiri':
    case 'sandwich':
    case 'bread':
    case 'bento':
      // Food geometry is colored; only the small wrapper sticker carries this map.
      geo = new THREE.PlaneGeometry(kind === 'bento' ? 0.38 : 0.48, kind === 'bento' ? 0.28 : 0.3);
      if (kind === 'bento') { geo.rotateX(-Math.PI / 2); geo.translate(0.12, 0.48, 0.1); }
      else geo.translate(0, kind === 'onigiri' ? -0.16 : -0.18, 0.505);
      break;
    case 'carton': geo = new THREE.BoxGeometry(1, 0.8, 1).translate(0, -0.1, 0); break;
    default: geo = lowDetail ? new THREE.BoxGeometry(1, 1, 1) : rounded(1, 1, 1, 0.035);
  }
  bodies.set(key, geo);
  return geo;
}

export function productDetails(kind: ProductKind, variant: number, lowDetail = false): THREE.BufferGeometry | null {
  if (kind === 'box') return null;
  const key = `${kind}:${variant}:${lowDetail}`;
  const hit = details.get(key);
  if (hit) return hit;
  const parts: THREE.BufferGeometry[] = [];
  function part(geometry: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    g.translate(x, y, z);
    const rgb = new THREE.Color(color);
    const colors = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = rgb.r; colors[i+1] = rgb.g; colors[i+2] = rgb.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
    part(new THREE.BoxGeometry(w, h, d), color, x, y, z);
  }
  function disc(r: number, h: number, color: number, y: number) {
    part(new THREE.CylinderGeometry(r, r, h, lowDetail ? 10 : 20), color, 0, y);
  }
  function prism(color: number, depth: number, y = 0, scale = 1, z = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.49 * scale, -0.49 * scale);
    shape.lineTo(0.49 * scale, -0.49 * scale);
    shape.lineTo(0, 0.49 * scale);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true,
      bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, steps: 1 });
    part(geo, color, 0, y, z - depth / 2);
  }
  if (kind === 'bottle') {
    const cap = [0x2f6bd8,0x3c7a3c,0xeee6d7][variant];
    disc(0.22, 0.08, cap, 0.46);
    disc(0.23, 0.018, cap, 0.405);
    for (const y of lowDetail ? [] : [-0.39,-0.31,0.1])
      part(new THREE.TorusGeometry(0.487,0.009,4,20).rotateX(Math.PI/2),0xc8d9d7,0,y);
    for (let i=0;i<(lowDetail ? 0 : 16);i++) {
      const a=i*Math.PI/8;
      box(0.018,0.06,0.018,0xd7dce0,Math.cos(a)*0.216,0.462,Math.sin(a)*0.216);
    }
  } else if (kind === 'can') {
    disc(0.448,0.014,0xa7b1b6,0.474);
    disc(0.42,0.008,0xcfd4d5,0.484);
    part(new THREE.TorusGeometry(0.443,0.016,lowDetail ? 3 : 5,lowDetail ? 10 : 20).rotateX(Math.PI/2),0xe2e5e4,0,0.48);
    box(0.12,0.012,0.19,0x505c63,0,0.495,0.13);
    part(new THREE.TorusGeometry(0.065,0.018,5,12).rotateX(Math.PI/2).scale(1,1,1.5),0xe7e8e5,0,0.498,-0.02);
  } else if (kind === 'cup') {
    disc(0.495,0.036,0xe3d9c4,0.455);
    disc(0.476,0.012,[0xbb3528,0x327ba8,0xb47d2a][variant],0.48);
    disc(0.37,0.012,0xfff3d7,0.49);
    box(0.19,0.014,0.1,0xe4d7b9,0,0.49,0.43);
    for (let i=0;i<4;i++) box(0.45,0.004,0.016,0xbd552f,0,0.499,-0.16+i*0.09);
  } else if (kind === 'chips') {
    for (const y of [-0.475,0.475]) {
      box(0.94,0.045,0.12,[0x922e23,0x155a2e,0x183a7c,0x9a6408][variant],0,y);
      const crimps = lowDetail ? 7 : 14;
      for (let i=0;i<crimps;i++) box(0.012,0.035,0.012,0xe6c99b,-0.43+i*0.86/(crimps-1),y,0.064);
    }
  } else if (kind === 'onigiri') {
    prism(0xf3efda,0.82);
    // Nori continues underneath the rice; red opening tape and triangular pull tab.
    box(0.41,0.55,0.027,0x20382d,0,-0.215,0.435);
    box(0.41,0.035,0.85,0x20382d,0,-0.475);
    box(0.026,0.76,0.012,0xd25237,0,0.04,0.46);
    box(0.13,0.07,0.09,0xd25237,0,0.445,0.03);
    for (let i=0;i<22;i++) {
      const y=-0.33+(i%6)*0.1, x=((i*7)%11-5)*0.045;
      if (Math.abs(x)<(0.49-y)*0.45) box(0.025,0.035,0.018,0xfffcf0,x,y,0.422);
    }
  } else if (kind === 'sandwich') {
    // Actual cut-face layers within the triangular wrapper.
    const layers: [number, number, number][] = [
      [-0.49,-0.43,0xc18b4c],[-0.43,-0.25,0xffefc9],
      [-0.25,-0.14,variant === 0 ? 0xf2cd57 : 0xe9a18f],
      [-0.14,-0.07,0x72a148],[-0.07,0.07,0xf1d571],
      [0.07,0.43,0xffefc9],[0.43,0.49,0xc18b4c],
    ];
    for (const [bottom,top,color] of layers) {
      const shape = new THREE.Shape();
      const wb = (0.49-bottom)*0.5, wt = (0.49-top)*0.5;
      shape.moveTo(-wb,bottom);shape.lineTo(wb,bottom);
      shape.lineTo(wt,top);shape.lineTo(-wt,top);shape.closePath();
      part(new THREE.ExtrudeGeometry(shape,{depth:0.94,bevelEnabled:false}),color,0,0,-0.47);
    }
    box(0.98,0.025,0.98,0xe4dfcf,0,-0.487);
  } else if (kind === 'bento') {
    part(rounded(1,0.28,1,0.035,lowDetail),0x252d2a,0,-0.36);
    box(0.96,0.13,0.94,0x161d1b,0,-0.18);
    box(0.46,0.39,0.78,0xf6f0d8,-0.22,0.02);
    box(0.025,0.35,0.84,0x333d32,0.04,-0.02);
    if (variant === 0) box(0.39,0.035,0.62,0x263c2e,-0.22,0.23);
    else part(new THREE.SphereGeometry(0.045,8,6),0xad3534,-0.23,0.24,0.04);
    for (let i=0;i<3;i++) {
      if (variant === 2) box(0.27,0.22,0.24,0xe39167,0.27,0.13,-0.25+i*0.23);
      else part(new THREE.SphereGeometry(1,10,7).scale(0.15,0.19,0.15),0xc68c40,0.26,0.08,-0.26+i*0.23);
    }
    box(0.18,0.19,0.16,0x679045,0.3,0.1,0.32);
    box(0.18,0.17,0.14,0xe8ba47,0.06,0.1,0.32);
    // Raised lid rim and a fine highlight suggest the clear thermoformed cover.
    for (const x of [-0.48,0.48]) box(0.018,0.13,0.96,0xc7d7d4,x,0.36);
    for (const z of [-0.48,0.48]) box(0.94,0.13,0.018,0xc7d7d4,0,0.36,z);
    box(0.012,0.012,0.7,0xf2f6e9,-0.43,0.43);
  } else if (kind === 'bread') {
    box(0.98,0.03,0.98,0xe1d1ad,0,-0.48);
    part(new THREE.SphereGeometry(1,lowDetail ? 10 : 20,lowDetail ? 6 : 12).scale(0.46,0.47,0.44),[0xd9b66d,0xa9652e,0xe3ba71][variant],0,-0.01);
    if (variant === 0) {
      for (let i=-2;i<=2;i++) {
        const y=0.15+i*0.105;
        box(0.65,0.014,0.015,0xf2d799,0,y,0.39-Math.abs(i)*0.035);
        box(0.014,0.58,0.015,0xf2d799,i*0.12,0.08,0.39-Math.abs(i)*0.035);
      }
    } else {
      for (let i=0;i<12;i++) box(0.02,0.018,0.016,0x633a22,Math.sin(i*2.4)*0.16,0.14+Math.cos(i*2.4)*0.12,0.407);
    }
    for (const x of [-0.47,0.47]) box(0.025,0.9,0.015,0xe4ddca,x,0,0.46);
  } else if (kind === 'carton') {
    // Gable prism, with a folded sealing ridge.
    const shape = new THREE.Shape();
    shape.moveTo(-0.5,0.3); shape.lineTo(0,0.47); shape.lineTo(0.5,0.3); shape.closePath();
    part(new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false}),[0xcee0f5,0xf6bac9,0xcda779][variant],0,0,-0.5);
    box(0.035,0.04,1,0xf7f1dc,0,0.48);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  details.set(key, merged);
  return merged;
}
