import { $, h } from './dom';
import { icon } from './icons';
import { formatBytes, formatDuration, formatRate } from '../shared/format';
import type { TransferProgress } from '../shared/types';

interface Card {
  el: HTMLElement;
  title: HTMLElement;
  fill: HTMLElement;
  line: HTMLElement;
  sub: HTMLElement;
}

const cards = new Map<number, Card>();

function create(p: TransferProgress): Card {
  const title = h('div', { class: 'tr-title' });
  const fill = h('div', { class: 'tr-fill' });
  const line = h('div', { class: 'tr-line' });
  const sub = h('div', { class: 'tr-sub' });
  const bar = h('div', { class: 'tr-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
  const el = h('div', { class: 'toast transfer', role: 'status' },
    icon(p.direction === 'upload' ? 'upload' : 'download', 18),
    h('div', { class: 'msg' }, title, bar, line, sub));
  return { el, title, fill, line, sub };
}

function paint(c: Card, p: TransferProgress): void {
  const verb = p.direction === 'upload' ? 'Uploading' : 'Downloading';
  c.title.textContent = `${verb} ${p.title}`;
  const known = p.totalBytes > 0;
  const pct = known ? Math.min(100, (p.doneBytes / p.totalBytes) * 100) : 0;
  const indeterminate = p.state === 'preparing' || !known;
  c.el.classList.toggle('indeterminate', indeterminate);
  c.fill.style.width = indeterminate ? '' : `${pct.toFixed(1)}%`;
  const bar = c.fill.parentElement!;
  if (indeterminate) bar.removeAttribute('aria-valuenow');
  else bar.setAttribute('aria-valuenow', String(Math.round(pct)));

  if (p.state === 'preparing') {
    c.line.textContent = 'Preparing…';
  } else if (!known) {
    c.line.textContent = `${formatBytes(p.doneBytes)} · ${formatRate(p.speed)}`;
  } else {
    const parts = [`${formatBytes(p.doneBytes)} of ${formatBytes(p.totalBytes)}`, `${Math.floor(pct)}%`, formatRate(p.speed)];
    if (p.etaSec !== null && p.doneBytes < p.totalBytes) parts.push(`${formatDuration(p.etaSec)} left`);
    c.line.textContent = parts.join(' · ');
  }
  c.sub.textContent = p.filesTotal > 1 ? `File ${Math.min(p.filesDone + 1, p.filesTotal)} of ${p.filesTotal}${p.current ? ` · ${p.current}` : ''}` : '';
  c.sub.hidden = !c.sub.textContent;
}

/** Shows live progress for every upload and download until it finishes. Call once at startup. */
export function initTransfers(): void {
  const root = $('toasts');
  window.termApi.onTransfer((p) => {
    let c = cards.get(p.id);
    if (p.state === 'done' || p.state === 'error') {
      c?.el.remove();
      cards.delete(p.id);
      return; // the caller shows the result
    }
    if (!c) {
      c = create(p);
      cards.set(p.id, c);
    }
    if (!c.el.isConnected) root.prepend(c.el); // the toast limit may have removed it
    paint(c, p);
  });
}
