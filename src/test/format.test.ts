import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatKb, formatRate, formatUptime, levelFor } from '../shared/format';

test('formatKb matches the style of common server dashboards', () => {
  assert.equal(formatKb(5201920), '4.96 GB');
  assert.equal(formatKb(8126464), '7.75 GB');
  assert.equal(formatKb(512 * 1024), '512 MB');
  assert.equal(formatKb(300), '300 KB');
  assert.equal(formatKb(2 * 1024 * 1024 * 1024), '2.00 TB');
  assert.equal(formatKb(-1), '–');
  assert.equal(formatKb(Number.NaN), '–');
});

test('formatBytes picks a sensible unit', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.00 MB');
  assert.equal(formatBytes(250 * 1024 * 1024 * 1024), '250 GB');
});

test('formatRate shows units and a dash before the first sample', () => {
  assert.equal(formatRate(null), '–');
  assert.equal(formatRate(0), '0 B/s');
  assert.equal(formatRate(512), '512 B/s');
  assert.equal(formatRate(2048), '2.0 KB/s');
  assert.equal(formatRate(250_000), '244 KB/s');
  assert.equal(formatRate(1_500_000), '1.43 MB/s');
});

test('formatUptime', () => {
  assert.equal(formatUptime(25 * 86400 + 5), '25 days');
  assert.equal(formatUptime(86400), '1 day');
  assert.equal(formatUptime(3 * 3600 + 12 * 60), '3 h 12 min');
  assert.equal(formatUptime(12 * 60 + 5), '12 min');
  assert.equal(formatUptime(null), '–');
});

test('levelFor bands', () => {
  assert.equal(levelFor(null), 'ok');
  assert.equal(levelFor(10), 'ok');
  assert.equal(levelFor(75), 'warn');
  assert.equal(levelFor(89.9), 'warn');
  assert.equal(levelFor(90), 'bad');
});
