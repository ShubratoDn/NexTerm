import fs from 'node:fs';
import path from 'node:path';
import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2';
import type { SftpEntry, SftpStat, SftpTreeSize, TreeTransferResult } from '../shared/types';
import type { Progress } from './transfer';
import { deletionOrder, isProtectedPath, summarizeSize, walkLocal, walkTree } from './sftp-tree';
import type { WalkResult } from './sftp-tree';

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

function p<T>(fn: (cb: (err: Error | null | undefined, v?: T) => void) => void): Promise<T> {
  return new Promise<T>((res, rej) => fn((e, v) => (e ? rej(e) : res(v as T))));
}

export const sftpOps = {
  realpath: (s: SFTPWrapper, remote: string) => p<string>((cb) => s.realpath(remote, cb)),

  async list(s: SFTPWrapper, remote: string): Promise<SftpEntry[]> {
    const items = await p<FileEntryWithStats[]>((cb) => s.readdir(remote, cb));
    return items
      .filter((i) => i.filename !== '.' && i.filename !== '..')
      .map((i) => ({
        name: i.filename,
        isDir: (i.attrs.mode & S_IFMT) === S_IFDIR,
        isLink: (i.attrs.mode & S_IFMT) === S_IFLNK,
        size: i.attrs.size,
        mtimeMs: i.attrs.mtime * 1000,
        mode: i.attrs.mode & 0o7777,
      }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  },

  async isDir(s: SFTPWrapper, remote: string): Promise<boolean> {
    const st = await p<{ mode: number }>((cb) => s.stat(remote, cb));
    return (st.mode & S_IFMT) === S_IFDIR;
  },

  mkdir: (s: SFTPWrapper, remote: string) => p<void>((cb) => s.mkdir(remote, (e) => cb(e))),
  rename: (s: SFTPWrapper, from: string, to: string) => p<void>((cb) => s.rename(from, to, (e) => cb(e))),
  unlink: (s: SFTPWrapper, remote: string) => p<void>((cb) => s.unlink(remote, (e) => cb(e))),
  rmdir: (s: SFTPWrapper, remote: string) => p<void>((cb) => s.rmdir(remote, (e) => cb(e))),
  /** Size of a remote file or folder entry, as reported by the server. */
  async sizeOf(s: SFTPWrapper, remote: string): Promise<{ isDir: boolean; size: number }> {
    const st = await p<{ mode: number; size: number }>((cb) => s.stat(remote, cb));
    return { isDir: (st.mode & S_IFMT) === S_IFDIR, size: st.size };
  },

  get: (s: SFTPWrapper, remote: string, local: string, prog?: Progress) =>
    p<void>((cb) => {
      prog?.file(path.posix.basename(remote));
      let last = 0;
      s.fastGet(
        remote,
        local,
        {
          step: (done) => {
            prog?.bytes(done - last);
            last = done;
          },
        },
        (e) => {
          if (!e) prog?.fileDone();
          cb(e);
        },
      );
    }),

  put: (s: SFTPWrapper, local: string, remote: string, prog?: Progress) =>
    p<void>((cb) => {
      prog?.file(path.basename(local));
      let last = 0;
      s.fastPut(
        local,
        remote,
        {
          step: (done) => {
            prog?.bytes(done - last);
            last = done;
          },
        },
        (e) => {
          if (!e) prog?.fileDone();
          cb(e);
        },
      );
    }),
};

export function joinRemote(dir: string, ...names: string[]): string {
  return path.posix.join(dir, ...names);
}

/** "name.txt" -> "name (1).txt" -> "name (2).txt" ... until `exists` says the name is free. */
export function uniqueName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 10000; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!exists(c)) return c;
  }
  throw new Error('could not find a free file name');
}

/** A remote file name coming from the UI must be a single path component. */
export function assertBaseName(name: string): void {
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.includes('\0')) {
    throw new Error('invalid file name');
  }
}

/* ------------------------------------------------------------------ properties and folder operations */

export async function statRemote(s: SFTPWrapper, remote: string): Promise<SftpStat> {
  const st = await p<Stats>((cb) => s.lstat(remote, cb));
  const isLink = (st.mode & S_IFMT) === S_IFLNK;
  const out: SftpStat = {
    path: remote,
    name: path.posix.basename(remote) || remote,
    isDir: (st.mode & S_IFMT) === S_IFDIR,
    isLink,
    size: st.size,
    mode: st.mode & 0o7777,
    uid: st.uid,
    gid: st.gid,
    atimeMs: st.atime * 1000,
    mtimeMs: st.mtime * 1000,
  };
  if (isLink) {
    try {
      out.linkTarget = await p<string>((cb) => s.readlink(remote, cb));
    } catch {
      /* unreadable link */
    }
    try {
      out.targetIsDir = (await p<Stats>((cb) => s.stat(remote, cb)).then((t) => t.mode & S_IFMT)) === S_IFDIR;
    } catch {
      /* broken link */
    }
  }
  return out;
}

export const chmodRemote = (s: SFTPWrapper, remote: string, mode: number) => p<void>((cb) => s.chmod(remote, mode, (e) => cb(e)));

/** Creates an empty file; fails if the name is taken. */
export async function mkfileRemote(s: SFTPWrapper, remote: string): Promise<void> {
  const handle = await p<Buffer>((cb) => s.open(remote, 'wx', cb));
  await p<void>((cb) => s.close(handle, (e) => cb(e)));
}

export async function treeSizeRemote(s: SFTPWrapper, remote: string): Promise<SftpTreeSize> {
  return summarizeSize(await walkTree((d) => sftpOps.list(s, d), remote, { maxEntries: 200_000, timeoutMs: 45_000 }));
}

