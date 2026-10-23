/**
 * 环境系统：时段（白天 / 黄昏 / 夜晚）× 天气（晴 / 雨 / 雪）。
 *
 * 设计原则 —— 两个维度必须**正交**：
 *
 *   时段只决定「光与色」：主光/天光/补光、雾的基准密度、天空渐变、
 *   调色（lift/gain/曝光/饱和/暗角）、bloom 的基准、店内与招牌的亮度。
 *
 *   天气只决定「降水与空气」：雨量、雪量、地面积水、雾的倍率与灰度、
 *   云的遮光（主光变弱、天光变强）、星空可见度。
 *
 * 以前把 rainDensity 写进时段预设里，于是「白天 + 下雨」得到雨量 0 ——
 * 选了雨却不下雨；晴天的地面积水、玻璃雨痕也是一直开着的。
 * 现在所有组合（3 × 3）都由同一套 compose 计算，任何一个时段都能下雨/下雪，
 * 任何天气都能是白天/黄昏/夜晚。
 *
 * 所有过渡都是平滑插值（默认 1.6s）。积雪是独立积分器：
 * 切到下雪后慢慢积、到上限停住；换时段不会让它归零或重新开始。
 */

import * as THREE from 'three';

export type TimeOfDay = 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'snow';

export interface EnvState {
  time: TimeOfDay;
  weather: Weather;
}

/**
 * 合成后的最终预设。
 *
 * rainDensity / snowAmount / wetness / starOpacity 只由天气（以及时段的
 * 星空基准）决定；其余由时段提供基准、天气做修正。
 */
export interface EnvPreset {
  /* 光 */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  keyColor: number;
  keyIntensity: number;
  /** 主光方向（世界坐标位置；target 恒为原点） */
  keyPos: [number, number, number];
  fillColor: number;
  fillIntensity: number;
  /* 大气 */
  fogColor: number;
  fogDensity: number;
  clearColor: number;
  skyZenith: number;
  skyHorizon: number;
  /* 后处理 */
  lift: number;
  gain: number;
  exposure: number;
  saturation: number;
  bloomStrength: number;
  bloomThreshold: number;
  vignette: number;
  /* 招牌 / 店内灯的应用强度（0..1） */
  signage: number;
  interior: number;
  /* 天气产物 */
  rainDensity: number;
  snowAmount: number;
  wetness: number;
  starOpacity: number;
}

/** 时段预设：只描述光、色、雾的基准。**不含**任何降水字段。 */
type TimePreset = Omit<EnvPreset, 'rainDensity' | 'snowAmount' | 'wetness' | 'starOpacity'> & {
  /** 该时段理论上空的星空可见度基准 0..1 */
  starBase: number;
};

/**
 * 三套时段预设。
 *
 * 数值不是随手调的，每条都有理由：
 * - 夜晚 bloomThreshold 要低（0.86），招牌才能糊出光晕；
 *   白天太阳把场景整体推亮，阈值必须抬高（1.15）否则整个画面发雾。
 * - 白天 hemi 强度反而要低于夜晚的"总亮度"感受 ——
 *   因为白天靠方向光出明暗，环境光一高就没有形体了。
 * - 黄昏是最难调的一档：光源低、色温暖，但天光还有蓝，
 *   所以 hemi 用暖橙 + 冷蓝的组合，曝光略低于白天。
 */
