import { $, h } from './dom';
import { icon } from './icons';
import type { IconName } from './icons';

type Kind = 'info' | 'success' | 'error' | 'busy';
const ICONS: Record<Kind, IconName> = { info: 'info', success: 'circle-check', error: 'circle-alert', busy: 'loader-circle' };

export interface ToastHandle {
  update(kind: Kind, message: string, ms?: number): void;
  dismiss(): void;
}

export function toast(kind: Kind, message: string, opts: { action?: { label: string; run: () => void }; ms?: number } = {}): ToastHandle {
  const root = $('toasts');
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' });
  let timer: number | undefined;
  let gone = false;

  const dismiss = () => {
    if (gone) return;
    gone = true;
    window.clearTimeout(timer);
    el.remove();
  };
  const schedule = (k: Kind, ms?: number) => {
    window.clearTimeout(timer);
    if (k === 'busy') return;
    timer = window.setTimeout(dismiss, ms ?? (k === 'error' ? 9000 : 4000));
  };
  const render = (k: Kind, msg: string, withAction: boolean) => {
    el.className = `toast ${k}`;
    const ic = icon(ICONS[k], 18, k === 'busy' ? 'spin' : '');
    const parts: Node[] = [ic, h('div', { class: 'msg' }, msg)];
    if (withAction && opts.action) {
      parts.push(h('button', { class: 'act', onclick: () => { opts.action!.run(); dismiss(); } }, opts.action.label));
    }
    parts.push(h('button', { class: 'icon-btn', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: dismiss }, icon('x', 14)));
    el.replaceChildren(...parts);
  };

  render(kind, message, true);
  root.append(el);
  while (root.children.length > 4) root.firstElementChild?.remove();
  schedule(kind, opts.ms);

  return {
    update(k, msg, ms) {
      if (gone) return;
      render(k, msg, false);
      schedule(k, ms);
    },
    dismiss,
  };
}

/** Shows an indeterminate toast for a long task and resolves it to success/error. */
export async function withProgress<T>(message: string, task: () => Promise<T>, success: (r: T) => string): Promise<T | undefined> {
  const t = toast('busy', message);
  try {
    const r = await task();
    t.update('success', success(r));
    return r;
  } catch (e) {
    t.update('error', cleanError(e));
    return undefined;
  }
}

export function cleanError(e: unknown): string {
  // Electron prefixes remote errors with "Error invoking remote method '...': Error: ".
  return ((e as Error)?.message ?? String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
}
