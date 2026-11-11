import path from 'node:path';
import type { FileEntryWithStats, SFTPWrapper } from 'ssh2';
import type { SftpEntry } from '../shared/types';

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
  get: (s: SFTPWrapper, remote: string, local: string) => p<void>((cb) => s.fastGet(remote, local, (e) => cb(e))),
  put: (s: SFTPWrapper, local: string, remote: string) => p<void>((cb) => s.fastPut(local, remote, (e) => cb(e))),
};

export function joinRemote(dir: string, name: string): string {
  return path.posix.join(dir, name);
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