const TIME: Record<TimeOfDay, TimePreset> = {
  day: {
    hemiSky: 0xc4d8f0,
    hemiGround: 0x7d7668,
    // 白天靠"方向光 + 天光"共同塑形。主光从镜头同侧斜照，
    // 朝街的两个立面和地面才有直射光；补光负责把暗部托起来。
    hemiIntensity: 1.55,
    keyColor: 0xfff4dd,
    keyIntensity: 2.0,
    keyPos: [13, 18, 11],
    fillColor: 0xc8dcf5,
    fillIntensity: 0.9,
    fogColor: 0xc3d4e6,
    fogDensity: 0.006,
    clearColor: 0x9fb8d4,
    skyZenith: 0x7ea8d8,
    skyHorizon: 0xd6e4f2,
    lift: 0x3a4250,
    gain: 0xfff8ee,
    exposure: 1.08,
    saturation: 1.02,
    bloomStrength: 0.16,
    bloomThreshold: 1.15,
    vignette: 0.32,
    signage: 0.28,
    interior: 0.72,
    starBase: 0,
  },
  dusk: {
    // 黄昏最怕"橙过头"：环境光一暖、gain 再暖、饱和度再高，
    // 人行道的砖底色（本身偏红棕）会被推到紫红，整张图失去可信度。
    // 解法是：暖光只给"光"，不给"色"—— hemi 与 key 都往中性偏暖靠，
    // 天空渐变承担大部分色相，地面主要靠冷蓝 fill 拉回平衡。
    hemiSky: 0xffc9a4,
    hemiGround: 0x5a5c78,
    hemiIntensity: 0.58,
    keyColor: 0xffc598,
    keyIntensity: 0.7,
    // 黄昏的太阳压得很低，从右前方打过来，拉出长影
    keyPos: [15, 6.5, 7.5],
    fillColor: 0x93a0dc,
    fillIntensity: 0.62,
    fogColor: 0xa894a4,
    fogDensity: 0.01,
    clearColor: 0x2c2440,
    skyZenith: 0x5e5688,
    skyHorizon: 0xd9a888,
    lift: 0x2b2836,
    gain: 0xfff2e6,
    exposure: 0.96,
    saturation: 0.96,
    bloomStrength: 0.3,
    bloomThreshold: 0.96,
    vignette: 0.44,
    signage: 0.72,
    interior: 0.9,
    starBase: 0.26,
  },
  night: {
    hemiSky: 0x5a76b4,
    hemiGround: 0x1a2230,
    hemiIntensity: 0.55,
    keyColor: 0xa8bcff,
    keyIntensity: 0.7,
    // 月亮留在后上方，和店里的暖光形成冷暖对撞
    keyPos: [-11, 16, -9],
    fillColor: 0x6d8cc8,
    fillIntensity: 0.4,
    fogColor: 0x0b1120,
    fogDensity: 0.018,
    clearColor: 0x05070d,
    skyZenith: 0x070c1a,
    skyHorizon: 0x16233c,
    lift: 0x101c33,
    gain: 0xfff4e2,
    exposure: 1.0,
    saturation: 1.14,
    bloomStrength: 0.42,
    bloomThreshold: 0.86,
    vignette: 0.55,
    signage: 1.0,
    interior: 1.0,
    starBase: 1.0,
  },
};

/**
 * 天气只修正「空气与降水」，不碰店内灯光，也不决定现在是几点。
 *
 * 关键做法：雾/天空/光色都不是硬编码一个天气色，而是把时段自己的颜色
 * 「去饱和 + 提亮」得到阴天版本。这样白天雨是灰白、黄昏雨是灰紫、
 * 夜晚雨是灰蓝 —— 同一套参数在三个时段都成立。
 */
interface WeatherProfile {
  rain: number;
  snow: number;
  wetness: number;
  /** 主光衰减：云把太阳/月亮挡住 */
  keyScale: number;
  /** 天光增强：阴天/雪天是漫射光 */
  hemiScale: number;
  fillScale: number;
  fogScale: number;
  fogDesat: number;
  fogLift: number;
  skyDesat: number;
  skyLift: number;
  keyDesat: number;
  keyLift: number;
  hemiDesat: number;
  hemiLift: number;
  exposure: number;
  saturation: number;
  bloomScale: number;
  bloomThresholdAdd: number;
  vignette: number;
  starTransmit: number;
}

