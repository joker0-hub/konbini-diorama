import * as THREE from 'three';
import { noOutline } from '../core/geom';

const VERT = /* glsl */ `
  uniform vec2 uPaneSize;
  varying vec2 vPane;

  void main() {
    vPane = uv * uPaneSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec2 uPaneSize;
  uniform float uSeed;
  uniform float uTime;
  uniform float uRain;
  varying vec2 vPane;

  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // Light and dark arcs give each bead a curved surface while keeping the shop visible.
  vec2 bead(vec2 p, vec2 radii, float pixel) {
    vec2 q = p / radii;
    float d = length(q);
    float aa = clamp(pixel / min(radii.x, radii.y), 0.04, 0.75);
    float coverage = (1.0 - smoothstep(0.85 - aa, 0.85 + aa, d))
      * (1.0 - smoothstep(0.55, 1.8, pixel / radii.x));
    float rim = smoothstep(0.42, 0.88, d);
    float glint = 1.0 - smoothstep(0.12, 0.38 + aa * 0.25, length(q - vec2(-0.27, 0.39)));
    return coverage * vec2(0.19 + rim * smoothstep(-0.4, 0.7, q.y) * 0.76,
      0.13 + glint * 0.85 + rim * (1.0 - smoothstep(-0.68, 0.08, q.y)) * 0.52);
  }

  void main() {
    vec2 p = vPane;
    float pixel = max(length(dFdx(p)), length(dFdy(p)));
    float edge = min(min(p.x, uPaneSize.x - p.x), min(p.y, uPaneSize.y - p.y));
    float opacity = uRain * smoothstep(0.003, 0.024, edge);
    if (opacity < 0.005 || pixel > 0.05) discard;

    vec2 beadTile = vec2(0.112, 0.134);
    vec2 beadCell = floor(p / beadTile);
    vec2 beadKey = beadCell + vec2(uSeed, -uSeed * 0.37);
    float sizeSeed = hash(beadKey + 4.2);
    vec2 center = (beadCell + 0.22 + 0.56 * vec2(hash(beadKey), hash(beadKey + 3.5))) * beadTile;
    float radius = mix(0.0045, 0.012, sizeSeed * sizeSeed);
    vec2 tones = bead(p - center, vec2(radius, radius * 1.13), pixel) * smoothstep(0.16, 0.52, sizeSeed) * 0.8;

    vec2 flowTile = vec2(0.28, 0.72);
    vec2 flowCell = floor(p / flowTile);
    vec2 flowKey = flowCell + vec2(-uSeed * 0.67, uSeed);
    float flowSeed = hash(flowKey);
    float phase = fract(uTime * mix(0.27, 0.57, flowSeed) + hash(flowKey + 6.0));
    float travel = pow(clamp((phase - 0.15) / 0.85, 0.0, 1.0), 1.5);
    vec2 local = p - flowCell * flowTile;
    float y = mix(0.58, 0.036, travel);
    float x = flowTile.x * mix(0.23, 0.77, hash(flowKey + 11.2));
    x += sin(y * 15.0 + flowSeed * 10.0) * 0.012;
    float speed = smoothstep(0.12, 0.78, phase);
    float life = smoothstep(0.0, 0.16, phase) * (1.0 - smoothstep(0.86, 1.0, phase));
    vec2 head = local - vec2(x, y);
    float flowRadius = mix(0.012, 0.021, flowSeed);
    vec2 flow = bead(head, vec2(flowRadius, flowRadius * mix(1.06, 1.85, speed)), pixel);

    float tailLength = mix(0.035, 0.16, speed);
    float tailY = head.y / tailLength;
    float tailX = local.x - (x + (sin(local.y * 15.0 + flowSeed * 10.0) - sin(y * 15.0 + flowSeed * 10.0)) * 0.012);
    float tailWidth = max(0.0038, pixel);
    float tail = (1.0 - smoothstep(0.0, tailWidth, abs(tailX))) * (0.0038 / tailWidth)
      * smoothstep(0.0, 0.16, tailY) * (1.0 - smoothstep(0.1, 1.0, tailY));
    tones += (flow + vec2(0.12, 0.26) * tail * speed) * life;

    float strength = tones.x + tones.y;
    float alpha = min(0.68, strength * 0.64) * opacity;
    if (alpha < 0.005) discard;
    vec3 color = mix(vec3(0.035, 0.075, 0.105), vec3(0.70, 0.88, 1.0), tones.y / strength);
    gl_FragColor = vec4(color, alpha);
  }
`;

export function buildGlassRain(panes: readonly THREE.Mesh<THREE.PlaneGeometry>[]) {
  const time = { value: 0 };
  const rain = { value: 0 };
  const layers = panes.map((pane, i) => {
    const { width, height } = pane.geometry.parameters;
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPaneSize: { value: new THREE.Vector2(width, height) },
        uSeed: { value: 1.7 + i * 17.3 },
        uTime: time,
        uRain: rain,
      },
    });
    const layer = new THREE.Mesh(pane.geometry, material);
    layer.name = 'glass-rain';
    layer.position.z = 0.004;
    layer.renderOrder = 6;
    layer.visible = false;
    noOutline(layer);
    pane.add(layer);
    return layer;
  });

  return {
    layers,
    setTime(t: number) { time.value = t; },
    setDensity(density: number) {
      rain.value = density;
      for (const layer of layers) layer.visible = density > 0.02;
    },
  };
}
