import { $, h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';

export interface MenuItem {
  label: string;
  icon?: IconName;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}
export type MenuEntry = MenuItem | 'sep';

let close: (() => void) | undefined;

export function showMenu(x: number, y: number, entries: MenuEntry[]): void {
  close?.();
  const prevFocus = document.activeElement as HTMLElement | null;
  const root = h('div', { class: 'menu', role: 'menu' });
  const buttons: HTMLButtonElement[] = [];

  for (const e of entries) {
    if (e === 'sep') {
      root.append(h('hr'));
      continue;
    }
    const b = h(
      'button',
      { role: 'menuitem', class: e.danger ? 'danger' : '', disabled: e.disabled },
      e.icon ? icon(e.icon, 15) : h('span', { style: 'width:15px' }),
      h('span', {}, e.label),
      e.shortcut && h('span', { class: 'sc' }, e.shortcut),
    );
    b.addEventListener('click', () => {
      close?.();
      e.run();
    });
    buttons.push(b);
    root.append(b);
  }

  const onKey = (ev: KeyboardEvent) => {
    const enabled = buttons.filter((b) => !b.disabled);
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (ev.key === 'Escape') {
      ev.preventDefault();
      close?.();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const next = ev.key === 'ArrowDown' ? i + 1 : i - 1;
      enabled[(next + enabled.length) % enabled.length]?.focus();
    }
  };
  const onOutside = (ev: Event) => {
    if (!root.contains(ev.target as Node)) close?.();
  };

  close = () => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('blur', onWinBlur);
    root.remove();
    close = undefined;
    if (prevFocus?.isConnected) prevFocus.focus();
  };
  const onWinBlur = () => close?.();

  $('menus').append(root);
  // Keep the menu inside the viewport.
  const r = root.getBoundingClientRect();
  root.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  root.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onOutside, true);
  window.addEventListener('blur', onWinBlur);
  buttons.find((b) => !b.disabled)?.focus();
}

export function closeMenu(): void {
  close?.();
}
