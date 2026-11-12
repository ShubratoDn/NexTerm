import { $, h, put } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import { askConfirm, quickDialog, sessionDialog, settingsDialog, KIND_META } from './dialogs';
import { importDialog } from './import-dialog';
import { openPalette } from './palette';
import type { PaletteItem } from './palette';
import { initSidebar, renderSidebar } from './sidebar';
import { applyTheme, resolveTheme } from './theme';
import { cleanError, toast } from './toast';
import { describeSession, emitChange, onStateChange, recentSessions, savePrefs, state } from './state';
import {
  activate, activeTab, allTabs, applySettingsToTerminals, closeTab, connectedSessionIds, cycle, duplicateTab, hooks, initWorkspaceEvents,
  isMultiExec, openLocal, openQuick, openSaved, reconnectActive, setMultiExec, toggleFiles, toggleFind,
} from './workspace';
import type { ImportSourceId, SessionSummary } from '../shared/types';

const api = window.termApi;
const isMac = api.platform === 'darwin';
const mod = isMac ? '⌘' : 'Ctrl';

/* ------------------------------------------------------------------ data helpers */

async function serialPorts(): Promise<string[]> {
  try {
    return (await api.listSerialPorts()).map((p) => p.path);
  } catch {
    return [];
  }
}

async function reloadSessions(): Promise<void> {
  state.sessions = await api.listSessions();
  emitChange();
}

const folders = () => [...new Set(state.sessions.map((s) => s.folder).filter((f): f is string => !!f))].sort();

/* ------------------------------------------------------------------ actions */

async function editSession(existing?: SessionSummary): Promise<void> {
  const res = await sessionDialog(existing, await serialPorts(), folders());
  if (!res) return;
  try {
    if (res.action === 'delete') {
      if (existing) await removeSession(existing);
      return;
    }
    const saved = await api.saveSession(res.input);
    await reloadSessions();
    if (res.action === 'connect') openSaved(saved);
    else toast('success', `Saved “${saved.name}”`);
  } catch (e) {
    toast('error', cleanError(e));
  }
}

async function removeSession(s: SessionSummary): Promise<void> {
  if (!(await askConfirm('Delete session', `Delete “${s.name}”? Its saved password is removed too. Open tabs stay open.`, 'Delete', true))) return;
  try {
    await api.deleteSession(s.id);
    await reloadSessions();
    toast('success', `Deleted “${s.name}”`);
  } catch (e) {
    toast('error', cleanError(e));
  }
}

async function duplicateSession(s: SessionSummary): Promise<void> {
  try {
    const copy = await api.duplicateSession(s.id);
    await reloadSessions();
    await editSession(copy);
  } catch (e) {
    toast('error', cleanError(e));
  }
}

/** Looks for MobaXterm / PuTTY / OpenSSH connections so the welcome screen can offer them. */
async function refreshImportSources(): Promise<void> {
  try {
    state.importSources = await api.importDetect();
  } catch {
    state.importSources = [];
  }
  emitChange();
}

async function importConnections(source?: ImportSourceId): Promise<void> {
  try {
    await refreshImportSources(); // pick up changes made since startup
    const result = await importDialog(state.importSources, source);
    if (!result) return;
    await reloadSessions();
    if (result.added === 0) toast('info', 'Nothing was imported.');
    else
      toast(
        'success',
        `Imported ${result.added} connection${result.added === 1 ? '' : 's'}. Double-click one to connect; you will be asked for the password the first time.`,
        { ms: 9000 },
      );
  } catch (e) {
    toast('error', cleanError(e));
  }
}

async function quickConnect(): Promise<void> {
  const res = await quickDialog(await serialPorts());
  if (!res) return;
  try {
    if (res.save) {
      const saved = await api.saveSession(res.input);
      await reloadSessions();
      openSaved(saved);
    } else openQuick(res.input);
  } catch (e) {
    toast('error', cleanError(e));
  }
}

async function openSettings(): Promise<void> {
  await settingsDialog(state.settings, async (patch) => {
    try {
      state.settings = await api.setSettings(patch);
      applySettingsToTerminals();
    } catch (e) {
      toast('error', cleanError(e));
    }
    return state.settings;
  });
}

