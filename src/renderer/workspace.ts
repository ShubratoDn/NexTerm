import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { $, h, put } from './dom';
import { icon } from './icons';
import { KIND_META, askConfirm, askSecret } from './dialogs';
import { showMenu } from './menu';
import { SftpPane } from './sftp-pane';
import { cleanError, toast } from './toast';
import { applyTheme, fontStack, resolveTheme, termTheme } from './theme';
import { describeSession, emitChange, savePrefs, state, touchRecent } from './state';
import type { OpenRequest, SessionInput, SessionKind, SessionSummary } from '../shared/types';

export type TabState = 'connecting' | 'connected' | 'closed' | 'failed';

export interface Tab {
  id: string;
  title: string;
  subtitle: string;
  kind: SessionKind;
  sessionId?: string;
  req: Omit<OpenRequest, 'cols' | 'rows'>;
  /** Kept in memory only, so a reconnect does not ask again. */
  password?: string;
  needsPassword: boolean;
  rememberPassword: boolean;
  connId?: string;
  state: TabState;
  error?: string;
  attempt: number;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  pane: HTMLElement;
  area: HTMLElement;
  overlay?: HTMLElement;
  banner?: HTMLElement;
  findbar?: HTMLElement;
  sftp?: SftpPane;
  tabEl?: HTMLElement;
  observer: ResizeObserver;
}

export const hooks: { editSession?: (id: string) => void; key?: (ev: KeyboardEvent) => boolean } = {};

const tabs: Tab[] = [];
const byConn = new Map<string, Tab>();
const early = new Map<string, Uint8Array[]>(); // data that arrived before its tab knew the connection id
let activeId: string | null = null;
let multiExec = false;

export const allTabs = (): readonly Tab[] => tabs;
export const activeTab = (): Tab | undefined => tabs.find((t) => t.id === activeId);
export const isMultiExec = (): boolean => multiExec;
export const connectedSessionIds = (): Set<string> => new Set(tabs.filter((t) => t.state === 'connected' && t.sessionId).map((t) => t.sessionId!));

export function setMultiExec(v: boolean): void {
  multiExec = v;
  renderTabs();
  emitChange();
}

/* ------------------------------------------------------------------ creation */

