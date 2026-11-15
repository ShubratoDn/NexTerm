import path from 'node:path';
import type { SFTPWrapper } from 'ssh2';
import type { TreeTransferResult } from '../shared/types';
import { isInside } from './edit-core';
import { isProtectedPath, walkTree } from './sftp-tree';
import type { WalkResult } from './sftp-tree';
import { assertBaseName, joinRemote, removeTree, sftpOps, uniqueName } from './sftp';
import type { Progress } from './transfer';

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

interface Source {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  mode: number;
}

const lstat = (s: SFTPWrapper, p: string) =>
  new Promise<{ mode: number; size: number }>((res, rej) => s.lstat(p, (e, st) => (e ? rej(e) : res(st))));

const rename = (s: SFTPWrapper, from: string, to: string) =>
  new Promise<void>((res, rej) => s.rename(from, to, (e) => (e ? rej(e) : res())));

const parentOf = (p: string) => path.posix.dirname(p.replace(/\/+$/, '')) || '/';

/** Copies one file by streaming it from one SFTP connection to another (or the same one). Never overwrites. */
function copyFile(from: SFTPWrapper, fromPath: string, to: SFTPWrapper, toPath: string, mode: number, prog?: Progress): Promise<void> {
  return new Promise((resolve, reject) => {
    prog?.file(path.posix.basename(fromPath));
    const rs = from.createReadStream(fromPath);
    const ws = to.createWriteStream(toPath, { flags: 'wx', mode: mode & 0o777 });
    let failed = false;
    const fail = (e: Error) => {
      if (failed) return;
      failed = true;
      rs.destroy();
      ws.destroy();
      // Do not leave half a file behind.
      to.unlink(toPath, () => reject(e));
    };
    rs.on('error', fail);
    ws.on('error', fail);
    rs.on('data', (c: Buffer) => prog?.bytes(c.length));
    ws.on('close', () => {
      if (failed) return;
      prog?.fileDone();
      resolve();
    });
    rs.pipe(ws);
  });
}

export interface CopyOptions {
  /** Remove the originals once they have been copied. */
  move: boolean;
  /** Both sides are the same connection, so a move can be a rename. */
  sameConn: boolean;
}

/** Sizes of everything a copy will move, so the progress bar knows its total. */
export async function planCopy(src: SFTPWrapper, items: Source[]): Promise<{ bytes: number; files: number; walks: Map<string, WalkResult> }> {
  let bytes = 0;
  let files = 0;
  const walks = new Map<string, WalkResult>();
  for (const it of items) {
    if (!it.isDir) {
      bytes += it.size;
      files++;
      continue;
    }
    const walk = await walkTree((d) => sftpOps.list(src, d), it.path);
    walks.set(it.path, walk);
    for (const w of walk.items) {
      if (!w.entry.isDir && !w.entry.isLink) {
        bytes += w.entry.size;
        files++;
      }
    }
  }
  return { bytes, files, walks };
}

/** Reads what each path is. Symbolic links are not followed, so they are skipped. */
export async function describeSources(src: SFTPWrapper, paths: string[], out: TreeTransferResult): Promise<Source[]> {
  const items: Source[] = [];
  for (const p of paths) {
    try {
      const name = path.posix.basename(p.replace(/\/+$/, ''));
      assertBaseName(name);
      const st = await lstat(src, p);
      if ((st.mode & S_IFMT) === S_IFLNK) {
        out.skipped++;
        continue;
      }
      items.push({ path: p, name, isDir: (st.mode & S_IFMT) === S_IFDIR, size: st.size, mode: st.mode });
    } catch (e) {
      out.skipped++;
      out.firstError ??= (e as Error).message;
    }
  }
  return items;
}

/**
 * Copies or moves files and folders to `dstDir`. Existing names are never overwritten ("a.txt" becomes "a (1).txt").
 * A move only deletes an original after everything inside it was copied.
 */
export async function copyItems(
  src: SFTPWrapper,
  srcPaths: string[],
  dst: SFTPWrapper,
  dstDir: string,
  opts: CopyOptions,
  startTransfer?: (totalBytes: number, totalFiles: number) => Progress | undefined,
): Promise<TreeTransferResult> {
  const out: TreeTransferResult = { files: 0, folders: 0, skipped: 0 };
  const note = (e: unknown) => {
    out.skipped++;
    out.firstError ??= (e as Error).message;
  };
  const items = await describeSources(src, srcPaths, out);
  const targetDir = dstDir.replace(/\/+$/, '') || '/';

  for (const it of items) {
    if (it.isDir && opts.sameConn && isInside(it.path, targetDir)) {
      throw new Error(`Cannot ${opts.move ? 'move' : 'copy'} “${it.name}” into itself.`);
    }
  }
  const existing = new Set((await sftpOps.list(dst, targetDir)).map((e) => e.name));
  const claim = (name: string) => {
    const unique = uniqueName(name, (c) => existing.has(c));
    existing.add(unique);
    return unique;
  };

  // A move inside the same folder changes nothing; anything else on one connection is a plain rename.
  const toCopy: Source[] = [];
  for (const it of items) {
    if (opts.move && opts.sameConn) {
      if (parentOf(it.path) === targetDir) continue;
      try {
        await rename(src, it.path, joinRemote(targetDir, claim(it.name)));
        if (it.isDir) out.folders++;
        else out.files++;
        continue;
      } catch {
        /* for example across file systems: fall back to copying, then deleting */
      }
    }
    toCopy.push(it);
  }
  if (toCopy.length === 0) return out;

  const plan = await planCopy(src, toCopy);
  const prog = startTransfer?.(plan.bytes, plan.files);

  for (const it of toCopy) {
    const skippedBefore = out.skipped;
    try {
      const top = joinRemote(targetDir, claim(it.name));
      if (!it.isDir) {
        await copyFile(src, it.path, dst, top, it.mode, prog);
        out.files++;
      } else {
        await sftpOps.mkdir(dst, top);
        out.folders++;
        const walk = plan.walks.get(it.path)!;
        out.skipped += walk.invalid;
        if (walk.truncated) throw new Error('The folder is very large; it was not copied completely.');
        // Parents are created before their children.
        const dirs = walk.items.filter((w) => w.entry.isDir && !w.entry.isLink).sort((a, b) => a.rel.split('/').length - b.rel.split('/').length);
        for (const d of dirs) {
          try {
            await sftpOps.mkdir(dst, joinRemote(top, ...d.rel.split('/')));
            out.folders++;
          } catch (e) {
            note(e);
          }
        }
        for (const w of walk.items) {
          if (w.entry.isDir && !w.entry.isLink) continue;
          if (w.entry.isLink) {
            out.skipped++;
            continue;
          }
          try {
            await copyFile(src, w.path, dst, joinRemote(top, ...w.rel.split('/')), w.entry.mode, prog);
            out.files++;
          } catch (e) {
            note(e);
          }
        }
      }
      // Only remove the original when every part of it arrived.
      if (opts.move) {
        if (out.skipped !== skippedBefore) {
          out.firstError ??= `“${it.name}” was not fully copied, so the original was kept.`;
        } else if (it.isDir) {
          if (isProtectedPath(it.path)) note(new Error(`“${it.name}” was copied but not removed from its old place (protected folder).`));
          else await removeTree(src, it.path);
        } else {
          await sftpOps.unlink(src, it.path);
        }
      }
    } catch (e) {
      note(e);
    }
  }
  return out;
}
