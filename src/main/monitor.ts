import type { DiskStat, NetInterfaceStat, ProcessStat, ServerStats } from '../shared/types';

/**
 * Server statistics, collected the way terminal clients usually do: a short read-only shell script is run over a
 * separate SSH channel and its output is parsed here. Nothing is installed on the server and the user's own shell
 * session is never touched.
 *
 * The script only reads /proc and runs hostname, uname, who, df and ps. It is sent on stdin to `sh -s`, so it behaves
 * the same whatever the user's login shell is (bash, zsh, fish, ...).
 */
export const STATS_COMMAND = 'sh -s';

export function statsScript(detail: boolean): string {
  return `DETAIL=${detail ? 1 : 0}
LC_ALL=C; export LC_ALL
echo '@@host'; hostname 2>/dev/null || cat /proc/sys/kernel/hostname 2>/dev/null
echo '@@os'; ( . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" ) 2>/dev/null
echo '@@kernel'; uname -sr 2>/dev/null
echo '@@arch'; uname -m 2>/dev/null
echo '@@stat'; sed -n 1p /proc/stat 2>/dev/null
echo '@@cpumodel'; grep -m1 'model name' /proc/cpuinfo 2>/dev/null
echo '@@cores'; grep -c '^processor' /proc/cpuinfo 2>/dev/null
echo '@@load'; cat /proc/loadavg 2>/dev/null
echo '@@mem'; grep -E '^(MemTotal|MemAvailable|MemFree|Buffers|Cached|SwapTotal|SwapFree):' /proc/meminfo 2>/dev/null
echo '@@net'; cat /proc/net/dev 2>/dev/null
echo '@@uptime'; cat /proc/uptime 2>/dev/null
echo '@@who'; who 2>/dev/null
echo '@@df'; df -P -k 2>/dev/null
echo '@@ps'; if [ "$DETAIL" = 1 ]; then ps -eo pid=,user=,pcpu=,pmem=,comm= --sort=-pcpu 2>/dev/null | head -n 8; fi
echo '@@end'
`;
}

/** Splits the script output into its named sections. */
export function parseSections(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^@@(\w+)\s*$/.exec(raw);
    if (m) {
      current = out[m[1]] = [];
    } else if (current && raw.trim() !== '') {
      current.push(raw);
    }
  }
  return out;
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Interfaces that are plumbing rather than real network traffic. */
const VIRTUAL_IFACE = /^(lo|veth|docker|br-|virbr|cni|flannel|cali|vxlan|tun\d|tap\d)/;

const PSEUDO_FS = new Set(['tmpfs', 'devtmpfs', 'udev', 'overlay', 'shm', 'none', 'efivarfs', 'squashfs', 'proc', 'sysfs', 'cgroup', 'cgroup2', 'run', 'devpts', 'fusectl']);
const PSEUDO_MOUNT = /^\/(snap|run|sys|proc|dev|var\/lib\/docker|var\/lib\/containers)(\/|$)/;

export function parseDisks(lines: string[] | undefined): DiskStat[] {
  const disks: DiskStat[] = [];
  const seen = new Set<string>();
  for (const line of lines ?? []) {
    const m = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/.exec(line);
    if (!m) continue; // header or wrapped line
    const [, device, total, used, , pct, mount] = m;
    if (PSEUDO_FS.has(device) || /^\/dev\/loop\d+$/.test(device) || PSEUDO_MOUNT.test(mount)) continue;
    if (seen.has(device)) continue; // bind mounts of the same device
    seen.add(device);
    disks.push({ mount, device, totalKb: Number(total), usedKb: Number(used), percent: Number(pct) });
  }
  // "/" first, then by mount path
  return disks.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : a.mount.localeCompare(b.mount)));
}