let zoomTimer: number | undefined;
function zoom(delta: number | 'reset'): void {
  const size = delta === 'reset' ? 13 : Math.max(8, Math.min(32, state.settings.fontSize + delta));
  if (size === state.settings.fontSize) return;
  state.settings = { ...state.settings, fontSize: size };
  applySettingsToTerminals();
  window.clearTimeout(zoomTimer);
  zoomTimer = window.setTimeout(() => void api.setSettings({ fontSize: size }).catch(() => undefined), 400);
}

function setSidebarOpen(open: boolean): void {
  state.prefs.sidebarOpen = open;
  savePrefs();
  $('app').classList.toggle('sidebar-closed', !open);
  const b = $('btn-sidebar');
  b.replaceChildren(icon(open ? 'panel-left-close' : 'panel-left-open', 17));
  b.title = open ? 'Hide sidebar (Ctrl+Shift+B)' : 'Show sidebar (Ctrl+Shift+B)';
}

/* ------------------------------------------------------------------ palette & shortcuts */

function paletteItems(): PaletteItem[] {
  const items: PaletteItem[] = [];
  const t = activeTab();
  const act = (title: string, ic: IconName, run: () => void, shortcut?: string, subtitle?: string) => items.push({ group: 'Commands', title, icon: ic, run, shortcut, subtitle });
  act('New session…', 'plus', () => void editSession(), `${mod}+Shift+N`);
  act('Quick connect…', 'zap', () => void quickConnect(), `${mod}+Shift+K`);
  act('New local terminal', 'square-terminal', () => openLocal(), `${mod}+Shift+T`);
  act('Import connections…', 'download', () => void importConnections(), undefined, 'From MobaXterm, PuTTY or an SSH config');
  if (t) {
    if (t.kind !== 'sftp') act('Find in terminal', 'search', () => toggleFind(t, true), `${mod}+Shift+F`);
    act('Duplicate this tab', 'copy-plus', () => duplicateTab(t));
    act('Close tab', 'x', () => void closeTab(t.id), `${mod}+Shift+W`);
    if (t.state === 'closed' || t.state === 'failed') act('Reconnect', 'rotate-cw', reconnectActive);
    if (t.kind === 'ssh') act('Toggle file browser', 'files', toggleFiles, `${mod}+Shift+E`);
  }
  act(isMultiExec() ? 'Turn MultiExec off' : 'Turn MultiExec on', 'radio', () => setMultiExec(!isMultiExec()), undefined, 'Type in all connected tabs at once');
  act(state.settings.monitor ? 'Hide server status bar' : 'Show server status bar', 'gauge', () => {
    void api.setSettings({ monitor: !state.settings.monitor }).then((s) => {
      state.settings = s;
      applySettingsToTerminals();
    }).catch((e) => toast('error', cleanError(e)));
  }, undefined, 'Live CPU, memory, network and disk usage under SSH terminals');
  act('Toggle sidebar', 'panel-left-close', () => setSidebarOpen(!state.prefs.sidebarOpen), `${mod}+Shift+B`);
  act('Zoom in', 'plus', () => zoom(1), `${mod}+=`);
  act('Zoom out', 'plus', () => zoom(-1), `${mod}+-`);
  act('Settings', 'settings', () => void openSettings());

  for (const s of [...state.sessions].sort((a, b) => a.name.localeCompare(b.name))) {
    items.push({ group: 'Sessions', title: `Connect to ${s.name}`, subtitle: describeSession(s), icon: KIND_META[s.kind].icon, run: () => openSaved(s) });
  }
  for (const tb of allTabs()) {
    items.push({ group: 'Open tabs', title: `Switch to ${tb.title}`, subtitle: tb.subtitle, icon: KIND_META[tb.kind].icon, run: () => activate(tb.id) });
  }
  return items;
}

function handleShortcut(ev: KeyboardEvent): boolean {
  if (ev.type !== 'keydown' || document.querySelector('dialog[open]')) return false;
  const ctrl = ev.ctrlKey || (isMac && ev.metaKey);
  if (ctrl && ev.shiftKey && !ev.altKey) {
    const run = (fn: () => void) => { ev.preventDefault(); fn(); return true; };
    switch (ev.code) {
      case 'KeyP': return run(() => openPalette(paletteItems()));
      case 'KeyT': return run(() => openLocal());
      case 'KeyN': return run(() => void editSession());
      case 'KeyK': return run(() => void quickConnect());
      case 'KeyB': return run(() => setSidebarOpen(!state.prefs.sidebarOpen));
      case 'KeyE': return run(toggleFiles);
      case 'KeyF': return run(() => toggleFind());
      case 'KeyW': return run(() => { const t = activeTab(); if (t) void closeTab(t.id); });
    }
  }
  if (ctrl && ev.key === 'Tab') { ev.preventDefault(); cycle(ev.shiftKey ? -1 : 1); return true; }
  if (ctrl && !ev.altKey) {
    if (ev.key === '=' || ev.key === '+') { ev.preventDefault(); zoom(1); return true; }
    if (ev.key === '-') { ev.preventDefault(); zoom(-1); return true; }
    if (ev.key === '0') { ev.preventDefault(); zoom('reset'); return true; }
  }
  return false;
}

