import { h, put } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';
import { toast } from './toast';
import { formatBytes, formatKb, formatRate, formatUptime, levelFor } from '../shared/format';
import type { ServerStats } from '../shared/types';

const HISTORY = 40;
const SVG = 'http://www.w3.org/2000/svg';

type Mode = 'hidden' | 'loading' | 'live' | 'unavailable';

/** A small CPU history graph: a line over a soft area, 0 to 100 %. */
function sparkline(values: number[], width: number, height: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  const base = document.createElementNS(SVG, 'line');
  base.setAttribute('x1', '0');
  base.setAttribute('x2', String(width));
  base.setAttribute('y1', String(height - 0.5));
  base.setAttribute('y2', String(height - 0.5));
  base.setAttribute('class', 'spark-base');
  svg.append(base);
  if (values.length >= 2) {
    const step = width / (HISTORY - 1);
    const x0 = width - (values.length - 1) * step;
    const pts = values.map((v, i) => [x0 + i * step, height - 1 - (Math.min(100, Math.max(0, v)) / 100) * (height - 2)] as const);
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = document.createElementNS(SVG, 'path');
    area.setAttribute('d', `${line} L${pts[pts.length - 1][0].toFixed(1)} ${height} L${pts[0][0].toFixed(1)} ${height} Z`);
    area.setAttribute('class', 'spark-area');
    const stroke = document.createElementNS(SVG, 'path');
    stroke.setAttribute('d', line);
    stroke.setAttribute('class', 'spark-line');
    svg.append(area, stroke);
  }
  return svg;
}

const pct = (n: number) => `${Math.round(n)}%`;
const lv = (p: number | null) => `lv-${levelFor(p)}`;

/** A horizontal meter; `parts` are stacked segments of the whole (each 0 to 100 %). */
function meter(parts: { percent: number; cls?: string }[]): HTMLElement {
  const el = h('div', { class: 'meter' });
  for (const p of parts) el.append(h('span', { class: `fill ${p.cls ?? ''}`, style: `width:${Math.min(100, Math.max(0, p.percent))}%` }));
  return el;
}

/**
 * Live server statistics shown under an SSH terminal: host, CPU with a mini graph, memory, network speed, uptime,
 * logged-in users and disk usage. Clicking opens a details panel (load, swap, interfaces, busiest processes).
 */
export class MonitorBar {
  readonly el: HTMLElement;
  private readonly body = h('div', { class: 'mb-body' });
  private panel: HTMLElement | null = null;
  private stats: ServerStats | null = null;
  private cpuHistory: number[] = [];
  private mode: Mode = 'hidden';

  constructor(
    private readonly getConn: () => string | undefined,
    private readonly onRetry: () => void,
  ) {
    this.el = h('div', { class: 'monitorbar hidden', role: 'status', 'aria-label': 'Server status' }, this.body);
  }

  /* ---------- state ---------- */

  setMode(mode: Mode): void {
    this.mode = mode;
    this.el.classList.toggle('hidden', mode === 'hidden');
    if (mode === 'hidden') this.closePanel();
    this.render();
  }

  /** Called for every sample; null means the server does not support this. */
  update(stats: ServerStats | null): void {
    if (stats === null) {
      this.stats = null;
      this.setMode('unavailable');
      return;
    }
    this.stats = stats;
    if (stats.cpuPercent !== null) {
      this.cpuHistory.push(stats.cpuPercent);
      if (this.cpuHistory.length > HISTORY) this.cpuHistory.shift();
    }
    if (this.mode !== 'live') this.setMode('live');
    else this.render();
  }

  destroy(): void {
    this.closePanel();
    this.el.remove();
  }

  get visible(): boolean {
    return this.mode !== 'hidden';
  }

  /* ---------- bar ---------- */

  private render(): void {
    this.body.replaceChildren();
    if (this.mode === 'loading') {
      put(this.body, h('div', { class: 'mb-note' }, icon('loader-circle', 14, 'spin'), 'Reading server status…'));
    } else if (this.mode === 'unavailable') {
      put(
        this.body,
        h('div', { class: 'mb-note' }, icon('info', 14), 'Server status is not available for this connection.',
          h('button', { class: 'mb-link', onclick: () => this.onRetry() }, 'Try again')),
      );
    } else if (this.mode === 'live' && this.stats) {
      this.renderLive(this.stats);
    }
    if (this.panel) this.renderPanel();
  }

