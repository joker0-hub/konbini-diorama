/**
 * 底部环境控制台。
 *
 * 设计目标：**两个维度必须一眼看出是独立的**。
 * 旧版把「白天」写成「晴日」，和天气的「晴」语义打架；按钮也只有纯文字，
 * 白天/黄昏/夜晚和晴/雨/雪挤在一条胶囊里，读起来像一排同级的标签。
 *
 * 新版：
 * - 左侧「时间」单选组（白天 / 黄昏 / 夜晚），右侧「天气」单选组（晴 / 雨 / 雪）
 * - 每组有自己的图标、标题和分段轨道；选中态是浅色实心片
 * - 顶部品牌点 + 「环境」标题，让它是"控制台"而不是一排按钮
 * - 桌面单行、手机双行（388px 宽也能完整放下，适合竖屏截图）
 * - 状态仍然单向流出：UI 只发指令，高亮由 Environment.onChange 回灌
 * - 键盘：1/2/3 切时段，4/5/6 切天气，T / W 循环，← → / ↑ ↓ 同组移动
 */

import type { EnvState, TimeOfDay, Weather } from '../scene/environment';

/* ---------------- 图标（线性、1.6px，和三渲二的描边同一种语言） ---------------- */

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const ICON = {
  day: svg(
    '<circle cx="12" cy="12" r="4.1"/>' +
      '<path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2"/>' +
      '<path d="m5.1 5.1 1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6"/>',
  ),
  dusk: svg(
    '<path d="M3.2 17.4h17.6"/><path d="M6.6 13.6a5.4 5.4 0 0 1 10.8 0"/>' +
      '<path d="M12 3.4v2.1M4.9 6.3l1.5 1.5M19.1 6.3l-1.5 1.5"/>' +
      '<path d="M2.8 20.6h18.4"/>',
  ),
  night: svg(
    '<path d="M20.4 14.6A8.2 8.2 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11Z"/>' +
      '<path d="M17.2 4.1v1.7M16.35 4.95h1.7"/>',
  ),
  clear: svg(
    '<circle cx="12" cy="12" r="4.1"/>' +
      '<path d="M12 2.4v2.2M12 19.4v2.2M2.4 12h2.2M19.4 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6"/>',
  ),
  rain: svg(
    '<path d="M7.1 15.4a3.3 3.3 0 0 1-.3-6.6 5.2 5.2 0 0 1 9.7-1.1 3.6 3.6 0 0 1 0 7.7"/>' +
      '<path d="M8.6 18.2 7.7 20.6M12 18.2l-.9 2.4M15.4 18.2l-.9 2.4"/>',
  ),
  snow: svg(
    '<path d="M12 2.6v18.8M4.0 7.4l16 9.2M20.0 7.4 4.0 16.6"/>' +
      '<path d="m9.4 4.3 2.6 2.6 2.6-2.6M9.4 19.7l2.6-2.6 2.6 2.6"/>' +
      '<path d="m4.7 10.2 3.5-.9-.9-3.5M19.3 13.8l-3.5.9.9 3.5M4.7 13.8l3.5.9-.9 3.5M19.3 10.2l-3.5-.9.9-3.5"/>',
  ),
};

interface Option<T> {
  value: T;
  label: string;
  hint: string;
  icon: string;
}

const TIME_OPTIONS: Option<TimeOfDay>[] = [
  { value: 'day', label: '白天', hint: '白天 · 1', icon: ICON.day },
  { value: 'dusk', label: '黄昏', hint: '黄昏 · 2', icon: ICON.dusk },
  { value: 'night', label: '夜晚', hint: '夜晚 · 3', icon: ICON.night },
];

const WEATHER_OPTIONS: Option<Weather>[] = [
  { value: 'clear', label: '晴', hint: '晴 · 4', icon: ICON.clear },
  { value: 'rain', label: '雨', hint: '雨 · 5', icon: ICON.rain },
  { value: 'snow', label: '雪', hint: '雪 · 6', icon: ICON.snow },
];

