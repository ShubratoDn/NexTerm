import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deletionOrder, isProtectedPath, isSafeName, summarizeSize, walkLocal, walkTree } from '../main/sftp-tree';
import type { SftpEntry } from '../shared/types';
import { formatOctal, modeToSymbolic, parseOctalMode, shellQuote } from '../shared/format';

type Node = { size?: number; link?: boolean; children?: Record<string, Node> };

/** An in-memory remote file system for the walker. */
const fakeFs = (root: Record<string, Node>) => {
  const lookup = (dir: string): Record<string, Node> | undefined => {
    let cur: Record<string, Node> | undefined = root;
    for (const part of dir.split('/').filter(Boolean)) cur = cur?.[part]?.children;
    return cur;
  };
  let calls = 0;
  return {
    calls: () => calls,
    list: async (dir: string): Promise<SftpEntry[]> => {
      calls++;
      const kids = lookup(dir);
      if (!kids) throw new Error(`no such directory ${dir}`);
      return Object.entries(kids).map(([name, n]) => ({
        name, isDir: !!n.children, isLink: !!n.link, size: n.size ?? 0, mtimeMs: 0, mode: n.children ? 0o755 : 0o644,
      }));
    },
  };
};

const TREE: Record<string, Node> = {
  proj: {
    children: {
      'a.txt': { size: 100 },
      sub: { children: { 'b.bin': { size: 2000 }, deeper: { children: { 'c.log': { size: 30 } } } } },
      empty: { children: {} },
      'link-to-sub': { link: true, children: { loop: { size: 999 } } },
    },
  },
};

test('walkTree lists parents before children and does not follow links', async () => {
  const w = await walkTree(fakeFs(TREE).list, '/proj');
  assert.deepEqual(w.items.map((i) => i.rel), ['a.txt', 'sub', 'sub/b.bin', 'sub/deeper', 'sub/deeper/c.log', 'empty', 'link-to-sub']);
  assert.equal(w.truncated, false);
  assert.equal(w.items[2].path, '/proj/sub/b.bin');
});

test('summarizeSize counts files, folders and bytes (links add no bytes)', async () => {
  const s = summarizeSize(await walkTree(fakeFs(TREE).list, '/proj'));
  assert.deepEqual(s, { bytes: 2130, files: 4, dirs: 3, truncated: false });
});

test('walkTree stops at the entry limit and says so', async () => {
  const w = await walkTree(fakeFs(TREE).list, '/proj', { maxEntries: 3 });
  assert.equal(w.items.length, 3);
  assert.equal(w.truncated, true);
});

test('walkTree stops at the depth limit', async () => {
  const w = await walkTree(fakeFs(TREE).list, '/proj', { maxDepth: 1 });
  assert.equal(w.truncated, true);
  assert.ok(!w.items.some((i) => i.rel.startsWith('sub/')));
});

test('walkTree stops at the time limit', async () => {
  let t = 0;
  const w = await walkTree(fakeFs(TREE).list, '/proj', { timeoutMs: 10, now: () => (t += 8) });
  assert.equal(w.truncated, true);
});

test('names a hostile server returns are never used', async () => {
  const evil: Record<string, Node> = { d: { children: { ok: { size: 1 }, '..': { size: 1 }, 'x/../../etc': { size: 1 }, 'a\\b': { size: 1 }, '': { size: 1 }, 'nul\0': { size: 1 } } } };
  const w = await walkTree(fakeFs(evil).list, '/d');
  assert.deepEqual(w.items.map((i) => i.rel), ['ok']);
  assert.equal(w.invalid, 5);
});

test('isSafeName', () => {
  for (const ok of ['a', 'file.txt', '.hidden', 'with space', 'ünïcode']) assert.ok(isSafeName(ok), ok);
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'x\0']) assert.ok(!isSafeName(bad), JSON.stringify(bad));
});

test('deletionOrder removes files first and folders deepest first', async () => {
  const { files, dirs } = deletionOrder(await walkTree(fakeFs(TREE).list, '/proj'));
  assert.deepEqual(files.map((f) => f.rel).sort(), ['a.txt', 'link-to-sub', 'sub/b.bin', 'sub/deeper/c.log']);
  assert.deepEqual(dirs.map((d) => d.rel), ['sub/deeper', 'sub', 'empty'].sort((a, b) => b.split('/').length - a.split('/').length));
  assert.equal(dirs[0].rel, 'sub/deeper'); // a child always comes before its parent
});

test('recursive delete refuses the root and top-level system folders', () => {
  for (const p of ['/', '', '.', '/etc', '/home', '/var/', '//']) assert.ok(isProtectedPath(p), p);
  for (const p of ['/home/me', '/tmp/x', '/var/www/site/']) assert.ok(!isProtectedPath(p), p);
});

test('walkLocal collects files and folders and skips symlinks', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexterm-walk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'top.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'a', 'b', 'deep.txt'), 'y');
  try {
    fs.symlinkSync(path.join(dir, 'top.txt'), path.join(dir, 'link'));
  } catch {
    /* symlinks may need privileges on Windows; the rest still applies */
  }
  const tree = walkLocal(dir);
  assert.deepEqual(tree.dirs, ['a', 'a/b']);
  assert.deepEqual(tree.files.map((f) => f.rel).sort(), ['a/b/deep.txt', 'top.txt']);
  assert.equal(tree.truncated, false);
  assert.equal(walkLocal(dir, 2).truncated, true);
});

test('permissions: symbolic form, octal parsing and special bits', () => {
  assert.equal(modeToSymbolic(0o755, 'dir'), 'drwxr-xr-x');
  assert.equal(modeToSymbolic(0o644), '-rw-r--r--');
  assert.equal(modeToSymbolic(0o777, 'link'), 'lrwxrwxrwx');
  assert.equal(modeToSymbolic(0o4755), '-rwsr-xr-x');
  assert.equal(modeToSymbolic(0o4644), '-rwSr--r--');
  assert.equal(modeToSymbolic(0o1777, 'dir'), 'drwxrwxrwt');
  assert.equal(modeToSymbolic(0o2755), '-rwxr-sr-x');
  assert.equal(formatOctal(0o100644), '0644');
  assert.equal(parseOctalMode('755'), 0o755);
  assert.equal(parseOctalMode(' 0644 '), 0o644);
  for (const bad of ['', '8', '12345', 'rwx', '-1', '7 5']) assert.equal(parseOctalMode(bad), null, bad);
});

test('shellQuote keeps a path as one literal word', () => {
  assert.equal(shellQuote('/home/me'), "'/home/me'");
  assert.equal(shellQuote('/tmp/it\'s here'), "'/tmp/it'\\''s here'");
  assert.equal(shellQuote('/tmp/$(rm -rf ~); `x` "y"'), "'/tmp/$(rm -rf ~); `x` \"y\"'");
  assert.equal(shellQuote(''), "''");
});