const WEATHER: Record<Weather, WeatherProfile> = {
  clear: {
    rain: 0,
    snow: 0,
    wetness: 0.16,
    keyScale: 1.12,
    hemiScale: 1.0,
    fillScale: 1.0,
    fogScale: 0.82,
    fogDesat: 0,
    fogLift: 0,
    skyDesat: 0,
    skyLift: 0,
    keyDesat: 0,
    keyLift: 0,
    hemiDesat: 0,
    hemiLift: 0,
    exposure: 1.0,
    saturation: 1.0,
    bloomScale: 1.0,
    bloomThresholdAdd: 0.02,
    vignette: 1.0,
    starTransmit: 1,
  },
  rain: {
    rain: 1,
    snow: 0,
    wetness: 1,
    // 雨云把直射光压掉一半，天光反而更均匀
    keyScale: 0.55,
    hemiScale: 1.14,
    fillScale: 0.9,
    fogScale: 1.22,
    fogDesat: 0.5,
    fogLift: 0.05,
    skyDesat: 0.5,
    skyLift: 0.03,
    keyDesat: 0.55,
    keyLift: 0.03,
    hemiDesat: 0.35,
    hemiLift: 0,
    exposure: 0.98,
    saturation: 0.94,
    bloomScale: 0.95,
    bloomThresholdAdd: -0.02,
    vignette: 1.04,
    starTransmit: 0.12,
  },
  snow: {
    rain: 0,
    snow: 1,
    wetness: 0.05,
    // 雪天是最"闷"的：方向光很弱、天光很强，雾更浓更白
    keyScale: 0.45,
    hemiScale: 1.4,
    fillScale: 1.02,
    fogScale: 1.45,
    fogDesat: 0.62,
    fogLift: 0.16,
    skyDesat: 0.62,
    skyLift: 0.14,
    keyDesat: 0.65,
    keyLift: 0.08,
    hemiDesat: 0.45,
    hemiLift: 0.08,
    exposure: 1.05,
    saturation: 0.82,
    bloomScale: 0.72,
    bloomThresholdAdd: 0.08,
    vignette: 0.92,
    starTransmit: 0.24,
  },
};

const WHITE = new THREE.Color(0xffffff);

/** 把颜色往"阴天版本"推：去饱和，再往白色提一点。 */
function overcast(hex: number, desat: number, lift: number): number {
  if (desat <= 0 && lift <= 0) return hex;
  const c = new THREE.Color(hex);
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  const gray = new THREE.Color(lum, lum, lum);
  const out = gray.lerp(c, 1 - desat); // 保留一点原色相，避免死灰
  out.lerp(WHITE, lift);
  return out.getHex();
}

