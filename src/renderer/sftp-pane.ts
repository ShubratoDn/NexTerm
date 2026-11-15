import { formatSize, h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import { askConfirm, askText } from './dialogs';
import { showMenu } from './menu';
import type { MenuEntry } from './menu';
import { showProperties } from './properties-dialog';
import { cleanError, toast, withResult } from './toast';
import { copyToClipboard } from './clipboard';
import { savePrefs, state } from './state';
import type { SftpEntry, TreeTransferResult } from '../shared/types';

type SortKey = 'name' | 'mtime' | 'size';

const EXT: Record<string, IconName> = {};
const ext = (icn: IconName, list: string) => list.split(' ').forEach((e) => (EXT[e] = icn));
ext('file-image', 'png jpg jpeg gif webp svg bmp ico tif tiff');
ext('file-archive', 'zip tar gz tgz xz bz2 7z rar zst deb rpm');
ext('file-code', 'js mjs ts tsx jsx py sh bash zsh c cc cpp h hpp go rs java kt rb php sql json yaml yml toml xml html css conf cfg ini service');
ext('file-text', 'txt md log csv rst');

function fileIcon(e: SftpEntry): IconName {
  if (e.isDir) return 'folder';
  if (e.isLink) return 'link';
  const dot = e.name.lastIndexOf('.');
  return (dot > 0 && EXT[e.name.slice(dot + 1).toLowerCase()]) || 'file';
}

const join = (dir: string, name: string) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`);
const parentOf = (p: string) => {
  const t = p.replace(/\/+$/, '');
  const i = t.lastIndexOf('/');
  return i <= 0 ? '/' : t.slice(0, i);
};
const baseOf = (p: string) => p.replace(/\/+$/, '').slice(p.replace(/\/+$/, '').lastIndexOf('/') + 1) || '/';
const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

/** Files that were copied or cut and wait to be pasted. Shared by every file browser, so it also works between servers. */
interface FileClip {
  connId: string;
  /** Full remote paths. */
  paths: string[];
  cut: boolean;
}
let fileClip: FileClip | null = null;

/** Files that make no sense in a text editor: these are downloaded when double-clicked. */
const BINARY = new Set('exe dll so bin iso img pdf doc docx xls xlsx ppt pptx odt ods mp3 mp4 mkv avi mov wav flac ogg woff woff2 ttf otf class jar db sqlite pyc o a dmg'.split(' '));
function isBinaryName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  const e = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const icn = EXT[e];
  return BINARY.has(e) || icn === 'file-archive' || icn === 'file-image';
}

const LARGE_FILE = 10 * 1024 * 1024;

export interface SftpHooks {
  /** Types `cd <folder>` into the session's terminal (SSH shell sessions only). */
  openTerminal?: (dir: string) => void;
}

/** File browser shown beside an SSH terminal, or on its own for SFTP-only sessions. */
export class SftpPane {
  readonly el: HTMLElement;
  private trail = h('div', { class: 'crumbs-trail' });
  private pathInput = h('input', { class: 'hidden', spellcheck: false, 'aria-label': 'Remote path' });
  private crumbs = h('div', { class: 'crumbs' }, this.trail, this.pathInput);
  private list = h('div', { class: 'sftp-list', role: 'listbox', 'aria-multiselectable': 'true', tabIndex: 0 });
  private foot = h('span', {});
  private cols = h('div', { class: 'sftp-cols' });
  private hiddenBtn = h('button', { class: 'icon-btn', title: 'Show hidden files', 'aria-label': 'Show hidden files', 'aria-pressed': String(state.prefs.showHidden) }, icon('eye', 15));

  private cwd = '';
  private entries: SftpEntry[] = [];
  private visibleRows: SftpEntry[] = [];
  /** Row elements by name. Selecting only changes their classes, so a double-click never loses its target. */
  private rowEls = new Map<string, HTMLElement>();
  private selected = new Set<string>();
  private anchor: string | null = null;
  private sort: { key: SortKey; dir: 1 | -1 } = { key: 'name', dir: 1 };
  private status: 'idle' | 'loading' | 'error' = 'idle';
  private errorText = '';
  private seq = 0;
  private started = false;
  private dragDepth = 0;

  constructor(
    private readonly getConn: () => string | undefined,
    private readonly hooks: SftpHooks = {},
  ) {
    const tool = (name: IconName, title: string, fn: (ev: MouseEvent) => void) => {
      const b = h('button', { class: 'icon-btn', title, 'aria-label': title }, icon(name, 15));
      b.addEventListener('click', fn);
      return b;
    };
    this.hiddenBtn.addEventListener('click', () => {
      state.prefs.showHidden = !state.prefs.showHidden;
      this.hiddenBtn.setAttribute('aria-pressed', String(state.prefs.showHidden));
      savePrefs();
      this.render();
    });

    const dropzone = h('div', { class: 'dropzone' }, icon('upload', 26), h('div', {}, 'Drop files or folders to upload here'));
    this.el = h(
      'div',
      { class: 'sftp' },
      h('div', { class: 'sftp-head' }, h('h4', {}, 'Files'),
        tool('arrow-up', 'Parent folder (Backspace)', () => this.up()),
        tool('refresh-cw', 'Refresh (F5)', () => void this.load(this.cwd)),
        tool('folder-plus', 'New folder', () => void this.newFolder()),
        tool('upload', 'Upload files', () => void this.upload()),
        this.hiddenBtn,
        tool('ellipsis', 'More actions', (ev) => {
          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
          this.backgroundMenu(r.left, r.bottom + 2);
        })),
      this.crumbs, this.cols, this.list,
      h('div', { class: 'sftp-foot' }, this.foot),
      dropzone,
    );

    this.crumbs.addEventListener('mousedown', (ev) => {
      if (ev.target === this.crumbs || ev.target === this.trail) {
        ev.preventDefault();
        this.editPath();
      }
    });
    this.pathInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        const v = this.pathInput.value.trim();
        this.endEdit();
        if (v) void this.load(v);
      } else if (ev.key === 'Escape') this.endEdit();
    });
    this.pathInput.addEventListener('blur', () => this.endEdit());

    this.list.addEventListener('keydown', (ev) => this.onKey(ev));
    this.list.addEventListener('contextmenu', (ev) => {
      if (ev.target === this.list || (ev.target as HTMLElement).classList.contains('sftp-state')) {
        ev.preventDefault();
        this.selected.clear();
        this.paintSelection();
        this.backgroundMenu(ev.clientX, ev.clientY);
      }
    });

    // Drag & drop upload (files and folders).
    const hasFiles = (ev: DragEvent) => !!ev.dataTransfer && [...ev.dataTransfer.types].includes('Files');
    this.el.addEventListener('dragenter', (ev) => { if (hasFiles(ev)) { ev.preventDefault(); this.dragDepth++; this.el.classList.add('dragging'); } });
    this.el.addEventListener('dragover', (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
    this.el.addEventListener('dragleave', () => { if (--this.dragDepth <= 0) { this.dragDepth = 0; this.el.classList.remove('dragging'); } });
    this.el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      this.dragDepth = 0;
      this.el.classList.remove('dragging');
      const paths = [...(ev.dataTransfer?.files ?? [])].map((f) => window.termApi.pathForFile(f)).filter(Boolean);
      if (paths.length) void this.uploadPaths(paths);
    });

    this.renderCols();
  }

  /** Loads the home folder the first time the panel is shown. */
  ensureLoaded(): void {
    if (this.started) return;
    this.started = true;
    void this.start();
  }

  /** Called after a reconnect: reload the folder the user was looking at. */
  refreshAfterReconnect(): void {
    if (!this.started) return;
    void this.load(this.cwd || '.');
  }

  private async start(): Promise<void> {
    const id = this.getConn();
    if (!id) return;
    this.setStatus('loading');
    try {
      await this.load(await window.termApi.sftp.realpath(id, '.'));
    } catch (e) {
      this.fail(cleanError(e));
    }
  }

  private setStatus(s: 'idle' | 'loading' | 'error', text = ''): void {
    this.status = s;
    this.errorText = text;
    this.render();
  }

  private fail(text: string): void {
    this.setStatus('error', text);
  }

  async load(path: string): Promise<void> {
    const id = this.getConn();
    if (!id) return this.fail('Not connected.');
    const mine = ++this.seq;
    this.setStatus('loading');
    try {
      const real = path === '.' ? path : await window.termApi.sftp.realpath(id, path).catch(() => path);
      const entries = await window.termApi.sftp.list(id, real);
      if (mine !== this.seq) return; // a newer navigation superseded this one
      const sameFolder = real === this.cwd;
      this.cwd = real;
      this.entries = entries;
      // keep the selection across a refresh of the same folder, dropping what no longer exists
      this.selected = sameFolder ? new Set([...this.selected].filter((n) => entries.some((e) => e.name === n))) : new Set();
      if (!sameFolder) this.anchor = null;
      this.status = 'idle';
      this.renderCrumbs();
      this.render();
    } catch (e) {
      if (mine === this.seq) this.fail(`Cannot open ${path}\n${cleanError(e)}`);
    }
  }

  /* ---------- rendering ---------- */

  private visible(): SftpEntry[] {
    const { key, dir } = this.sort;
    const list = this.entries.filter((e) => state.prefs.showHidden || !e.name.startsWith('.'));
    return list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      const c = key === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : key === 'size' ? a.size - b.size : a.mtimeMs - b.mtimeMs;
      return (c || a.name.localeCompare(b.name)) * dir;
    });
  }

  private renderCols(): void {
    const col = (key: SortKey, label: string, cls = '') => {
      const active = this.sort.key === key;
      const b = h('button', { class: cls, title: `Sort by ${label.toLowerCase()}` }, label, active ? icon(this.sort.dir === 1 ? 'chevron-up' : 'chevron-down', 12) : null);
      b.addEventListener('click', () => {
        this.sort = { key, dir: active ? (this.sort.dir === 1 ? -1 : 1) : 1 };
        this.renderCols();
        this.render();
      });
      return b;
    };
    this.cols.replaceChildren(col('name', 'Name'), col('mtime', 'Modified'), col('size', 'Size', 'r'));
  }

  private renderCrumbs(): void {
    const parts = this.cwd.split('/').filter(Boolean);
    const items: Node[] = [];
    const crumb = (label: string, target: string) => {
      const b = h('button', { class: 'crumb', title: target }, label);
      b.addEventListener('click', (ev) => { ev.stopPropagation(); void this.load(target); });
      return b;
    };
    items.push(crumb('/', '/'));
    let acc = '';
    for (const p of parts) {
      acc += `/${p}`;
      items.push(h('span', { class: 'sep' }, icon('chevron-right', 12)), crumb(p, acc));
    }
    this.trail.replaceChildren(...items);
    this.trail.scrollLeft = this.trail.scrollWidth;
  }

  private editPath(): void {
    this.trail.classList.add('hidden');
    this.pathInput.classList.remove('hidden');
    this.pathInput.value = this.cwd;
    this.pathInput.focus();
    this.pathInput.select();
  }

  private endEdit(): void {
    if (this.pathInput.classList.contains('hidden')) return;
    this.pathInput.classList.add('hidden');
    this.trail.classList.remove('hidden');
  }

  private render(): void {
    this.rowEls.clear();
    if (this.status === 'loading' && this.entries.length === 0) {
      this.list.replaceChildren(h('div', { class: 'sftp-state' }, icon('loader-circle', 22, 'spin'), 'Loading…'));
      this.foot.textContent = '';
      return;
    }
    if (this.status === 'error') {
      const retry = h('button', { class: 'btn' }, icon('refresh-cw', 14), 'Retry');
      retry.addEventListener('click', () => (this.cwd ? void this.load(this.cwd) : void this.start()));
      this.list.replaceChildren(h('div', { class: 'sftp-state err' }, icon('circle-alert', 22), h('div', { style: 'white-space:pre-wrap;user-select:text' }, this.errorText), retry));
      this.foot.textContent = '';
      return;
    }
    const rows = this.visible();
    this.visibleRows = rows;
    if (rows.length === 0) {
      this.list.replaceChildren(h('div', { class: 'sftp-state' }, icon('folder', 24), this.entries.length ? 'Only hidden items here' : 'This folder is empty', h('span', { class: 'hint' }, 'Drop files or folders here to upload')));
      this.foot.textContent = '0 items';
      return;
    }
    const els = rows.map((e) => {
      const el = this.row(e);
      this.rowEls.set(e.name, el);
      return el;
    });
    this.list.replaceChildren(...els);
    this.paintSelection();
  }

  private row(e: SftpEntry): HTMLElement {
    const row = h(
      'div',
      { class: `sftp-row${e.isDir ? ' dir' : ''}`, role: 'option', 'aria-selected': 'false', title: `${e.name}\n${(e.mode & 0o7777).toString(8).padStart(4, '0')}` },
      h('div', { class: 'nm' }, icon(fileIcon(e), 15), h('span', {}, e.name)),
      h('div', { class: 'dt' }, fmtDate(e.mtimeMs)),
      h('div', { class: 'sz' }, e.isDir ? '—' : formatSize(e.size)),
    );
    row.dataset.name = e.name;
    // Selecting must NOT rebuild the list: that would destroy this very row between the two clicks of a double-click.
    row.addEventListener('mousedown', (ev) => {
      if (ev.button === 2 && this.selected.has(e.name)) return;
      this.select(e, ev);
    });
    row.addEventListener('dblclick', () => this.open(e));
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (!this.selected.has(e.name)) this.select(e, ev);
      this.rowMenu(ev.clientX, ev.clientY);
    });
    return row;
  }

  /** Updates highlights and the footer without touching the row elements. */
  private paintSelection(): void {
    const cutHere = fileClip?.cut && fileClip.connId === this.getConn() ? new Set(fileClip.paths) : null;
    for (const [name, el] of this.rowEls) {
      const on = this.selected.has(name);
      el.classList.toggle('sel', on);
      el.classList.toggle('cut', !!cutHere?.has(join(this.cwd, name)));
      el.setAttribute('aria-selected', String(on));
    }
    const n = this.selected.size;
    this.foot.textContent = `${plural(this.visibleRows.length, 'item')}${n ? ` · ${n} selected` : ''}`;
  }

  private select(e: SftpEntry, ev: MouseEvent | KeyboardEvent): void {
    const rows = this.visibleRows;
    if (ev.shiftKey && this.anchor) {
      const names = rows.map((r) => r.name);
      const a = names.indexOf(this.anchor);
      const b = names.indexOf(e.name);
      if (a >= 0 && b >= 0) {
        this.selected = new Set(names.slice(Math.min(a, b), Math.max(a, b) + 1));
        this.paintSelection();
        return;
      }
    }
    if (ev.ctrlKey || ev.metaKey) {
      if (!this.selected.delete(e.name)) this.selected.add(e.name);
    } else this.selected = new Set([e.name]);
    this.anchor = e.name;
    this.paintSelection();
  }

  private selectedEntries(): SftpEntry[] {
    return this.entries.filter((e) => this.selected.has(e.name));
  }

  /* ---------- menus ---------- */

  private rowMenu(x: number, y: number): void {
    const sel = this.selectedEntries();
    if (sel.length === 0) return;
    const one = sel.length === 1 ? sel[0] : undefined;
    const folder = one?.isDir ? join(this.cwd, one.name) : undefined;
    const anyDir = sel.some((e) => e.isDir);
    const items: MenuEntry[] = [];

    if (one?.isDir) items.push({ label: 'Open', icon: 'folder-open', shortcut: 'Enter', run: () => this.open(one) });
    if (one && !one.isDir) {
      items.push(
        { label: 'Edit', icon: 'pencil', shortcut: 'F4', run: () => void this.openFile(one, 'edit') },
        { label: 'Open with default app', icon: 'external-link', run: () => void this.openFile(one, 'default') },
        { label: 'Open with…', icon: 'external-link', run: () => void this.openFile(one, 'choose') },
        'sep',
      );
    }
    items.push({ label: one ? (one.isDir ? 'Download folder…' : 'Download') : `Download ${sel.length} items…`, icon: 'download', run: () => void this.download() });
    if (this.hooks.openTerminal) items.push({ label: 'Open terminal here', icon: 'terminal', run: () => this.hooks.openTerminal!(folder ?? this.cwd) });

    items.push(
      'sep',
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', run: () => this.copySelection(false) },
      { label: 'Cut', icon: 'scissors', shortcut: 'Ctrl+X', run: () => this.copySelection(true) },
      { label: folder ? 'Paste into folder' : 'Paste', icon: 'clipboard-paste', shortcut: 'Ctrl+V', disabled: !fileClip, run: () => void this.paste(folder ?? this.cwd) },
    );

    if (folder) {
      items.push(
        'sep',
        { label: 'Upload files here…', icon: 'upload', run: () => void this.upload(folder) },
        { label: 'Upload folder here…', icon: 'upload', run: () => void this.uploadFolder(folder) },
        { label: 'New folder inside…', icon: 'folder-plus', run: () => void this.newFolder(folder) },
        { label: 'New file inside…', icon: 'file', run: () => void this.newFile(folder) },
      );
    }
    items.push(
      'sep',
      { label: 'Rename…', icon: 'pencil', shortcut: 'F2', disabled: !one, run: () => void this.rename() },
      { label: sel.length > 1 ? `Move ${sel.length} items to…` : 'Move to…', icon: 'arrow-down-up', run: () => void this.moveTo() },
      { label: sel.length > 1 ? 'Copy paths' : 'Copy path', icon: 'copy', run: () => this.copyText(sel.map((e) => join(this.cwd, e.name)).join('\n'), 'Path copied') },
      { label: sel.length > 1 ? 'Copy names' : 'Copy name', icon: 'copy', run: () => this.copyText(sel.map((e) => e.name).join('\n'), 'Name copied') },
      'sep',
      { label: 'Properties', icon: 'info', shortcut: 'Alt+Enter', run: () => void this.properties() },
      'sep',
      { label: sel.length > 1 ? `Delete ${sel.length} items…` : anyDir ? 'Delete (empty folder)…' : 'Delete…', icon: 'trash-2', danger: true, shortcut: 'Del', run: () => void this.remove() },
    );
    if (anyDir) items.push({ label: 'Delete with contents…', icon: 'trash-2', danger: true, run: () => void this.removeWithContents() });
    showMenu(x, y, items);
  }

  private backgroundMenu(x: number, y: number): void {
    const items: MenuEntry[] = [
      { label: 'Paste', icon: 'clipboard-paste', shortcut: 'Ctrl+V', disabled: !fileClip, run: () => void this.paste() },
      'sep',
      { label: 'New folder…', icon: 'folder-plus', run: () => void this.newFolder() },
      { label: 'New file…', icon: 'file', run: () => void this.newFile() },
      { label: 'Upload files…', icon: 'upload', run: () => void this.upload() },
      { label: 'Upload folder…', icon: 'upload', run: () => void this.uploadFolder() },
    ];
    if (this.hooks.openTerminal) items.push('sep', { label: 'Open terminal here', icon: 'terminal', run: () => this.hooks.openTerminal!(this.cwd) });
    items.push(
      'sep',
      { label: 'Select all', icon: 'check', shortcut: 'Ctrl+A', run: () => this.selectAll() },
      { label: 'Refresh', icon: 'refresh-cw', shortcut: 'F5', run: () => void this.load(this.cwd) },
      'sep',
      { label: 'Properties of this folder', icon: 'info', run: () => void this.properties(true) },
    );
    showMenu(x, y, items);
  }

  private onKey(ev: KeyboardEvent): void {
    const rows = this.visibleRows;
    const idx = rows.findIndex((r) => r.name === this.anchor);
    const move = (to: number) => {
      const t = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (!t) return;
      ev.preventDefault();
      this.select(t, ev);
      this.rowEls.get(t.name)?.scrollIntoView({ block: 'nearest' });
    };
    switch (ev.key) {
      case 'ArrowDown': return move(idx + 1);
      case 'ArrowUp': return move(idx < 0 ? 0 : idx - 1);
      case 'Home': return move(0);
      case 'End': return move(rows.length - 1);
      case 'Enter': {
        ev.preventDefault();
        if (ev.altKey) return void this.properties();
        const e = rows[idx];
        if (e) this.open(e);
        return;
      }
      case 'Backspace': ev.preventDefault(); return this.up();
      case 'Delete': ev.preventDefault(); return void this.remove();
      case 'F2': ev.preventDefault(); return void this.rename();
      case 'F4': {
        ev.preventDefault();
        const e = this.selectedEntries();
        if (e.length === 1 && !e[0].isDir) void this.openFile(e[0], 'edit');
        return;
      }
      case 'c': case 'C': if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey) { ev.preventDefault(); this.copySelection(false); } return;
      case 'x': case 'X': if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey) { ev.preventDefault(); this.copySelection(true); } return;
      case 'v': case 'V': if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey) { ev.preventDefault(); void this.paste(); } return;
      case 'F5': ev.preventDefault(); return void this.load(this.cwd);
      case 'a': if (ev.ctrlKey) { ev.preventDefault(); this.selectAll(); } return;
      case 'l': if (ev.ctrlKey) { ev.preventDefault(); this.editPath(); } return;
    }
  }

  private selectAll(): void {
    this.selected = new Set(this.visibleRows.map((r) => r.name));
    this.paintSelection();
  }

  /* ---------- actions ---------- */

  private up(): void {
    if (this.cwd && this.cwd !== '/') void this.load(parentOf(this.cwd));
  }

  /** Double-click or Enter: folders open, text-like files open in the editor, other files are downloaded. */
  private open(e: SftpEntry): void {
    if (e.isDir) return void this.load(join(this.cwd, e.name));
    if (e.isLink) {
      // A link may point to a folder.
      const id = this.getConn();
      if (!id) return;
      void window.termApi.sftp.stat(id, join(this.cwd, e.name)).then(
        (st) => (st.targetIsDir ? void this.load(join(this.cwd, e.name)) : isBinaryName(e.name) ? void this.download([e]) : void this.openFile(e, 'edit')),
        (err) => toast('error', cleanError(err)),
      );
      return;
    }
    if (isBinaryName(e.name)) void this.download([e]);
    else void this.openFile(e, 'edit');
  }

  /** Opens a file in a local program. Changes saved there are uploaded back automatically. */
  private openFile(e: SftpEntry, mode: 'edit' | 'default' | 'choose'): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      if (!id) return;
      if (e.size > LARGE_FILE && !(await askConfirm('Large file', `“${e.name}” is ${formatSize(e.size)}. It has to be downloaded before it can be opened. Continue?`, 'Open'))) return;
      const r = await window.termApi.sftp.edit(id, join(this.cwd, e.name), mode);
      if (!r) return;
      toast('success', `Opened “${r.name}” in ${r.program}. When you save it there, it is uploaded to the server automatically.`, { ms: 6000 });
    });
  }

  private copySelection(cut: boolean): void {
    const id = this.conn();
    const sel = this.selectedEntries();
    if (!id || sel.length === 0) return;
    fileClip = { connId: id, paths: sel.map((e) => join(this.cwd, e.name)), cut };
    // The paths also go to the system clipboard as text, so they can be pasted into a terminal or a note.
    void window.termApi.writeClipboard(fileClip.paths.join('\n')).catch(() => undefined);
    this.paintSelection();
    const what = sel.length === 1 ? `“${sel[0].name}”` : plural(sel.length, 'item');
    toast('info', `${cut ? 'Cut' : 'Copied'} ${what}. Open a folder, even on another server, and choose Paste.`, { ms: 3500 });
  }

  /** Pastes what was copied or cut into `dir`. Nothing is overwritten: a clash gets a new name such as “a (1).txt”. */
  private paste(dir = this.cwd): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      const clip = fileClip;
      if (!id || !clip) return;
      const r = await withResult(
        () => window.termApi.sftp.copy(clip.connId, clip.paths, id, dir, clip.cut),
        (x) => (x.files + x.folders === 0 && !x.skipped ? 'Nothing to move: the items are already in this folder.' : this.reportTransfer(clip.cut ? 'Moved' : 'Copied', x)),
      );
      if (clip.cut && r && r.skipped === 0) fileClip = null; // a cut can only be pasted once
      await this.load(this.cwd);
    });
  }

  private conn(): string | undefined {
    const id = this.getConn();
    if (!id) toast('error', 'The session is not connected.');
    return id;
  }

  private async guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      toast('error', cleanError(e));
    }
  }

  private copyText(text: string, message: string): void {
    void copyToClipboard(text).then((ok) => ok && toast('success', message));
  }

  private reportTransfer(verb: string, r: TreeTransferResult): string {
    const parts = [`${verb} ${plural(r.files, 'file')}`];
    if (r.folders) parts.push(plural(r.folders, 'folder'));
    let msg = parts.join(' and ');
    if (r.skipped) msg += ` · ${r.skipped} skipped${r.firstError ? ` (${r.firstError})` : ''}`;
    return msg;
  }

  private download(entries = this.selectedEntries()): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      if (!id || entries.length === 0) return;
      if (entries.length === 1 && !entries[0].isDir) {
        // Progress appears in the transfer card; only the result is reported here.
        try {
          const saved = await window.termApi.sftp.download(id, join(this.cwd, entries[0].name));
          if (saved) toast('success', `Saved to ${saved}`);
        } catch (e) {
          toast('error', cleanError(e));
        }
        return;
      }
      try {
        const r = await window.termApi.sftp.downloadMany(id, entries.map((f) => join(this.cwd, f.name)));
        if (r.dir) toast(r.skipped ? 'info' : 'success', `Saved ${plural(r.saved, 'file')} to ${r.dir}${r.skipped ? ` · ${r.skipped} skipped (links or unreadable items)` : ''}`, { ms: 9000 });
      } catch (e) {
        toast('error', cleanError(e));
      }
    });
  }

  private upload(dir = this.cwd): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      if (!id) return;
      const n = await withResult(() => window.termApi.sftp.upload(id, dir), (c) => (c ? `Uploaded ${plural(c, 'file')}` : 'Nothing uploaded'));
      if (n && dir === this.cwd) await this.load(this.cwd);
    });
  }

  private uploadFolder(dir = this.cwd): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      if (!id) return;
      const r = await withResult(() => window.termApi.sftp.uploadFolder(id, dir), (x) => (x.files + x.folders ? this.reportTransfer('Uploaded', x) : 'Nothing uploaded'));
      if (r && r.files + r.folders > 0 && dir === this.cwd) await this.load(this.cwd);
    });
  }

  private uploadPaths(paths: string[]): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      if (!id) return;
      const r = await withResult(() => window.termApi.sftp.uploadPaths(id, this.cwd, paths), (x) => this.reportTransfer('Uploaded', x));
      if (r && r.files + r.folders > 0) await this.load(this.cwd);
    });
  }

  private newFolder(dir = this.cwd): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      const name = id && (await askText('New folder', 'Folder name', '', 'Create'));
      if (!id || !name) return;
      await window.termApi.sftp.mkdir(id, join(dir, name));
      if (dir === this.cwd) await this.load(this.cwd);
      else toast('success', `Created “${name}”`);
    });
  }

  private newFile(dir = this.cwd): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      const name = id && (await askText('New file', 'File name', '', 'Create'));
      if (!id || !name) return;
      await window.termApi.sftp.mkfile(id, join(dir, name));
      if (dir === this.cwd) {
        this.selected = new Set([name]);
        await this.load(this.cwd);
      } else toast('success', `Created “${name}”`);
    });
  }

  private rename(): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      const sel = this.selectedEntries();
      if (!id || sel.length !== 1) return;
      const name = await askText('Rename', 'New name', sel[0].name, 'Rename');
      if (!name || name === sel[0].name) return;
      await window.termApi.sftp.rename(id, join(this.cwd, sel[0].name), join(this.cwd, name));
      this.selected = new Set([name]);
      await this.load(this.cwd);
    });
  }

  private moveTo(): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      const sel = this.selectedEntries();
      if (!id || sel.length === 0) return;
      const dest = await askText('Move to', 'Destination folder (path on the server)', this.cwd, 'Move');
      if (!dest) return;
      const target = await window.termApi.sftp.realpath(id, dest).catch(() => dest);
      if (target === this.cwd) return;
      const failed: string[] = [];
      let moved = 0;
      for (const e of sel) {
        try {
          await window.termApi.sftp.rename(id, join(this.cwd, e.name), join(target, e.name));
          moved++;
        } catch (err) {
          failed.push(`${e.name}: ${cleanError(err)}`);
        }
      }
      if (moved) toast('success', `Moved ${plural(moved, 'item')} to ${target}`);
      if (failed.length) toast('error', `Could not move ${plural(failed.length, 'item')}.\n${failed[0]}`);
      await this.load(this.cwd);
    });
  }

  private properties(thisFolder = false): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      if (!id) return;
      let targets;
      if (thisFolder || this.selected.size === 0) {
        const entry: SftpEntry = { name: baseOf(this.cwd), isDir: true, isLink: false, size: 0, mtimeMs: 0, mode: 0 };
        targets = [{ path: this.cwd, entry }];
      } else {
        targets = this.selectedEntries().map((entry) => ({ path: join(this.cwd, entry.name), entry }));
      }
      await showProperties(id, targets, () => void this.load(this.cwd));
    });
  }

  /** Files and empty folders. */
  private remove(): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      const sel = this.selectedEntries();
      if (!id || sel.length === 0) return;
      const what = sel.length === 1 ? `“${sel[0].name}”` : `${sel.length} items`;
      const ok = await askConfirm('Delete', `Permanently delete ${what}? This cannot be undone.${sel.some((e) => e.isDir) ? ' Folders must be empty; use “Delete with contents” for folders that are not.' : ''}`, 'Delete', true);
      if (!ok) return;
      const failed: string[] = [];
      for (const e of sel) {
        try {
          await window.termApi.sftp.remove(id, join(this.cwd, e.name), e.isDir);
        } catch (err) {
          failed.push(`${e.name}: ${cleanError(err)}`);
        }
      }
      if (failed.length) toast('error', `Could not delete ${plural(failed.length, 'item')}.\n${failed[0]}`);
      this.selected.clear();
      await this.load(this.cwd);
    });
  }

  /** Folders and everything inside them, after showing how much that is. */
  private removeWithContents(): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      const sel = this.selectedEntries();
      if (!id || sel.length === 0) return;
      const probe = toast('busy', 'Checking what would be deleted…');
      let files = sel.filter((e) => !e.isDir).length;
      let dirs = sel.filter((e) => e.isDir).length;
      let bytes = sel.filter((e) => !e.isDir).reduce((n, e) => n + e.size, 0);
      let truncated = false;
      try {
        for (const e of sel.filter((x) => x.isDir)) {
          const t = await window.termApi.sftp.treeSize(id, join(this.cwd, e.name));
          files += t.files;
          dirs += t.dirs;
          bytes += t.bytes;
          truncated ||= t.truncated;
        }
      } finally {
        probe.dismiss();
      }
      const names = sel.length === 1 ? `“${sel[0].name}”` : `${sel.length} items`;
      const size = bytes >= 1024 * 1024 ? ` (${(bytes / 1024 / 1024).toFixed(bytes >= 1024 ** 3 ? 0 : 1)} MB)` : '';
      const ok = await askConfirm(
        'Delete with contents',
        `Permanently delete ${names} and everything inside it? This removes ${truncated ? 'at least ' : ''}${plural(files, 'file')} and ${plural(dirs, 'folder')}${size} in total, including the selected folder${sel.filter((e) => e.isDir).length === 1 ? '' : 's'} themselves. This cannot be undone.`,
        'Delete everything',
        true,
      );
      if (!ok) return;
      const t = toast('busy', 'Deleting…');
      let deleted = 0;
      const failed: string[] = [];
      for (const e of sel) {
        try {
          if (e.isDir) {
            const r = await window.termApi.sftp.removeTree(id, join(this.cwd, e.name));
            deleted += r.files + r.folders;
            if (r.skipped) failed.push(`${e.name}: ${r.skipped} item${r.skipped === 1 ? '' : 's'} could not be deleted${r.firstError ? ` (${r.firstError})` : ''}`);
          } else {
            await window.termApi.sftp.remove(id, join(this.cwd, e.name), false);
            deleted++;
          }
        } catch (err) {
          failed.push(`${e.name}: ${cleanError(err)}`);
        }
      }
      if (failed.length) t.update('error', failed.join('\n'));
      else t.update('success', `Deleted ${plural(deleted, 'item')}`);
      this.selected.clear();
      await this.load(this.cwd);
    });
  }
}