/* ------------------------------------------------------------------ welcome & status */

function renderWelcome(): void {
  const el = $('welcome');
  const show = allTabs().length === 0;
  el.classList.toggle('show', show);
  if (!show) return;

  const action = (ic: IconName, title: string, desc: string, run: () => void, sc?: string) =>
    h('button', { class: 'action', onclick: run }, h('span', { class: 'glyph' }, icon(ic, 17)), h('span', { class: 'txt' }, h('div', { class: 't' }, title), h('div', { class: 'd' }, desc)), sc ? h('kbd', {}, sc) : null);

  const recent = recentSessions(5);

  // First run: lead with importing, so nobody starts from an empty list.
  let onboard: HTMLElement | null = null;
  if (state.sessions.length === 0) {
    const found = state.importSources.filter((s) => s.found.length > 0);
    const rows = found.map((s) => {
      const total = s.found.reduce((a, l) => a + l.count, 0);
      return h('div', { class: 'ob-row' },
        h('span', { class: 'src-icon' }, icon(s.id === 'mobaxterm' ? 'server' : s.id === 'putty' ? 'terminal' : 'key-round', 16)),
        h('div', { class: 'txt' }, h('div', { class: 't' }, s.label), h('div', { class: 'd' }, `${total} connection${total === 1 ? '' : 's'} found on this computer`)),
        h('button', { class: 'btn primary', onclick: () => void importConnections(s.id) }, 'Review & import'));
    });
    onboard = h('div', { class: 'onboard' },
      h('div', { class: 'ob-head' }, h('span', { class: 'ob-icon' }, icon('download', 19)),
        h('div', {}, h('h2', {}, found.length ? 'Bring your connections with you' : 'Already using another SSH tool?'),
          h('p', {}, found.length ? 'NexTerm found connections from other tools. Import them in a few clicks instead of typing each server again.' : 'Import your saved servers from MobaXterm, PuTTY or an SSH config instead of adding them one by one.'))),
      ...rows,
      h('div', { class: 'ob-foot' }, h('span', {}, 'Passwords are never imported.'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => void importConnections() }, icon('folder-open', 15), found.length ? 'Choose another file…' : 'Import connections…')));
  }

  el.replaceChildren(
    h('div', { class: 'welcome-inner' },
      h('div', { class: 'mark' }, h('img', { src: 'icon.svg', alt: '', width: 44, height: 44 }), h('div', {}, h('h1', {}, 'NexTerm'), h('p', { class: 'tag' }, 'SSH, SFTP, Telnet, serial and local terminals in one window'))),
      onboard,
      h('h3', {}, 'Start'),
      h('div', { class: 'action-list' },
        action('plus', 'New session', 'Create and save a connection', () => void editSession(), `${mod}+Shift+N`),
        action('zap', 'Quick connect', 'Connect to a host without saving it', () => void quickConnect(), `${mod}+Shift+K`),
        action('square-terminal', 'Local terminal', 'Open a shell on this computer', () => openLocal(), `${mod}+Shift+T`),
        state.sessions.length ? action('download', 'Import connections', 'From MobaXterm, PuTTY or an SSH config', () => void importConnections()) : null,
        action('command', 'Command palette', 'Search sessions and commands', () => openPalette(paletteItems()), `${mod}+Shift+P`),
      ),
      recent.length ? h('h3', {}, 'Recent') : null,
      recent.length ? h('div', { class: 'action-list' }, ...recent.map((s) => action(KIND_META[s.kind].icon, s.name, describeSession(s), () => openSaved(s)))) : null,
      h('h3', {}, 'Tips'),
      h('div', { class: 'tips' }, h('kbd', {}, `${mod}+Shift+E`), 'Show the file browser beside an SSH terminal',
        h('kbd', {}, 'Drag files'), 'onto the file browser to upload them',
        h('kbd', {}, `${mod}+Shift+F`), 'Search the terminal output',
        h('kbd', {}, 'MultiExec'), 'in the status bar types into every open tab at once'),
    ),
  );
}