function mixHex(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

/**
 * 合成：时段基准 + 天气修正。纯函数，无状态 —— 3 × 3 组合都可以直接算出来，
 * 不需要为「白天雨」「黄昏雪」逐个写预设。
 */
function compose(time: TimeOfDay, weather: Weather): EnvPreset {
  const T = TIME[time];
  const W = WEATHER[weather];
  const cloud = W.skyDesat > 0 ? 1 : 0;

  const fogHaze = overcast(T.skyHorizon, W.fogDesat, W.fogLift);
  const skyZenithHaze = overcast(T.skyZenith, W.skyDesat, W.skyLift);
  const skyHorizonHaze = overcast(T.skyHorizon, W.skyDesat, W.skyLift);

  return {
    hemiSky: mixHex(T.hemiSky, overcast(T.hemiSky, W.hemiDesat, W.hemiLift), cloud * 0.65),
    hemiGround: mixHex(T.hemiGround, overcast(T.hemiGround, W.hemiDesat, W.hemiLift * 0.4), cloud * 0.45),
    hemiIntensity: T.hemiIntensity * W.hemiScale,
    keyColor: mixHex(T.keyColor, overcast(T.keyColor, W.keyDesat, W.keyLift), cloud * 0.75),
    keyIntensity: T.keyIntensity * W.keyScale,
    keyPos: [T.keyPos[0], T.keyPos[1], T.keyPos[2]],
    fillColor: T.fillColor,
    fillIntensity: T.fillIntensity * W.fillScale,
    fogColor: mixHex(T.fogColor, fogHaze, cloud * 0.8),
    fogDensity: T.fogDensity * W.fogScale,
    clearColor: mixHex(T.clearColor, fogHaze, cloud * 0.45),
    skyZenith: mixHex(T.skyZenith, skyZenithHaze, cloud * 0.85),
    skyHorizon: mixHex(T.skyHorizon, skyHorizonHaze, cloud * 0.78),
    lift: T.lift,
    gain: T.gain,
    exposure: T.exposure * W.exposure,
    saturation: T.saturation * W.saturation,
    bloomStrength: T.bloomStrength * W.bloomScale,
    bloomThreshold: T.bloomThreshold + W.bloomThresholdAdd,
    vignette: T.vignette * W.vignette,
    signage: T.signage,
    interior: T.interior,
    rainDensity: W.rain,
    snowAmount: W.snow,
    wetness: W.wetness,
    starOpacity: T.starBase * W.starTransmit,
  };
}

function lerpPreset(a: EnvPreset, b: EnvPreset, t: number): EnvPreset {
  const lc = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), t).getHex();
  const ln = (x: number, y: number) => x + (y - x) * t;
  return {
    hemiSky: lc(a.hemiSky, b.hemiSky),
    hemiGround: lc(a.hemiGround, b.hemiGround),
    hemiIntensity: ln(a.hemiIntensity, b.hemiIntensity),
    keyColor: lc(a.keyColor, b.keyColor),
    keyIntensity: ln(a.keyIntensity, b.keyIntensity),
    keyPos: [
      ln(a.keyPos[0], b.keyPos[0]),
      ln(a.keyPos[1], b.keyPos[1]),
      ln(a.keyPos[2], b.keyPos[2]),
    ],
    fillColor: lc(a.fillColor, b.fillColor),
    fillIntensity: ln(a.fillIntensity, b.fillIntensity),
    fogColor: lc(a.fogColor, b.fogColor),
    fogDensity: ln(a.fogDensity, b.fogDensity),
    clearColor: lc(a.clearColor, b.clearColor),
    skyZenith: lc(a.skyZenith, b.skyZenith),
    skyHorizon: lc(a.skyHorizon, b.skyHorizon),
    lift: lc(a.lift, b.lift),
    gain: lc(a.gain, b.gain),
    exposure: ln(a.exposure, b.exposure),
    saturation: ln(a.saturation, b.saturation),
    bloomStrength: ln(a.bloomStrength, b.bloomStrength),
    bloomThreshold: ln(a.bloomThreshold, b.bloomThreshold),
    vignette: ln(a.vignette, b.vignette),
    signage: ln(a.signage, b.signage),
    interior: ln(a.interior, b.interior),
    rainDensity: ln(a.rainDensity, b.rainDensity),
    snowAmount: ln(a.snowAmount, b.snowAmount),
    wetness: ln(a.wetness, b.wetness),
    starOpacity: ln(a.starOpacity, b.starOpacity),
  };
}

export interface EnvTargets {
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  /** 招牌 / 店内灯的"亮起来"程度（0..1） */
  applySignage: (v: number) => void;
  applyInterior: (v: number) => void;
  /** 雨丝 / 滴水 / 玻璃雨痕 / 体积光锥的浓度（0..1） */
  setRainDensity: (v: number) => void;
  /** 地面湿反光与积水暗斑的浓度（0..1） */
  setWetness: (v: number) => void;
  /** 夜空可见度（0..1）：由「时段基准 × 天气通透度」合成 */
  setStarOpacity: (v: number) => void;
  /** 飘雪粒子密度（0..1）：跟随天气，不跟随地面积雪进度 */
  setSnowfall: (v: number) => void;
  /** 地面积雪量（0..1），由 Environment 按缓慢速率累积后写入 */
  setSnow: (v: number) => void;
}

/**
 * 渲染侧的目标（雾 / 背景 / 后处理）。
 *
 * 单独拆出来是因为这些东西属于 main.ts，而灯光属于 world.ts。
 * Environment 在 world 里构造（它要管灯），构造后再由 main.ts bind()
 * 把渲染侧的引用交进来 —— 否则 world 得反过来依赖 renderer 和 pipeline，
 * 依赖方向就乱了。
 */
export interface RenderTargets {
  fog: THREE.FogExp2;
  renderer: THREE.WebGLRenderer;
  /** 天空渐变（星空球壳） */
  setSky: (zenith: number, horizon: number) => void;
  pipeline: {
    bloom: { strength: number; threshold: number };
    exposure: { value: number };
    setEnvironment: (o: {
      lift: number; gain: number; saturation: number; vignette: number;
    }) => void;
  };
}

