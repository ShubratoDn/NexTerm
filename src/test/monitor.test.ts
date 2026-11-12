import test from 'node:test';
import assert from 'node:assert/strict';
import { Monitor, MonitorHub, parseDisks, parseMem, parseNet, parseProcesses, parseSections, parseUsers, statsScript } from '../main/monitor';
import type { ServerStats } from '../shared/types';

// Samples in the exact shape Linux prints them.
const NET_HEAD = [
  'Inter-|   Receive                                                |  Transmit',
  ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
];
const netLine = (name: string, rx: number, tx: number) => `${name.padStart(6)}: ${rx}    5000    0    0    0     0          0         0 ${tx}    4000    0    0    0     0       0          0`;

interface Sample {
  cpu: string;
  eth0: [number, number];
  docker: [number, number];
  who?: string[];
  ps?: string[];
}

const raw = (s: Sample, extra: Record<string, string[]> = {}): string => {
  const sections: Record<string, string[]> = {
    host: ['web-01'],
    os: ['Ubuntu 24.04.1 LTS'],
    kernel: ['Linux 6.8.0-45-generic'],
    arch: ['x86_64'],
    stat: [s.cpu],
    cpumodel: ['model name\t: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz'],
    cores: ['4'],
    load: ['0.52 0.40 0.31 1/312 12345'],
    mem: ['MemTotal:        8123456 kB', 'MemFree:          500000 kB', 'MemAvailable:    3000000 kB', 'Buffers:          100000 kB', 'Cached:          2000000 kB', 'SwapTotal:       2097148 kB', 'SwapFree:        2000000 kB'],
    net: [...NET_HEAD, netLine('lo', 99999, 99999), netLine('eth0', ...s.eth0), netLine('docker0', ...s.docker), netLine('veth9a1', 5, 5)],
    uptime: ['2160000.55 8000000.12'],
    who: s.who ?? ['dev      pts/0        2026-11-10 09:12 (10.0.0.4)', 'dev      pts/1        2026-11-11 08:00 (10.0.0.4)', 'root     tty1         2026-11-01 10:00'],
    df: [
      'Filesystem     1024-blocks      Used Available Capacity Mounted on',
      'udev               4012344         0   4012344       0% /dev',
      'tmpfs               813040      1700    811340       1% /run',
      '/dev/sda2         61255492   6738624  51375324      12% /',
      'tmpfs              4065192         0   4065192       0% /dev/shm',
      '/dev/sda1           523248      6244    517004       2% /boot/efi',
      '/dev/loop0           56064     56064         0     100% /snap/core20/1974',
      'fileserver:/export 100000000  50000000  50000000      50% /mnt/nfs',
    ],
    ps: s.ps ?? [],
    ...extra,
  };
  return Object.entries(sections).map(([k, v]) => `@@${k}\n${v.join('\n')}`).join('\n') + '\n@@end\n';
};

const A: Sample = { cpu: 'cpu  10132153 290696 3084719 46828483 16683 0 25195 0 175628 0', eth0: [1_000_000_000, 500_000_000], docker: [10, 10] };
const B: Sample = { cpu: 'cpu  10132253 290696 3084819 46828983 16683 0 25195 0 175628 0', eth0: [1_002_000_000, 500_500_000], docker: [999999, 999999] };

test('first sample has static facts but no rates yet', () => {
  const s = new Monitor().update(raw(A), 1000);
  assert.equal(s.host, 'web-01');
  assert.equal(s.os, 'Ubuntu 24.04.1 LTS');
  assert.equal(s.kernel, 'Linux 6.8.0-45-generic');
  assert.equal(s.cpuModel, 'Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz');
  assert.equal(s.cores, 4);
  assert.equal(s.cpuPercent, null);
  assert.equal(s.netRxBps, null);
  assert.deepEqual(s.load, [0.52, 0.4, 0.31]);
  assert.equal(s.uptimeSec, 2160000.55);
});

