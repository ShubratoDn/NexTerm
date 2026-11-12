import fs from 'node:fs';
import path from 'node:path';
import type { SftpEntry } from '../shared/types';

/** A remote file name must be a single path component. */
export function isSafeName(name: string): boolean {
  return !!name && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..' && !name.includes('\0');
}

export interface WalkItem {
  /** Absolute remote path. */
  path: string;
  /** Path relative to the walked root, with forward slashes. */
  rel: string;
  entry: SftpEntry;
}

export interface WalkResult {
  items: WalkItem[];
  /** The walk stopped at a safety limit, so `items` is incomplete. */
  truncated: boolean;
  /** Entries whose names are unsafe (for example "../x") and were left out. */
  invalid: number;
}

export interface WalkOptions {
  maxEntries?: number;
  maxDepth?: number;
  /** Stop after this many milliseconds. */
  timeoutMs?: number;
  now?: () => number;
}

const joinRemote = (dir: string, name: string) => path.posix.join(dir, name);

/**
 * Lists everything below `root` (not including it), parents before their children.
 * Symbolic links are reported but never followed, so a link loop cannot trap the walk.
 */
export async function walkTree(listDir: (dir: string) => Promise<SftpEntry[]>, root: string, opts: WalkOptions = {}): Promise<WalkResult> {
  const { maxEntries = 200_000, maxDepth = 64, timeoutMs = 60_000, now = Date.now } = opts;
  const started = now();
  const items: WalkItem[] = [];
  let truncated = false;
  let invalid = 0;

  const visit = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (depth > maxDepth || now() - started > timeoutMs) {
      truncated = true;
      return;
    }
    for (const entry of await listDir(dir)) {
      if (!isSafeName(entry.name)) {
        invalid++;
        continue;
      }
      if (items.length >= maxEntries) {
        truncated = true;
        return;
      }
      const item: WalkItem = { path: joinRemote(dir, entry.name), rel: rel ? `${rel}/${entry.name}` : entry.name, entry };
      items.push(item);
      if (entry.isDir && !entry.isLink) await visit(item.path, item.rel, depth + 1);
      if (truncated) return;
    }
  };

  await visit(root, '', 1);
  return { items, truncated, invalid };
}

export function summarizeSize(walk: WalkResult): { bytes: number; files: number; dirs: number; truncated: boolean } {
  let bytes = 0;
  let files = 0;
  let dirs = 0;
  for (const { entry } of walk.items) {
    if (entry.isDir && !entry.isLink) dirs++;
    else {
      files++;
      if (!entry.isLink) bytes += entry.size;
    }
  }
  return { bytes, files, dirs, truncated: walk.truncated };
}

/** Deleting order for a walked tree: files and links first, then folders, deepest first. */
export function deletionOrder(walk: WalkResult): { files: WalkItem[]; dirs: WalkItem[] } {
  const files = walk.items.filter((i) => !(i.entry.isDir && !i.entry.isLink));
  const dirs = walk.items.filter((i) => i.entry.isDir && !i.entry.isLink).sort((a, b) => b.rel.split('/').length - a.rel.split('/').length);
  return { files, dirs };
}

/** Folders that must never be deleted recursively: the root and any top-level system folder. */
export function isProtectedPath(remote: string): boolean {
  const norm = path.posix.normalize(remote.replace(/\/+$/, '') || '/');
  return norm === '/' || norm === '.' || norm.split('/').filter(Boolean).length < 2;
}

export interface LocalTree {
  dirs: string[]; // relative, forward slashes, parents first
  files: { rel: string; abs: string }[];
  skipped: number;
  truncated: boolean;
}

/** Walks a local folder for uploading. Symbolic links are skipped. */
export function walkLocal(root: string, maxEntries = 200_000): LocalTree {
  const tree: LocalTree = { dirs: [], files: [], skipped: 0, truncated: false };
  let count = 0;
  const visit = (abs: string, rel: string): void => {
    for (const d of fs.readdirSync(abs, { withFileTypes: true })) {
      if (tree.truncated) return;
      if (++count > maxEntries) {
        tree.truncated = true;
        return;
      }
      const childAbs = path.join(abs, d.name);
      const childRel = rel ? `${rel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) tree.skipped++;
      else if (d.isDirectory()) {
        tree.dirs.push(childRel);
        visit(childAbs, childRel);
      } else if (d.isFile()) tree.files.push({ rel: childRel, abs: childAbs });
      else tree.skipped++;
    }
  };
  visit(root, '');
  return tree;
}