function uniqueTitle(base: string): string {
  const names = new Set(tabs.map((t) => t.title));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} (${i})`)) return `${base} (${i})`;
}

function termOptions() {
  const s = state.settings;
  return {
    fontSize: s.fontSize,
    fontFamily: fontStack(s.fontFamily),
    fontWeight: '400' as const,
    fontWeightBold: '700' as const,
    lineHeight: 1.15,
    scrollback: s.scrollback,
    cursorBlink: s.cursorBlink,
    cursorStyle: s.cursorStyle,
    theme: termTheme(resolveTheme(s.theme)),
    allowProposedApi: true, // required by the search addon's match highlighting
    macOptionIsMeta: true,
  };
}

interface Spec {
  req: Tab['req'];
  title: string;
  subtitle: string;
  kind: SessionKind;
  sessionId?: string;
  needsPassword: boolean;
  password?: string;
}

function create(spec: Spec): Tab {
  const term = new Terminal(termOptions());
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);

  const host = h('div', { class: 'term-host' });
  const area = h('div', { class: 'term-area' }, h('div', { class: 'term-pad' }, host));
  const pane = h('div', { class: `pane${state.prefs.filesOpen ? '' : ' no-files'}` });
  const tab: Tab = {
    id: crypto.randomUUID(), title: uniqueTitle(spec.title), subtitle: spec.subtitle, kind: spec.kind, sessionId: spec.sessionId, req: spec.req,
    password: spec.password, needsPassword: spec.needsPassword, rememberPassword: false, state: 'connecting', attempt: 0,
    term, fit, search, pane, area, observer: new ResizeObserver(() => refitSoon(tab)),
  };

  const filesBtn = h('button', { class: 'icon-btn', title: 'Toggle file browser (Ctrl+Shift+E)', 'aria-label': 'Toggle file browser', 'aria-pressed': String(state.prefs.filesOpen), 'data-role': 'files' }, icon('files', 16));
  filesBtn.addEventListener('click', toggleFiles);
  const findBtn = h('button', { class: 'icon-btn', title: 'Find in terminal (Ctrl+Shift+F)', 'aria-label': 'Find in terminal' }, icon('search', 16));
  findBtn.addEventListener('click', () => toggleFind(tab));
  const reconnectBtn = h('button', { class: 'icon-btn hidden', title: 'Reconnect', 'aria-label': 'Reconnect', 'data-role': 'reconnect' }, icon('rotate-cw', 16));
  reconnectBtn.addEventListener('click', () => void connect(tab));

  const bar = h('div', { class: 'pane-bar' }, icon(KIND_META[tab.kind].icon, 15), h('span', { class: 'who' }, tab.title), h('span', { class: 'where' }, tab.subtitle), h('span', { class: 'spacer' }), reconnectBtn, tab.kind === 'ssh' ? filesBtn : null, findBtn);
  const main = h('div', { class: 'pane-main' });
  if (tab.kind === 'ssh') {
    tab.sftp = new SftpPane(() => tab.connId);
    main.append(tab.sftp.el, resizer(tab.sftp.el));
  }
  main.append(area);
  pane.append(bar, main);
  $('panes').append(pane);

  tabs.push(tab);
  activate(tab.id);
  term.open(host);
  fit.fit();
  tab.observer.observe(host);
  wireTerminal(tab, host);
  void connect(tab);
  return tab;
}

export function openSaved(s: SessionSummary): Tab {
  return create({
    req: { sessionId: s.id }, title: s.name, subtitle: describeSession(s), kind: s.kind, sessionId: s.id,
    needsPassword: s.kind === 'ssh' && (s.authMethod ?? 'password') === 'password' && !s.hasPassword,
  });
}

export function openQuick(input: SessionInput): Tab {
  const { password, ...rest } = input;
  return create({
    req: { quick: rest }, title: input.name, subtitle: describeSession({ ...input, port: input.port }), kind: input.kind,
    needsPassword: input.kind === 'ssh' && (input.authMethod ?? 'password') === 'password' && !password, password: password ?? undefined,
  });
}

export const openLocal = (): Tab => openQuick({ name: 'Local', kind: 'local' });

export function duplicateTab(tab: Tab): void {
  if (tab.sessionId) {
    const s = state.sessions.find((x) => x.id === tab.sessionId);
    if (s) {
      openSaved(s);
      return;
    }
  }
  if (tab.req.quick) {
    openQuick({ ...tab.req.quick, password: tab.password });
  }
}

/* ------------------------------------------------------------------ connecting */

const isPassphraseError = (e: unknown) => /passphrase|encrypted private key/i.test((e as Error)?.message ?? '');

async function connect(tab: Tab): Promise<void> {
  const attempt = ++tab.attempt;
  const stale = () => attempt !== tab.attempt || !tabs.includes(tab);
  setState(tab, 'connecting');

  if (tab.needsPassword && tab.password === undefined) {
    const r = await askSecret({
      title: 'Authentication required',
      message: `Enter the password for ${tab.subtitle}.`,
      confirmLabel: 'Connect',
      remember: tab.sessionId ? 'Save this password (encrypted with your OS account)' : undefined,
    });
    if (stale()) return;
    if (!r) return fail(tab, 'Authentication was cancelled.');
    tab.password = r.value;
    tab.rememberPassword = r.remember;
  }

  const open = (password?: string) => window.termApi.open({ ...tab.req, password, cols: tab.term.cols, rows: tab.term.rows });
  let res;
  try {
    try {
      res = await open(tab.password);
    } catch (e) {
      if (!isPassphraseError(e) || stale()) throw e;
      const r = await askSecret({ title: 'Key passphrase', message: `The private key for ${tab.subtitle} is encrypted.`, confirmLabel: 'Unlock' });
      if (!r) throw new Error('Authentication was cancelled.');
      tab.password = r.value;
      res = await open(r.value);
    }
  } catch (e) {
    if (!stale()) fail(tab, cleanError(e));
    return;
  }
  if (stale()) {
    window.termApi.close(res.connId); // the tab was closed or retried while connecting
    return;
  }

  tab.connId = res.connId;
  byConn.set(res.connId, tab);
  tab.error = undefined;
  setState(tab, 'connected');
  for (const chunk of early.get(res.connId) ?? []) tab.term.write(chunk);
  early.delete(res.connId);
  tab.sftp?.refreshAfterReconnect();
  if (tab.id === activeId) {
    tab.sftp && state.prefs.filesOpen && tab.sftp.ensureLoaded();
    tab.term.focus();
  }
  if (tab.sessionId) touchRecent(tab.sessionId);
  if (tab.rememberPassword && tab.sessionId && tab.password) void rememberPassword(tab);
  window.termApi.resize(res.connId, tab.term.cols, tab.term.rows);
}

async function rememberPassword(tab: Tab): Promise<void> {
  const s = state.sessions.find((x) => x.id === tab.sessionId);
  if (!s) return;
  const { hasPassword: _hp, ...rest } = s;
  try {
    await window.termApi.saveSession({ ...rest, password: tab.password });
    state.sessions = await window.termApi.listSessions();
    tab.needsPassword = false;
    tab.rememberPassword = false;
    emitChange();
  } catch (e) {
    toast('error', `Could not save the password: ${cleanError(e)}`);
  }
}

function fail(tab: Tab, message: string): void {
  tab.error = message;
  setState(tab, 'failed');
}

function setState(tab: Tab, s: TabState): void {
  tab.state = s;
  renderOverlay(tab);
  renderBanner(tab);
  tab.pane.classList.toggle('pending', s === 'connecting' || s === 'failed'); // no empty file browser before connecting
  const reconnect = tab.pane.querySelector('[data-role=reconnect]');
  reconnect?.classList.toggle('hidden', s !== 'closed');
  renderTabs();
  emitChange();
}

function renderOverlay(tab: Tab): void {
  tab.overlay?.remove();
  tab.overlay = undefined;
  if (tab.state !== 'connecting' && tab.state !== 'failed') return;
  const failed = tab.state === 'failed';
  const actions = h('div', { class: 'row' });
  if (failed) {
    put(
      actions,
      h('button', { class: 'btn primary', onclick: () => void connect(tab) }, icon('rotate-cw', 15), 'Retry'),
      tab.sessionId ? h('button', { class: 'btn', onclick: () => hooks.editSession?.(tab.sessionId!) }, icon('pencil', 15), 'Edit session') : null,
      h('button', { class: 'btn ghost', onclick: () => void closeTab(tab.id, true) }, 'Close tab'),
    );
  } else {
    actions.append(h('button', { class: 'btn', onclick: () => void closeTab(tab.id, true) }, 'Cancel'));
  }
  tab.overlay = h(
    'div',
    { class: `overlay${failed ? ' error' : ''}`, role: failed ? 'alert' : 'status' },
    h('div', { class: 'big' }, failed ? icon('plug-zap', 22) : icon('loader-circle', 22, 'spin')),
    h('h3', {}, failed ? 'Connection failed' : `Connecting to ${tab.subtitle}…`),
    failed ? h('p', {}, tab.error ?? 'Unknown error') : null,
    actions,
  );
  tab.area.append(tab.overlay);
}

function renderBanner(tab: Tab): void {
  tab.banner?.remove();
  tab.banner = undefined;
  if (tab.state !== 'closed') return;
  tab.banner = h(
    'div',
    { class: 'banner', role: 'status' },
    icon('wifi-off', 16),
    h('span', {}, tab.kind === 'local' ? 'Process exited' : 'Session disconnected'),
    h('button', { class: 'btn primary', onclick: () => void connect(tab) }, icon('rotate-cw', 14), tab.kind === 'local' ? 'Restart' : 'Reconnect'),
    h('button', { class: 'btn ghost', onclick: () => void closeTab(tab.id, true) }, 'Close'),
  );
  tab.area.append(tab.banner);
}

/* ------------------------------------------------------------------ terminal wiring */

function wireTerminal(tab: Tab, host: HTMLElement): void {
  const { term } = tab;
  const send = (data: string) => {
    if (tab.state === 'connected' && tab.connId) window.termApi.write(tab.connId, data);
  };
  term.onData((d) => {
    send(d);
    if (multiExec) for (const o of tabs) if (o !== tab && o.state === 'connected' && o.connId) window.termApi.write(o.connId, d);
  });
  term.onResize(({ cols, rows }) => {
    if (tab.connId && tab.state === 'connected') window.termApi.resize(tab.connId, cols, rows);
    emitChange();
  });

  term.attachCustomKeyEventHandler((ev) => {
    if (ev.type !== 'keydown') return true;
    if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.code === 'KeyC' && term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
    if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyC') {
      if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection());
      return false;
    }
    if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyV') {
      void navigator.clipboard.readText().then((t) => term.paste(t));
      return false;
    }
    if (hooks.key?.(ev)) return false;
    return true;
  });

  host.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const sel = term.hasSelection();
    showMenu(ev.clientX, ev.clientY, [
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+Shift+C', disabled: !sel, run: () => void navigator.clipboard.writeText(term.getSelection()) },
      { label: 'Paste', icon: 'clipboard-paste', shortcut: 'Ctrl+Shift+V', run: () => void navigator.clipboard.readText().then((t) => term.paste(t)) },
      { label: 'Select all', run: () => term.selectAll() },
      'sep',
      { label: 'Find…', icon: 'search', shortcut: 'Ctrl+Shift+F', run: () => toggleFind(tab, true) },
      { label: 'Clear screen', run: () => term.clear() },
    ]);
  });
}

function refit(tab: Tab): void {
  if (tab.area.clientWidth === 0 || tab.area.clientHeight === 0) return; // hidden pane
  try {
    tab.fit.fit();
  } catch {
    /* terminal disposed */
  }
}

const pending = new WeakSet<Tab>();
function refitSoon(tab: Tab): void {
  if (pending.has(tab)) return;
  pending.add(tab);
  requestAnimationFrame(() => {
    pending.delete(tab);
    refit(tab);
  });
}

function resizer(target: HTMLElement): HTMLElement {
  const bar = h('div', { class: 'sftp-resizer', role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to resize' });
  bar.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    bar.setPointerCapture(ev.pointerId);
    bar.classList.add('dragging');
    const startX = ev.clientX;
    const startW = target.getBoundingClientRect().width;
    const move = (e: PointerEvent) => {
      state.prefs.sftpWidth = Math.round(Math.max(220, Math.min(720, startW + e.clientX - startX)));
      document.documentElement.style.setProperty('--sftp-w', `${state.prefs.sftpWidth}px`);
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
  bar.addEventListener('dblclick', () => {
    state.prefs.sftpWidth = 340;
    document.documentElement.style.setProperty('--sftp-w', '340px');
    savePrefs();
  });
  return bar;
}

/* ------------------------------------------------------------------ find */

export function toggleFind(tab = activeTab(), forceOpen = false): void {
  if (!tab) return;
  if (tab.findbar) {
    if (forceOpen) tab.findbar.querySelector('input')?.focus();
    else closeFind(tab);
    return;
  }
  const input = h('input', { class: 'input', placeholder: 'Find', spellcheck: false, 'aria-label': 'Find in terminal' });
  const miss = h('span', { class: 'nomatch hidden' }, 'No results');
  const deco = { matchBackground: '#7a5c00', activeMatchBackground: '#c28a00', matchOverviewRuler: '#c28a00', activeMatchColorOverviewRuler: '#ffb300' };
  const run = (dir: 'next' | 'prev') => {
    if (!input.value) return miss.classList.add('hidden');
    const ok = dir === 'next' ? tab.search.findNext(input.value, { decorations: deco }) : tab.search.findPrevious(input.value, { decorations: deco });
    miss.classList.toggle('hidden', ok);
  };
  input.addEventListener('input', () => run('next'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); run(e.shiftKey ? 'prev' : 'next'); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(tab); }
  });
  const b = (name: Parameters<typeof icon>[0], title: string, fn: () => void) => h('button', { class: 'icon-btn', title, 'aria-label': title, onclick: fn }, icon(name, 15));
  tab.findbar = h('div', { class: 'findbar', role: 'search' }, input, miss, b('chevron-up', 'Previous (Shift+Enter)', () => run('prev')), b('chevron-down', 'Next (Enter)', () => run('next')), b('x', 'Close (Esc)', () => closeFind(tab)));
  tab.area.append(tab.findbar);
  input.focus();
  const sel = tab.term.getSelection();
  if (sel && !sel.includes('\n')) { input.value = sel; input.select(); }
}

function closeFind(tab: Tab): void {
  tab.search.clearDecorations();
  tab.findbar?.remove();
  tab.findbar = undefined;
  tab.term.focus();
}

/* ------------------------------------------------------------------ tabs */

export function activate(id: string): void {
  activeId = id;
  for (const t of tabs) t.pane.classList.toggle('active', t.id === id);
  renderTabs();
  const t = activeTab();
  if (t) {
    requestAnimationFrame(() => {
      refit(t);
      if (!t.findbar?.contains(document.activeElement)) t.term.focus();
    });
    if (t.sftp && state.prefs.filesOpen && t.state === 'connected') t.sftp.ensureLoaded();
  }
  emitChange();
}

export function cycle(dir: 1 | -1): void {
  if (tabs.length < 2) return;
  const i = tabs.findIndex((t) => t.id === activeId);
  activate(tabs[(i + dir + tabs.length) % tabs.length].id);
}

export async function closeTab(id: string, force = false): Promise<void> {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  if (!force && tab.state === 'connected' && !(await askConfirm('Close session', `“${tab.title}” is still connected. Close it?`, 'Close', true))) return;
  tab.attempt++; // invalidates an in-flight connect
  if (tab.connId) {
    window.termApi.close(tab.connId);
    byConn.delete(tab.connId);
    early.delete(tab.connId);
  }
  tab.observer.disconnect();
  tab.term.dispose();
  tab.pane.remove();
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  if (activeId === id) {
    activeId = null;
    const next = tabs[Math.min(i, tabs.length - 1)];
    if (next) activate(next.id);
  }
  renderTabs();
  emitChange();
}

export async function closeOthers(id: string): Promise<void> {
  const others = tabs.filter((t) => t.id !== id);
  if (others.some((t) => t.state === 'connected') && !(await askConfirm('Close other tabs', `Close ${others.length} other tab${others.length === 1 ? '' : 's'}?`, 'Close', true))) return;
  for (const t of others) await closeTab(t.id, true);
}

export function reconnectActive(): void {
  const t = activeTab();
  if (t && (t.state === 'closed' || t.state === 'failed')) void connect(t);
}

function renderTabs(): void {
  const root = $('tabs');
  root.replaceChildren(
    ...tabs.map((t) => {
      const active = t.id === activeId;
      const el = h(
        'div',
        { class: `tab${active ? ' active' : ''}`, role: 'tab', tabIndex: active ? 0 : -1, 'aria-selected': String(active), 'data-state': t.state, title: `${t.title}\n${t.subtitle}` },
        h('span', { class: 'kind' }, icon(KIND_META[t.kind].icon, 14)),
        h('span', { class: 'label' }, t.title),
        multiExec && t.state === 'connected' ? h('span', { class: 'bcast', title: 'MultiExec is on' }, icon('radio', 13)) : null,
        h('span', { class: 'dot' }),
        h('button', { class: 'icon-btn close', title: 'Close tab', 'aria-label': `Close ${t.title}`, tabIndex: -1, onclick: (e: Event) => { e.stopPropagation(); void closeTab(t.id); } }, icon('x', 13)),
      );
      el.addEventListener('mousedown', (e) => {
        // Re-rendering the strip on mousedown would destroy the close button before its click completes.
        if (e.button === 0 && t.id !== activeId && !(e.target as HTMLElement).closest('.close')) activate(t.id);
      });
      el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); void closeTab(t.id); } });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(t.id); } });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: 'Duplicate', icon: 'copy-plus', run: () => duplicateTab(t) },
          { label: t.kind === 'local' ? 'Restart' : 'Reconnect', icon: 'rotate-cw', disabled: t.state === 'connected' || t.state === 'connecting', run: () => void connect(t) },
          'sep',
          { label: 'Close', icon: 'x', shortcut: 'Ctrl+Shift+W', run: () => void closeTab(t.id) },
          { label: 'Close other tabs', disabled: tabs.length < 2, run: () => void closeOthers(t.id) },
        ]);
      });
      if (active) queueMicrotask(() => el.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
      return el;
    }),
  );
}

/* ------------------------------------------------------------------ files, settings, events */

export function toggleFiles(): void {
  state.prefs.filesOpen = !state.prefs.filesOpen;
  savePrefs();
  for (const t of tabs) {
    t.pane.classList.toggle('no-files', !state.prefs.filesOpen);
    t.pane.querySelector('[data-role=files]')?.setAttribute('aria-pressed', String(state.prefs.filesOpen));
    requestAnimationFrame(() => refit(t));
  }
  const t = activeTab();
  if (t?.sftp && state.prefs.filesOpen && t.state === 'connected') t.sftp.ensureLoaded();
  emitChange();
}

export function applySettingsToTerminals(): void {
  const r = applyTheme(state.settings.theme);
  const o = termOptions();
  for (const t of tabs) {
    t.term.options.fontSize = o.fontSize;
    t.term.options.fontFamily = o.fontFamily;
    t.term.options.scrollback = o.scrollback;
    t.term.options.cursorBlink = o.cursorBlink;
    t.term.options.cursorStyle = o.cursorStyle;
    t.term.options.theme = termTheme(r);
    refitSoon(t);
  }
}

export function initWorkspaceEvents(): void {
  window.termApi.onData((id, data) => {
    const t = byConn.get(id);
    if (t) t.term.write(data);
    else early.set(id, [...(early.get(id) ?? []), data]);
  });
  window.termApi.onClosed((id, reason) => {
    const t = byConn.get(id);
    early.delete(id);
    if (!t) return;
    byConn.delete(id);
    t.connId = undefined;
    t.term.write(`\r\n\x1b[2m[${t.kind === 'local' ? 'Process exited' : 'Session closed'}${reason ? `: ${reason}` : ''}]\x1b[0m\r\n`);
    setState(t, 'closed');
    if (reason) toast('error', `${t.title}: ${reason}`);
  });
  document.documentElement.style.setProperty('--sftp-w', `${state.prefs.sftpWidth}px`);
}