export function parseUsers(lines: string[] | undefined): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const line of lines ?? []) {
    const name = line.trim().split(/\s+/)[0];
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function parseProcesses(lines: string[] | undefined): ProcessStat[] {
  const procs: ProcessStat[] = [];
  for (const line of lines ?? []) {
    const m = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(.+?)\s*$/.exec(line);
    if (m) procs.push({ pid: Number(m[1]), user: m[2], cpu: Number(m[3]), mem: Number(m[4]), command: m[5] });
  }
  return procs;
}

interface NetCounters {
  rx: number;
  tx: number;
}

export function parseNet(lines: string[] | undefined): Map<string, NetCounters> {
  const map = new Map<string, NetCounters>();
  for (const line of lines ?? []) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m) continue; // the two header lines have no "name:" prefix in this shape
    const f = m[2].trim().split(/\s+/);
    if (f.length >= 9) map.set(m[1], { rx: num(f[0]), tx: num(f[8]) });
  }
  return map;
}

export function parseMem(lines: string[] | undefined): ServerStats['mem'] {
  if (!lines || lines.length === 0) return null;
  const kv: Record<string, number> = {};
  for (const line of lines) {
    const m = /^(\w+):\s*(\d+)/.exec(line);
    if (m) kv[m[1]] = Number(m[2]);
  }
  const total = kv.MemTotal;
  if (!total) return null;
  const cached = (kv.Cached ?? 0) + (kv.Buffers ?? 0);
  const avail = kv.MemAvailable ?? (kv.MemFree ?? 0) + cached;
  const swapTotal = kv.SwapTotal ?? 0;
  return {
    totalKb: total,
    availKb: avail,
    usedKb: Math.max(0, total - avail),
    cachedKb: cached,
    swapTotalKb: swapTotal,
    swapUsedKb: Math.max(0, swapTotal - (kv.SwapFree ?? swapTotal)),
  };
}

interface CpuCounters {
  total: number;
  idle: number;
}

function parseCpu(lines: string[] | undefined): CpuCounters | null {
  const line = lines?.[0];
  if (!line || !line.startsWith('cpu')) return null;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  if (n.length < 4 || n.some((x) => !Number.isFinite(x))) return null;
  // user nice system idle iowait irq softirq steal
  const total = n.slice(0, 8).reduce((a, b) => a + b, 0);
  return { total, idle: (n[3] ?? 0) + (n[4] ?? 0) };
}

/** Turns successive raw samples into statistics, remembering the previous counters to compute rates. */
export class Monitor {
  private prevCpu: CpuCounters | null = null;
  private prevNet: { at: number; ifaces: Map<string, NetCounters> } | null = null;

  update(raw: string, now = Date.now()): ServerStats {
    const s = parseSections(raw);
    const first = (name: string) => s[name]?.[0]?.trim();

    // CPU: share of non-idle time since the previous sample
    let cpuPercent: number | null = null;
    const cpu = parseCpu(s.stat);
    if (cpu && this.prevCpu) {
      const dTotal = cpu.total - this.prevCpu.total;
      const dIdle = cpu.idle - this.prevCpu.idle;
      if (dTotal > 0) cpuPercent = Math.round(Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100)) * 10) / 10;
    }
    if (cpu) this.prevCpu = cpu;

    // Network: bytes per second since the previous sample
    const counters = parseNet(s.net);
    const dt = this.prevNet ? (now - this.prevNet.at) / 1000 : 0;
    const interfaces: NetInterfaceStat[] = [];
    let rx: number | null = null;
    let tx: number | null = null;
    for (const [name, c] of counters) {
      const before = this.prevNet?.ifaces.get(name);
      const rate = (cur: number, prev: number | undefined) => (before && prev !== undefined && dt > 0 ? Math.max(0, (cur - prev) / dt) : null);
      const rxBps = rate(c.rx, before?.rx);
      const txBps = rate(c.tx, before?.tx);
      if (name !== 'lo' && !name.startsWith('veth')) interfaces.push({ name, rxBps, txBps, rxTotal: c.rx, txTotal: c.tx });
      if (!VIRTUAL_IFACE.test(name)) {
        if (rxBps !== null) rx = (rx ?? 0) + rxBps;
        if (txBps !== null) tx = (tx ?? 0) + txBps;
      }
    }
    if (counters.size > 0) this.prevNet = { at: now, ifaces: counters };

    const loadParts = first('load')?.split(/\s+/).slice(0, 3).map(Number);
    const uptime = Number(first('uptime')?.split(/\s+/)[0]);
    const cores = Number(first('cores'));
    const procs = parseProcesses(s.ps);

    const stats: ServerStats = {
      at: now,
      host: first('host') ?? '',
      os: first('os') || undefined,
      kernel: first('kernel') || undefined,
      arch: first('arch') || undefined,
      cpuModel: first('cpumodel')?.replace(/^model name\s*:\s*/i, '').replace(/\s+/g, ' ') || undefined,
      cores: Number.isFinite(cores) && cores > 0 ? cores : undefined,
      cpuPercent,
      load: loadParts && loadParts.length === 3 && loadParts.every(Number.isFinite) ? [loadParts[0], loadParts[1], loadParts[2]] : null,
      mem: parseMem(s.mem),
      netRxBps: rx,
      netTxBps: tx,
      interfaces,
      uptimeSec: Number.isFinite(uptime) ? uptime : null,
      users: parseUsers(s.who),
      disks: parseDisks(s.df),
    };
    if (procs.length > 0) stats.processes = procs;
    return stats;
  }
}

