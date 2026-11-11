import { $, h } from './dom';
import { icon } from './icons';
import { KIND_META } from './dialogs';
import { showMenu } from './menu';
import { describeSession, savePrefs, state } from './state';
import { connectedSessionIds } from './workspace';
import type { SessionSummary } from '../shared/types';

export interface SidebarActions {
  newSession(): void;
  quickConnect(): void;
  openLocal(): void;
  settings(): void;
  connect(s: SessionSummary): void;
  edit(s: SessionSummary): void;
  duplicate(s: SessionSummary): void;
  remove(s: SessionSummary): void;
}

let actions: SidebarActions;
let filter = '';
let selectedId: string | null = null;

export function initSidebar(a: SidebarActions): void {
  actions = a;
  const root = $('sidebar');
  const search = h('input', { class: 'input', type: 'text', placeholder: 'Search sessions', 'aria-label': 'Search sessions', spellcheck: false });
  const clear = h('button', { class: 'icon-btn clear hidden', title: 'Clear search', 'aria-label': 'Clear search' }, icon('x', 13));
  search.addEventListener('input', () => {
    filter = search.value.trim().toLowerCase();
    clear.classList.toggle('hidden', !filter);
    renderSidebar();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) { search.value = ''; search.dispatchEvent(new Event('input')); e.stopPropagation(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); $('session-list').querySelector<HTMLElement>('.srow')?.focus(); }
    else if (e.key === 'Enter') { const first = visible()[0]; if (first) actions.connect(first); }
  });
  clear.addEventListener('click', () => { search.value = ''; search.dispatchEvent(new Event('input')); search.focus(); });

  root.append(
    h('div', { class: 'side-head' }, h('h2', {}, 'Sessions'),
      h('button', { class: 'icon-btn', title: 'Quick connect (Ctrl+Shift+K)', 'aria-label': 'Quick connect', onclick: () => actions.quickConnect() }, icon('zap', 16))),
    h('div', { class: 'side-actions' },
      h('button', { class: 'btn primary', onclick: () => actions.newSession() }, icon('plus', 15), 'New session'),
      h('div', { class: 'input-with-icon' }, icon('search', 14), search, clear)),
    h('div', { id: 'session-list', role: 'listbox', 'aria-label': 'Sessions' }),
    h('div', { class: 'side-foot' },
      h('button', { class: 'icon-btn', title: 'Settings', 'aria-label': 'Settings', onclick: () => actions.settings() }, icon('settings', 16)),
      h('button', { class: 'icon-btn', title: 'New local terminal (Ctrl+Shift+T)', 'aria-label': 'New local terminal', onclick: () => actions.openLocal() }, icon('square-terminal', 16)),
      h('span', { class: 'spacer' })),
  );

  // Resizer
  const bar = $('sidebar-resizer');
  const apply = (w: number) => document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
  apply(state.prefs.sidebarWidth);
  bar.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    bar.setPointerCapture(ev.pointerId);
    bar.classList.add('dragging');
    const startX = ev.clientX;
    const startW = root.getBoundingClientRect().width;
    const move = (e: PointerEvent) => {
      state.prefs.sidebarWidth = Math.round(Math.max(200, Math.min(520, startW + e.clientX - startX)));
      apply(state.prefs.sidebarWidth);
    };
    const up = () => {
      bar.classList.remove('dragging');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      savePrefs();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('dblclick', () => { state.prefs.sidebarWidth = 280; apply(280); savePrefs(); });
}

