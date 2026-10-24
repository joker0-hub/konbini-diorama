/**
 * IDE 式代码开场。
 *
 * 不是"黑屏淡入"，而是把"这个世界是怎么被写出来的"演一遍：
 * 一个 IntelliJ IDEA 窗口里躺着这个项目的入口文件，两段代码分两次"编译"。
 *
 *   STEP 1  初始化便利店街角  → 底部的「继续」把第二段代码接上去
 *   STEP 2  进入可探索空间    → 「进入站点」把 IDE 收起来
 *   标题卡  ホシノマート      → 没有按钮，停一拍，然后两扇门向左右滑开
 *
 * 窗口左上角的红黄绿是纯装饰（没有交互），右上角才是真正的操作：
 * 「直接显示」跳到标题卡，「跳过开场」直接进门。
 *
 * 全部由 DOM + CSS 生成：没有图片、没有视频、没有字体文件。
 *
 * 交互：
 * - 「继续」/ Enter → 输出第二段；「进入站点」/ Enter → 标题卡
 * - 「直接显示」→ 标题卡；「跳过开场」/ Esc → 直接进门
 * - 标题卡上没有按钮，停约 2.1 秒后自动开门；点一下可以立刻开门
 * - ?intro=0、?instant=1、prefers-reduced-motion 时完全不创建
 */

/* ---------------- 代码行 ---------------- */

interface Tok {
  text: string;
  cls?: 'com' | 'kw' | 'str' | 'fn' | 'num' | 'prop' | 'var' | 'type';
}

type Line = Tok[];

/** STEP 1：站点结构与场景装配（19 行） */
function stageOne(time: string, weather: string): Line[] {
  return [
    [{ text: '// ==========================================================', cls: 'com' }],
    [{ text: '// FILE: konbini.scene.ts — 街角结构与场景装配', cls: 'com' }],
    [{ text: '// ==========================================================', cls: 'com' }],
    [
      { text: 'import ', cls: 'kw' },
      { text: '{ ' },
      { text: 'buildWorld', cls: 'fn' },
      { text: ' } ' },
      { text: 'from', cls: 'kw' },
      { text: " './world'", cls: 'str' },
      { text: ';' },
    ],
    [],
    [
      { text: 'export ', cls: 'kw' },
      { text: 'class ', cls: 'kw' },
      { text: 'KonbiniScene', cls: 'type' },
      { text: ' {' },
    ],
    [],
    [
      { text: '  ' },
      { text: 'private ', cls: 'kw' },
      { text: 'readonly ', cls: 'kw' },
      { text: 'world', cls: 'prop' },
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
      { text: ' });' },
    ],
    [
      { text: '  ' },
      { text: 'private ', cls: 'kw' },
      { text: 'readonly ', cls: 'kw' },
      { text: 'pipeline', cls: 'prop' },
      { text: ' = ' },
      { text: 'createPipeline', cls: 'fn' },
      { text: '(' },
      { text: 'this.world', cls: 'var' },
      { text: ');' },
    ],
    [],
    [
      { text: '  ' },
      { text: 'public ', cls: 'kw' },
      { text: 'compose', cls: 'fn' },
      { text: '(): ' },
      { text: 'Diorama', cls: 'type' },
      { text: ' {' },
    ],
    [{ text: '    // 每个零件都注册统一的交互描述，避免各写一套逻辑。', cls: 'com' }],
    [
      { text: '    ' },
      { text: 'this.world', cls: 'var' },
      { text: '.' },
      { text: 'register', cls: 'fn' },
      { text: '(' },
      { text: 'storefront', cls: 'fn' },
      { text: '());' },
    ],
    [
      { text: '    ' },
      { text: 'this.world', cls: 'var' },
      { text: '.' },
      { text: 'register', cls: 'fn' },
      { text: '(' },
      { text: 'streetCorner', cls: 'fn' },
      { text: '());' },
    ],
    [],
    [{ text: '    // 内容与场景解耦：替换 JSON 即可更新招牌与商品。', cls: 'com' }],
    [
      { text: '    ' },
      { text: 'return ', cls: 'kw' },
      { text: 'new ', cls: 'kw' },
      { text: 'Diorama', cls: 'type' },
      { text: '(' },
      { text: 'this.world.products', cls: 'fn' },
      { text: '(), ' },
      { text: 'this.world.articles', cls: 'fn' },
      { text: '());' },
    ],
    [{ text: '  }' }],
    [{ text: '}' }],
  ];
}

