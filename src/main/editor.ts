import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { SFTPWrapper } from 'ssh2';
import type { EditOpened, EditStatus } from '../shared/types';
import { MAX_EDIT_BYTES, SyncJob, isRiskyToOpen, safeLocalName } from './edit-core';
import type { FileState } from './edit-core';
import { assertBaseName, sftpOps } from './sftp';
import type { Transfer } from './transfer';

/* ------------------------------------------------------------------ programs */

export interface Program {
  /** Full path of the program (or the command name on macOS). */
  path: string;
  args(file: string): string[];
  /** Short name for messages. */
  label: string;
}

const labelOf = (p: string) => path.basename(p).replace(/\.(exe|com|app)$/i, '');

export function programFor(p: string): Program {
  if (process.platform === 'darwin' && p.endsWith('.app')) return { path: 'open', args: (f) => ['-a', p, f], label: labelOf(p) };
  return { path: p, args: (f) => [f], label: labelOf(p) };
}

/** Why a program chosen by the user cannot be used, or null if it can. */
export function validateProgram(p: string): string | null {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return 'Choose a program on this computer.';
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return 'That program does not exist.';
  }
  if (process.platform === 'darwin' && p.endsWith('.app') && st.isDirectory()) return null;
  if (!st.isFile()) return 'That is not a program.';
  if (process.platform === 'win32') return /\.(exe|com)$/i.test(p) ? null : 'Choose a program (an .exe file).';
  try {
    fs.accessSync(p, fs.constants.X_OK);
  } catch {
    return 'That file is not executable.';
  }
  return null;
}

function onPath(command: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, command);
    if (validateProgram(p) === null) return p;
  }
  return null;
}

/**
 * The plain text editor of this system. It is never "whatever opens this file type", because for a script that could
 * mean running it.
 */
export function defaultEditor(): Program | null {
  if (process.platform === 'win32') {
    const notepad = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'notepad.exe');
    return fs.existsSync(notepad) ? programFor(notepad) : null;
  }
  if (process.platform === 'darwin') return { path: 'open', args: (f) => ['-t', f], label: 'TextEdit' };
  for (const c of ['code', 'gedit', 'gnome-text-editor', 'kate', 'mousepad', 'xed', 'pluma', 'geany', 'subl']) {
    const p = onPath(c);
    if (p) return programFor(p);
  }
  return null;
}