function renderStatus(): void {
  const t = activeTab();
  const connected = allTabs().filter((x) => x.state === 'connected').length;
  const dot = (cls: string) => h('span', { class: `dot ${cls}` });
  let left: HTMLElement;
  if (!t) left = h('span', { class: 'item' }, dot(''), 'Ready');
  else if (t.state === 'connected') left = h('span', { class: 'item' }, dot('ok'), `Connected · ${t.subtitle}`);
  else if (t.state === 'connecting') left = h('span', { class: 'item' }, dot('busy'), `Connecting · ${t.subtitle}`);
  else if (t.state === 'failed') left = h('span', { class: 'item' }, dot('bad'), `Connection failed · ${t.subtitle}`);
  else left = h('span', { class: 'item' }, dot(''), `Disconnected · ${t.subtitle}`);

  const mx = h('button', { class: 'mx', 'aria-pressed': String(isMultiExec()), title: 'MultiExec: send everything you type to all connected tabs' }, icon('radio', 13), isMultiExec() ? `MultiExec on · ${connected} tab${connected === 1 ? '' : 's'}` : 'MultiExec');
  mx.addEventListener('click', () => setMultiExec(!isMultiExec()));

  const bar = $('statusbar');
  bar.replaceChildren();
  put(bar, left, h('span', { class: 'spacer' }), mx, t && t.kind !== 'sftp' && h('span', { class: 'item' }, `${t.term.cols} × ${t.term.rows}`), h('span', { class: 'item' }, 'UTF-8'));
}

/* ------------------------------------------------------------------ bootstrap */

let lastSig = '';
function onChange(): void {
  const sig = JSON.stringify([state.sessions, [...connectedSessionIds()]]);
  if (sig !== lastSig) {
    lastSig = sig;
    renderSidebar();
  }
  renderWelcome();
  renderStatus();
}

async function init(): Promise<void> {
  state.settings = await api.getSettings();
  applyTheme(state.settings.theme);
  // xterm measures glyphs once, so the bundled fonts must be ready before the first terminal opens.
  await Promise.all(['400 13px "JetBrains Mono"', '700 13px "JetBrains Mono"', '400 13px "Inter"'].map((f) => document.fonts.load(f))).catch(() => undefined);

  $('btn-newtab').replaceChildren(icon('plus', 16));
  $('btn-newtab').addEventListener('click', () => openLocal());
  $('btn-sidebar').addEventListener('click', () => setSidebarOpen(!state.prefs.sidebarOpen));
  $('btn-palette').replaceChildren(icon('search', 14), h('span', {}, 'Search'), h('kbd', {}, `${mod}+Shift+P`));
  $('btn-palette').addEventListener('click', () => openPalette(paletteItems()));
  setSidebarOpen(state.prefs.sidebarOpen);

  initSidebar({
    newSession: () => void editSession(),
    quickConnect: () => void quickConnect(),
    openLocal: () => openLocal(),
    settings: () => void openSettings(),
    importSessions: () => void importConnections(),
    connect: (s) => openSaved(s),
    edit: (s) => void editSession(s),
    duplicate: (s) => void duplicateSession(s),
    remove: (s) => void removeSession(s),
  });

  hooks.key = handleShortcut;
  hooks.editSession = (id) => { const s = state.sessions.find((x) => x.id === id); if (s) void editSession(s); };
  // Capture phase, and stop the event once handled so the focused terminal never sees (or re-handles) it.
  document.addEventListener('keydown', (e) => { if (handleShortcut(e)) e.stopPropagation(); }, true);
  // Dropping a file anywhere else must not make the window navigate to it.
  for (const type of ['dragover', 'drop'] as const) document.addEventListener(type, (e) => e.preventDefault());
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (state.settings.theme === 'system') applySettingsToTerminals();
  });
  window.addEventListener('unhandledrejection', (e) => toast('error', cleanError(e.reason)));

  initWorkspaceEvents();
  onStateChange(onChange);
  state.sessions = await api.listSessions();
  resolveTheme(state.settings.theme);
  onChange();
  void refreshImportSources(); // detection can take a moment (it queries the registry); do not block the first paint
}

init().catch((e) => toast('error', `Startup failed: ${cleanError(e)}`));