  private seg(ic: IconName, cls: string, title: string, ...children: (Node | string | null)[]): HTMLElement {
    const el = h('button', { class: `mb-seg ${cls}`, type: 'button', title, 'aria-label': title, onclick: () => this.togglePanel() }, icon(ic, 14));
    put(el, ...children.map((c) => (typeof c === 'string' ? h('span', { class: 'v' }, c) : c)));
    return el;
  }

  private renderLive(s: ServerStats): void {
    const segs = h('div', { class: 'mb-segs' });
    const sysTitle = [s.os, s.kernel, s.arch, s.cores ? `${s.cores} CPU core${s.cores === 1 ? '' : 's'}` : ''].filter(Boolean).join('\n');
    segs.append(this.seg('server', 'host', sysTitle || 'Server', h('b', { class: 'v' }, s.host || 'server')));

    // CPU with history graph
    const cpuText = s.cpuPercent === null ? '…' : pct(s.cpuPercent);
    segs.append(this.seg('cpu', `cpu ${lv(s.cpuPercent)}`, `CPU ${s.cpuPercent === null ? 'measuring…' : s.cpuPercent + '%'}${s.load ? `\nLoad ${s.load.join(' / ')}` : ''}`, h('span', { class: 'v num' }, cpuText), sparkline(this.cpuHistory, 56, 16)));

    if (s.mem) {
      const used = (s.mem.usedKb / s.mem.totalKb) * 100;
      const el = this.seg('memory-stick', `mem has-bar ${lv(used)}`, `Memory ${pct(used)} used\nCache and buffers ${formatKb(s.mem.cachedKb)}${s.mem.swapTotalKb ? `\nSwap ${formatKb(s.mem.swapUsedKb)} of ${formatKb(s.mem.swapTotalKb)}` : ''}`, `${formatKb(s.mem.usedKb)} / ${formatKb(s.mem.totalKb)}`);
      el.style.setProperty('--p', `${Math.min(100, used)}%`);
      segs.append(el);
    }

    if (s.netTxBps !== null || s.netRxBps !== null || s.interfaces.length) {
      segs.append(this.seg('arrow-up', 'net up', 'Upload', h('span', { class: 'v num' }, formatRate(s.netTxBps))));
      segs.append(this.seg('arrow-down', 'net down', 'Download', h('span', { class: 'v num' }, formatRate(s.netRxBps))));
    }

    if (s.uptimeSec !== null) segs.append(this.seg('clock', 'uptime', 'Uptime', formatUptime(s.uptimeSec)));

    if (s.users.length) {
      const label = s.users.map((u) => (u.count > 1 ? `${u.name} (x${u.count})` : u.name)).join(', ');
      segs.append(this.seg('users', 'users', `Logged in: ${label}`, label));
    }

    s.disks.forEach((d, i) => {
      const el = this.seg('hard-drive', `disk has-bar ${lv(d.percent)}${i === 0 ? '' : ' no-icon'}`, `${d.device}\n${formatKb(d.usedKb)} of ${formatKb(d.totalKb)} used`, `${d.mount}: ${d.percent}%`);
      el.style.setProperty('--p', `${d.percent}%`);
      segs.append(el);
    });

    const more = h('button', { class: 'mb-more', type: 'button', 'aria-expanded': String(!!this.panel), title: 'Server details', onclick: () => this.togglePanel() }, icon('gauge', 14), h('span', {}, 'Details'), icon('chevron-up', 13));
    put(this.body, segs, more);
  }

  /* ---------- details panel ---------- */

