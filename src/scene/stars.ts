/**
 * 星空。
 *
 * 做法：一个跟随相机的大球壳（BackSide），片元着色器里用方向哈希
 * 生成稳定的星点，而不是放几万个 Points —— 后者在半透明排序、
 * 与雾的配合上都会出问题，而且这里不需要视差。
 *
 * 几个关键点：
 * - 星星必须在"地平线以上"才出现（y > 0），否则会从地面/台座下方透出来。
 * - 用 pow 分布让亮星稀疏、暗星密集，这是真实夜空的观感；
 *   均匀随机会得到一片"平"的噪点。
 * - 加一点色温差异（蓝白 / 暖白），三渲二里这一点点色彩差别很出效果。
 * - 时间上做极缓慢的闪烁，几乎察觉不到，但静帧之间不会像死贴图。
 */

import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    // 球壳跟随相机，永不裁切
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  varying vec3 vDir;
  uniform float uTime;
  uniform float uStarOpacity;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;

  // 三维方向 -> 稳定伪随机
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);

    // 星空的可见范围。
    //
    // 物理上星星只该在地平线以上，但这里的相机是"俯视一座悬浮的微缩模型"：
    // 默认机位俯角约 -27°，垂直半视角 14°，整个画面都在水平线以下 ——
    // 严格按地平线裁的话，星星永远进不了画面。
    //
    // 所以把范围放宽到 -0.45（约 -27°）开始淡入、-0.12 全亮：
    // 这样画面上缘会自然浮出一片星，读作"模型之外是夜空"，
    // 而台座本体是不透明的，不会透出星点。
    float up = d.y;
    float sky = smoothstep(-0.45, -0.12, up);

    // 天空渐变：即使没有星星，背景也要有"天在上、地在暗"的层次。
    // 纯色 clearColor 会让整个画面像贴了一张色卡。
    float grad = smoothstep(-0.55, 0.6, up);
    vec3 skyCol = mix(uHorizon, uZenith, grad);
    // 天空渐变始终存在（白天也有渐变），星星单独受 uStarOpacity 控制。
    // 以前两者共用一个 opacity，白天的天空就变成了纯色 clearColor。
    float skyA = smoothstep(-0.62, -0.34, up);

    // ---- 星点 ----
    // scale 越大格子越细 -> 星星越密。
    // 115 + 10% 的命中率，配合下面的低亮度，是"疏落但看得出是星空"的量级。
    float scale = 115.0;
    vec3 cell = floor(d * scale);
    float r = hash(cell);
    float star = step(0.90, r);

    // 星点在格子内的位置，决定它离格心的偏移 -> 用作亮度权重
    vec3 frac3 = fract(d * scale) - 0.5;
    float d2 = dot(frac3, frac3);
    // 越靠格心越亮，形成一个小圆点
    float core = smoothstep(0.34, 0.0, d2);

    // 亮度分布：pow 让亮星稀疏、暗星密集
    float mag = pow(hash(cell + 7.13), 3.0);
    float bright = star * core * (0.08 + mag * 0.85);

    // 缓慢闪烁（不同格子不同相位，幅度很小）
    float tw = 0.86 + 0.14 * sin(uTime * 1.7 + r * 62.8);
    bright *= tw;

    // 色温：偏蓝白的多一点
    float warm = hash(cell + 3.7);
    vec3 tint = mix(vec3(0.78, 0.86, 1.0), vec3(1.0, 0.94, 0.82), warm * warm);

    vec3 starCol = tint * bright * 0.9;
    // 靠近地平线压暗（大气消光），也让星星不均匀分布
    starCol *= mix(0.35, 1.0, sky);
    float starA = bright * uStarOpacity * sky * 0.9;

    // 合成：天空渐变打底，星点加色叠上去。
    // 星点颜色必须再乘 uStarOpacity —— 否则 alpha 为 0 的星点依然会被
    // 加进天空的 RGB，白天/阴天就会在画面上留下满天白点。
    vec3 col = skyCol + starCol * uStarOpacity;
    float a = clamp(skyA + starA, 0.0, 1.0);

    if (a <= 0.002) discard;
    gl_FragColor = vec4(col, a);
    // 与后处理管线的线性空间对齐
    #include <colorspace_fragment>
  }
`;

export interface Starfield {
  mesh: THREE.Mesh;
  update: (t: number, cam: THREE.Camera, opacity: number) => void;
  /** 让天空渐变跟着时段走 */
  setSky: (zenith: number, horizon: number) => void;
}

export function buildStarfield(): Starfield {
  // 半径 60：相机远平面 140，怎么旋转都不会被裁；同时又在雾的
  // 影响范围之外靠 fog:false 排除（见材质设置）。
  const geo = new THREE.SphereGeometry(60, 32, 24);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uStarOpacity: { value: 0 },
      uZenith: { value: new THREE.Color(0x0a1020) },
      uHorizon: { value: new THREE.Color(0x1b2740) },
    },
    side: THREE.BackSide,
    // 天空底是"不透明"的，用普通混合；
    // 星点靠加色算进同一个 fragment，所以不需要 AdditiveBlending。
    transparent: true,
    depthWrite: false,
    // depthTest 必须开着：关掉的话天空会盖住建筑和地面。
    depthTest: true,
    blending: THREE.NormalBlending,
    fog: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'starfield';
  mesh.frustumCulled = false;
  // 星空必须在所有不透明物体之后画，否则会被场景覆盖。
  // 用 depthTest:false 会画到"所有东西上面"（包括建筑），所以必须保留深度测试，
  // 只把渲染顺序放到最前面（-10），让它在天空之前铺底。
  mesh.renderOrder = -10;
  // 层 1：不参与描边的深度通道
  mesh.layers.set(1);

  return {
    mesh,
    setSky(zenith, horizon) {
      mat.uniforms.uZenith.value.setHex(zenith);
      mat.uniforms.uHorizon.value.setHex(horizon);
    },
    update(t, cam, starOpacity) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uStarOpacity.value = starOpacity;
      // 天空渐变始终可见；星星为 0 时仍然要画天空底色
      mesh.visible = true;
      // 球壳始终套在相机上。半径固定 60 —— 相机远平面是 140，
      // 所以无论怎么缩放都不会被裁掉，也不会因为缩放而变色。
      mesh.position.copy(cam.position);
    },
  };
}
