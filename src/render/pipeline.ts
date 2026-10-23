/**
 * 自建后处理管线。
 *
 * 顺序：场景(带深度纹理) → bloom 叠加 → 深度边缘描边 + 调色 → 屏幕。
 *
 * 为什么不直接用 EffectComposer：
 * 我们要在「bloom 之后」做深度边缘检测，而描边需要场景的深度附件。
 * 自己管两个 render target 反而更短、更可控，也省掉一个 CopyPass。
 *
 * 描边原理：对深度做拉普拉斯，深度突变处画线。因为整个模型是硬边几何，
 * 深度断层几乎覆盖所有需要描边的轮廓与转折，代价是一次全屏采样。
 */

import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  #include <packing>

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uEdgeStrength;
  uniform float uEdgeWidth;
  uniform vec3 uLineColor;
  uniform float uVignette;
  uniform float uSat;
  uniform vec3 uLift;
  uniform vec3 uGain;
  uniform float uExposure;
  uniform float uDebug;

  varying vec2 vUv;

  float linearDepth(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    float viewZ = perspectiveDepthToViewZ(d, uNear, uFar);
    return viewZToOrthographicDepth(viewZ, uNear, uFar);
  }  void main() {
    vec2 texel = uEdgeWidth / uResolution;

    // 5 点采样做拉普拉斯：中心 + 上下左右
    float c = linearDepth(vUv);
    float l = linearDepth(vUv - vec2(texel.x, 0.0));
    float r = linearDepth(vUv + vec2(texel.x, 0.0));
    float u = linearDepth(vUv - vec2(0.0, texel.y));
    float d = linearDepth(vUv + vec2(0.0, texel.y));

    float lap = abs(l + r + u + d - 4.0 * c);

    // 远处（深度接近 1）弱化描边，避免远景糊成黑块
    float depthFade = smoothstep(0.9, 0.999, c);
    // 近处（紧贴镜头）也弱化
    float nearFade = smoothstep(0.0, 0.015, c);

    // 用深度差本身的相对量做阈值：同一平面上不会出线
    float edge = smoothstep(0.00006, 0.0008, lap) * (1.0 - depthFade) * nearFade;

    // rt 里是线性 HDR 值
    vec4 tex = texture2D(tColor, vUv);
    vec3 col = max(tex.rgb, 0.0) * uExposure;

    if (uDebug > 0.5) {
      gl_FragColor = vec4(vec3(edge), 1.0);
      return;
    }

    // 指数色调映射：0 保持 0，高光平滑压到 1。
    // 用 0.8 的斜率给中间调留出空间——斜率太高会让彩色商品全部烧成白块。
    col = 1.0 - exp(-col * 0.8);

    // 线色偏深蓝，乘上去更像赛璐璐的墨线而不是黑框
    col = mix(col, uLineColor, clamp(edge * uEdgeStrength, 0.0, 1.0));

    // split toning：暗部偏冷、亮部偏暖
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col + uLift * (1.0 - lum) * 0.34, col * uGain, smoothstep(0.18, 1.0, lum));

    // 饱和度：三渲二的配色要"艳"，不然夜景一片灰
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(g), col, uSat);

    // 对比度：给暗部一点下压，夜景才"沉"
    col = clamp((col - 0.5) * 1.12 + 0.48, 0.0, 1.0);

    // 暗角
    vec2 q = vUv - 0.5;
    float vig = 1.0 - smoothstep(0.34, 0.98, length(q) * 1.4) * uVignette;
    col *= vig;

    // 线性 → sRGB
    col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface Pipeline {
  render: (t: number, dt: number) => void;
  setSize: (w: number, h: number) => void;
  bloom: UnrealBloomPass;
  setEdgeStrength: (v: number) => void;
  exposure: { value: number };
  debugEdges: (on: boolean) => void;
  /** 环境驱动的调色（lift / gain / 饱和 / 暗角） */
  setEnvironment: (o: {
    lift: number; gain: number; saturation: number; vignette: number;
  }) => void;
  /** 场景本身（不含后处理）的渲染统计 */
  sceneStats: { calls: number; triangles: number };
}

export function createPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): Pipeline {
  const size = new THREE.Vector2();
  renderer.getSize(size);

  // 场景目标：半浮点颜色 + 深度纹理
  const depthTexture = new THREE.DepthTexture(size.x, size.y);
  depthTexture.type = THREE.UnsignedShortType;
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    depthTexture,
    depthBuffer: true,
    samples: 0,
  });

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 0.86);

  const uniforms = {
    tColor: { value: rt.texture },
    tDepth: { value: depthTexture },
    uResolution: { value: new THREE.Vector2(size.x, size.y) },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
    uEdgeStrength: { value: 0.92 },
    uEdgeWidth: { value: 1.1 },
    uLineColor: { value: new THREE.Color(0x0b1220) },
    uVignette: { value: 0.55 },
    uSat: { value: 1.14 },
    uLift: { value: new THREE.Color(0x101c33) },
    uGain: { value: new THREE.Color(0xfff4e2) },
    uExposure: { value: 1.0 },
    uDebug: { value: 0 },
  };

  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadMat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(quadGeo, quadMat);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const sceneStats = { calls: 0, triangles: 0 };

  return {
    bloom,
    sceneStats,
    exposure: uniforms.uExposure,
    setEdgeStrength(v) {
      uniforms.uEdgeStrength.value = v;
    },
    debugEdges(on) {
      uniforms.uDebug.value = on ? 1 : 0;
    },
    /**
     * 环境（时段 / 天气）驱动的调色参数。
     *
     * 三渲二里调色是"风格的一半"。换时段时如果只改灯光、
     * 不改这一段，画面会立刻露馅：白天还压着夜景的蓝 lift，
     * 或者夜晚被白天的中性 gain 洗掉招牌的暖光。
     */
    setEnvironment(o: {
      lift: number; gain: number; saturation: number; vignette: number;
    }) {
      uniforms.uLift.value.setHex(o.lift);
      uniforms.uGain.value.setHex(o.gain);
      uniforms.uSat.value = o.saturation;
      uniforms.uVignette.value = o.vignette;
    },
    setSize(w, h) {
      rt.setSize(w, h);
      depthTexture.image.width = w;
      depthTexture.image.height = h;
      uniforms.uResolution.value.set(w, h);
      bloom.setSize(w, h);
    },
    render(t, dt) {
      // 1. 场景 → rt
      renderer.setRenderTarget(rt);
      renderer.clear();
      // 关掉自动重置：否则 renderer.info 会被后续的 bloom / 全屏 pass 覆盖，
      // 只读到最后一趟 quad（1 draw call、2 三角形），统计完全失真。
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.render(scene, camera);
      // 在这一刻冻结场景的真实统计
      sceneStats.calls = renderer.info.render.calls;
      sceneStats.triangles = renderer.info.render.triangles;

      // 2. bloom 直接加色混合回 rt（needsSwap=false 的通行做法）
      bloom.render(renderer, rt, rt, dt, false);

      // 3. 描边 + 调色 → 屏幕
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(quadScene, quadCam);
      renderer.info.autoReset = true;
    },
  };
}
