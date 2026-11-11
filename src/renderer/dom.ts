type Child = Node | string | null | undefined | false;

/** Tiny DOM builder. Strings are always inserted as text, never as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el) {
      try {
        (el as unknown as Record<string, unknown>)[k] = v;
      } catch {
        el.setAttribute(k, String(v)); // read-only DOM property such as input.list
      }
    } else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** Like `parent.append(...)` but ignores null/undefined/false children. */
export function put<T extends Element>(parent: T, ...children: Child[]): T {
  for (const c of children) if (c) parent.append(c);
  return parent;
}

export function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}
