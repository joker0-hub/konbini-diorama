/**
 * 代码开场动画。
 *
 * 不是"黑屏淡入"，而是一段正在编译这个场景的脚本：
 * 逐字敲出 `buildWorld({ time: 'day', weather: 'rain' })`，
 * 敲完后标题浮出、两扇门向左右滑开，露出背后已经组装到一半的微缩模型。
 *
 * 全部由 DOM + CSS + requestAnimationFrame 生成：
 * 没有图片、没有视频、没有字体文件，和整个项目"零二进制资源"的约定一致。
 *
 * 交互：
 * - 点击 / 任意按键立即跳过
 * - ?intro=0、?instant=1、prefers-reduced-motion 时完全不创建
 */

/* ---------------- 要"敲"出来的那几行代码 ---------------- */

interface Tok {
  text: string;
  cls?: 'com' | 'kw' | 'str' | 'fn' | 'num' | 'prop' | 'var';
}

/** 代码里的 time / weather 必须和实际首屏环境一致，不能永远写 day/rain */
function buildCode(time: string, weather: string): Tok[][] {
  return [
    [{ text: '// konbini-diorama — opening sequence', cls: 'com' }],
    [
      { text: 'const ', cls: 'kw' },
      { text: 'world', cls: 'var' },
      { text: ' = ' },
      { text: 'buildWorld', cls: 'fn' },
      { text: '({ ' },
      { text: 'time', cls: 'prop' },
      { text: ': ' },
      { text: `'${time}'`, cls: 'str' },
      { text: ', ' },
      { text: 'weather', cls: 'prop' },
      { text: ': ' },
      { text: `'${weather}'`, cls: 'str' },
      { text: ' })' },
    ],
    [
      { text: 'world', cls: 'var' },
      { text: '.' },
      { text: 'assembly', cls: 'prop' },
      { text: '.' },
      { text: 'play', cls: 'fn' },
      { text: '()' },
    ],
    [
      { text: 'await ', cls: 'kw' },
      { text: 'world', cls: 'var' },
      { text: '.' },
      { text: 'rain', cls: 'prop' },
      { text: '.' },
      { text: 'ready', cls: 'fn' },
      { text: '()' },
      { text: '  ' },
      { text: '// 3000 drops', cls: 'com' },
    ],
    [
      { text: 'console', cls: 'var' },
      { text: '.' },
      { text: 'log', cls: 'fn' },
      { text: '(' },
      { text: "'OPEN 24 HOURS'", cls: 'str' },
      { text: ')' },
    ],
  ];
}

/** 每个字的敲击间隔（ms）；约 60 字/秒，比真人打字快，但能看清节奏 */
const CHAR_MS = 16;
/** 敲完后停留多久再开门 */
const HOLD_MS = 950;
/** 门扇滑开所需时间，必须和 CSS 的 transition 对上 */
const OPEN_MS = 1050;
/** 跳过时门扇的快速滑动时间 */
const SKIP_MS = 340;

interface TokenEl {
  el: HTMLSpanElement;
  text: string;
}

export interface CodeOpening {
  /** 跳过（如果已经打开则无操作） */
  skip: () => void;
  /** 直接销毁，不再有动画 */
  destroy: () => void;
  /** 是否仍在屏幕上（含滑门过程） */
  readonly isRunning: boolean;
}

const noopOpening: CodeOpening = {
  skip() {},
  destroy() {},
  isRunning: false,
};

/* ------------------------------------------------------------------ */

