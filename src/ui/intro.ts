import type { EnvState } from '../scene/environment';

function readLaunchOptions() {
  const url = new URL(location.href);
  const query = url.searchParams;
  const time = query.get('time');
  const weather = query.get('weather');
  const options: EnvState & { instant: boolean; intro: boolean; forceIntro: boolean } = {
    time: time === 'dusk' || time === 'night' ? time : 'day',
    weather: weather === 'rain' || weather === 'snow' ? weather : 'clear',
    instant: query.get('instant') === '1',
    intro: query.get('intro') !== '0',
    forceIntro: query.get('intro') === '1',
  };
  if (query.has('intro') || query.has('instant')) {
    query.delete('intro');
    query.delete('instant');
    history.replaceState(history.state, '', url);
  }
  return options;
}

export const envInit = readLaunchOptions();
export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MIN_LOADING_MS = 2400;

interface Opening {
  ready(): void;
  fail(): void;
  skip(): void;
  readonly holdsAssembly: boolean;
  readonly isRunning: boolean;
}

function createOpening(disabled: boolean): Opening {
  if (disabled) return { ready() {}, fail() {}, skip() {}, holdsAssembly: false, isRunning: false };

  const root = document.createElement('div');
  root.className = 'intro';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'opening-title');
  root.innerHTML = `
    <div class="intro__petals" aria-hidden="true"></div>
    <div class="intro__splash">
      <div class="intro__title">
        <span class="intro__sign" lang="en">OPEN 24 HOURS</span>
        <h1 id="opening-title" class="intro__title-jp" lang="ja">ホシノマート</h1>
        <span class="intro__title-en" lang="en">Hoshino Mart</span>
        <div class="intro__entry">
          <div class="intro__status" role="status" lang="zh">
            <span>正在加载场景…</span>
            <span class="intro__meter" aria-hidden="true"></span>
          </div>
          <button type="button" class="intro__enter" lang="en" hidden>ENTER</button>
        </div>
      </div>
    </div>
  `;

  const petals = root.querySelector<HTMLDivElement>('.intro__petals')!;
  for (let i = 0; i < 24; i++) {
    const petal = document.createElement('i');
    petal.style.left = `${(i * 37) % 108 - 6}%`;
    petal.style.setProperty('--size', `${7 + (i * 5) % 9}px`);
    petal.style.setProperty('--drift', `${35 + (i * 23) % 72}px`);
    petal.style.animationDuration = `${6.5 + (i % 7) * 0.68}s`;
    petal.style.animationDelay = `${-i * 0.83}s`;
    petals.appendChild(petal);
  }

  const status = root.querySelector<HTMLDivElement>('.intro__status')!;
  const button = root.querySelector<HTMLButtonElement>('.intro__enter')!;
  let phase: 'loading' | 'ready' | 'error' | 'opening' | 'done' = 'loading';

  function finish(): void {
    phase = 'done';
    window.removeEventListener('keydown', onKey, true);
    root.remove();
  }

  function open(skip: boolean): void {
    if (phase === 'opening' || phase === 'done' || (!skip && phase !== 'ready')) return;
    phase = 'opening';
    button.disabled = true;
    root.classList.add('is-open');
    if (reducedMotion) {
      finish();
      return;
    }
    const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: skip ? 260 : 900,
      easing: 'cubic-bezier(0.42, 0, 0.32, 1)',
      fill: 'forwards',
    });
    void fade.finished.then(finish, finish);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'Tab') event.preventDefault();
    if (phase !== 'ready') return;
    if (event.key === 'Enter') open(false);
    if (event.key === 'Escape') open(true);
    if (event.key === 'Tab') button.focus({ preventScroll: true });
  }

  button.addEventListener('click', () => open(false));
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  const loadingStartedAt = performance.now();

  function showEnter(): void {
    if (phase !== 'loading') return;
    phase = 'ready';
    status.hidden = true;
    button.hidden = false;
    button.focus({ preventScroll: true });
  }

  return {
    ready() {
      if (phase !== 'loading') return;
      const remaining = MIN_LOADING_MS - (performance.now() - loadingStartedAt);
      if (reducedMotion || remaining <= 0) showEnter();
      else window.setTimeout(showEnter, remaining);
    },
    fail() {
      if (phase !== 'loading') return;
      phase = 'error';
      status.textContent = '场景加载失败，请刷新重试。';
    },
    skip: () => open(true),
    get holdsAssembly() { return phase !== 'opening' && phase !== 'done'; },
    get isRunning() { return phase !== 'done'; },
  };
}

export const opening = createOpening(
  !envInit.intro || ((envInit.instant || reducedMotion) && !envInit.forceIntro),
);
