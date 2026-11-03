import type { EnvState } from '../scene/environment';

export type SoundEffect = 'purchase' | 'impact' | 'pickup' | 'recycle' | 'ui';
export type VolumeChannel = 'master' | 'ambience' | 'effects' | 'music';
export interface SoundSettings {
  master: number;
  ambience: number;
  effects: number;
  music: number;
  muted: boolean;
}
export interface SoundState extends SoundSettings {
  ready: boolean;
  supported: boolean;
  trackLoaded: boolean;
  trackName: string;
  musicPlaying: boolean;
  musicWanted: boolean;
  message: string;
}

const STORAGE_KEY = 'hoshino-sound-v1';
const DEFAULTS: SoundSettings = { master: 0.65, ambience: 0.6, effects: 0.65, music: 0.35, muted: false };
const clamp = (v: number): number => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;

// Project-relative so the bundled song also works on GitHub Pages subpaths.
const BUNDLED_MUSIC = 'audio/night-dancer.mp3';

/** One lazy audio graph; procedural ambience and SFX need no downloads. */
export function createSoundscape(initial: EnvState) {
  let settings = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const key of ['master', 'ambience', 'effects', 'music'] as const) {
        if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) settings[key] = clamp(saved[key]);
      }
      if (typeof saved.muted === 'boolean') settings.muted = saved.muted;
    }
  } catch { /* Storage may be disabled. */ }

  let environment = { ...initial };
  let context: AudioContext | undefined;
  let master: GainNode;
  let ambience: GainNode;
  let effects: GainNode;
  let musicGain: GainNode;
  let analyser: AnalyserNode;
  const waveform = new Float32Array(512);
  let rain: GainNode;
  let wind: GainNode;
  let hum: GainNode;
  let noise: AudioBuffer;
  let active = false;
  let destroyed = false;
  let objectUrl: string | undefined;
  let musicWanted = false;
  let message = '';
  let trackName = 'NIGHT DANCER · imase';
  let lastEffect = 0;
  let lastImpact = 0;
  let lastBird = 0;
  const listeners = new Set<(state: SoundState) => void>();
  const sources = new Set<AudioScheduledSourceNode>();
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'metadata';
  if (BUNDLED_MUSIC) audio.src = new URL(BUNDLED_MUSIC, new URL(import.meta.env.BASE_URL, location.href)).href;

  const getState = (): SoundState => ({
    ...settings, ready: context?.state === 'running', supported: typeof AudioContext !== 'undefined',
    trackLoaded: Boolean(audio.getAttribute('src')), trackName,
    musicPlaying: !audio.paused, musicWanted, message,
  });
  const emit = (): void => { if (!destroyed) for (const listener of listeners) listener(getState()); };
  const persist = (): void => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Session-only fallback. */ }
  };
  function ramp(param: AudioParam, value: number, seconds = 0.12): void {
    if (!context) return;
    param.cancelScheduledValues(context.currentTime);
    param.setTargetAtTime(value, context.currentTime, seconds);
  }
  function syncVolumes(): void {
    if (!context) return;
    ramp(master.gain, active && !document.hidden && !settings.muted ? settings.master : 0, 0.035);
    ramp(ambience.gain, settings.ambience);
    ramp(effects.gain, settings.effects);
    ramp(musicGain.gain, settings.music);
    // Pause the track while inaudible; its position is preserved.
    if (!active || document.hidden || settings.muted || settings.master === 0 || settings.music === 0 || !musicWanted) audio.pause();
  }
  function syncEnvironment(): void {
    if (!context) return;
    ramp(rain.gain, environment.weather === 'rain' ? 0.27 : 0, 0.5);
    ramp(wind.gain, environment.weather === 'snow' ? 0.23 : environment.weather === 'rain' ? 0.09 : 0.07, 0.6);
    ramp(hum.gain, environment.time === 'night' ? 0.012 : 0.006, 0.6);
  }
  function own<T extends AudioScheduledSourceNode>(source: T, cleanup: AudioNode[] = []): T {
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
      for (const node of cleanup) node.disconnect();
    };
    return source;
  }
  function tone(frequency: number, duration: number, volume: number, bus: AudioNode, delay = 0,
    endFrequency = frequency, type: OscillatorType = 'sine'): void {
    if (!context) return;
    const t = context.currentTime + delay;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    gain.connect(bus);
    const oscillator = own(context.createOscillator(), [gain]);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
    oscillator.connect(gain);
    oscillator.start(t);
    oscillator.stop(t + duration + 0.02);
  }
  function noiseLayer(type: BiquadFilterType, frequency: number, level: GainNode): void {
    const source = own(context!.createBufferSource());
    source.buffer = noise;
    source.loop = true;
    const filter = context!.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.55;
    source.connect(filter).connect(level).connect(ambience);
    source.start(0, Math.random() * 4);
  }
  function buildGraph(): void {
    const ctx = context!;
    master = ctx.createGain();
    master.gain.value = 0;
    // Leave headroom and catch overlapping bottle impacts.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 12;
    limiter.ratio.value = 5;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    master.connect(limiter).connect(analyser).connect(ctx.destination);
    ambience = ctx.createGain();
    effects = ctx.createGain();
    musicGain = ctx.createGain();
    ambience.connect(master); effects.connect(master); musicGain.connect(master);
    ctx.createMediaElementSource(audio).connect(musicGain);
    noise = ctx.createBuffer(2, ctx.sampleRate * 6, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = noise.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    rain = ctx.createGain(); rain.gain.value = 0;
    wind = ctx.createGain(); wind.gain.value = 0;
    hum = ctx.createGain(); hum.gain.value = 0;
    noiseLayer('highpass', 800, rain);
    noiseLayer('lowpass', 360, wind);
    const breeze = own(ctx.createOscillator());
    const depth = ctx.createGain();
    breeze.frequency.value = 0.13;
    depth.gain.value = 0.025;
    breeze.connect(depth).connect(wind.gain);
    breeze.start();
    const motor = own(ctx.createOscillator());
    motor.frequency.value = 110;
    motor.connect(hum).connect(ambience);
    motor.start();
    syncVolumes(); syncEnvironment();
  }
  async function playMusic(): Promise<void> {
    if (!musicWanted || !audio.src || !active || document.hidden || settings.muted || settings.master === 0 || settings.music === 0 || context?.state !== 'running') return;
    try { await audio.play(); message = ''; }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      message = audio.error ? '音频无法播放，请选择 MP3、M4A、OGG 或 WAV 文件' : '点击播放，开启背景音乐';
    }
    emit();
  }
  async function unlock(): Promise<void> {
    if (destroyed || typeof AudioContext === 'undefined') return;
    try {
      if (!context) {
        context = new AudioContext();
        buildGraph();
        context.onstatechange = emit;
      }
      if (context.state === 'suspended' && !document.hidden) await context.resume();
      syncVolumes();
      await playMusic();
      emit();
    } catch { message = '声音暂时无法启动，请再次点击声音按钮'; emit(); }
  }
  const gesture = (event: Event): void => {
    if (event.isTrusted && (!context || context.state === 'suspended')) void unlock();
  };
  window.addEventListener('pointerdown', gesture, true);
  window.addEventListener('keydown', gesture, true);
  function visibility(): void {
    syncVolumes();
    if (document.hidden) {
      audio.pause();
      if (context?.state === 'running') void context.suspend().catch(() => {});
    } else if (context) void unlock();
  }
  document.addEventListener('visibilitychange', visibility);
  const musicEvent = (): void => emit();
  const musicError = (): void => { message = '音频无法播放，请重新选择音频文件'; musicWanted = false; emit(); };
  audio.addEventListener('play', musicEvent);
  audio.addEventListener('pause', musicEvent);
  audio.addEventListener('error', musicError);

  // Sparse birds in daylight and short insect pulses at night, silenced in rain/snow.
  const wildlife = window.setInterval(() => {
    if (!context || context.state !== 'running' || !active || document.hidden || settings.muted || settings.master === 0 || settings.ambience === 0 || environment.weather !== 'clear') return;
    if (environment.time === 'day') {
      if (context.currentTime - lastBird < 6) return;
      lastBird = context.currentTime;
      tone(2200, 0.16, 0.018, ambience, 0, 3400);
      tone(3000, 0.19, 0.014, ambience, 0.22, 2300);
    } else {
      for (let i = 0; i < 3; i++) tone(4200, 0.055, 0.009, ambience, i * 0.12, 4400);
    }
  }, 1700);

  return {
    getState,
    unlock,
    subscribe(listener: (state: SoundState) => void) {
      listeners.add(listener); listener(getState());
      return () => { listeners.delete(listener); };
    },
    setActive(next: boolean) {
      if (active === next) return;
      active = next; syncVolumes();
      if (next) void playMusic();
    },
    setEnvironment(next: EnvState) { environment = { ...next }; syncEnvironment(); },
    setVolume(channel: VolumeChannel, value: number) {
      settings[channel] = clamp(value); persist(); syncVolumes(); void playMusic(); emit();
    },
    setMuted(next: boolean) {
      settings.muted = next; persist(); syncVolumes();
      if (!next) void unlock();
      emit();
    },
    setMusicPlaying(next: boolean) {
      musicWanted = next && Boolean(audio.src);
      if (musicWanted) void unlock();
      else audio.pause();
      emit();
    },
    loadMusic(file: File) {
      if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|ogg|wav|aac|flac|webm)$/i.test(file.name)) {
        message = '请选择音频文件'; emit(); return;
      }
      audio.pause();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);
      audio.src = objectUrl;
      trackName = /night[ _-]*dancer/i.test(file.name) ? 'NIGHT DANCER · imase' : file.name.replace(/\.[^.]+$/, '');
      message = ''; musicWanted = true;
      void unlock(); emit();
    },
    play(effect: SoundEffect, strength = 1) {
      if (!context || context.state !== 'running' || !active || document.hidden || settings.muted || settings.effects === 0 || settings.master === 0) return;
      const now = context.currentTime;
      if (effect === 'impact' && now - lastImpact < 0.09) return;
      if (effect === 'impact') lastImpact = now;
      lastEffect = now;
      const v = clamp(strength);
      if (effect === 'purchase') {
        tone(880, 0.12, 0.085, effects); tone(1320, 0.2, 0.065, effects, 0.13);
        tone(130, 0.45, 0.06, effects, 0.1, 65, 'triangle');
      } else if (effect === 'impact') {
        tone(190 + Math.random() * 90, 0.11, 0.13 * v, effects, 0, 75, 'triangle');
        const source = own(context.createBufferSource());
        const gain = context.createGain();
        const filter = context.createBiquadFilter();
        source.buffer = noise;
        filter.type = 'lowpass'; filter.frequency.value = 1700;
        gain.gain.setValueAtTime(0.08 * v, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
        source.connect(filter).connect(gain).connect(effects);
        source.onended = () => { sources.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
        source.start(); source.stop(now + 0.08);
      } else if (effect === 'pickup') tone(500, 0.12, 0.045, effects, 0, 800);
      else if (effect === 'recycle') {
        tone(280, 0.14, 0.08, effects, 0, 120, 'triangle');
        tone(1046, 0.2, 0.04, effects, 0.12); tone(1568, 0.24, 0.035, effects, 0.23);
      } else tone(740, 0.07, 0.025, effects, 0, 620);
    },
    /** Useful for verifying the real output graph without audio-device access. */
    inspect() {
      analyser?.getFloatTimeDomainData(waveform);
      const rms = Math.sqrt(waveform.reduce((sum, v) => sum + v * v, 0) / waveform.length);
      return { context: context?.state ?? 'uninitialized', active,
        environment: { ...environment }, lastEffect, sources: sources.size, rms,
        rain: rain?.gain.value ?? 0, wind: wind?.gain.value ?? 0,
        master: master?.gain.value ?? 0, musicTime: audio.currentTime };
    },
    destroy() {
      destroyed = true;
      window.clearInterval(wildlife);
      window.removeEventListener('pointerdown', gesture, true);
      window.removeEventListener('keydown', gesture, true);
      document.removeEventListener('visibilitychange', visibility);
      audio.removeEventListener('play', musicEvent);
      audio.removeEventListener('pause', musicEvent);
      audio.removeEventListener('error', musicError);
      audio.pause(); audio.removeAttribute('src'); audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      for (const source of sources) { try { source.stop(); } catch { /* Already stopped. */ } source.disconnect(); }
      sources.clear(); listeners.clear();
      if (context) { context.onstatechange = null; void context.close().catch(() => {}); }
    },
  };
}

export type Soundscape = ReturnType<typeof createSoundscape>;