export function createCodeOpening(
  opts: { disabled?: boolean; time?: string; weather?: string } = {},
): CodeOpening {
  if (opts.disabled || typeof document === 'undefined') return noopOpening;

  const time = (opts.time ?? 'day').toLowerCase();
  const weather = (opts.weather ?? 'rain').toLowerCase();
  const CODE = buildCode(time, weather);

  const root = document.createElement('div');
  root.className = 'intro';
  root.setAttribute('aria-hidden', 'true');

  /* ---------------- 两扇门 ---------------- */
  const leaves = document.createElement('div');
  leaves.className = 'intro__leaves';
  const leafL = document.createElement('div');
  leafL.className = 'intro__leaf intro__leaf--l';
  const leafR = document.createElement('div');
  leafR.className = 'intro__leaf intro__leaf--r';
  leaves.append(leafL, leafR);

  /* ---------------- 内容 ---------------- */
  const content = document.createElement('div');
  content.className = 'intro__content';

  const top = document.createElement('header');
  top.className = 'intro__top';
  top.innerHTML =
    '<span class="intro__tag">konbini-diorama</span>' +
    '<span class="intro__sign">OPEN 24 HOURS</span>' +
    `<span class="intro__env">${time.toUpperCase()} · ${weather.toUpperCase()}</span>`;

  const center = document.createElement('div');
  center.className = 'intro__center';

  const codeBox = document.createElement('div');
  codeBox.className = 'intro__code';
  const codeHead = document.createElement('div');
  codeHead.className = 'intro__code-head';
  codeHead.innerHTML = '<span></span><span></span><span></span><em>konbini.scene.ts</em>';
  const list = document.createElement('ol');
  list.className = 'intro__lines';

  const tokenEls: TokenEl[][] = [];
  const lineEls: HTMLLIElement[] = [];
  const lineLens: number[] = [];

  CODE.forEach((line, i) => {
    const li = document.createElement('li');
    const ln = document.createElement('span');
    ln.className = 'intro__ln';
    ln.textContent = String(i + 1).padStart(2, '0');
    const src = document.createElement('span');
    src.className = 'intro__src';
    const toks: TokenEl[] = [];
    let len = 0;
    for (const tok of line) {
      const span = document.createElement('span');
      if (tok.cls) span.className = `tok-${tok.cls}`;
      src.appendChild(span);
      toks.push({ el: span, text: tok.text });
      len += tok.text.length;
    }
    li.append(ln, src);
    list.appendChild(li);
    lineEls.push(li);
    tokenEls.push(toks);
    lineLens.push(len);
  });

  const lineStarts: number[] = [];
  let totalChars = 0;
  for (const len of lineLens) {
    lineStarts.push(totalChars);
    totalChars += len;
  }

  codeBox.append(codeHead, list);

  const title = document.createElement('div');
  title.className = 'intro__title';
  title.innerHTML =
    '<p class="intro__title-jp">ホシノマート</p>' +
    '<span class="intro__title-en">HOSHINO MART · KONBINI DIORAMA</span>';

  center.append(codeBox, title);

  const bottom = document.createElement('footer');
  bottom.className = 'intro__bottom';
  bottom.innerHTML =
    '<span class="intro__status"><i></i><b>booting scene</b></span>' +
    '<span class="intro__meter"><i></i></span>' +
    '<span class="intro__skip">click / key to skip</span>';

  const meterFill = bottom.querySelector('.intro__meter i') as HTMLElement;
  const statusText = bottom.querySelector('.intro__status b') as HTMLElement;
  const counter = document.createElement('span');
  counter.className = 'intro__counter';
  counter.textContent = `01 / ${String(CODE.length).padStart(2, '0')}`;
  bottom.insertBefore(counter, bottom.querySelector('.intro__skip'));

  content.append(top, center, bottom);
  root.append(leaves, content);
  document.body.appendChild(root);

  /* ---------------- 状态机 ---------------- */
  let phase: 'typing' | 'ready' | 'open' | 'done' = 'typing';
  let raf = 0;
  let start = 0;
  let lastChars = -1;
  let holdTimer = 0;
  let destroyTimer = 0;

  const reveal = (chars: number): void => {
    let left = chars;
    for (let i = 0; i < CODE.length; i++) {
      const startOfLine = lineStarts[i];
      const endOfLine = startOfLine + lineLens[i];
      let used = 0;
      for (const tok of tokenEls[i]) {
        const n = Math.max(0, Math.min(tok.text.length, left));
        tok.el.textContent = tok.text.slice(0, n);
        left -= n;
        used += n;
      }
      const active = chars === totalChars && i === CODE.length - 1
        ? true
        : chars >= startOfLine && chars < endOfLine;
      lineEls[i].classList.toggle('is-active', active);
      lineEls[i].classList.toggle('is-done', used >= lineLens[i]);
      if (active) counter.textContent = `${String(i + 1).padStart(2, '0')} / ${String(CODE.length).padStart(2, '0')}`;
    }

    const ratio = totalChars === 0 ? 1 : chars / totalChars;
    meterFill.style.transform = `scaleX(${ratio.toFixed(3)})`;
    if (phase === 'typing') {
      if (ratio > 0.86) statusText.textContent = 'opening storefront';
      else if (ratio > 0.52) statusText.textContent = 'assembling diorama';
      else if (ratio > 0.12) statusText.textContent = 'painting canvas textures';
    }
  };

  const finishDestroy = (): void => {
    if (phase === 'done') return;
    phase = 'done';
    cancelAnimationFrame(raf);
    clearTimeout(holdTimer);
    clearTimeout(destroyTimer);
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  };

  const open = (): void => {
    if (phase === 'open' || phase === 'done') return;
    phase = 'open';
    cancelAnimationFrame(raf);
    clearTimeout(holdTimer);
    root.classList.add('is-open');
    destroyTimer = window.setTimeout(finishDestroy, OPEN_MS + 160);
  };

  const skip = (): void => {
    if (phase === 'done' || phase === 'open') return;
    phase = 'open';
    cancelAnimationFrame(raf);
    clearTimeout(holdTimer);
    root.classList.add('is-open', 'is-skip');
    destroyTimer = window.setTimeout(finishDestroy, SKIP_MS + 120);
  };

  const enterReady = (): void => {
    if (phase !== 'typing') return;
    phase = 'ready';
    reveal(totalChars);
    statusText.textContent = 'ready · open 24 hours';
    counter.textContent = `${String(CODE.length).padStart(2, '0')} / ${String(CODE.length).padStart(2, '0')}`;
    root.classList.add('is-ready');
    holdTimer = window.setTimeout(open, HOLD_MS);
  };

  const tick = (now: number): void => {
    if (phase !== 'typing') return;
    if (!start) start = now;
    const chars = Math.min(totalChars, Math.floor((now - start) / CHAR_MS));
    if (chars !== lastChars) {
      lastChars = chars;
      reveal(chars);
    }
    if (chars >= totalChars) {
      enterReady();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // 捕获阶段拦下：跳过开场的那一下不要同时触发底部控制台的
    // 1–6 / T / W 快捷键，否则用户会莫名其妙地换了天气。
    e.stopPropagation();
    skip();
  };

  root.addEventListener('pointerdown', skip, { passive: true });
  window.addEventListener('keydown', onKey, true);

  reveal(0);
  raf = requestAnimationFrame(tick);

  return {
    skip,
    destroy: finishDestroy,
    get isRunning() {
      return phase !== 'done';
    },
  };
}
