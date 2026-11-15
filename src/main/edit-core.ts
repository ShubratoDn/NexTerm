/** Pure helpers for editing remote files locally. No Electron or file system access, so they are easy to test. */

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A name that is safe to create on any operating system, keeping the extension so editors pick the right mode. */
export function safeLocalName(name: string): string {
  let n = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  if (!n || n === '.' || n === '..') n = 'file';
  if (WIN_RESERVED.test(n.split('.')[0])) n = `_${n}`;
  if (n.length > 120) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 16 ? n.slice(dot) : '';
    n = n.slice(0, 120 - ext.length) + ext;
  }
  return n;
}

/**
 * Extensions that an operating system would RUN rather than show when a file is opened with its default program.
 * A downloaded file with one of these must never be opened that way.
 */
const RISKY = new Set([
  'exe', 'com', 'scr', 'pif', 'bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'msi', 'msp', 'cpl',
  'reg', 'lnk', 'url', 'scf', 'jar', 'appimage', 'desktop', 'run', 'bin', 'command', 'app', 'workflow', 'sh', 'bash', 'csh', 'ksh', 'zsh', 'py', 'pl', 'rb',
]);

export function isRiskyToOpen(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && RISKY.has(name.slice(dot + 1).toLowerCase());
}

/** True when `child` is `parent` or lies inside it (POSIX paths, as used on SFTP servers). */
export function isInside(parent: string, child: string): boolean {
  const p = parent.replace(/\/+$/, '') || '/';
  const c = child.replace(/\/+$/, '') || '/';
  return c === p || p === '/' || c.startsWith(`${p}/`);
}

/** Largest file that "Edit" and "Open with" will download. */
export const MAX_EDIT_BYTES = 200 * 1024 * 1024;

export interface FileState {
  mtimeMs: number;
  size: number;
}

export type SyncState = 'uploading' | 'saved' | 'conflict' | 'error';

export interface SyncDeps {
  localStat(): FileState | null;
  remoteStat(): Promise<FileState | null>;
  upload(): Promise<void>;
  emit(state: SyncState, message?: string): void;
  delay(ms: number): Promise<void>;
}

/**
 * Sends a locally edited copy back to the server. It waits until the editor has finished writing, refuses to overwrite
 * a file that someone else changed on the server in the meantime (unless told to), and never runs two uploads at once.
 */
export class SyncJob {
  private busy = false;
  private again = false;

  constructor(
    private readonly deps: SyncDeps,
    /** What the server copy looked like when it was downloaded (or last uploaded). */
    public base: FileState | null,
  ) {}

  async changed(force = false): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      let overwrite = force;
      do {
        this.again = false;
        // Editors often truncate and then write; wait until size and time stop moving.
        let a = this.deps.localStat();
        for (let i = 0; i < 6 && a; i++) {
          await this.deps.delay(250);
          const b = this.deps.localStat();
          if (!b) return;
          if (b.size === a.size && b.mtimeMs === a.mtimeMs) break;
          a = b;
        }
        if (!a) return;
        if (!overwrite) {
          const cur = await this.deps.remoteStat();
          if (cur && this.base && (cur.mtimeMs !== this.base.mtimeMs || cur.size !== this.base.size)) {
            this.deps.emit('conflict');
            return;
          }
        }
        this.deps.emit('uploading');
        await this.deps.upload();
        this.base = (await this.deps.remoteStat()) ?? this.base;
        this.deps.emit('saved');
        overwrite = false;
      } while (this.again);
    } catch (e) {
      this.deps.emit('error', (e as Error).message);
    } finally {
      this.busy = false;
    }
  }
}
