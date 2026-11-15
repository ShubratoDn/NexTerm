import test from 'node:test';
import assert from 'node:assert/strict';
import { Transfer, TransferMeter } from '../main/transfer';
import { formatDuration } from '../shared/format';
import type { TransferProgress } from '../shared/types';

const clock = (start = 1000) => {
  let t = start;
  return { now: () => t, tick: (ms: number) => void (t += ms) };
};

test('speed is bytes per second over the recent window', () => {
  const c = clock();
  const m = new TransferMeter(c.now);
  m.setTotals(10_000_000, 1);
  for (let i = 0; i < 4; i++) {
    c.tick(500);
    m.add(500_000); // 1 MB/s
  }
  assert.equal(Math.round(m.speed() / 1000), 1000);
  assert.equal(m.etaSec(), 8); // 8 MB left at 1 MB/s
});

test('speed falls back to zero when the transfer stalls', () => {
  const c = clock();
  const m = new TransferMeter(c.now);
  m.setTotals(5_000_000, 1);
  c.tick(1000);
  m.add(1_000_000);
  c.tick(10_000); // nothing for ten seconds
  assert.ok(m.speed() < 1);
  assert.equal(m.etaSec(), null);
});

test('only the last few seconds count, so a speed change shows up', () => {
  const c = clock();
  const m = new TransferMeter(c.now);
  m.setTotals(100_000_000, 1);
  for (let i = 0; i < 10; i++) {
    c.tick(1000);
    m.add(10_000_000); // fast at first: 10 MB/s
  }
  for (let i = 0; i < 6; i++) {
    c.tick(1000);
    m.add(100_000); // then slow: 0.1 MB/s
  }
  assert.ok(m.speed() < 300_000, `speed was ${m.speed()}`);
});

test('the done count never goes past the total', () => {
  const c = clock();
  const m = new TransferMeter(c.now);
  m.setTotals(1000, 1);
  m.add(1500); // the file grew while it was copied
  assert.equal(m.snapshot().doneBytes, 1000);
  assert.equal(m.etaSec(), 0);
});

test('negative and zero byte counts are ignored', () => {
  const m = new TransferMeter();
  m.add(-5);
  m.add(0);
  assert.equal(m.doneBytes, 0);
});

test('a transfer reports preparing, running and done, and throttles the running updates', () => {
  const c = clock();
  const seen: TransferProgress[] = [];
  const t = new Transfer('upload', 'a.bin', (p) => seen.push(p), c.now, 100);
  t.setTotals(1000, 2);
  t.file('a.bin');
  for (let i = 0; i < 50; i++) {
    c.tick(10);
    t.bytes(10); // 50 updates in 500 ms
  }
  t.fileDone();
  t.finish();
  t.finish(); // a second call does nothing
  assert.equal(seen[0].state, 'preparing');
  assert.equal(seen.at(-1)!.state, 'done');
  assert.equal(seen.filter((p) => p.state === 'done').length, 1);
  assert.ok(seen.length < 20, `expected throttling, got ${seen.length} updates`);
  assert.equal(new Set(seen.map((p) => p.id)).size, 1);
  assert.equal(seen.at(-1)!.filesDone, 1);
});

test('a failed transfer reports the error', () => {
  const seen: TransferProgress[] = [];
  const t = new Transfer('download', 'x', (p) => seen.push(p));
  t.finish('Permission denied');
  assert.equal(seen.at(-1)!.state, 'error');
  assert.equal(seen.at(-1)!.error, 'Permission denied');
});

test('formatDuration is short and readable', () => {
  assert.equal(formatDuration(5), '5 s');
  assert.equal(formatDuration(75), '1 min 15 s');
  assert.equal(formatDuration(3900), '1 h 05 min');
  assert.equal(formatDuration(null), '–');
});