test('cpu percent and network rates come from the difference between samples', () => {
  const m = new Monitor();
  m.update(raw(A), 1000);
  const s = m.update(raw(B), 3000); // two seconds later
  // 700 jiffies elapsed, 500 of them idle -> 200/700
  assert.equal(s.cpuPercent, 28.6);
  // eth0: +2,000,000 bytes down / +500,000 up over 2 s. docker0 and veth/lo are not real traffic.
  assert.equal(s.netRxBps, 1_000_000);
  assert.equal(s.netTxBps, 250_000);
  assert.deepEqual(s.interfaces.map((i) => i.name), ['eth0', 'docker0']); // lo and veth hidden
  assert.equal(s.interfaces[0].rxBps, 1_000_000);
});

test('memory: used excludes reclaimable cache', () => {
  const mem = parseMem(['MemTotal: 8000 kB', 'MemAvailable: 3000 kB', 'Buffers: 100 kB', 'Cached: 900 kB', 'SwapTotal: 2000 kB', 'SwapFree: 1500 kB']);
  assert.deepEqual(mem, { totalKb: 8000, availKb: 3000, usedKb: 5000, cachedKb: 1000, swapTotalKb: 2000, swapUsedKb: 500 });
});

test('memory: old kernels without MemAvailable fall back to free + cache', () => {
  const mem = parseMem(['MemTotal: 8000 kB', 'MemFree: 1000 kB', 'Buffers: 200 kB', 'Cached: 800 kB'])!;
  assert.equal(mem.availKb, 2000);
  assert.equal(mem.usedKb, 6000);
  assert.equal(parseMem([]), null);
  assert.equal(parseMem(['garbage']), null);
});

test('disks: real filesystems only, root first, duplicates and snap mounts dropped', () => {
  const s = new Monitor().update(raw(A), 1);
  assert.deepEqual(s.disks.map((d) => d.mount), ['/', '/boot/efi', '/mnt/nfs']);
  assert.equal(s.disks[0].percent, 12);
  assert.equal(s.disks[0].totalKb, 61255492);
  assert.equal(s.disks[2].device, 'fileserver:/export');
});

test('disks: a bind mount of the same device is listed once', () => {
  const d = parseDisks(['/dev/sda2 1000 500 500 50% /', '/dev/sda2 1000 500 500 50% /var/lib/other']);
  assert.equal(d.length, 1);
});

test('users are grouped and counted', () => {
  const u = parseUsers(['dev pts/0 2026-11-10', 'dev pts/1 2026-11-11', 'root tty1 2026-11-01']);
  assert.deepEqual(u, [{ name: 'dev', count: 2 }, { name: 'root', count: 1 }]);
});

test('processes parse, including commands with spaces', () => {
  const p = parseProcesses([' 1234 root      45.2  3.1 node', ' 5678 www-data   1.0 10.5 nginx: worker process']);
  assert.equal(p.length, 2);
  assert.deepEqual(p[1], { pid: 5678, user: 'www-data', cpu: 1, mem: 10.5, command: 'nginx: worker process' });
  assert.deepEqual(parseProcesses(['PID USER %CPU %MEM COMMAND']), []);
});

test('net parser tolerates headers and counters glued to the colon', () => {
  const n = parseNet([...NET_HEAD, 'eth0:1234567890    5000    0    0    0     0          0         0 999    4000    0    0    0     0       0          0']);
  assert.deepEqual(n.get('eth0'), { rx: 1234567890, tx: 999 });
  assert.equal(n.size, 1);
});

test('the process list is only present when requested', () => {
  const s = new Monitor().update(raw({ ...A, ps: [' 1234 root 45.2 3.1 node'] }), 1);
  assert.equal(s.processes?.length, 1);
  assert.equal(new Monitor().update(raw(A), 1).processes, undefined);
});