/** Starts a program with one file. Resolves once it has started; it is not waited for (editors may hand over and exit). */
export function launch(program: Program, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(program.path, program.args(file), { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/* ------------------------------------------------------------------ editing sessions */

export interface EditEnv {
  sftp(connId: unknown, owner: number): Promise<SFTPWrapper>;
  send(owner: number, status: EditStatus): void;
  getEditorPath(): string;
  setEditorPath(p: string): void;
  /** Native file chooser for a program; resolves with its path, or null if cancelled. */
  chooseProgram(owner: number, title: string): Promise<string | null>;
  /** The system's program for a file type (Electron shell.openPath); resolves with an error text, or "". */
  openDefault(file: string): Promise<string>;
  /** Progress for big files. */
  startTransfer(owner: number, direction: 'upload' | 'download', title: string): Transfer;
  /** Private folder for the local copies. */
  tmpRoot: string;
}

interface Session {
  id: number;
  owner: number;
  dir: string;
  local: string;
  stop(): void;
  job: SyncJob;
}

const BIG = 1024 * 1024;

const isMissing = (e: unknown) => /no such file/i.test((e as Error)?.message ?? '');

async function statFollow(s: SFTPWrapper, remote: string): Promise<{ isDir: boolean; size: number; mtimeMs: number }> {
  const st = await new Promise<{ mode: number; size: number; mtime: number }>((res, rej) => s.stat(remote, (e, v) => (e ? rej(e) : res(v))));
  return { isDir: (st.mode & 0o170000) === 0o040000, size: st.size, mtimeMs: st.mtime * 1000 };
}

function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/connection not found/i.test(m)) return 'The connection is closed. Reconnect and open the file again to keep editing it.';
  return m;
}

/** Remote files that are open in local programs: downloads them, launches the program and uploads saved changes. */
export class EditManager {
  private sessions = new Map<number, Session>();
  private seq = 0;

  constructor(private readonly env: EditEnv) {
    fs.mkdirSync(env.tmpRoot, { recursive: true, mode: 0o700 });
    this.purgeStale();
  }

  /** Removes local copies left behind by an earlier run that did not exit cleanly. */
  private purgeStale(): void {
    try {
      for (const d of fs.readdirSync(this.env.tmpRoot)) {
        const p = path.join(this.env.tmpRoot, d);
        if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true });
      }
    } catch {
      /* best effort */
    }
  }

  private async resolveEditor(owner: number): Promise<Program | null> {
    const saved = this.env.getEditorPath();
    if (saved && validateProgram(saved) === null) return programFor(saved);
    const fallback = defaultEditor();
    if (fallback) return fallback;
    const chosen = await this.env.chooseProgram(owner, 'Choose a text editor');
    if (!chosen) return null;
    const err = validateProgram(chosen);
    if (err) throw new Error(err);
    this.env.setEditorPath(chosen);
    return programFor(chosen);
  }

  async start(owner: number, connId: unknown, remotePath: string, mode: 'edit' | 'default' | 'choose'): Promise<EditOpened | null> {
    const sftp = await this.env.sftp(connId, owner);
    const name = path.posix.basename(remotePath.replace(/\/+$/, ''));
    assertBaseName(name);
    const st = await statFollow(sftp, remotePath);
    if (st.isDir) throw new Error('This is a folder, not a file.');
    if (st.size > MAX_EDIT_BYTES) throw new Error(`This file is larger than ${Math.round(MAX_EDIT_BYTES / 1024 / 1024)} MB. Download it instead.`);
    if (mode === 'default' && isRiskyToOpen(name)) {
      throw new Error(`“${name}” is a type of file that your system would run instead of showing. Use Edit or Open with… and pick a text editor.`);
    }

    let program: Program | null = null;
    if (mode === 'choose') {
      const chosen = await this.env.chooseProgram(owner, 'Open with');
      if (!chosen) return null;
      const err = validateProgram(chosen);
      if (err) throw new Error(err);
      program = programFor(chosen);
    } else if (mode === 'edit') {
      program = await this.resolveEditor(owner);
      if (!program) return null;
    }

    const dir = fs.mkdtempSync(path.join(this.env.tmpRoot, 'e-'));
    const local = path.join(dir, safeLocalName(name));
    try {
      const t = st.size > BIG ? this.env.startTransfer(owner, 'download', name) : null;
      try {
        t?.setTotals(st.size, 1);
        await sftpOps.get(sftp, remotePath, local, t ?? undefined);
        t?.finish();
      } catch (e) {
        t?.finish((e as Error).message);
        throw e;
      }
      const startMtime = fs.statSync(local).mtimeMs;
      if (mode === 'default') {
        const err = await this.env.openDefault(local);
        if (err) throw new Error(`Could not open the file: ${err}`);
      } else {
        await launch(program!, local);
      }
      return this.watch(owner, connId, remotePath, name, dir, local, startMtime, { mtimeMs: st.mtimeMs, size: st.size }, program?.label ?? 'the default program');
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  }

  private watch(owner: number, connId: unknown, remotePath: string, name: string, dir: string, local: string, startMtime: number, base: FileState, label: string): EditOpened {
    const id = ++this.seq;
    const emit = (state: EditStatus['state'], message?: string) => this.env.send(owner, { id, name, remotePath, state, ...(message ? { message: friendly(message) } : {}) });
    const job = new SyncJob(
      {
        localStat: () => {
          try {
            const x = fs.statSync(local);
            return { mtimeMs: x.mtimeMs, size: x.size };
          } catch {
            return null;
          }
        },
        remoteStat: async () => {
          const s = await this.env.sftp(connId, owner);
          try {
            const x = await statFollow(s, remotePath);
            return { mtimeMs: x.mtimeMs, size: x.size };
          } catch (e) {
            if (isMissing(e)) return null;
            throw e;
          }
        },
        upload: async () => {
          const s = await this.env.sftp(connId, owner);
          const size = fs.statSync(local).size;
          const t = size > BIG ? this.env.startTransfer(owner, 'upload', name) : null;
          try {
            t?.setTotals(size, 1);
            await sftpOps.put(s, local, remotePath, t ?? undefined);
            t?.finish();
          } catch (e) {
            t?.finish((e as Error).message);
            throw e;
          }
        },
        emit,
        delay: (ms) => new Promise((r) => setTimeout(r, ms)),
      },
      base,
    );

    // Editors save in different ways (in place, or by writing a new file and renaming it), so the file is polled by path.
    let last = startMtime;
    fs.watchFile(local, { interval: 600, persistent: false }, (cur) => {
      if (cur.mtimeMs === 0 || cur.mtimeMs === last) return;
      last = cur.mtimeMs;
      void job.changed();
    });
    this.sessions.set(id, { id, owner, dir, local, job, stop: () => fs.unwatchFile(local) });
    return { id, name, program: label };
  }

  /** The user answered a "changed on the server" warning. */
  resolve(owner: number, id: number, overwrite: boolean): void {
    const s = this.sessions.get(id);
    if (!s || s.owner !== owner) throw new Error('This file is no longer being edited.');
    if (overwrite) void s.job.changed(true);
  }

  /** Stops watching and deletes every local copy. */
  cleanup(): void {
    for (const s of this.sessions.values()) {
      s.stop();
      try {
        fs.rmSync(s.dir, { recursive: true, force: true });
      } catch {
        /* the program may still hold the file */
      }
    }
    this.sessions.clear();
  }
}
