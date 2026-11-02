/** Japanese city bicycle, in the original 1 m wheelbase and parking envelope. */
import * as THREE from 'three';
import { addBox, addCyl, addMesh, group, noOutline, strut } from '../core/geom';
import { toon } from '../core/materials';
import { mergeStaticMeshes } from './merge';

type Point = [number, number, number];

export function buildBicycle(parent: THREE.Object3D, x: number, y: number, z: number, ry: number): THREE.Group {
  const g = group(parent, x, y, z, 'bicycle');
  g.rotation.y = ry;
  const paint = toon(0x2a3850);
  const rubber = toon(0x20252a);
  const tire = toon(0x171a1f);
  const chrome = toon(0xb8c2c7);
  const steel = toon(0x78858e);
  const alloy = toon(0xd2d7d4);
  const cream = toon(0xe7ddc7);
  const amber = toon(0xe6ab39);
  const red = toon(0xb83c32);
  const lens = toon(0xf6efd3);

  const rod = (p: THREE.Object3D, mat: THREE.Material, a: Point, b: Point, diameter: number, fine = false) => {
    const m = strut(p, mat, a, b, diameter, true);
    m.castShadow = !fine;
    if (fine) noOutline(m);
    return m;
  };
  const curve = (p: THREE.Object3D, mat: THREE.Material, pts: Point[], radius: number, fine = false) => {
    const path = new THREE.CatmullRomCurve3(pts.map(v => new THREE.Vector3(...v)));
    const m = addMesh(p, new THREE.TubeGeometry(path, Math.max(12, pts.length * 5), radius, fine ? 5 : 8, false), mat, 0, 0, 0);
    m.castShadow = !fine;
    if (fine) noOutline(m);
    return m;
  };
  const ring = (p: THREE.Object3D, mat: THREE.Material, radius: number, tube: number, cx: number, cy: number, cz = 0) =>
    addMesh(p, new THREE.TorusGeometry(radius, tube, 6, 40), mat, cx, cy, cz, { cast: false });
  const axle = (p: THREE.Object3D, mat: THREE.Material, radius: number, length: number, cx: number, cy: number, cz = 0) =>
    addCyl(p, mat, radius, radius, length, cx, cy - length / 2, cz, { rx: Math.PI / 2, seg: 12, cast: false });

  /* Wheels: continuous tires, alloy rims, alternating left/right spoke flanges. */
  for (const wx of [-0.5, 0.5]) {
    const wheel = group(g, wx, 0.33, 0, wx < 0 ? 'bike-rear-wheel' : 'bike-front-wheel');
    ring(wheel, tire, 0.32, 0.026, 0, 0);
    ring(wheel, alloy, 0.294, 0.011, 0, 0);
    for (const side of [-1, 1]) ring(wheel, steel, 0.31, 0.002, 0, 0, side * 0.023);
    axle(wheel, chrome, 0.026, 0.094, 0, 0);
    for (const side of [-1, 1]) {
      axle(wheel, steel, 0.037, 0.008, 0, 0, side * 0.032);
      axle(wheel, chrome, 0.014, 0.012, 0, 0, side * 0.059);
    }
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      const side = i % 2 ? -1 : 1;
      const hubAngle = a + side * 0.45;
      rod(wheel, chrome,
        [Math.cos(hubAngle) * 0.027, Math.sin(hubAngle) * 0.027, side * 0.032],
        [Math.cos(a) * 0.287, Math.sin(a) * 0.287, side * 0.004], 0.0025, true);
      // Sparse tread blocks read as rubber texture without adding a dark outline to every groove.
      const tread = addBox(wheel, rubber, 0.009, 0.0015, 0.018,
        Math.cos(a) * 0.345, Math.sin(a) * 0.345 - 0.00075, 0, { rz: a - Math.PI / 2, cast: false });
      noOutline(tread);
    }
    rod(wheel, steel, [0,-0.277,0], [0,-0.251,0], 0.006, true);
    addBox(wheel, amber, 0.052, 0.017, 0.013, 0.14, 0.085, 0.012, { rz: -0.55, r: 0.004, cast: false });
  }

  /* A proper low-step frame: bottom bracket, seat tube, stays and angled head tube. */
  const frame = group(g, 0, 0, 0, 'bike-frame');
  const bb: Point = [-0.12,0.32,0];
  const seat: Point = [-0.24,0.78,0];
  const headTop: Point = [0.31,0.81,0];
  const headBottom: Point = [0.36,0.64,0];
  rod(frame, paint, bb, seat, 0.039);
  rod(frame, paint, headTop, headBottom, 0.045);
  curve(frame, paint, [[-0.22,0.7,0],[-0.11,0.49,0],[0.08,0.48,0],[0.34,0.72,0]],0.018);
  curve(frame, paint, [bb,[0.02,0.34,0],[0.21,0.4,0],headBottom],0.021);
  for (const side of [-1,1]) {
    rod(frame, paint, [-0.5,0.33,side*0.045], [-0.225,0.735,side*0.018], 0.019);
    rod(frame, paint, [-0.5,0.33,side*0.045], [-0.12,0.32,side*0.035], 0.023);
    // Curved fork blades terminate on either side of the front axle.
    curve(frame, paint, [[0.355,0.65,side*0.037],[0.397,0.53,side*0.05],[0.46,0.36,side*0.055],[0.5,0.33,side*0.055]],0.013);
    axle(frame, steel, 0.022, 0.013, 0.5,0.33,side*0.053);
  }
  axle(frame, steel, 0.036, 0.12, ...bb);
  rod(frame, chrome, [-0.24,0.775,0],[-0.266,0.895,0],0.025).name='bike-seat-post';
  rod(frame, steel, [-0.243,0.778,-0.027],[-0.243,0.778,0.027],0.012);
  // Small paint graphics follow the tubes rather than floating beside the frame.
  rod(frame, cream, [0.18,0.555,0.017],[0.26,0.624,0.017],0.008,true);
  rod(frame, cream, [-0.217,0.675,0.018],[-0.205,0.631,0.018],0.01,true);

  /* Saddle: rounded cushion, tapered nose, underside rails and sprung support. */
  const saddle = group(g, -0.265,0.897,0,'bike-saddle');
  rod(saddle, steel, [-0.09,-0.01,-0.035],[0.06,-0.01,-0.035],0.009);
  rod(saddle, steel, [-0.09,-0.01,0.035],[0.06,-0.01,0.035],0.009);
  addBox(saddle, rubber,0.18,0.047,0.145,-0.035,0.005,0,{r:0.021});
  addBox(saddle, rubber,0.115,0.037,0.073,0.065,0.011,0,{r:0.017});
  for (const side of [-1,1]) {
    axle(saddle, steel,0.016,0.01,-0.075,-0.015,side*0.045);
    rod(saddle, steel,[-0.11,0.023,side*0.067],[-0.005,0.023,side*0.067],0.003,true);
  }

  /* Swept bars and levers, with two continuous brake cables down to the calipers. */
  const cockpit = group(g,0,0,0,'bike-handlebar');
  rod(cockpit, chrome, headTop,[0.285,0.965,0],0.026);
  rod(cockpit, chrome,[0.285,0.965,0],[0.33,1.015,0],0.024);
  curve(cockpit, chrome, [[0.235,1.025,-0.23],[0.285,1.025,-0.16],[0.33,1.015,-0.08],
    [0.33,1.015,0.08],[0.285,1.025,0.16],[0.235,1.025,0.23]],0.012);
  for (const side of [-1,1]) {
    rod(cockpit,rubber,[0.27,1.025,side*0.18],[0.226,1.025,side*0.245],0.028);
    rod(cockpit,steel,[0.29,1.013,side*0.17],[0.22,0.985,side*0.223],0.009);
    rod(cockpit,chrome,[0.29,1.015,side*0.153],[0.29,1.015,side*0.177],0.032);
    const cable: Point[] = [[0.29,1.005,side*0.15],[0.4,0.91,side*0.11],[0.38,0.77,side*0.09]];
    if (side > 0) cable.push([0.4,0.69,0.055],[0.46,0.628,0.027]);
    else cable.push([0.31,0.69,-0.035],[0.1,0.475,-0.03],[-0.11,0.485,-0.03],
      [-0.22,0.686,-0.03],[-0.36,0.68,-0.04],[-0.54,0.628,-0.027]);
    curve(cockpit,rubber,cable,0.003,true);
  }
  // Bell dome, clamp and thumb striker.
  addMesh(cockpit,new THREE.SphereGeometry(0.025,12,8,0,Math.PI*2,0,Math.PI/2),chrome,0.31,1.03,-0.115);
  rod(cockpit,rubber,[0.305,1.035,-0.115],[0.275,1.036,-0.105],0.008,true);
  for (const wx of [-0.5,0.5]) {
    const brake=group(g,wx,0.594,0,wx<0?'bike-rear-brake':'bike-front-brake');
    for (const side of [-1,1]) {
      rod(brake,steel,[-0.04,0.034,side*0.02],[0.045,-0.007,side*0.035],0.009);
      addBox(brake,rubber,0.027,0.015,0.016,0,-0.006,side*0.027,{cast:false});
    }
    rod(brake,chrome,[-0.04,0.034,-0.027],[-0.04,0.034,0.027],0.009);
  }

  /* Crankset, rear sprocket, visible chain, opposed cranks and rubber pedals. */
  const drivetrain=group(g,0,0,0,'bike-drivetrain');
  ring(drivetrain,steel,0.087,0.008,-0.12,0.32,0.08);
  ring(drivetrain,chrome,0.061,0.005,-0.12,0.32,0.085);
  ring(drivetrain,steel,0.038,0.006,-0.5,0.33,0.075);
  const chainPath: Point[]=[];
  // Two circular ends joined by tangent runs; loop remains behind the right crank.
  for(let i=0;i<=12;i++) {const a=Math.PI/2-i*Math.PI/12;chainPath.push([-0.12+Math.cos(a)*0.1,0.32+Math.sin(a)*0.1,0.076]);}
  for(let i=0;i<=12;i++) {const a=-Math.PI/2-i*Math.PI/12;chainPath.push([-0.5+Math.cos(a)*0.045,0.33+Math.sin(a)*0.045,0.076]);}
  chainPath.push(chainPath[0]);
  curve(drivetrain,steel,chainPath,0.004,true);
  for(let i=0;i<5;i++) {const a=i*Math.PI*2/5;rod(drivetrain,chrome,[-0.12,0.32,0.087],[-0.12+Math.cos(a)*0.076,0.32+Math.sin(a)*0.076,0.087],0.009);}
  for(const side of [-1,1]) {
    const px=-0.12+side*0.108, py=0.32-side*0.065;
    rod(drivetrain,chrome,[-0.12,0.32,side*0.105],[px,py,side*0.105],0.018);
    rod(drivetrain,steel,[px,py,side*0.105],[px,py,side*0.16],0.012);
    const pedal=group(drivetrain,px,py,side*0.16,'bike-pedal');
    addBox(pedal,rubber,0.074,0.022,0.09,0,-0.011,0,{r:0.005});
    for(const dx of [-0.038,0.038]) addBox(pedal,amber,0.004,0.011,0.057,dx,-0.0055,0,{cast:false});
    for(let i=0;i<4;i++) rod(pedal,steel,[-0.026,-0.012,-0.032+i*0.021],[0.026,-0.012,-0.032+i*0.021],0.003,true);
  }

  /* Sheet-metal mudguards follow the upper tire arc, with separate mounting stays. */
  for (const wx of [-0.5,0.5]) {
    const fender=group(g,wx,0.33,0,'bike-mudguard');
    const vertices:number[]=[],uv:number[]=[],indices:number[]=[];
    const segments=32;
    for(let i=0;i<=segments;i++) {
      const a=-0.12+(Math.PI+0.24)*i/segments;
      for(const side of [-1,1]) {vertices.push(Math.cos(a)*0.36,Math.sin(a)*0.36,side*0.038);uv.push(i/segments,(side+1)/2);}
      if(i<segments) {const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setIndex(indices);geometry.computeVertexNormals();
    const sheet=addMesh(fender,geometry,toon(0x88959c,{side:THREE.DoubleSide}),0,0,0);
    sheet.castShadow=false;
    for(const side of [-1,1]) {
      const pts:Point[]=[];
      for(let i=0;i<=24;i++) {const a=-0.12+(Math.PI+0.24)*i/24;pts.push([Math.cos(a)*0.36,Math.sin(a)*0.36,side*0.038]);}
      curve(fender,chrome,pts,0.003,true);
      rod(fender,steel,[0,0,side*0.055],[-0.29,0.21,side*0.038],0.006,true);
      rod(fender,steel,[0,0,side*0.055],[0.28,0.225,side*0.038],0.006,true);
    }
  }

  /* Open tapered wire basket: real bottom, hoop rims, uprights and mounting brackets. */
  const basket=group(g,0.595,0.765,0,'bike-basket');
  const corners=(yy:number):Point[]=>{const halfX=0.115+0.03*yy/0.21,halfZ=0.135+0.035*yy/0.21;return [[-halfX,yy,-halfZ],[halfX,yy,-halfZ],[halfX,yy,halfZ],[-halfX,yy,halfZ]];};
  for(const yy of [0,0.105,0.21]) {
    const c=corners(yy); for(let i=0;i<4;i++) rod(basket,steel,c[i],c[(i+1)%4],yy===0.21?0.009:0.005,true);
  }
  for(let i=0;i<=8;i++) {
    const t=i/8;
    for(const side of [-1,1]) {
      rod(basket,steel,[-0.115+0.23*t,0,side*0.135],[-0.145+0.29*t,0.21,side*0.17],0.0035,true);
      rod(basket,steel,[side*0.115,0,-0.135+0.27*t],[side*0.145,0.21,-0.17+0.34*t],0.0035,true);
    }
    rod(basket,steel,[-0.115,0,-0.135+0.27*t],[0.115,0,-0.135+0.27*t],0.004,true);
  }
  addBox(basket,paint,0.035,0.028,0.14,-0.11,-0.035,0,{r:0.006});
  for(const side of [-1,1]) rod(g,steel,[0.5,0.33,side*0.06],[0.62,0.765,side*0.12],0.008);
  rod(g,steel,[0.33,0.84,-0.09],[0.48,0.82,-0.09],0.01);
  rod(g,steel,[0.33,0.84,0.09],[0.48,0.82,0.09],0.01);
  // Front lamp sits below the basket; rear reflector is fixed to the rack.
  rod(g,steel,[0.705,0.765,0],[0.72,0.726,0],0.008);
  addMesh(g,new THREE.CylinderGeometry(0.029,0.034,0.057,16).rotateZ(-Math.PI/2),steel,0.735,0.726,0);
  addMesh(g,new THREE.CircleGeometry(0.025,16).rotateY(Math.PI/2),lens,0.765,0.726,0,{cast:false});

  const rack=group(g,-0.49,0.755,0,'bike-rear-rack');
  for(const side of [-1,1]) {
    rod(rack,chrome,[-0.23,0,side*0.077],[0.2,0,side*0.077],0.01);
    rod(rack,steel,[0,-0.425,side*0.055],[-0.19,0,side*0.077],0.008);
    rod(rack,steel,[0,-0.425,side*0.055],[0.14,0,side*0.077],0.008);
  }
  for(const side of [-1,1]) rod(g,steel,[-0.29,0.755,side*0.077],[-0.24,0.755,side*0.018],0.008);
  for(let i=0;i<6;i++) rod(rack,chrome,[-0.22+i*0.084,0,-0.077],[-0.22+i*0.084,0,0.077],0.008);
  rod(rack,steel,[-0.2,0.012,-0.045],[0.12,0.012,-0.045],0.005);
  rod(rack,steel,[-0.2,0.012,0.045],[0.12,0.012,0.045],0.005);
  addBox(rack,steel,0.014,0.06,0.074,-0.235,-0.035,0,{r:0.006});
  addBox(rack,red,0.019,0.043,0.061,-0.245,-0.026,0,{r:0.006});

  // The parked stand connects to the rear dropout and stays above the tire contact plane.
  const stand=group(g,0,0,0,'bike-kickstand');
  rod(stand,steel,[-0.45,0.33,-0.045],[-0.55,-0.01,-0.16],0.011);
  rod(stand,rubber,[-0.57,-0.01,-0.16],[-0.53,-0.01,-0.16],0.01);

  // Bake repeated static parts into a few shared-material batches before scene assembly.
  // Empty named component groups survive for inspection; the parked bicycles stay static.
  mergeStaticMeshes(g);
  g.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(g);
  if(Number.isFinite(bounds.min.y)) g.position.y+=y-bounds.min.y+0.012;
  return g;
}