test('a server without /proc yields a partial but valid result', () => {
  const sparse = '@@host\nmac-mini\n@@os\n@@kernel\nDarwin 23.1.0\n@@arch\narm64\n@@stat\n@@mem\n@@net\n@@uptime\n@@who\nme console\n@@df\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 488245288 300000000 150000000 67% /\n@@end\n';
  const s = new Monitor().update(sparse, 1);
  assert.equal(s.host, 'mac-mini');
  assert.equal(s.cpuPercent, null);
  assert.equal(s.mem, null);
  assert.equal(s.uptimeSec, null);
  assert.equal(s.disks[0].percent, 67);
  assert.deepEqual(s.users, [{ name: 'me', count: 1 }]);
});

test('garbage and empty output never throw', () => {
  for (const text of ['', '\n\n', 'not the right output', '@@stat\ncpu\n@@net\nbad\n@@df\nweird']) {
    const s = new Monitor().update(text, 1);
    assert.equal(s.cpuPercent, null);
    assert.deepEqual(s.disks, []);
  }
});

test('a counter reset never produces a negative rate', () => {
  const m = new Monitor();
  m.update(raw(A), 1000);
  const s = m.update(raw({ ...B, eth0: [5, 5] }), 3000); // interface counters restarted
  assert.equal(s.netRxBps, 0);
  assert.equal(s.netTxBps, 0);
});

test('sections parser', () => {
  assert.deepEqual(parseSections('@@a\n1\n\n2\n@@b\n@@c\nx\n'), { a: ['1', '2'], b: [], c: ['x'] });
});

test('the script is read-only and shell independent', () => {
  const s = statsScript(false);
  assert.ok(s.startsWith('DETAIL=0'));
  assert.ok(statsScript(true).startsWith('DETAIL=1'));
  for (const forbidden of [/\brm\b/, /\bsudo\b/, /\bkill\b/, /\bchmod\b/, /\bcurl\b|\bwget\b/]) {
    assert.ok(!forbidden.test(s), `script must not contain ${forbidden}`);
  }
});

// ---- hub

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('hub: samples immediately, then again, and reports stats', async () => {
  const seen: (ServerStats | null)[] = [];
  const scripts: string[] = [];
  let n = 0;
  const hub = new MonitorHub(() => 20, (_id, s) => seen.push(s), 20);
  hub.start('c1', { exec: async (_c, input) => { scripts.push(input); return raw(n++ % 2 === 0 ? A : B); } });
  await wait(150);
  hub.stop('c1');
  assert.ok(seen.length >= 3, `expected several samples, got ${seen.length}`);
  assert.equal(seen[0]!.cpuPercent, null); // first sample
  assert.ok(seen[1]!.cpuPercent !== null); // second sample has a rate
  assert.ok(scripts.every((s) => s.startsWith('DETAIL=0')));
  const after = seen.length;
  await wait(80);
  assert.equal(seen.length, after, 'no samples after stop');
});

test('hub: detail mode asks for processes', async () => {
  const scripts: string[] = [];
  const hub = new MonitorHub(() => 20, () => undefined, 20);
  hub.start('c', { exec: async (_c, input) => { scripts.push(input); return raw(A); } });
  await wait(30);
  hub.setDetail('c', true);
  await wait(100);
  hub.stop('c');
  assert.ok(scripts.some((s) => s.startsWith('DETAIL=1')));
});

test('hub: three failures in a row stop it and report null', async () => {
  const seen: (ServerStats | null)[] = [];
  let calls = 0;
  const hub = new MonitorHub(() => 20, (_id, s) => seen.push(s), 20);
  hub.start('bad', { exec: async () => { calls++; throw new Error('exec denied'); } });
  await wait(250);
  assert.deepEqual(seen, [null]);
  assert.equal(calls, 3);
});

test('hub: a connection without exec is ignored and a slow sample does not overlap the next', async () => {
  const hub = new MonitorHub(() => 10, () => undefined, 10);
  hub.start('none', {}); // nothing happens, nothing throws
  let concurrent = 0;
  let max = 0;
  hub.start('slow', { exec: async () => { concurrent++; max = Math.max(max, concurrent); await wait(60); concurrent--; return raw(A); } });
  await wait(300);
  hub.stopAll();
  assert.equal(max, 1);
});