export interface EnvDetails {
  time: TimeOfDay;
  weather: Weather;
  rain: number;
  snow: number;
  snowOnGround: number;
  wetness: number;
  starOpacity: number;
  keyIntensity: number;
  fogDensity: number;
  exposure: number;
  saturation: number;
}

export class Environment {
  private state: EnvState;
  private current: EnvPreset;
  private from: EnvPreset;
  private to: EnvPreset;
  private t = 1;
  private duration = 1.5;
  private render: RenderTargets | null = null;
  /** 状态变化时广播，UI 靠它同步高亮（避免 UI 与真实状态脱节） */
  private listeners: ((s: EnvState) => void)[] = [];

  /**
   * 当前积雪量 0..1。
   *
   * 关键：它**不受 1.5s 的时段过渡控制**，而是自己按固定速率爬升。
   * 雪是"慢慢积起来"的，几秒钟就铺满会显得很假；
   * 而且它必须能从任意中间状态接着长/接着化，不能每次切换就归零。
   */
  private snow = 0;
  /** 积雪累积速率（每秒进度）：约 12 秒铺满，之后停在 1 */
  private snowRate = 1 / 12;
  /** 融雪速率：比积雪快一些，切走雪天时不至于拖太久 */
  private meltRate = 1 / 5;
  /** 当前雪天的目标量：由天气决定 */
  private snowTarget = 0;

  constructor(private targets: EnvTargets, initial: EnvState) {
    this.state = { ...initial };
    const target = compose(initial.time, initial.weather);
    this.current = target;
    this.from = target;
    this.to = target;
    this.snowTarget = target.snowAmount;
    // 初始积雪从 0 开始慢慢积（?instant=1 会在 main.ts 里 snap 到终态）
    this.snow = 0;
    this.applyLights(target);
    this.targets.setSnow(this.snow);
  }