/** The part of a connection the hub needs. */
export interface Execable {
  exec?(command: string, input: string, timeoutMs: number): Promise<string>;
}

interface Run {
  mon: Monitor;
  timer?: NodeJS.Timeout;
  detail: boolean;
  inflight: boolean;
  failures: number;
  stopped: boolean;
  samples: number;
}

/**
 * Polls connections for statistics. One sample is taken immediately and a second one a second later, so CPU and network
 * rates appear quickly; after that it follows the configured interval. Several failures in a row stop it quietly.
 */
export class MonitorHub {
  private runs = new Map<string, Run>();

  constructor(
    private readonly intervalMs: () => number,
    private readonly send: (connId: string, stats: ServerStats | null) => void,
    /** Delay before the second sample and the smallest allowed interval (milliseconds). Tests lower it. */
    private readonly minDelayMs = 1000,
  ) {}

  start(connId: string, conn: Execable): void {
    if (!conn.exec || this.runs.has(connId)) return;
    const run: Run = { mon: new Monitor(), detail: false, inflight: false, failures: 0, stopped: false, samples: 0 };
    this.runs.set(connId, run);
    void this.tick(connId, conn);
  }

  stop(connId: string): void {
    const run = this.runs.get(connId);
    if (!run) return;
    run.stopped = true;
    if (run.timer) clearTimeout(run.timer);
    this.runs.delete(connId);
  }

  setDetail(connId: string, on: boolean): void {
    const run = this.runs.get(connId);
    if (run) run.detail = on;
  }

  refresh(connId: string, conn: Execable): void {
    const run = this.runs.get(connId);
    if (!run || run.inflight) return;
    if (run.timer) clearTimeout(run.timer);
    void this.tick(connId, conn);
  }

  stopAll(): void {
    for (const id of [...this.runs.keys()]) this.stop(id);
  }

  private async tick(connId: string, conn: Execable): Promise<void> {
    const run = this.runs.get(connId);
    if (!run || run.stopped || run.inflight || !conn.exec) return;
    run.inflight = true;
    try {
      const out = await conn.exec(STATS_COMMAND, statsScript(run.detail), 8000);
      if (run.stopped) return;
      run.failures = 0;
      run.samples++;
      this.send(connId, run.mon.update(out));
    } catch {
      if (run.stopped) return;
      if (++run.failures >= 3) {
        this.send(connId, null); // the server does not allow this; stop asking
        this.stop(connId);
        return;
      }
    } finally {
      run.inflight = false;
    }
    if (!run.stopped) {
      const delay = run.samples <= 1 ? this.minDelayMs : Math.max(this.minDelayMs, this.intervalMs());
      run.timer = setTimeout(() => void this.tick(connId, conn), delay);
    }
  }
}
