/** Black metal umbrella stand and four folded umbrellas, in the original doorway footprint. */
import * as THREE from 'three';
import { addBox, addCyl, addMesh, group, noOutline, strut } from '../core/geom';
import { decal, toon } from '../core/materials';
import * as TX from '../core/textures';
import { L } from './layout';
import { mergeStaticMeshes } from './merge';

type Point = [number, number, number];
const PROFILE: [number, number][] = [
  [0.012,0.06],[0.023,0.105],[0.043,0.2],[0.056,0.31],
  [0.06,0.41],[0.053,0.52],[0.038,0.63],[0.019,0.74],
];

/** Pleated fabric has eight gathered panels rather than a smooth rotational outline. */
function foldedCanopy(): THREE.BufferGeometry {
  const vertices:number[]=[],uv:number[]=[],indices:number[]=[];
  const segments=64;
  PROFILE.forEach(([radius,y],row)=>{
    for(let i=0;i<=segments;i++) {
      const a=i/segments*Math.PI*2;
      const r=radius*(0.84+0.16*Math.cos(a*8));
      const twist=(y-0.06)*0.18;
      vertices.push(Math.sin(a+twist)*r,y,Math.cos(a+twist)*r);
      uv.push(i/segments,(y-0.06)/0.68);
      if(row<PROFILE.length-1 && i<segments) {
        const j=row*(segments+1)+i;
        indices.push(j,j+1,j+segments+1,j+1,j+segments+2,j+segments+1);
      }
    }
  });
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geo.setIndex(indices);geo.computeVertexNormals();
  return geo;
}

