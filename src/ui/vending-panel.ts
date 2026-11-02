import './vending-panel.css';
import type { Drink } from '../core/vending-products';
import type { VendingHandles } from '../scene/vending';

export interface VendingPanel {
  open(machine: VendingHandles): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

let panelCount = 0;

/** The native modal keeps focus and pointer input away from the scene while choosing. */
export function createVendingPanel(
  host: HTMLElement,
  onPurchase: (machine: VendingHandles, drink: Drink) => boolean,
): VendingPanel {
  const uid = `vending-panel-${++panelCount}`;
  const panel = document.createElement('dialog');
  panel.className = 'vending-panel interaction-panel';
  panel.setAttribute('aria-labelledby', `${uid}-title`);
  panel.setAttribute('aria-describedby', `${uid}-hint`);

  const header = document.createElement('header');
  header.className = 'vending-panel__header interaction-panel__header';
  const heading = document.createElement('div');
  heading.innerHTML = '<span class="interaction-panel__eyebrow">HOSHINO · DRINKS</span>';
  const title = document.createElement('h2');
  title.id = `${uid}-title`;
  title.textContent = '选一瓶喜欢的饮品';
  heading.append(title);

  const closeButton = document.createElement('button');
  closeButton.className = 'vending-panel__close interaction-panel__close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭饮品选择');
  closeButton.title = '关闭（Esc）';
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  header.append(heading, closeButton);

  const hint = document.createElement('p');
  hint.id = `${uid}-hint`;
  hint.className = 'vending-panel__hint interaction-panel__hint';
  hint.textContent = '点击饮品购买，在下方取货口等待掉落';

  const products = document.createElement('div');
  products.className = 'vending-panel__products';

  const status = document.createElement('p');
  status.className = 'vending-panel__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const footer = document.createElement('p');
  footer.className = 'vending-panel__footer';
  footer.textContent = '取货口最多 3 瓶，第 4 瓶会移除最早的一瓶。长按饮料可拖动，落地 10 秒后清理，投入垃圾桶立即回收。';
  panel.append(header, hint, products, status, footer);
  host.append(panel);

  let current: VendingHandles | null = null;
  let returnFocus: HTMLElement | null = null;
  let refreshTimer: number | undefined;
  let busyState: boolean | undefined;
  let outsideStart = false;

  const stopRefresh = (): void => {
    window.clearInterval(refreshTimer);
    refreshTimer = undefined;
  };

  const close = (): void => {
    stopRefresh();
    outsideStart = false;
    if (panel.open) panel.close();
    current = null;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  };

  const refreshBusy = (): void => {
    if (!panel.open || !current) return;
    const busy = current.isBusy();
    if (busy === busyState) return;
    busyState = busy;
    products.setAttribute('aria-busy', String(busy));
    for (const button of products.querySelectorAll('button')) button.disabled = busy;
    status.textContent = busy ? '正在出货，请稍候…' : '冷藏供应 · 请选择饮品';
  };

  const makeProduct = (drink: Drink): HTMLButtonElement => {
    const button = document.createElement('button');
    button.className = 'vending-panel__product';
    button.type = 'button';
    button.dataset.drinkId = drink.id;
    button.setAttribute('aria-label', `购买${drink.name}，${drink.price}日元`);
    button.style.setProperty('--drink-color', drink.color);
    button.style.setProperty('--cap-color', drink.capColor || '#e5edf2');

    const art = document.createElement('span');
    art.className = 'vending-panel__bottle';
    art.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'vending-panel__bottle-label';
    label.textContent = drink.label;
    art.append(label);

    const name = document.createElement('span');
    name.className = 'vending-panel__product-name';
    name.textContent = drink.name;
    const price = document.createElement('span');
    price.className = 'vending-panel__price';
    price.textContent = `¥${drink.price}`;
    button.append(art, name, price);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const machine = current;
      if (!machine) return;
      if (onPurchase(machine, drink)) {
        close();
      } else {
        busyState = undefined;
        refreshBusy();
        if (!machine.isBusy()) status.textContent = '暂时无法出货，请重新选择';
      }
    });
    return button;
  };

  const isOutside = (event: PointerEvent): boolean => {
    const rect = panel.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
  };

  closeButton.addEventListener('click', close);
  panel.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  panel.addEventListener('close', () => {
    // Native close events are queued; a rapid reopen must keep its new timer.
    if (!panel.open) stopRefresh();
  });
  panel.addEventListener('keydown', (event) => {
    // Environment shortcuts are on window; do not change the scene while shopping.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  panel.addEventListener('keyup', (event) => event.stopPropagation());
  panel.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    outsideStart = event.target === panel && isOutside(event);
  });
  panel.addEventListener('pointerup', (event) => {
    event.stopPropagation();
    if (outsideStart && event.target === panel && isOutside(event)) close();
    outsideStart = false;
  });
  panel.addEventListener('pointercancel', (event) => {
    event.stopPropagation();
    outsideStart = false;
  });
  panel.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });

  return {
    open(machine) {
      stopRefresh();
      if (!panel.open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      current = machine;
      busyState = undefined;
      outsideStart = false;
      panel.dataset.machineId = machine.id;
      panel.dataset.variant = machine.variant;
      products.replaceChildren(...machine.products.map(makeProduct));
      if (!panel.open) panel.showModal();
      refreshBusy();
      // A safe initial focus avoids buying by an accidental repeated Enter key.
      closeButton.focus({ preventScroll: true });
      refreshTimer = window.setInterval(refreshBusy, 120);
    },
    close,
    isOpen: () => panel.open,
    destroy() {
      close();
      panel.remove();
    },
  };
}