  private readonly onOutside = (e: Event) => {
    if (this.panel && !this.el.contains(e.target as Node)) this.closePanel();
  };

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.panel) {
      e.stopPropagation();
      this.closePanel();
    }
  };

  private togglePanel(): void {
    if (this.panel) this.closePanel();
    else this.openPanel();
  }

  private openPanel(): void {
    if (this.panel || this.mode !== 'live') return;
    this.panel = h('div', { class: 'mb-panel', role: 'dialog', 'aria-label': 'Server details' });
    this.el.append(this.panel);
    document.addEventListener('pointerdown', this.onOutside, true);
    document.addEventListener('keydown', this.onKey, true);
    const id = this.getConn();
    if (id) {
      void window.termApi.monitorDetail(id, true); // adds the process list to the next samples
      void window.termApi.monitorRefresh(id);
    }
    this.render();
  }

  private closePanel(): void {
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
    document.removeEventListener('pointerdown', this.onOutside, true);
    document.removeEventListener('keydown', this.onKey, true);
    const id = this.getConn();
    if (id) void window.termApi.monitorDetail(id, false).catch(() => undefined);
    this.body.querySelector('.mb-more')?.setAttribute('aria-expanded', 'false');
  }

  private summary(s: ServerStats): string {
    const lines = [`${s.host}${s.os ? ` · ${s.os}` : ''}${s.kernel ? ` · ${s.kernel}` : ''}`];
    if (s.cpuPercent !== null) lines.push(`CPU ${s.cpuPercent}%${s.cores ? ` (${s.cores} cores)` : ''}${s.load ? `, load ${s.load.join(' / ')}` : ''}`);
    if (s.mem) lines.push(`Memory ${formatKb(s.mem.usedKb)} / ${formatKb(s.mem.totalKb)}${s.mem.swapTotalKb ? `, swap ${formatKb(s.mem.swapUsedKb)} / ${formatKb(s.mem.swapTotalKb)}` : ''}`);
    if (s.uptimeSec !== null) lines.push(`Uptime ${formatUptime(s.uptimeSec)}`);
    for (const d of s.disks) lines.push(`${d.mount}: ${d.percent}% (${formatKb(d.usedKb)} / ${formatKb(d.totalKb)})`);
    return lines.join('\n');
  }

  private renderPanel(): void {
    const panel = this.panel;
    if (!panel) return;
    const s = this.stats;
    const scroll = panel.scrollTop; // a refresh must not throw the reader back to the top
    panel.replaceChildren();
    if (!s) {
      put(panel, h('div', { class: 'mb-note' }, icon('loader-circle', 14, 'spin'), 'Waiting for the first sample…'));
      return;
    }

    const tool = (ic: IconName, title: string, fn: () => void) => h('button', { class: 'icon-btn', title, 'aria-label': title, type: 'button', onclick: fn }, icon(ic, 15));
    const head = h('div', { class: 'mbp-head' },
      h('span', { class: 'mbp-icon' }, icon('server', 18)),
      h('div', { class: 'mbp-title' }, h('strong', {}, s.host || 'Server'), h('div', { class: 'sub' }, [s.os, s.kernel, s.arch].filter(Boolean).join(' · '))),
      h('span', { class: 'spacer' }),
      tool('refresh-cw', 'Refresh now', () => { const id = this.getConn(); if (id) void window.termApi.monitorRefresh(id); }),
      tool('copy', 'Copy a text summary', () => { void navigator.clipboard.writeText(this.summary(s)); toast('success', 'Server summary copied'); }),
      tool('x', 'Close', () => this.closePanel()));

    const card = (title: string, ic: IconName, ...children: (Node | null)[]) => {
      const el = h('section', { class: 'mbp-card' }, h('h4', {}, icon(ic, 14), title));
      return put(el, ...children);
    };
    const kv = (k: string, v: string | Node) => h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'val' }, v));

    // CPU
    const cpuCard = card('CPU', 'cpu',
      h('div', { class: 'big-num' }, h('span', { class: lv(s.cpuPercent) }, s.cpuPercent === null ? '…' : pct(s.cpuPercent)), h('span', { class: 'unit' }, s.cores ? ` of ${s.cores} core${s.cores === 1 ? '' : 's'}` : '')),
      sparkline(this.cpuHistory, 240, 44),
      s.cpuModel ? kv('Model', s.cpuModel) : null,
      s.load ? kv('Load average', `${s.load[0]}  ${s.load[1]}  ${s.load[2]}`) : null);

    // Memory
    let memCard: HTMLElement | null = null;
    if (s.mem) {
      const m = s.mem;
      const usedP = (m.usedKb / m.totalKb) * 100;
      const cacheP = Math.min(100 - usedP, (m.cachedKb / m.totalKb) * 100);
      memCard = card('Memory', 'memory-stick',
        h('div', { class: 'big-num' }, h('span', { class: lv(usedP) }, pct(usedP)), h('span', { class: 'unit' }, ` ${formatKb(m.usedKb)} of ${formatKb(m.totalKb)}`)),
        meter([{ percent: usedP, cls: lv(usedP) }, { percent: cacheP, cls: 'cache' }]),
        kv('Cache and buffers', formatKb(m.cachedKb)),
        kv('Available', formatKb(m.availKb)),
        m.swapTotalKb ? kv('Swap', `${formatKb(m.swapUsedKb)} of ${formatKb(m.swapTotalKb)}`) : kv('Swap', 'none'),
        m.swapTotalKb ? meter([{ percent: (m.swapUsedKb / m.swapTotalKb) * 100, cls: lv((m.swapUsedKb / m.swapTotalKb) * 100) }]) : null);
    }

    // Network
    let netCard: HTMLElement | null = null;
    if (s.interfaces.length) {
      const table = h('table', { class: 'mbp-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Interface'), h('th', { class: 'r' }, 'Down'), h('th', { class: 'r' }, 'Up'), h('th', { class: 'r' }, 'Received'), h('th', { class: 'r' }, 'Sent'))),
        h('tbody', {}, ...s.interfaces.map((i) => h('tr', {}, h('td', {}, i.name), h('td', { class: 'r num' }, formatRate(i.rxBps)), h('td', { class: 'r num' }, formatRate(i.txBps)), h('td', { class: 'r num dim' }, formatBytes(i.rxTotal)), h('td', { class: 'r num dim' }, formatBytes(i.txTotal))))));
      netCard = card('Network', 'network', table);
    }

    // Disks
    let diskCard: HTMLElement | null = null;
    if (s.disks.length) {
      const table = h('table', { class: 'mbp-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Mount'), h('th', {}, 'Device'), h('th', { class: 'r' }, 'Used'), h('th', {}, ''), h('th', { class: 'r' }, ''))),
        h('tbody', {}, ...s.disks.map((d) => h('tr', {}, h('td', {}, d.mount), h('td', { class: 'dim' }, d.device), h('td', { class: 'r num' }, `${formatKb(d.usedKb)} / ${formatKb(d.totalKb)}`), h('td', { class: 'bar' }, meter([{ percent: d.percent, cls: lv(d.percent) }])), h('td', { class: `r num ${lv(d.percent)}` }, `${d.percent}%`)))));
      diskCard = card('Disks', 'hard-drive', table);
    }

    // Users
    const usersCard = card('Logged in', 'users',
      s.users.length ? h('div', { class: 'chips' }, ...s.users.map((u) => h('span', { class: 'chip' }, u.name, u.count > 1 ? h('em', {}, ` ×${u.count}`) : null))) : h('div', { class: 'dim' }, 'No sessions reported'),
      s.uptimeSec !== null ? kv('Uptime', formatUptime(s.uptimeSec)) : null);

    // Busiest processes (only sampled while this panel is open)
    let procCard: HTMLElement | null = null;
    if (s.processes && s.processes.length) {
      const table = h('table', { class: 'mbp-table' },
        h('thead', {}, h('tr', {}, h('th', { class: 'r' }, 'PID'), h('th', {}, 'User'), h('th', { class: 'r' }, 'CPU'), h('th', { class: 'r' }, 'Mem'), h('th', {}, 'Command'))),
        h('tbody', {}, ...s.processes.map((p) => h('tr', {}, h('td', { class: 'r num dim' }, String(p.pid)), h('td', {}, p.user), h('td', { class: `r num ${lv(p.cpu)}` }, `${p.cpu.toFixed(1)}%`), h('td', { class: 'r num' }, `${p.mem.toFixed(1)}%`), h('td', { class: 'cmd' }, p.command)))));
      procCard = card('Busiest processes', 'activity', table);
    }

    put(panel, head, h('div', { class: 'mbp-grid' }, cpuCard, memCard, usersCard, netCard), diskCard, procCard);
    panel.scrollTop = scroll;
  }
}
