/**
 * Zooming with Ctrl + mouse wheel (or Ctrl + and Ctrl -).
 *
 * - Over the terminal or the file browser ("content"): only those two change size.
 * - Anywhere else ("interface"): the interface font size changes, and the terminal follows by the same amount,
 *   so everything stays in proportion. The file browser follows the interface size on its own.
 */
export type ZoomRegion = 'content' | 'interface';

export interface ZoomState {
  /** Terminal font size. */
  fontSize: number;
  /** Interface font size. */
  uiFontSize: number;
  /** File browser size relative to the interface size (it is bigger or smaller than the interface by this much). */
  filesFontOffset: number;
}

export const ZOOM_DEFAULT: ZoomState = { fontSize: 13, uiFontSize: 13, filesFontOffset: 0 };
export const TERMINAL_RANGE = [8, 32] as const;
export const UI_RANGE = [10, 20] as const;
export const FILES_RANGE = [9, 26] as const;

const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/** Size of the file browser text in pixels. */
export const filesFontSize = (uiFontSize: number, offset: number): number => clamp(uiFontSize + offset, FILES_RANGE);

export function nextZoom(cur: ZoomState, delta: number | 'reset', region: ZoomRegion): ZoomState {
  if (delta === 'reset') return { ...ZOOM_DEFAULT };
  if (region === 'content') {
    const files = clamp(filesFontSize(cur.uiFontSize, cur.filesFontOffset) + delta, FILES_RANGE);
    return { ...cur, fontSize: clamp(cur.fontSize + delta, TERMINAL_RANGE), filesFontOffset: files - cur.uiFontSize };
  }
  const ui = clamp(cur.uiFontSize + delta, UI_RANGE);
  const actual = ui - cur.uiFontSize;
  if (actual === 0) return cur; // already at the limit: the terminal must not drift away from the interface
  return { ...cur, uiFontSize: ui, fontSize: clamp(cur.fontSize + actual, TERMINAL_RANGE) };
}