  /** 订阅状态变化，返回取消订阅函数 */
  onChange(fn: (s: EnvState) => void): () => void {
    this.listeners.push(fn);
    fn(this.get());
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  private emit(): void {
    const s = this.get();
    for (const fn of this.listeners) fn(s);
  }

  /** main.ts 在管线建好后调用；会把当前的渲染参数立刻推一次 */
  bindRender(rt: RenderTargets): void {
    this.render = rt;
    this.applyRender(this.current);
  }

  get(): EnvState {
    return { ...this.state };
  }

  /** 供 UI / 自动测试读取的当前合成结果（不是目标值，是插值中的实时值） */
  details(): EnvDetails {
    const p = this.current;
    return {
      time: this.state.time,
      weather: this.state.weather,
      rain: p.rainDensity,
      snow: p.snowAmount,
      snowOnGround: this.snow,
      wetness: p.wetness,
      starOpacity: p.starOpacity,
      keyIntensity: p.keyIntensity,
      fogDensity: p.fogDensity,
      exposure: p.exposure,
      saturation: p.saturation,
    };
  }

  /**
   * 切换环境。两个维度完全独立：
   *   set({ time: 'day' })            保留当前天气
   *   set({ weather: 'rain' })        保留当前时段
   *
   * @param instant 为 true 时立即生效（调试 / 截图用）
   */
  set(next: Partial<EnvState>, instant = false): void {
    const merged: EnvState = {
      time: next.time ?? this.state.time,
      weather: next.weather ?? this.state.weather,
    };
    if (!instant && merged.time === this.state.time && merged.weather === this.state.weather) {
      return;
    }
    this.state = merged;
    this.from = this.current;
    this.to = compose(merged.time, merged.weather);
    this.snowTarget = this.to.snowAmount;
    if (instant) {
      this.current = this.to;
      this.t = 1;
      this.snow = this.snowTarget;
      this.applyLights(this.to);
      this.applyRender(this.to);
      // instant 用于截图/调试：雪也要立刻到位，否则等 12 秒没法拍
      this.targets.setSnow(this.snow);
    } else {
      this.t = 0;
    }
    this.emit();
  }

  /** 在时段之间循环（演示用） */
  cycleTime(): EnvState {
    const order: TimeOfDay[] = ['day', 'dusk', 'night'];
    const i = order.indexOf(this.state.time);
    const next = order[(i + 1) % order.length];
    this.set({ time: next });
    return this.get();
  }

  toggleWeather(): EnvState {
    // 三档循环：晴 -> 雨 -> 雪 -> 晴
    const order: Weather[] = ['clear', 'rain', 'snow'];
    const i = order.indexOf(this.state.weather);
    this.set({ weather: order[(i + 1) % order.length] });
    return this.get();
  }

  /** 当前积雪量（0..1），调试用 */
  getSnow(): number {
    return this.snow;
  }

  update(dt: number): void {
    // 积雪独立于时段过渡：按自己的速率朝目标爬/退，到 1 就停
    this.updateSnow(dt);

    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    // smoothstep 让过渡两端更柔和，避免线性插值的"速度突变"感
    const e = this.t * this.t * (3 - 2 * this.t);
    this.current = lerpPreset(this.from, this.to, e);
    this.applyLights(this.current);
    this.applyRender(this.current);
  }

  /**
   * 积雪累积。
   *
   * 行为要求（来自使用者）：
   * - 切换下雪后地面、屋顶慢慢有雪
   * - 到一定厚度就停，不能越来越厚
   *
   * 所以这里是一个"朝目标爬、封顶在 1"的积分器：
   * 目标由天气决定（雪天 = 1，其它 = 0），
   * 用固定速率逼近，到 1 就自然停住（不会溢出）。
   * 融雪用更快的速率，避免切走后地上还留着雪。
   *
   * 注意：这里只写「地面积雪」，飘雪粒子由 applyLights 的 setSnowfall 控制。
   * 两者分开后，切到下雪的第一秒就能看见飘雪，而地面还在慢慢变白。
   */
  private updateSnow(dt: number): void {
    const target = this.snowTarget;
    if (Math.abs(this.snow - target) < 1e-4) {
      this.snow = target;
      return;
    }
    const rate = target > this.snow ? this.snowRate : this.meltRate;
    const step = rate * dt;
    if (this.snow < target) {
      this.snow = Math.min(target, this.snow + step);
    } else {
      this.snow = Math.max(target, this.snow - step);
    }
    this.targets.setSnow(this.snow);
  }

  /** 灯光 / 降水 / 地面积水：这部分 world 自己就能改 */
  private applyLights(p: EnvPreset): void {
    const T = this.targets;
    T.hemi.color.setHex(p.hemiSky);
    T.hemi.groundColor.setHex(p.hemiGround);
    T.hemi.intensity = p.hemiIntensity;

    T.key.color.setHex(p.keyColor);
    T.key.intensity = p.keyIntensity;
    T.key.position.set(p.keyPos[0], p.keyPos[1], p.keyPos[2]);

    T.fill.color.setHex(p.fillColor);
    T.fill.intensity = p.fillIntensity;

    T.applySignage(p.signage);
    T.applyInterior(p.interior);
    T.setRainDensity(p.rainDensity);
    T.setWetness(p.wetness);
    T.setStarOpacity(p.starOpacity);
    T.setSnowfall(p.snowAmount);
  }

  /** 雾 / 背景 / 后处理：这部分要等 main.ts 把引用交进来 */
  private applyRender(p: EnvPreset): void {
    const R = this.render;
    if (!R) return;
    R.fog.color.setHex(p.fogColor);
    R.fog.density = p.fogDensity;
    R.renderer.setClearColor(p.clearColor, 1);
    R.setSky(p.skyZenith, p.skyHorizon);

    R.pipeline.bloom.strength = p.bloomStrength;
    R.pipeline.bloom.threshold = p.bloomThreshold;
    R.pipeline.exposure.value = p.exposure;
    R.pipeline.setEnvironment({
      lift: p.lift,
      gain: p.gain,
      saturation: p.saturation,
      vignette: p.vignette,
    });
  }
}