/** STEP 2：把模型真正启动起来（第 20–30 行） */
function stageTwo(): Line[] {
  return [
    [],
    [{ text: '// [STAGE 02] 启动可探索的 3D 街角', cls: 'com' }],
    [
      { text: 'export ', cls: 'kw' },
      { text: 'function ', cls: 'kw' },
      { text: 'main', cls: 'fn' },
      { text: '(): ' },
      { text: 'void', cls: 'type' },
      { text: ' {' },
    ],
    [
      { text: '  ' },
      { text: 'const ', cls: 'kw' },
      { text: 'site', cls: 'prop' },
      { text: ' = ' },
      { text: 'new ', cls: 'kw' },
      { text: 'KonbiniScene', cls: 'type' },
      { text: '();' },
    ],
    [
      { text: '  ' },
      { text: 'const ', cls: 'kw' },
      { text: 'world', cls: 'prop' },
      { text: ' = ' },
      { text: 'site.compose', cls: 'fn' },
      { text: '().' },
      { text: 'mount', cls: 'fn' },
      { text: '(' },
      { text: "'corner'", cls: 'str' },
      { text: ');' },
    ],
    [],
    [
      { text: '  ' },
      { text: 'world.spawnVisitor', cls: 'fn' },
      { text: '(' },
      { text: "'从雨棚走向收银台'", cls: 'str' },
      { text: ');' },
    ],
    [
      { text: '  ' },
      { text: 'world.enableInteractions', cls: 'fn' },
      { text: '(' },
      { text: "'E'", cls: 'str' },
      { text: ');' },
    ],
    [{ text: '  ' }, { text: 'world.start', cls: 'fn' }, { text: '();' }],
    [{ text: '}' }],
    [{ text: '// 3000 drops · OPEN 24 HOURS', cls: 'com' }],
  ];
}

/* ---------------- 时序 ---------------- */

/** 标题卡停留多久（ms），之后自动开门 */
const SPLASH_MS = 2100;
/** 门扇滑开所需时间，必须和 CSS 的 transition 对上 */
const OPEN_MS = 1050;
/** 跳过时门扇的快速滑动时间 */
const SKIP_MS = 340;

/* ---------------- 图标 ---------------- */

const ICON_BOLT =
  '<svg class="ide__ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M13.4 2 4.8 13.6h5.6L9.2 22l8.6-11.6h-5.5L13.4 2Z" fill="currentColor"/></svg>';

const ICON_SKIP =
  '<svg class="ide__ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
  '<path d="M6 4.6v14.8L17 12 6 4.6Z" fill="currentColor"/>' +
  '<path d="M19.4 4v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const ICON_WRENCH =
  '<svg class="ide__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<path d="M14.6 6.4a3.9 3.9 0 0 0-5.2 5.2L4.2 16.8 7.2 19.8l5.2-5.2a3.9 3.9 0 0 0 5.2-5.2l-2.3 2.3-2.5-.6-.6-2.5 2.4-2.2Z"/></svg>';

const ICON_BOOK =
  '<svg class="ide__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<path d="M4.6 5.4A2.4 2.4 0 0 1 7 3h12.4v15.4H7A2.4 2.4 0 0 0 4.6 20.8V5.4Z"/>' +
  '<path d="M4.6 20.8A2.4 2.4 0 0 1 7 18.4h12.4"/></svg>';

/* ------------------------------------------------------------------ */

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

type Stage = 'step1' | 'step2' | 'splash' | 'open' | 'done';

