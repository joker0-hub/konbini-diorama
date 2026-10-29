import type { SakuraParameters } from '../scene/sakura';

interface ParameterControl {
  key: keyof SakuraParameters;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
}

/**
 * 面板控件定义。
 *
 * `value` 必须与 `scene/sakura.ts` 的 DEFAULT_PARAMETERS 一一对应：
 * 滑块显示的是这里的 value，模型用的是那边的默认值，
 * 两边不一致时会出现"滑块显示 0.80×、模型却是 1.45×"的错位。
 */
const CONTROLS: ParameterControl[] = [
  { key: 'blossomScale', label: '樱花单簇蓬松度', min: 0.5, max: 1.5, step: 0.02, value: 0.8, format: (v) => `${v.toFixed(2)}×` },
  { key: 'depthFullness', label: '前后纵深饱和度', min: 0.7, max: 1.5, step: 0.02, value: 1.2, format: (v) => `${v.toFixed(2)}×` },
  { key: 'frontThinning', label: '正面透枝疏花度', min: 0, max: 100, step: 1, value: 80, format: (v) => `${Math.round(v)}%` },
  { key: 'petalIntensity', label: '落樱强度', min: 0, max: 2.5, step: 0.05, value: 0.85, format: (v) => v.toFixed(2) },
];

export interface SakuraPanel {
  setOpen: (open: boolean) => void;
  isOpen: () => boolean;
  destroy: () => void;
}

export function createSakuraPanel(
  host: HTMLElement,
  onChange: (patch: Partial<SakuraParameters>) => void,
): SakuraPanel {
  const panel = document.createElement('aside');
  panel.className = 'sakura-panel';
  panel.setAttribute('aria-label', '樱花树环境参数控制');
  panel.setAttribute('aria-hidden', 'true');
  panel.hidden = true;

  const header = document.createElement('header');
  header.className = 'sakura-panel__header';
  const title = document.createElement('div');
  title.className = 'sakura-panel__title';
  title.innerHTML = '<span class="sakura-panel__dot" aria-hidden="true"></span><span>环境参数控制</span>';

  const close = document.createElement('button');
  close.className = 'sakura-panel__close';
  close.type = 'button';
  close.setAttribute('aria-label', '收起参数面板');
  close.title = '收起';
  close.innerHTML = '<span>收起</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

  const controls = document.createElement('div');
  controls.className = 'sakura-panel__controls';

  for (const definition of CONTROLS) {
    const row = document.createElement('label');
    row.className = 'sakura-panel__control';
    const top = document.createElement('span');
    top.className = 'sakura-panel__control-top';
    const label = document.createElement('span');
    label.className = 'sakura-panel__label';
    label.textContent = definition.label;
    const output = document.createElement('output');
    output.className = 'sakura-panel__value';
    output.value = definition.format(definition.value);
    top.append(label, output);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(definition.min);
    input.max = String(definition.max);
    input.step = String(definition.step);
    input.value = String(definition.value);
    input.dataset.parameter = definition.key;
    input.setAttribute('aria-label', definition.label);
    input.addEventListener('input', () => {
      const rawValue = Number(input.value);
      output.value = definition.format(rawValue);
      const value = definition.key === 'frontThinning' ? rawValue / 100 : rawValue;
      onChange({ [definition.key]: value });
    });
    row.append(top, input);
    controls.append(row);
  }

  header.append(title, close);
  panel.append(header, controls);
  host.append(panel);

  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    panel.hidden = !open;
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  };
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(false);
  });

  const stop = (event: Event): void => event.stopPropagation();
  panel.addEventListener('pointerdown', stop);
  panel.addEventListener('pointerup', stop);
  panel.addEventListener('pointercancel', stop);
  panel.addEventListener('wheel', stop, { passive: true });

  return {
    setOpen,
    isOpen: () => open,
    destroy: () => panel.remove(),
  };
}
