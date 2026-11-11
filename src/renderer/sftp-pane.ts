import { formatSize, h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import { askConfirm, askText } from './dialogs';
import { showMenu } from './menu';
import type { MenuEntry } from './menu';
import { cleanError, toast, withProgress } from './toast';
import { savePrefs, state } from './state';
import type { SftpEntry } from '../shared/types';

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
const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/** File browser shown beside an SSH terminal. */
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
  private selected = new Set<string>();
  private anchor: string | null = null;
  private sort: { key: SortKey; dir: 1 | -1 } = { key: 'name', dir: 1 };
  private status: 'idle' | 'loading' | 'error' = 'idle';
  private errorText = '';
  private seq = 0;
  private started = false;
  private dragDepth = 0;

  constructor(private readonly getConn: () => string | undefined) {
    const tool = (name: IconName, title: string, fn: () => void) => {
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

    const dropzone = h('div', { class: 'dropzone' }, icon('upload', 26), h('div', {}, 'Drop files to upload here'));
    this.el = h(
      'div',
      { class: 'sftp' },
      h('div', { class: 'sftp-head' }, h('h4', {}, 'Files'),
        tool('arrow-up', 'Parent folder (Backspace)', () => this.up()),
        tool('refresh-cw', 'Refresh', () => void this.load(this.cwd)),
        tool('folder-plus', 'New folder', () => void this.mkdir()),
        tool('upload', 'Upload files', () => void this.upload()),
        this.hiddenBtn),
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
        showMenu(ev.clientX, ev.clientY, [
          { label: 'New folder', icon: 'folder-plus', run: () => void this.mkdir() },
          { label: 'Upload files…', icon: 'upload', run: () => void this.upload() },
          'sep',
          { label: 'Refresh', icon: 'refresh-cw', run: () => void this.load(this.cwd) },
        ]);
      }
    });

    // Drag & drop upload.
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
      this.cwd = real;
      this.entries = entries;
      this.selected.clear();
      this.anchor = null;
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
    if (rows.length === 0) {
      this.list.replaceChildren(h('div', { class: 'sftp-state' }, icon('folder', 24), this.entries.length ? 'Only hidden items here' : 'This folder is empty', h('span', { class: 'hint' }, 'Drop files here to upload')));
    } else {
      this.list.replaceChildren(...rows.map((e) => this.row(e, rows)));
    }
    const sel = this.selected.size;
    this.foot.textContent = `${rows.length} item${rows.length === 1 ? '' : 's'}${sel ? ` · ${sel} selected` : ''}`;
  }

  private row(e: SftpEntry, rows: SftpEntry[]): HTMLElement {
    const sel = this.selected.has(e.name);
    const row = h(
      'div',
      { class: `sftp-row${e.isDir ? ' dir' : ''}${sel ? ' sel' : ''}`, role: 'option', 'aria-selected': String(sel), title: `${e.name}\n${(e.mode & 0o7777).toString(8).padStart(4, '0')}` },
      h('div', { class: 'nm' }, icon(fileIcon(e), 15), h('span', {}, e.name)),
      h('div', { class: 'dt' }, fmtDate(e.mtimeMs)),
      h('div', { class: 'sz' }, e.isDir ? '—' : formatSize(e.size)),
    );
    row.dataset.name = e.name;
    row.addEventListener('mousedown', (ev) => {
      if (ev.button === 2 && this.selected.has(e.name)) return;
      this.select(e, rows, ev);
    });
    row.addEventListener('dblclick', () => this.open(e));
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (!this.selected.has(e.name)) this.select(e, rows, ev);
      this.rowMenu(ev.clientX, ev.clientY);
    });
    return row;
  }

  private select(e: SftpEntry, rows: SftpEntry[], ev: MouseEvent | KeyboardEvent): void {
    if (ev.shiftKey && this.anchor) {
      const names = rows.map((r) => r.name);
      const a = names.indexOf(this.anchor);
      const b = names.indexOf(e.name);
      if (a >= 0 && b >= 0) {
        this.selected = new Set(names.slice(Math.min(a, b), Math.max(a, b) + 1));
        this.render();
        return;
      }
    }
    if (ev.ctrlKey || ev.metaKey) {
      if (!this.selected.delete(e.name)) this.selected.add(e.name);
    } else this.selected = new Set([e.name]);
    this.anchor = e.name;
    this.render();
  }

  private selectedEntries(): SftpEntry[] {
    return this.entries.filter((e) => this.selected.has(e.name));
  }

  private rowMenu(x: number, y: number): void {
    const sel = this.selectedEntries();
    const one = sel.length === 1 ? sel[0] : undefined;
    const items: MenuEntry[] = [];
    if (one?.isDir) items.push({ label: 'Open', icon: 'folder-open', run: () => this.open(one) });
    else items.push({ label: sel.length > 1 ? `Download ${sel.filter((e) => !e.isDir).length} files…` : 'Download', icon: 'download', disabled: sel.every((e) => e.isDir), run: () => void this.download() });
    items.push(
      { label: 'Rename…', icon: 'pencil', shortcut: 'F2', disabled: !one, run: () => void this.rename() },
      { label: 'Copy path', icon: 'copy', disabled: !one, run: () => one && void navigator.clipboard.writeText(join(this.cwd, one.name)) },
      'sep',
      { label: sel.length > 1 ? `Delete ${sel.length} items…` : 'Delete…', icon: 'trash-2', danger: true, shortcut: 'Del', run: () => void this.remove() },
    );
    showMenu(x, y, items);
  }

  private onKey(ev: KeyboardEvent): void {
    const rows = this.visible();
    const idx = rows.findIndex((r) => r.name === this.anchor);
    const move = (to: number) => {
      const t = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (!t) return;
      ev.preventDefault();
      this.select(t, rows, ev);
      this.list.querySelector(`[data-name="${CSS.escape(t.name)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    switch (ev.key) {
      case 'ArrowDown': return move(idx + 1);
      case 'ArrowUp': return move(idx < 0 ? 0 : idx - 1);
      case 'Home': return move(0);
      case 'End': return move(rows.length - 1);
      case 'Enter': { const e = rows[idx]; if (e) { ev.preventDefault(); this.open(e); } return; }
      case 'Backspace': ev.preventDefault(); return this.up();
      case 'Delete': ev.preventDefault(); return void this.remove();
      case 'F2': ev.preventDefault(); return void this.rename();
      case 'F5': ev.preventDefault(); return void this.load(this.cwd);
      case 'a': if (ev.ctrlKey) { ev.preventDefault(); this.selected = new Set(rows.map((r) => r.name)); this.render(); } return;
      case 'l': if (ev.ctrlKey) { ev.preventDefault(); this.editPath(); } return;
    }
  }

  /* ---------- actions ---------- */

  private up(): void {
    if (this.cwd && this.cwd !== '/') void this.load(parentOf(this.cwd));
  }

  private open(e: SftpEntry): void {
    if (e.isDir) void this.load(join(this.cwd, e.name));
    else void this.download([e]);
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

  private download(entries = this.selectedEntries()): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      if (!id || entries.length === 0) return;
      if (entries.length === 1 && !entries[0].isDir) {
        const name = entries[0].name;
        const t = toast('busy', `Downloading ${name}…`);
        try {
          const saved = await window.termApi.sftp.download(id, join(this.cwd, name));
          if (saved) t.update('success', `Saved to ${saved}`);
          else t.dismiss();
        } catch (e) {
          t.update('error', cleanError(e));
        }
        return;
      }
      const files = entries.filter((e) => !e.isDir);
      if (files.length === 0) return void toast('info', 'Folder download is not supported yet.');
      const t = toast('busy', `Downloading ${files.length} files…`);
      try {
        const r = await window.termApi.sftp.downloadMany(id, files.map((f) => join(this.cwd, f.name)));
        if (!r.dir) t.dismiss();
        else t.update('success', `Saved ${r.saved} file${r.saved === 1 ? '' : 's'} to ${r.dir}${entries.length > files.length ? ' (folders skipped)' : ''}`);
      } catch (e) {
        t.update('error', cleanError(e));
      }
    });
  }

  private upload(): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      if (!id) return;
      const n = await withProgress('Uploading…', () => window.termApi.sftp.upload(id, this.cwd), (c) => (c ? `Uploaded ${c} file${c === 1 ? '' : 's'}` : 'Nothing uploaded'));
      if (n) await this.load(this.cwd);
    });
  }

  private uploadPaths(paths: string[]): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      if (!id) return;
      const r = await withProgress(`Uploading ${paths.length} item${paths.length === 1 ? '' : 's'}…`, () => window.termApi.sftp.uploadPaths(id, this.cwd, paths),
        (x) => `Uploaded ${x.uploaded} file${x.uploaded === 1 ? '' : 's'}${x.skipped ? ` · ${x.skipped} skipped (folders are not supported yet)` : ''}`);
      if (r?.uploaded) await this.load(this.cwd);
    });
  }

  private mkdir(): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      const name = id && (await askText('New folder', 'Folder name', '', 'Create'));
      if (!id || !name) return;
      await window.termApi.sftp.mkdir(id, join(this.cwd, name));
      await this.load(this.cwd);
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
      await this.load(this.cwd);
    });
  }

  private remove(): Promise<void> {
    return this.guard(async () => {
      const id = this.conn();
      const sel = this.selectedEntries();
      if (!id || sel.length === 0) return;
      const what = sel.length === 1 ? `“${sel[0].name}”` : `${sel.length} items`;
      const ok = await askConfirm('Delete', `Permanently delete ${what}? This cannot be undone.${sel.some((e) => e.isDir) ? ' Folders must be empty.' : ''}`, 'Delete', true);
      if (!ok) return;
      const failed: string[] = [];
      for (const e of sel) {
        try {
          await window.termApi.sftp.remove(id, join(this.cwd, e.name), e.isDir);
        } catch (err) {
          failed.push(`${e.name}: ${cleanError(err)}`);
        }
      }
      if (failed.length) toast('error', `Could not delete ${failed.length} item${failed.length === 1 ? '' : 's'}.\n${failed[0]}`);
      await this.load(this.cwd);
    });
  }
}