export function createCodeOpening(
  opts: { disabled?: boolean; time?: string; weather?: string } = {},
): CodeOpening {
  if (opts.disabled || typeof document === 'undefined') return noopOpening;

  const time = (opts.time ?? 'day').toLowerCase();
  const weather = (opts.weather ?? 'rain').toLowerCase();
  const STAGE1 = stageOne(time, weather);
  const STAGE2 = stageTwo();
  const CODE = STAGE1.concat(STAGE2);

  /* 「工作状态」/「使用说明」里随机抽的句子 */
  const WORK_LINES: string[] = [
    `当前环境 ${time.toUpperCase()} · ${weather.toUpperCase()}：光、雾、降水已经同步到控制台。`,
    '747 件商品都在货架上，17 组包装贴图全部命中，没有一件是纯色方块。',
    '雨丝 3000 条只占 1 个 draw call；靠近便利店暖光的那批被染成了金色。',
    '静态合并完成：draw call 1780 → 831，三角面 287,309。',
    '自动门 8.6 秒一轮，门头感应器在线，滑门两端都没有穿出转角。',
    '信号灯车绿 10s / 黄 3s / 红 13s，行人灯严格互锁，湿地还有倒影。',
    '积雪厚度 0–4 cm，随天气生长或融化；切时段不会把它清零。',
    '描边管线 5 点拉普拉斯采样，近处实、远处淡，没有 CT 片一样的白边。',
    '阴影全部交给方向光，门灯按约定不投影 —— 人行道上那块椭圆已经消掉了。',
    '关东煮 8 种串、咖啡机、热食柜都收在台面跨度内，没有一件悬空。',
    '湿地反光按湿度淡入淡出，晴天会自动收工。',
  ];
  const HELP_LINES: string[] = [
    '左键拖拽旋转，滚轮缩放 8–60 m，右键拖拽平移。',
    '按 1 / 2 / 3 切白天、黄昏、夜晚；4 / 5 / 6 切晴、雨、雪。',
    '按 T / W 循环时段与天气，← → / ↑ ↓ 在同一组里移动。',
    '底部控制台悬停会变亮，拖它不会旋转相机。',
    '想直接看模型：地址后面加 ?instant=1。',
    '只想跳过代码开场：加 ?intro=0，模型组装仍会播放。',
    '玻璃不做真实折射，所以隔着幕墙也能一眼看清货架。',
    '切走雪天不会立刻化完，积雪会按自己的速度退场。',
    '系统开启「减少动效」时，开场和过渡会自动关闭。',
    '所有商品包装都是 Canvas 2D 画的，没有一张 PNG。',
  ];

  const root = document.createElement('div');
  root.className = 'intro';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', 'konbini-diorama opening sequence');

  /* ---------------- 背后的两扇门 ---------------- */
  const leaves = document.createElement('div');
  leaves.className = 'intro__leaves';
  leaves.innerHTML = '<div class="intro__leaf intro__leaf--l"></div><div class="intro__leaf intro__leaf--r"></div>';

  // IDE 不再撑满屏幕：它是一扇浮在暗背景上的窗口
  const shade = document.createElement('div');
  shade.className = 'intro__shade';

  /* ---------------- 标题卡（无按钮） ---------------- */
  const splash = document.createElement('div');
  splash.className = 'intro__splash';
  splash.innerHTML =
    '<header class="intro__top">' +
    '<span class="intro__tag">konbini-diorama</span>' +
    '<span class="intro__sign">OPEN 24 HOURS</span>' +
    `<span class="intro__env">${time.toUpperCase()} · ${weather.toUpperCase()}</span>` +
    '</header>' +
    '<div class="intro__title">' +
    '<p class="intro__title-jp">ホシノマート</p>' +
    '<span class="intro__title-en">HOSHINO MART · KONBINI DIORAMA</span>' +
    '</div>' +
    '<footer class="intro__bottom">' +
    '<span class="intro__status"><i></i><b>READY · OPEN 24 HOURS</b></span>' +
    '<span class="intro__meter"><i></i></span>' +
    `<span class="intro__counter">${String(CODE.length).padStart(2, '0')} / ${String(CODE.length).padStart(2, '0')}</span>` +
    '</footer>';

  /* ---------------- IDE 窗口 ---------------- */
  const ide = document.createElement('div');
  ide.className = 'intro__ide';

  const bar = document.createElement('div');
  bar.className = 'ide__bar';
  bar.innerHTML =
    '<span class="ide__lights" aria-hidden="true"><i></i><i></i><i></i></span>' +
    '<span class="ide__title">IntelliJ IDEA <em>// konbini.scene.ts</em></span>' +
    '<span class="ide__top-actions">' +
    `<button type="button" class="ide__chip ide__chip--reveal" data-act="reveal">${ICON_BOLT}<span>直接显示</span></button>` +
    `<button type="button" class="ide__chip" data-act="skip"><span>跳过开场</span>${ICON_SKIP}</button>` +
    '</span>';

  const tabs = document.createElement('div');
  tabs.className = 'ide__tabs';
  tabs.innerHTML =
    '<span class="ide__tab is-active">konbini.scene.ts</span>' +
    '<span class="ide__tab">world.ts</span>' +
    '<span class="ide__tab">environment.ts</span>' +
    '<span class="ide__step"><b>STEP 1 / 2</b><span class="ide__step-label"> · 初始化便利店街角</span></span>';

  const code = document.createElement('div');
  code.className = 'ide__code';
  const rows = document.createElement('div');
  rows.className = 'ide__rows';
  code.appendChild(rows);

  const rowEls: HTMLDivElement[] = [];
  CODE.forEach((line, i) => {
    const row = document.createElement('div');
    row.className = 'ide__row';
    if (i >= STAGE1.length) row.classList.add('is-pending');
    const ln = document.createElement('span');
    ln.className = 'ide__ln';
    ln.textContent = String(i + 1);
    const src = document.createElement('span');
    src.className = 'ide__src';
    for (const tok of line) {
      if (!tok.text) continue;
      const span = document.createElement('span');
      if (tok.cls) span.className = `tok-${tok.cls}`;
      span.textContent = tok.text;
      src.appendChild(span);
    }
    row.append(ln, src);
    rows.appendChild(row);
    rowEls.push(row);
  });

  const caret = document.createElement('span');
  caret.className = 'ide__caret';
  caret.setAttribute('aria-hidden', 'true');

  const logBar = document.createElement('div');
  logBar.className = 'ide__log';
  logBar.innerHTML =
    '<span class="ide__log-text" aria-live="polite">&gt; <b class="is-info">[INFO]</b> 正在加载场景配置、商品数据与交互注册表...</span>' +
    '<span class="ide__tools">' +
    `<button type="button" class="ide__tool" data-tip="work" aria-label="工作状态" aria-haspopup="true" aria-expanded="false" aria-controls="ide-pop">${ICON_WRENCH}<span>工作状态</span></button>` +
    `<button type="button" class="ide__tool" data-tip="help" aria-label="使用说明" aria-haspopup="true" aria-expanded="false" aria-controls="ide-pop">${ICON_BOOK}<span>使用说明</span></button>` +
    '</span>';
  const pop = document.createElement('div');
  pop.className = 'ide__pop';
  pop.id = 'ide-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '工作状态');
  pop.hidden = true;
  pop.innerHTML =
    '<div class="ide__pop-head">' +
    '<span class="ide__pop-title"></span>' +
    '<span class="ide__pop-hint">再点一次换一批</span>' +
    '<button type="button" class="ide__pop-close" aria-label="关闭">×</button>' +
    '</div>' +
    '<ul class="ide__pop-list"></ul>';
  logBar.appendChild(pop);

  const term = document.createElement('div');
  term.className = 'ide__term';
  term.innerHTML =
    '<span class="ide__prompt">hoshino@konbini:~$</span>' +
    '<input class="ide__cmd" type="text" spellcheck="false" autocomplete="off" ' +
    'aria-label="终端输入，按 Enter 继续" placeholder="输入任意内容按 Enter 继续（第 1 段 → 第 2 段进入站点）" />' +
    '<button type="button" class="ide__go" data-act="next">' +
    '<span class="ide__go-label">继续 → 进入可探索空间</span><em>(Enter)</em></button>';

  const caption = document.createElement('p');
  caption.className = 'ide__caption';
  caption.textContent = '这是一个可以走进去的便利店街角：代码只是入口，雨夜与货架承载内容。';

  ide.append(bar, tabs, code, logBar, term, caption);

  root.append(leaves, shade, splash, ide);
  document.body.appendChild(root);

  /* ---------------- 引用 ---------------- */
  const nextBtn = term.querySelector('.ide__go') as HTMLButtonElement;
  const goLabel = nextBtn.querySelector('.ide__go-label') as HTMLElement;
  const revealBtn = bar.querySelector('[data-act="reveal"]') as HTMLButtonElement;
  const skipBtn = bar.querySelector('[data-act="skip"]') as HTMLButtonElement;
  const stepBadge = tabs.querySelector('.ide__step') as HTMLElement;
  const logText = logBar.querySelector('.ide__log-text') as HTMLElement;
  const cmd = term.querySelector('.ide__cmd') as HTMLInputElement;
  const meterFill = splash.querySelector('.intro__meter i') as HTMLElement;

  /* ---------------- 工作状态 / 使用说明 ---------------- */
  const workBtn = logBar.querySelector('[data-tip="work"]') as HTMLButtonElement;
  const helpBtn = logBar.querySelector('[data-tip="help"]') as HTMLButtonElement;
  const popTitle = pop.querySelector('.ide__pop-title') as HTMLElement;
  const popList = pop.querySelector('.ide__pop-list') as HTMLElement;
  const popClose = pop.querySelector('.ide__pop-close') as HTMLButtonElement;
  let tipKind: 'work' | 'help' | null = null;
  const lastTip: Record<'work' | 'help', string> = { work: '', help: '' };

  const pickLines = (pool: string[], count: number): string[] => {
    const out: string[] = [];
    const used = new Set<number>();
    while (out.length < count && used.size < pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      if (used.has(i)) continue;
      used.add(i);
      out.push(pool[i]);
    }
    return out;
  };

  const rollTip = (kind: 'work' | 'help'): void => {
    const pool = kind === 'work' ? WORK_LINES : HELP_LINES;
    const batch = pickLines(pool, 3);
    // 连续两次点同一个按钮时，至少不要第一句还一模一样
    if (batch.length > 1 && batch[0] === lastTip[kind]) {
      [batch[0], batch[1]] = [batch[1], batch[0]];
    }
    lastTip[kind] = batch[0] ?? '';
    tipKind = kind;
    popTitle.textContent = kind === 'work' ? '工作状态' : '使用说明';
    pop.setAttribute('aria-label', popTitle.textContent);
    popList.replaceChildren(
      ...batch.map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }),
    );
    pop.hidden = false;
    workBtn.classList.toggle('is-on', kind === 'work');
    helpBtn.classList.toggle('is-on', kind === 'help');
    workBtn.setAttribute('aria-expanded', String(kind === 'work'));
    helpBtn.setAttribute('aria-expanded', String(kind === 'help'));
  };

  const closeTip = (): void => {
    if (!tipKind) return;
    tipKind = null;
    pop.hidden = true;
    workBtn.classList.remove('is-on');
    helpBtn.classList.remove('is-on');
    workBtn.setAttribute('aria-expanded', 'false');
    helpBtn.setAttribute('aria-expanded', 'false');
  };

  workBtn.addEventListener('click', () => rollTip('work'));
  helpBtn.addEventListener('click', () => rollTip('help'));
  popClose.addEventListener('click', closeTip);

  const onDocPointerDown = (e: PointerEvent): void => {
    if (!tipKind) return;
    const t = e.target as Node;
    if (pop.contains(t) || workBtn.contains(t) || helpBtn.contains(t)) return;
    closeTip();
  };
  document.addEventListener('pointerdown', onDocPointerDown, true);

  /* ---------------- 状态机 ---------------- */
  let stage: Stage = 'step1';
  let splashTimer = 0;
  let destroyTimer = 0;

  const moveCaret = (row: HTMLDivElement): void => {
    (row.querySelector('.ide__src') as HTMLElement).appendChild(caret);
  };
  moveCaret(rowEls[STAGE1.length - 1]);

  // 第一段逐行落下；第二段先藏在编辑器外面。
  STAGE1.forEach((_, i) => {
    rowEls[i].classList.add('is-new');
    rowEls[i].style.setProperty('--i', String(i));
  });
  meterFill.style.transform = 'scaleX(0.62)';

  const finishDestroy = (): void => {
    if (stage === 'done') return;
    stage = 'done';
    clearTimeout(splashTimer);
    clearTimeout(destroyTimer);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    root.remove();
  };

  const open = (): void => {
    if (stage === 'open' || stage === 'done') return;
    stage = 'open';
    closeTip();
    clearTimeout(splashTimer);
    root.classList.add('is-open');
    destroyTimer = window.setTimeout(finishDestroy, OPEN_MS + 160);
  };

  const skip = (): void => {
    if (stage === 'open' || stage === 'done') return;
    stage = 'open';
    closeTip();
    clearTimeout(splashTimer);
    root.classList.add('is-open', 'is-skip');
    destroyTimer = window.setTimeout(finishDestroy, SKIP_MS + 120);
  };

  const enterSplash = (): void => {
    if (stage === 'splash' || stage === 'open' || stage === 'done') return;
    stage = 'splash';
    closeTip();
    clearTimeout(splashTimer);
    root.classList.add('is-splash');
    // 标题卡上没有按钮：整张 IDE 退出焦点顺序，避免 Tab 到看不见的按钮
    ide.setAttribute('inert', '');
    ide.setAttribute('aria-hidden', 'true');
    meterFill.style.transform = 'scaleX(1)';
    splashTimer = window.setTimeout(open, SPLASH_MS);
  };

  const enterStep2 = (): void => {
    if (stage !== 'step1') return;
    stage = 'step2';
    closeTip();
    root.classList.add('is-step2');

    STAGE2.forEach((_, i) => {
      const row = rowEls[STAGE1.length + i];
      row.classList.remove('is-pending');
      row.classList.add('is-new');
      row.style.setProperty('--i', String(i));
    });
    moveCaret(rowEls[CODE.length - 1]);
    meterFill.style.transform = 'scaleX(1)';

    stepBadge.innerHTML =
      '<b>STEP 2 / 2</b><span class="ide__step-label"> · 进入可探索空间</span>';
    logText.innerHTML =
      '&gt; <b class="is-ready">[READY]</b> 便利店街角已就绪，靠近物件按 E 打开内容。';
    cmd.placeholder = '输入任意内容按 Enter 进入站点';
    goLabel.textContent = '进入站点';
    nextBtn.classList.add('is-armed');

    // 编辑器滚到第二段：和参考图一样，行号从 3 左右开始。
    requestAnimationFrame(() => {
      code.scrollTo({ top: code.scrollHeight, behavior: 'smooth' });
    });
  };

  const nextStage = (): void => {
    if (stage === 'step1') enterStep2();
    else if (stage === 'step2') enterSplash();
    else if (stage === 'splash') open();
  };

  /* ---------------- 交互 ---------------- */
  const onKey = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (tipKind) closeTip();
      else if (stage === 'splash') open();
      else skip();
      return;
    }
    if (e.key === 'Enter') {
      // 焦点在按钮上时交给按钮自己响应（否则 Enter 会变成"继续"）
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      nextStage();
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // 开场期间按 1–6 / T / W 不要偷偷换掉底部控制台的环境
    e.stopPropagation();
  };

  nextBtn.addEventListener('click', nextStage);
  revealBtn.addEventListener('click', enterSplash);
  skipBtn.addEventListener('click', skip);

  // 标题卡上没有按钮：点一下空白处可以立刻开门
  root.addEventListener('click', (e) => {
    if (stage !== 'splash') return;
    if (ide.contains(e.target as Node)) return;
    open();
  });

  window.addEventListener('keydown', onKey, true);

  return {
    skip,
    destroy: finishDestroy,
    get isRunning() {
      return stage !== 'done';
    },
  };
}