const result = (): TreeTransferResult => ({ files: 0, folders: 0, skipped: 0 });

/** Downloads a folder into `localParent`, under a name that does not overwrite anything. */
export async function downloadTree(s: SFTPWrapper, remoteRoot: string, localParent: string, prog?: Progress, walked?: WalkResult): Promise<TreeTransferResult> {
  const name = path.posix.basename(remoteRoot.replace(/\/+$/, ''));
  assertBaseName(name);
  const top = uniqueName(name, (c) => fs.existsSync(path.join(localParent, c)));
  const topPath = path.join(localParent, top);
  fs.mkdirSync(topPath);
  const out: TreeTransferResult = { ...result(), dir: topPath };
  const note = (e: unknown) => {
    out.skipped++;
    out.firstError ??= (e as Error).message;
  };
  const walk = walked ?? (await walkTree((d) => sftpOps.list(s, d), remoteRoot));
  out.skipped += walk.invalid;
  const base = path.resolve(topPath) + path.sep;
  for (const it of walk.items) {
    const local = path.join(topPath, ...it.rel.split('/'));
    if (!path.resolve(local).startsWith(base)) {
      note(new Error('unsafe path'));
      continue;
    }
    try {
      if (it.entry.isLink) out.skipped++; // links are not followed
      else if (it.entry.isDir) {
        fs.mkdirSync(local, { recursive: true });
        out.folders++;
      } else {
        await sftpOps.get(s, it.path, local, prog);
        out.files++;
      }
    } catch (e) {
      note(e);
    }
  }
  if (walk.truncated) out.firstError ??= 'The folder is very large; only part of it was downloaded.';
  return out;
}

/** Uploads a local folder into `remoteParent`, under a name that does not overwrite anything. */
export async function uploadTree(s: SFTPWrapper, localRoot: string, remoteParent: string, prog?: Progress): Promise<TreeTransferResult> {
  const name = path.basename(localRoot);
  assertBaseName(name);
  const existing = new Set((await sftpOps.list(s, remoteParent)).map((e) => e.name));
  const remoteRoot = joinRemote(remoteParent, uniqueName(name, (c) => existing.has(c)));
  await sftpOps.mkdir(s, remoteRoot);
  const out: TreeTransferResult = { ...result(), folders: 1 };
  const note = (e: unknown) => {
    out.skipped++;
    out.firstError ??= (e as Error).message;
  };
  const tree = walkLocal(localRoot);
  out.skipped += tree.skipped;
  for (const rel of tree.dirs) {
    try {
      await sftpOps.mkdir(s, joinRemote(remoteRoot, ...rel.split('/')));
      out.folders++;
    } catch (e) {
      note(e);
    }
  }
  for (const f of tree.files) {
    try {
      await sftpOps.put(s, f.abs, joinRemote(remoteRoot, ...f.rel.split('/')), prog);
      out.files++;
    } catch (e) {
      note(e);
    }
  }
  if (tree.truncated) out.firstError ??= 'The folder is very large; only part of it was uploaded.';
  return out;
}

/** Deletes a folder and everything inside it. Refuses the root and top-level system folders. */
export async function removeTree(s: SFTPWrapper, remoteRoot: string): Promise<TreeTransferResult> {
  if (isProtectedPath(remoteRoot)) throw new Error('Refusing to delete the root or a top-level system folder.');
  const walk = await walkTree((d) => sftpOps.list(s, d), remoteRoot);
  if (walk.truncated) throw new Error('This folder is too large to delete in one go. Nothing was deleted.');
  const { files, dirs } = deletionOrder(walk);
  const out = result();
  const note = (e: unknown) => {
    out.skipped++;
    out.firstError ??= (e as Error).message;
  };
  for (const f of files) {
    try {
      await sftpOps.unlink(s, f.path);
      out.files++;
    } catch (e) {
      note(e);
    }
  }
  for (const d of dirs) {
    try {
      await sftpOps.rmdir(s, d.path);
      out.folders++;
    } catch (e) {
      note(e);
    }
  }
  try {
    await sftpOps.rmdir(s, remoteRoot);
    out.folders++;
  } catch (e) {
    note(e);
  }
  return out;
}
/** Total size and file count of local files and folders, for the progress bar. Links and unreadable items are not counted. */
export function planLocalUpload(paths: string[]): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  for (const p of paths) {
    try {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isFile()) {
        bytes += st.size;
        files++;
      } else if (st.isDirectory()) {
        for (const f of walkLocal(p).files) {
          try {
            bytes += fs.statSync(f.abs).size;
            files++;
          } catch {
            /* vanished */
          }
        }
      }
    } catch {
      /* vanished */
    }
  }
  return { bytes, files };
}

/** Total size and file count of remote files and folders, plus the folder walks so they need not be repeated. */
export async function planRemoteDownload(s: SFTPWrapper, remotes: string[]): Promise<{ bytes: number; files: number; walks: Map<string, WalkResult> }> {
  let bytes = 0;
  let files = 0;
  const walks = new Map<string, WalkResult>();
  for (const r of remotes) {
    const st = await sftpOps.sizeOf(s, r);
    if (!st.isDir) {
      bytes += st.size;
      files++;
      continue;
    }
    const walk = await walkTree((d) => sftpOps.list(s, d), r);
    walks.set(r, walk);
    for (const it of walk.items) {
      if (!it.entry.isDir && !it.entry.isLink) {
        bytes += it.entry.size;
        files++;
      }
    }
  }
  return { bytes, files, walks };
}