const TIME_ORDER: TimeOfDay[] = ['day', 'dusk', 'night'];
const WEATHER_ORDER: Weather[] = ['clear', 'rain', 'snow'];
const TIME_LABEL: Record<TimeOfDay, string> = { day: '白天', dusk: '黄昏', night: '夜晚' };
const WEATHER_LABEL: Record<Weather, string> = { clear: '晴', rain: '雨', snow: '雪' };
const THEME_COLOR: Record<TimeOfDay, string> = {
  day: '#9fb8d4',
  dusk: '#2c2440',
  night: '#05070d',
};

export interface EnvUI {
  setState: (s: EnvState) => void;
  destroy: () => void;
}

export function createEnvUI(
  host: HTMLElement,
  getState: () => EnvState,
  onChange: (patch: Partial<EnvState>) => void,
): EnvUI {
  const root = document.createElement('div');
  root.className = 'envbar';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', '环境控制：时间与天气');

  /* ---------------- 品牌 ---------------- */
  const brand = document.createElement('div');
  brand.className = 'envbar__brand';
  brand.innerHTML = '<span class="envbar__brand-dot" aria-hidden="true"></span><span>环境</span>';

  /* ---------------- 时间组 ---------------- */
  const timeSection = document.createElement('div');
  timeSection.className = 'envbar__section';
  const timeLabel = document.createElement('span');
  timeLabel.className = 'envbar__section-label';
  timeLabel.textContent = '时间';
  const timeGroup = document.createElement('div');
  timeGroup.className = 'envbar__group';
  timeGroup.setAttribute('role', 'radiogroup');
  timeGroup.setAttribute('aria-label', '时间');

  /* ---------------- 天气组 ---------------- */
  const weatherSection = document.createElement('div');
  weatherSection.className = 'envbar__section';
  const weatherLabel = document.createElement('span');
  weatherLabel.className = 'envbar__section-label';
  weatherLabel.textContent = '天气';
  const weatherGroup = document.createElement('div');
  weatherGroup.className = 'envbar__group';
  weatherGroup.setAttribute('role', 'radiogroup');
  weatherGroup.setAttribute('aria-label', '天气');

  const divider = document.createElement('div');
  divider.className = 'envbar__divider';
  divider.setAttribute('aria-hidden', 'true');

  const hint = document.createElement('div');
  hint.className = 'envbar__hint';
  hint.setAttribute('aria-hidden', 'true');
  hint.innerHTML = '<span>1–3</span><span>4–6</span>';

  const live = document.createElement('div');
  live.className = 'envbar__live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');

  const timeButtons = new Map<TimeOfDay, HTMLButtonElement>();
  const weatherButtons = new Map<Weather, HTMLButtonElement>();

  const makeButton = <T extends string>(
    opt: Option<T>,
    group: 'time' | 'weather',
    map: Map<T, HTMLButtonElement>,
  ): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'envbar__btn';
    btn.dataset.value = opt.value;
    btn.title = opt.hint;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.innerHTML =
      `<span class="envbar__icon">${opt.icon}</span>` +
      `<span class="envbar__label">${opt.label}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onChange(group === 'time' ? { time: opt.value as TimeOfDay } : { weather: opt.value as Weather });
    });
    map.set(opt.value, btn);
    return btn;
  };

  for (const opt of TIME_OPTIONS) timeGroup.appendChild(makeButton(opt, 'time', timeButtons));
  for (const opt of WEATHER_OPTIONS) weatherGroup.appendChild(makeButton(opt, 'weather', weatherButtons));

  timeSection.append(timeLabel, timeGroup);
  weatherSection.append(weatherLabel, weatherGroup);
  root.append(brand, timeSection, divider, weatherSection, hint, live);
  host.appendChild(root);

  let last: EnvState = getState();

  const setState = (s: EnvState): void => {
    last = s;
    root.dataset.time = s.time;
    root.dataset.weather = s.weather;
    for (const [v, btn] of timeButtons) {
      const on = v === s.time;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      // 只有选中项进入 tab 序列，其余用方向键切换（radiogroup 惯例）
      btn.tabIndex = on ? 0 : -1;
    }
    for (const [v, btn] of weatherButtons) {
      const on = v === s.weather;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
    }
    live.textContent = `时间：${TIME_LABEL[s.time]}；天气：${WEATHER_LABEL[s.weather]}`;

    // 页面外围也记住当前环境：主题色、标题、供 CSS 使用
    document.documentElement.dataset.time = s.time;
    document.documentElement.dataset.weather = s.weather;
    document.title = `ホシノマート — ${TIME_LABEL[s.time]}・${WEATHER_LABEL[s.weather]}`;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[s.time]);
  };

  /* ---------------- 键盘 ---------------- */
  // 1/2/3 时间，4/5/6 天气，T/W 循环。
  // 方向键按"当前焦点所在的组"工作；焦点不在控制台时按时间处理。
  const selectTime = (v: TimeOfDay, focus = false): void => {
    onChange({ time: v });
    if (focus) timeButtons.get(v)?.focus();
  };
  const selectWeather = (v: Weather, focus = false): void => {
    onChange({ weather: v });
    if (focus) weatherButtons.get(v)?.focus();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    const num = Number(key);
    if (num >= 1 && num <= 3) {
      e.preventDefault();
      selectTime(TIME_ORDER[num - 1], true);
      return;
    }
    if (num >= 4 && num <= 6) {
      e.preventDefault();
      selectWeather(WEATHER_ORDER[num - 4], true);
      return;
    }
    if (key === 't' || key === 'T') {
      e.preventDefault();
      const next = TIME_ORDER[(TIME_ORDER.indexOf(last.time) + 1) % TIME_ORDER.length];
      selectTime(next, true);
      return;
    }
    if (key === 'w' || key === 'W') {
      e.preventDefault();
      const next = WEATHER_ORDER[(WEATHER_ORDER.indexOf(last.weather) + 1) % WEATHER_ORDER.length];
      selectWeather(next, true);
      return;
    }

    const inWeather = Boolean(document.activeElement && weatherGroup.contains(document.activeElement));
    const inTime = Boolean(document.activeElement && timeGroup.contains(document.activeElement));

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      e.preventDefault();
      const dir = key === 'ArrowRight' ? 1 : -1;
      if (inWeather) {
        const i = WEATHER_ORDER.indexOf(last.weather);
        selectWeather(WEATHER_ORDER[(i + dir + WEATHER_ORDER.length) % WEATHER_ORDER.length], true);
      } else {
        const i = TIME_ORDER.indexOf(last.time);
        selectTime(TIME_ORDER[(i + dir + TIME_ORDER.length) % TIME_ORDER.length], true);
      }
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault();
      const dir = key === 'ArrowDown' ? 1 : -1;
      if (inTime && !inWeather) {
        const i = TIME_ORDER.indexOf(last.time);
        selectTime(TIME_ORDER[(i + dir + TIME_ORDER.length) % TIME_ORDER.length], true);
      } else {
        const i = WEATHER_ORDER.indexOf(last.weather);
        selectWeather(WEATHER_ORDER[(i + dir + WEATHER_ORDER.length) % WEATHER_ORDER.length], true);
      }
    }
  };
  window.addEventListener('keydown', onKey);

  // 避免点击条本身冒泡到 canvas（OrbitControls 会把拖拽当成旋转开始）
  const stop = (e: Event): void => e.stopPropagation();
  root.addEventListener('pointerdown', stop);
  root.addEventListener('pointerup', stop);
  root.addEventListener('pointercancel', stop);
  root.addEventListener('wheel', stop, { passive: true });

  setState(getState());

  return {
    setState,
    destroy() {
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
