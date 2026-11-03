import type { Soundscape, VolumeChannel } from '../audio/soundscape';
import './vending-panel.css';
import './sound-panel.css';

const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path class="sound-waves" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="sound-cross" d="m16 9 6 6m0-6-6 6"/></svg>';

/** Shares the same native modal, headings, close button and sliders as scene panels. */
export function createSoundPanel(host: HTMLElement, sound: Soundscape, beforeOpen: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sound-toggle';
  button.innerHTML = SPEAKER;
  button.title = '声音设置';
  button.setAttribute('aria-label', '打开声音控制面板');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-controls', 'sound-panel');
  button.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('dialog');
  panel.id = 'sound-panel';
  panel.className = 'sound-panel interaction-panel';
  panel.setAttribute('aria-labelledby', 'sound-panel-title');
  panel.setAttribute('aria-describedby', 'sound-panel-hint');
  panel.innerHTML = `
    <header class="interaction-panel__header">
      <div><span class="interaction-panel__eyebrow">HOSHINO · SOUND</span><h2 id="sound-panel-title">街角的声音</h2></div>
      <button type="button" class="interaction-panel__close" aria-label="关闭声音面板" title="关闭（Esc）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </header>
    <p id="sound-panel-hint" class="interaction-panel__hint">听一场雨，留一首歌。声音随天气与昼夜流转。</p>
    <button type="button" class="sound-panel__mute" aria-pressed="false">${SPEAKER}<span>声音已开启</span><small>点击静音</small></button>
    <div class="sound-panel__mix interaction-panel__controls"></div>
    <section class="sound-panel__track" aria-label="背景音乐">
      <div class="sound-panel__track-top"><span class="interaction-panel__eyebrow">NOW PLAYING</span><span class="sound-panel__loop">单曲循环</span></div>
      <div class="sound-panel__song">NIGHT DANCER</div><div class="sound-panel__artist">imase</div>
      <div class="sound-panel__actions"><button type="button" class="sound-panel__play" disabled>播放音乐</button><button type="button" class="sound-panel__choose">选择音频</button></div>
      <input class="sound-panel__file" type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac" aria-label="选择背景音乐文件" hidden>
      <p class="sound-panel__status" role="status" aria-live="polite"></p>
    </section>`;
  host.append(button, panel);
  const closeButton = panel.querySelector<HTMLButtonElement>('.interaction-panel__close')!;
  const mute = panel.querySelector<HTMLButtonElement>('.sound-panel__mute')!;
  const play = panel.querySelector<HTMLButtonElement>('.sound-panel__play')!;
  const choose = panel.querySelector<HTMLButtonElement>('.sound-panel__choose')!;
  const fileInput = panel.querySelector<HTMLInputElement>('.sound-panel__file')!;
  const status = panel.querySelector<HTMLElement>('.sound-panel__status')!;
  const controls = new Map<VolumeChannel, { input: HTMLInputElement; output: HTMLOutputElement }>();
  const definitions: [VolumeChannel, string, string][] = [
    ['master', '总音量', '所有声音的音量'], ['ambience', '环境音', '风雨 · 鸟鸣 · 夜虫'],
    ['effects', '交互音效', '购买 · 掉落 · 回收'], ['music', '背景音乐', '为街角选一首歌'],
  ];
  for (const [channel, label, description] of definitions) {
    const row = document.createElement('label');
    row.className = 'interaction-panel__control';
    row.innerHTML = `<span class="interaction-panel__control-top"><span class="interaction-panel__label">${label}<small>${description}</small></span><output class="interaction-panel__value"></output></span>`;
    const input = document.createElement('input');
    input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '1';
    input.dataset.channel = channel;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => sound.setVolume(channel, Number(input.value) / 100));
    const output = row.querySelector('output')!;
    row.append(input);
    panel.querySelector('.sound-panel__mix')!.append(row);
    controls.set(channel, { input, output });
  }

  const unsubscribe = sound.subscribe((state) => {
    const silent = state.muted || state.master === 0;
    button.dataset.muted = String(silent);
    button.dataset.ready = String(state.ready);
    button.title = silent ? '声音设置 · 已静音' : '声音设置';
    mute.dataset.muted = String(silent);
    mute.setAttribute('aria-pressed', String(state.muted));
    mute.setAttribute('aria-label', state.muted ? '取消静音' : '静音所有声音');
    mute.querySelector('span')!.textContent = state.muted ? '声音已静音' : state.master === 0 ? '总音量为零' : '声音已开启';
    mute.querySelector('small')!.textContent = state.muted ? '点击开启' : '点击静音';
    for (const [channel, control] of controls) {
      control.input.value = String(Math.round(state[channel] * 100));
      control.input.setAttribute('aria-valuetext', `${control.input.value}%`);
      control.output.value = `${control.input.value}%`;
    }
    const [song, artist] = state.trackName.split(' · ');
    panel.querySelector('.sound-panel__song')!.textContent = song;
    panel.querySelector('.sound-panel__artist')!.textContent = artist || '本地音频';
    play.disabled = !state.trackLoaded || !state.supported;
    play.textContent = state.musicWanted ? '暂停音乐' : '播放音乐';
    play.setAttribute('aria-label', state.musicWanted ? '暂停背景音乐' : '播放背景音乐');
    panel.querySelector('.sound-panel__track')!.classList.toggle('is-playing', state.musicPlaying);
    status.textContent = !state.supported ? '当前浏览器暂不支持声音播放' : state.message ||
      (!state.trackLoaded ? '选择《NIGHT DANCER》音频文件，即可在街角循环播放。' :
        state.muted ? '已静音，取消静音后继续播放' : state.musicWanted && state.music === 0 ? '音乐音量为 0，调高后继续播放' :
          state.musicWanted && state.master === 0 ? '总音量为 0，调高后继续播放' :
            state.musicPlaying ? '正在播放 · 关闭面板后继续聆听' : '音频已就绪');
  });

  let outsideStart = false;
  let returnFocus: HTMLElement | null = null;
  const setOpen = (next: boolean): void => {
    if (next === panel.open) return;
    if (next) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      beforeOpen();
      panel.showModal();
      closeButton.focus({ preventScroll: true });
      void sound.unlock();
      sound.play('ui');
    } else {
      panel.close();
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      returnFocus = null;
    }
    outsideStart = false;
    button.setAttribute('aria-expanded', String(next));
  };
  button.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  mute.addEventListener('click', () => sound.setMuted(!sound.getState().muted));
  play.addEventListener('click', () => sound.setMusicPlaying(!sound.getState().musicWanted));
  choose.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) sound.loadMusic(file);
    fileInput.value = '';
  });
  const outside = (event: PointerEvent): boolean => {
    const r = panel.getBoundingClientRect();
    return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
  };
  panel.addEventListener('cancel', (event) => { event.preventDefault(); setOpen(false); });
  panel.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
  });
  panel.addEventListener('keyup', (event) => event.stopPropagation());
  panel.addEventListener('pointerdown', (event) => {
    event.stopPropagation(); outsideStart = event.target === panel && outside(event);
  });
  panel.addEventListener('pointerup', (event) => {
    event.stopPropagation();
    if (outsideStart && event.target === panel && outside(event)) setOpen(false);
    outsideStart = false;
  });
  panel.addEventListener('pointercancel', (event) => { event.stopPropagation(); outsideStart = false; });
  panel.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });

  return {
    setOpen,
    isOpen: () => panel.open,
    setVisible(visible: boolean) { button.hidden = !visible; },
    destroy() { setOpen(false); unsubscribe(); button.remove(); panel.remove(); },
  };
}