function visible(): SessionSummary[] {
  return state.sessions
    .filter((s) => !filter || `${s.name} ${s.host ?? ''} ${s.username ?? ''} ${s.folder ?? ''} ${s.serialPath ?? ''}`.toLowerCase().includes(filter))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function menuFor(s: SessionSummary, x: number, y: number): void {
  showMenu(x, y, [
    { label: 'Connect', icon: 'plug-zap', run: () => actions.connect(s) },
    { label: 'Edit…', icon: 'pencil', shortcut: 'F2', run: () => actions.edit(s) },
    { label: 'Duplicate', icon: 'copy-plus', run: () => actions.duplicate(s) },
    'sep',
    { label: 'Delete…', icon: 'trash-2', danger: true, shortcut: 'Del', run: () => actions.remove(s) },
  ]);
}

export function renderSidebar(): void {
  const list = $('session-list');
  const live = connectedSessionIds();
  const all = visible();
  const keepFocus = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.id : undefined;

  if (state.sessions.length === 0) {
    list.replaceChildren(h('div', { class: 'empty-note' }, icon('server', 28), h('div', {}, 'No saved sessions yet.'), h('div', {}, 'Create one, or use Quick connect for a one-off host.')));
    return;
  }
  if (all.length === 0) {
    list.replaceChildren(h('div', { class: 'empty-note' }, icon('search-x', 26), h('div', {}, `No sessions match “${filter}”.`)));
    return;
  }

  const row = (s: SessionSummary, nested: boolean) => {
    const meta = KIND_META[s.kind];
    const el = h(
      'div',
      { class: `srow${nested ? ' nested' : ''}${selectedId === s.id ? ' selected' : ''}`, tabIndex: 0, role: 'option', 'data-kind': s.kind, 'data-id': s.id, 'aria-selected': String(selectedId === s.id), title: `${s.name}\n${describeSession(s)}` },
      h('span', { class: 'glyph' }, icon(meta.icon, 15), live.has(s.id) ? h('span', { class: 'live', title: 'Connected' }) : null),
      h('span', { class: 'meta' }, h('div', { class: 'name' }, s.name), h('div', { class: 'sub' }, describeSession(s))),
      h('span', { class: 'icon-btn more', title: 'More actions', role: 'button', 'aria-label': `Actions for ${s.name}` }, icon('ellipsis', 15)),
    );
    el.addEventListener('click', () => { selectedId = s.id; for (const r of list.querySelectorAll('.srow')) r.classList.toggle('selected', r === el); });
    el.addEventListener('dblclick', () => actions.connect(s));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); selectedId = s.id; menuFor(s, e.clientX, e.clientY); });
    el.querySelector('.more')!.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      menuFor(s, r.left, r.bottom + 2);
    });
    el.addEventListener('keydown', (e) => {
      const rows = [...list.querySelectorAll<HTMLElement>('.srow')];
      const i = rows.indexOf(el);
      if (e.key === 'Enter') { e.preventDefault(); actions.connect(s); }
      else if (e.key === 'F2') { e.preventDefault(); actions.edit(s); }
      else if (e.key === 'Delete') { e.preventDefault(); actions.remove(s); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); rows[i + 1]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (rows[i - 1] ?? $('sidebar').querySelector<HTMLElement>('input'))?.focus(); }
      else if (e.key === 'ContextMenu') { const r = el.getBoundingClientRect(); menuFor(s, r.left + 40, r.bottom); }
    });
    return el;
  };

  const out: HTMLElement[] = [];
  const loose = all.filter((s) => !s.folder);
  const folders = new Map<string, SessionSummary[]>();
  for (const s of all) if (s.folder) folders.set(s.folder, [...(folders.get(s.folder) ?? []), s]);

  for (const [name, items] of [...folders].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
    const collapsed = !filter && state.prefs.collapsedFolders.includes(name);
    const head = h('button', { class: 'folder-row', 'aria-expanded': String(!collapsed) }, icon(collapsed ? 'chevron-right' : 'chevron-down', 14), h('span', {}, name), h('span', { class: 'count' }, String(items.length)));
    head.addEventListener('click', () => {
      const set = new Set(state.prefs.collapsedFolders);
      if (!set.delete(name)) set.add(name);
      state.prefs.collapsedFolders = [...set];
      savePrefs();
      renderSidebar();
    });
    out.push(head);
    if (!collapsed) out.push(...items.map((s) => row(s, true)));
  }
  out.push(...loose.map((s) => row(s, false)));
  list.replaceChildren(...out);
  if (keepFocus) list.querySelector<HTMLElement>(`[data-id="${CSS.escape(keepFocus)}"]`)?.focus();
}
