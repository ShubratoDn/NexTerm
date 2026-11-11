import type { ITheme } from '@xterm/xterm';
import type { Settings } from '../shared/types';

export type Resolved = 'dark' | 'light';

export function resolveTheme(pref: Settings['theme']): Resolved {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const DARK: ITheme = {
  background: '#14151a', foreground: '#d7dae0', cursor: '#d7dae0', cursorAccent: '#14151a', selectionBackground: '#3a4a6e',
  black: '#1d1f27', red: '#e06c75', green: '#7fc57a', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5c6370', brightRed: '#ef7b85', brightGreen: '#98d68f', brightYellow: '#f0d08a', brightBlue: '#7bbcf5', brightMagenta: '#d68ae8', brightCyan: '#6ac6d1', brightWhite: '#e6e9ef',
};

const LIGHT: ITheme = {
  background: '#fbfbfc', foreground: '#24292f', cursor: '#24292f', cursorAccent: '#fbfbfc', selectionBackground: '#b6d0ff',
  black: '#24292f', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
  brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#2da44e', brightYellow: '#bf8700', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
};

export const termTheme = (r: Resolved): ITheme => (r === 'dark' ? DARK : LIGHT);

const TITLEBAR = { dark: ['#17181b', '#e3e5e9'], light: ['#eceef2', '#1c1e23'] } as const;

export function fontStack(name: string): string {
  const clean = name.replace(/["\\]/g, '');
  return `"${clean}", "JetBrains Mono", "Cascadia Mono", Consolas, Menlo, monospace`;
}

export function applyTheme(pref: Settings['theme']): Resolved {
  const r = resolveTheme(pref);
  document.documentElement.dataset.theme = r;
  document.documentElement.dataset.platform = window.termApi.platform;
  const [bg, fg] = TITLEBAR[r];
  window.termApi.setTitleBar(bg, fg);
  return r;
}
