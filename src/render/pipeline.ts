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
  /** 花冠遮罩：R 通道 = 该像素属于「不描边的密集面片」的强度 */
  uniform sampler2D tMask;
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

    // 花冠遮罩：这一层专门用来"抹掉"密集小面片区域的描边。
    // 花簇本身不参与描边（否则每片花瓣被描黑边），但那样描边就会
    // 把它背后枝条的轮廓画到花团上 —— 看起来像枝条长在花前面。
    // 代理体把花冠的体积报给深度图，遮罩再把这些区域内的线全部抹平，
    // 于是花团内部干净、枝条被正确遮住，外轮廓交给花团自己的明暗表达。
    float canopy = texture2D(tMask, vUv).r;
    edge *= (1.0 - canopy);

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

  /**
   * 描边专用的深度目标。
   *
   * 为什么要单独一遍：花簇（层 2）是几千片互相穿插的小三角，
   * 深度处处断层，如果和场景一起写进深度图，全屏描边会把每一片花瓣
   * 都描上黑边，整棵树糊成一团黑。但把花瓣完全排除出渲染又会
   * 让树枝穿透花冠显形。
   *
   * 所以描边判断改看这一张图：只渲染层 0（实体）和层 1（玻璃/雨），
   * 不含层 2 的花瓣。花瓣在主 rt 里正常着色，只是不产生描边线。
   * 颜色目标随手用一个 1x1 的占位 —— 这一遍我们只关心深度。
   */
  const edgeDepth = new THREE.DepthTexture(size.x, size.y);
  edgeDepth.type = THREE.UnsignedShortType;
  const edgeTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    depthTexture: edgeDepth,
    depthBuffer: true,
  });

  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 0.86);

  /**
   * 花冠遮罩目标。
   *
   * 渲染流程变成「两遍」：
   *   1. 遮罩 pass：只画 OUTLINE_PROXY_LAYER（花冠代理体），白色不透明。
   *      不需要深度，只要一块能看出「哪里是花团」的剪影。
   *   2. 描边深度 pass：只画 0 / 1 层（实体与玻璃），不含花瓣。
   *
   * 两遍合起来就能做到：花团内部不出描边线，而花团背后的枝条轮廓
   * 也不会被错误地画到花团表面。
   */
  const maskTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.UnsignedByteType,
    depthBuffer: true,
  });

  const uniforms = {
    tColor: { value: rt.texture },
    // 描边读这张「不含花瓣」的深度图，而不是主 rt 的深度
    tDepth: { value: edgeDepth },
    tMask: { value: maskTarget.texture },
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
      edgeTarget.setSize(w, h);
      edgeDepth.image.width = w;
      edgeDepth.image.height = h;
      maskTarget.setSize(w, h);
      uniforms.uResolution.value.set(w, h);
      bloom.setSize(w, h);
    },
    // 第一个参数是累计时间：bloom 只需要 dt，
    // 但保留 `_t` 让签名与调用处一致（也是给后续加时间类效果留的位置）。
    render(_t, dt) {
      /* ---- 0a. 花冠遮罩 pass：只画代理体，白色剪影 ---- */
      const savedMask = camera.layers.mask;
      // 遮罩必须清成纯黑（着色器把 R 通道当"遮罩强度"读，黑 = 不遮挡）。
      // 但 setClearColor 改的是 renderer 的全局状态，不清回去会污染
      // 主渲染与后续所有 pass —— 主渲染的背景色会被悄悄改成透明黑。
      const savedClear = renderer.getClearColor(new THREE.Color());
      const savedAlpha = renderer.getClearAlpha();
      camera.layers.disableAll();
      camera.layers.enable(3);
      renderer.setRenderTarget(maskTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);

      /* ---- 0b. 描边深度 pass：实体 + 玻璃，不含花瓣与代理体 ---- */
      // 层 2（花簇/落樱/地面花瓣）不参与，避免每片花瓣都被描黑边。
      // 层 3 也不参与 —— 它只在遮罩里出现，不该污染描边的深度。
      camera.layers.disableAll();
      camera.layers.enable(0);
      camera.layers.enable(1);
      renderer.setRenderTarget(edgeTarget);
      renderer.clear();
      renderer.render(scene, camera);
      camera.layers.mask = savedMask;
      // 恢复全局清屏色，别把辅助 pass 的临时设置泄漏给主渲染
      renderer.setClearColor(savedClear, savedAlpha);

      /* ---- 1. 场景 → rt（完整渲染，含层 2 的花瓣） ---- */
      renderer.setRenderTarget(rt);
      renderer.clear();
      // 关掉自动重置：否则 renderer.info 会被后续的 bloom / 全屏 pass 覆盖，
      // 只读到最后一趟 quad（1 draw call、2 三角形），统计完全失真。
      renderer.info.autoReset = false;
      // 关键：reset() 必须紧贴主渲染。前面两遍 pass（花冠遮罩、描边深度）
      // 也在往同一个计数器里累加，不重置的话 sceneStats 读到的是
      // "主渲染 + 两遍 pass"的和，三角面会虚高近三倍。
      renderer.info.reset();
      renderer.render(scene, camera);
      // 在这一刻冻结场景的真实统计
      sceneStats.calls = renderer.info.render.calls;
      sceneStats.triangles = renderer.info.render.triangles;
      // 立刻再清一次：bloom / 全屏 quad 的绘制不该污染下一次采样的基线
      renderer.info.reset();

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
