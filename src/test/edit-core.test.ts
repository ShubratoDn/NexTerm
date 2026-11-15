import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncJob, isInside, isRiskyToOpen, safeLocalName } from '../main/edit-core';
import type { FileState, SyncDeps, SyncState } from '../main/edit-core';

test('safeLocalName replaces characters that are not allowed and keeps the extension', () => {
  assert.equal(safeLocalName('report.csv'), 'report.csv');
  assert.equal(safeLocalName('a:b?c*.txt'), 'a_b_c_.txt');
  assert.equal(safeLocalName('con.txt'), '_con.txt');
  assert.equal(safeLocalName('name. '), 'name');
  assert.equal(safeLocalName('..'), 'file');
  assert.equal(safeLocalName(''), 'file');
  const long = safeLocalName(`${'x'.repeat(300)}.conf`);
  assert.ok(long.length <= 120 && long.endsWith('.conf'));
});

test('files that an operating system would run are flagged', () => {
  for (const n of ['setup.exe', 'run.BAT', 'x.ps1', 'a.js', 'deploy.sh', 'tool.AppImage', 'x.lnk', 'a.py']) assert.equal(isRiskyToOpen(n), true, n);
  for (const n of ['notes.txt', 'config.yaml', 'README.md', 'data.csv', 'photo.png', 'noext', '.bashrc']) assert.equal(isRiskyToOpen(n), false, n);
});

test('isInside', () => {
  assert.equal(isInside('/home/a', '/home/a'), true);
  assert.equal(isInside('/home/a', '/home/a/b/c'), true);
  assert.equal(isInside('/home/a', '/home/ab'), false);
  assert.equal(isInside('/home/a/', '/home/a/x'), true);
  assert.equal(isInside('/', '/anything'), true);
  assert.equal(isInside('/home/a/b', '/home/a'), false);
});

function harness(initial: FileState | null, remote: { cur: FileState | null }) {
  const events: [SyncState, string | undefined][] = [];
  let local: FileState | null = { mtimeMs: 10, size: 5 };
  let uploads = 0;
  const deps: SyncDeps = {
    localStat: () => local,
    remoteStat: async () => remote.cur,
    upload: async () => {
      uploads++;
      remote.cur = { mtimeMs: (remote.cur?.mtimeMs ?? 0) + 1000, size: local?.size ?? 0 };
    },
    emit: (s, m) => events.push([s, m]),
    delay: async () => undefined,
  };
  return { job: new SyncJob(deps, initial), events, uploads: () => uploads, setLocal: (s: FileState | null) => (local = s) };
}

test('a saved file is uploaded and the new server state becomes the base', async () => {
  const remote = { cur: { mtimeMs: 1000, size: 3 } as FileState | null };
  const h = harness({ mtimeMs: 1000, size: 3 }, remote);
  await h.job.changed();
  assert.deepEqual(h.events.map((e) => e[0]), ['uploading', 'saved']);
  assert.equal(h.uploads(), 1);
  assert.deepEqual(h.job.base, remote.cur);
  await h.job.changed(); // a second save works too, because the base was refreshed
  assert.equal(h.uploads(), 2);
});

test('a file changed on the server is not overwritten until the user agrees', async () => {
  const remote = { cur: { mtimeMs: 5000, size: 99 } as FileState | null }; // someone else changed it
  const h = harness({ mtimeMs: 1000, size: 3 }, remote);
  await h.job.changed();
  assert.deepEqual(h.events.map((e) => e[0]), ['conflict']);
  assert.equal(h.uploads(), 0);
  await h.job.changed(true); // "overwrite"
  assert.equal(h.uploads(), 1);
  assert.equal(h.events.at(-1)![0], 'saved');
});

test('a file deleted on the server is recreated', async () => {
  const remote = { cur: null as FileState | null };
  const h = harness({ mtimeMs: 1000, size: 3 }, remote);
  await h.job.changed();
  assert.equal(h.uploads(), 1);
});

test('an upload failure is reported and the next save still works', async () => {
  const remote = { cur: { mtimeMs: 1000, size: 3 } as FileState | null };
  const events: SyncState[] = [];
  let fail = true;
  const job = new SyncJob(
    {
      localStat: () => ({ mtimeMs: 1, size: 1 }),
      remoteStat: async () => remote.cur,
      upload: async () => {
        if (fail) throw new Error('connection lost');
      },
      emit: (s) => events.push(s),
      delay: async () => undefined,
    },
    { mtimeMs: 1000, size: 3 },
  );
  await job.changed();
  assert.deepEqual(events, ['uploading', 'error']);
  fail = false;
  await job.changed();
  assert.equal(events.at(-1), 'saved');
});

test('saves that arrive during an upload are not lost and never overlap', async () => {
  const remote = { cur: { mtimeMs: 1000, size: 3 } as FileState | null };
  let running = 0;
  let maxRunning = 0;
  let uploads = 0;
  const box: { job?: SyncJob } = {};
  box.job = new SyncJob(
    {
      localStat: () => ({ mtimeMs: 1, size: 1 }),
      remoteStat: async () => remote.cur,
      upload: async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        uploads++;
        if (uploads === 1) void box.job!.changed(); // the user saves again while the first upload runs
        await Promise.resolve();
        remote.cur = { mtimeMs: (remote.cur?.mtimeMs ?? 0) + 1, size: 1 };
        running--;
      },
      emit: () => undefined,
      delay: async () => undefined,
    },
    { mtimeMs: 1000, size: 3 },
  );
  await box.job.changed();
  assert.equal(uploads, 2);
  assert.equal(maxRunning, 1);
});

test('a file that disappears locally is ignored', async () => {
  const remote = { cur: { mtimeMs: 1000, size: 3 } as FileState | null };
  const h = harness({ mtimeMs: 1000, size: 3 }, remote);
  h.setLocal(null);
  await h.job.changed();
  assert.equal(h.uploads(), 0);
  assert.equal(h.events.length, 0);
});