export function buildUmbrellaStand(parent: THREE.Object3D, x: number, z: number): THREE.Group {
  const g=group(parent,x,L.curb+0.003,z,'umbrella-stand');
  const frame=toon(0x1b2027),frameHi=toon(0x303843),tray=toon(0x0e1116);
  const rubber=toon(0x171b20),metal=toon(0x89939c),screw=toon(0x68737e);
  const W=0.84,D=0.46,tipY=0.092,topY=0.96;
  const rod=(p:THREE.Object3D,mat:THREE.Material,a:Point,b:Point,d:number,fine=false)=>{
    const m=strut(p,mat,a,b,d,true);m.castShadow=!fine;
    if(fine) noOutline(m);
    return m;
  };
  const tube=(p:THREE.Object3D,mat:THREE.Material,points:Point[],radius:number,fine=false)=>{
    const path=new THREE.CatmullRomCurve3(points.map(v=>new THREE.Vector3(...v)));
    const m=addMesh(p,new THREE.TubeGeometry(path,32,radius,8,false),mat,0,0,0,{cast:!fine});
    if(fine) noOutline(m);
    return m;
  };
  const fastener=(p:THREE.Object3D,xx:number,yy:number,zz:number)=>{
    addMesh(p,new THREE.CylinderGeometry(0.006,0.006,0.003,10).rotateX(Math.PI/2),screw,xx,yy,zz,{cast:false});
    const slot=addBox(p,tray,0.007,0.0015,0.001,xx,yy-0.00075,zz+0.002,{cast:false});
    noOutline(slot);
  };

  /* Four capped square-tube legs with rubber feet and a removable recessed drip tray. */
  const rack=group(g,0,0,0,'stand-frame');
  for(const sx of [-W/2+0.02,W/2-0.02]) for(const sz of [-D/2+0.02,D/2-0.02]) {
    addBox(rack,rubber,0.047,0.018,0.047,sx,0,sz,{r:0.005});
    addBox(rack,frame,0.032,topY-0.018,0.032,sx,0.018,sz,{r:0.003});
    addBox(rack,frameHi,0.036,0.008,0.036,sx,topY-0.008,sz,{r:0.003});
    fastener(rack,sx,0.135,sz+(sz>0?0.018:-0.018));
    fastener(rack,sx,topY-0.025,sz+(sz>0?0.018:-0.018));
  }
  // Perimeter rails leave the tray face recessed and the upper opening unobstructed.
  for(const yy of [0.055,topY-0.035]) {
    for(const sz of [-D/2+0.02,D/2-0.02]) addBox(rack,frameHi,W-0.02,0.035,0.032,0,yy,sz,{r:0.003});
    for(const sx of [-W/2+0.02,W/2-0.02]) addBox(rack,frameHi,0.032,0.035,D-0.02,sx,yy,0,{r:0.003});
  }
  // Rear brace and front lower rail tie the uprights to the base.
  rod(rack,frame,[-0.39,0.14,-0.205],[0.39,0.56,-0.205],0.012,true);
  rod(rack,frame,[0.39,0.14,-0.205],[-0.39,0.56,-0.205],0.012,true);
  addBox(rack,frame,0.78,0.018,0.018,0,0.235,0.21,{r:0.003});
  const drip=group(g,0,0,0,'stand-drip-tray');
  addBox(drip,frame,0.768,0.012,0.368,0,0.071,0,{r:0.005});
  addBox(drip,tray,0.734,0.009,0.334,0,0.083,0,{r:0.003});
  for(const sz of [-0.177,0.177]) addBox(drip,frameHi,0.764,0.031,0.014,0,0.079,sz,{r:0.003});
  for(const sx of [-0.377,0.377]) addBox(drip,frameHi,0.014,0.031,0.34,sx,0.079,0,{r:0.003});
  for(let i=0;i<13;i++) addBox(drip,frameHi,0.009,0.008,0.3,-0.33+i*0.055,0.092,0,{r:0.002,cast:false});
  // The pull recess is inset into the front lip, with a small metal grip underneath.
  addBox(drip,tray,0.13,0.017,0.002,0,0.086,0.185,{r:0.003,cast:false});
  addBox(drip,screw,0.094,0.004,0.009,0,0.084,0.188,{r:0.001,cast:false});

  const slots=group(g,0,0,0,'stand-divider-grid');
  for(const sx of [-0.18,0,0.18]) {
    addBox(slots,frameHi,0.014,0.02,0.394,sx,topY-0.028,0,{r:0.003});
    for(const sz of [-0.175,0.175]) addBox(slots,rubber,0.023,0.026,0.039,sx,topY-0.032,sz,{r:0.005,cast:false});
  }
  // A small enamel sign is fixed to the front rail by two straps, not left floating.
  for(const sx of [-0.135,0.135]) addBox(rack,frameHi,0.014,0.23,0.016,sx,0.725,0.21,{r:0.002});
  addBox(rack,frameHi,0.34,0.113,0.014,0,0.72,0.219,{r:0.006});
  const label=addMesh(rack,new THREE.PlaneGeometry(0.322,0.095),decal(TX.umbrellaStandLabelTex()),0,0.7765,0.227,{cast:false});
  noOutline(label);

  /* Four long umbrellas. Tips meet the tray ribs; fabric, closures and hooks stay distinct. */
  const umbrellas:[string,number,number,number,number][]=[
    ['black',0x262b34,-0.27,-0.045,-0.025],['blue',0x2f5fb8,-0.09,0.012,0.02],
    ['red',0xc73e35,0.09,-0.02,-0.02],['white',0xe7e3d8,0.27,0.035,0.025],
  ];
  const canopyGeo=foldedCanopy();
  for(const [name,color,ux,uz,lean] of umbrellas) {
    const ug=group(g,ux,tipY,uz,'umbrella-'+name);
    ug.rotation.z=lean;
    const cloth=toon(color,{side:THREE.DoubleSide,map:TX.umbrellaFoldTex()});
    const grip=toon(new THREE.Color(color).multiplyScalar(name==='white'?0.94:0.72).getHex());
    const bandMat=toon(new THREE.Color(color).multiplyScalar(0.57).getHex(),{side:THREE.DoubleSide});
    const stitch=toon(new THREE.Color(color).lerp(new THREE.Color(0xe3e5e2),0.22).getHex());
    // Ferrule, central shaft, sliding runner and the handle collar are separate parts.
    addCyl(ug,metal,0.007,0.0035,0.055,0,0,0,{seg:10});
    addCyl(ug,metal,0.007,0.007,0.9,0,0.045,0,{seg:10});
    addCyl(ug,screw,0.012,0.01,0.028,0,0.742,0,{seg:12});
    addCyl(ug,grip,0.013,0.013,0.05,0,0.91,0,{seg:12});
    addCyl(ug,metal,0.014,0.014,0.009,0,0.925,0,{seg:12,cast:false});
    addMesh(ug,canopyGeo,cloth,0,0,0).name='folded-canopy';
    for(let panel=0;panel<8;panel++) {
      const a=panel*Math.PI/4;
      const pts:Point[]=PROFILE.map(([r,yy])=>{
        const t=a+(yy-0.06)*0.18;
        return [Math.sin(t)*(r+0.0009),yy,Math.cos(t)*(r+0.0009)];
      });
      tube(ug,stitch,pts,0.0011,true);
    }
    // Slightly raised wrap strap with an overlapping tab and press stud.
    addMesh(ug,new THREE.CylinderGeometry(0.0615,0.0615,0.025,32,1,true),bandMat,0,0.412,0,{cast:false});
    addBox(ug,bandMat,0.024,0.025,0.006,0,0.3995,0.061,{r:0.002,cast:false});
    addMesh(ug,new THREE.SphereGeometry(0.004,10,6).scale(1,1,0.5),metal,0,0.412,0.065,{cast:false});
    // J-shaped molded handle, rounded tip and subtle seam along its outer surface.
    const hook:Point[]=[[0,0.94,0],[0,1.04,0],[0,1.106,0.035],
      [0,1.128,0.095],[0,1.09,0.155],[0,1.015,0.173]];
    tube(ug,grip,hook,0.018);
    addMesh(ug,new THREE.SphereGeometry(0.018,12,8),grip,0,1.015,0.173,{cast:false});
    const seam:Point[]=hook.map(([xx,yy,zz])=>[xx+0.018,yy,zz]);
    tube(ug,stitch,seam,0.0007,true);
  }
  // Preserve the doorway silhouette while batching the denser frame and fabric details.
  mergeStaticMeshes(g);
  return g;
}
