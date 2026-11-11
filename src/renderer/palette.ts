import { $, h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';

export interface PaletteItem {
  group: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  shortcut?: string;
  run: () => void;
}

export function openPalette(items: PaletteItem[]): void {
  const prev = document.activeElement as HTMLElement | null;
  const dlg = h('dialog', { class: 'palette', 'aria-label': 'Command palette' });
  const input = h('input', { placeholder: 'Search sessions and commands…', spellcheck: false, 'aria-label': 'Search commands', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'palette-list' });
  const list = h('div', { class: 'palette-list', id: 'palette-list', role: 'listbox' });
  let shown: PaletteItem[] = [];
  let sel = 0;

  const score = (it: PaletteItem, q: string): number => {
    const t = it.title.toLowerCase();
    const hay = `${t} ${(it.subtitle ?? '').toLowerCase()}`;
    let ok = true;
    for (const w of q.split(/\s+/).filter(Boolean)) if (!hay.includes(w)) ok = false;
    if (!ok) return -1;
    return t.startsWith(q) ? 2 : t.includes(q) ? 1 : 0;
  };

  const render = () => {
    const q = input.value.trim().toLowerCase();
    shown = q ? items.map((i) => ({ i, s: score(i, q) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.i) : items;
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    if (shown.length === 0) {
      list.replaceChildren(h('div', { class: 'palette-empty' }, 'No matching commands or sessions'));
      return;
    }
    const nodes: HTMLElement[] = [];
    let group = '';
    shown.forEach((it, idx) => {
      if (!q && it.group !== group) { group = it.group; nodes.push(h('div', { class: 'palette-group' }, group)); }
      const el = h('button', { class: 'pitem', role: 'option', 'aria-selected': String(idx === sel), 'data-idx': idx },
        icon(it.icon, 16), h('span', { class: 't' }, it.title), it.subtitle ? h('span', { class: 'sub' }, it.subtitle) : null, it.shortcut ? h('kbd', { class: 'sc' }, it.shortcut) : null);
      el.addEventListener('mousemove', () => { if (sel !== idx) { sel = idx; paint(); } });
      el.addEventListener('click', () => choose(idx));
      nodes.push(el);
    });
    list.replaceChildren(...nodes);
  };
  const paint = () => {
    for (const el of list.querySelectorAll<HTMLElement>('.pitem')) {
      const on = Number(el.dataset.idx) === sel;
      el.setAttribute('aria-selected', String(on));
      if (on) el.scrollIntoView({ block: 'nearest' });
    }
  };
  const done = () => { dlg.close(); dlg.remove(); if (prev?.isConnected) prev.focus(); };
  const choose = (idx: number) => {
    const it = shown[idx];
    done();
    if (it) setTimeout(it.run, 0);
  };

  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(); });
  dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) done(); });

  dlg.append(
    h('div', { class: 'palette-input' }, icon('search', 17), input),
    list,
    h('div', { class: 'palette-foot' }, h('span', {}, h('kbd', {}, '↑'), ' ', h('kbd', {}, '↓'), ' navigate'), h('span', {}, h('kbd', {}, 'Enter'), ' run'), h('span', {}, h('kbd', {}, 'Esc'), ' close')),
  );
  $('dialogs').append(dlg);
  render();
  dlg.showModal();
  input.focus();
}
