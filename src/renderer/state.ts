import type { SessionSummary, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

/** Layout preferences that only matter to this window; kept in localStorage. */
export interface UiPrefs {
  sidebarWidth: number;
  sidebarOpen: boolean;
  sftpWidth: number;
  filesOpen: boolean;
  showHidden: boolean;
  collapsedFolders: string[];
  recent: Record<string, number>;
}

const KEY = 'nexterm.ui.v1';
const DEFAULTS: UiPrefs = {
  sidebarWidth: 280,
  sidebarOpen: true,
  sftpWidth: 340,
  filesOpen: true,
  showHidden: true,
  collapsedFolders: [],
  recent: {},
};

function loadPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<UiPrefs>) };
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return { ...DEFAULTS };
}

export const state = {
  settings: { ...DEFAULT_SETTINGS } as Settings,
  sessions: [] as SessionSummary[],
  prefs: loadPrefs(),
};

export function savePrefs(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state.prefs));
  } catch {
    /* ignore */
  }
}

export function touchRecent(sessionId: string): void {
  state.prefs.recent[sessionId] = Date.now();
  savePrefs();
}

export function recentSessions(limit = 5): SessionSummary[] {
  return state.sessions
    .filter((s) => state.prefs.recent[s.id])
    .sort((a, b) => state.prefs.recent[b.id] - state.prefs.recent[a.id])
    .slice(0, limit);
}

type Listener = () => void;
const listeners = new Set<Listener>();
export const onStateChange = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const emitChange = (): void => listeners.forEach((f) => f());

export function describeSession(s: Pick<SessionSummary, 'kind' | 'host' | 'port' | 'username' | 'serialPath' | 'baudRate' | 'shell'>): string {
  switch (s.kind) {
    case 'ssh':
      return `${s.username ? s.username + '@' : ''}${s.host}${s.port && s.port !== 22 ? ':' + s.port : ''}`;
    case 'telnet':
      return `${s.host}${s.port && s.port !== 23 ? ':' + s.port : ''}`;
    case 'serial':
      return `${s.serialPath} @ ${s.baudRate ?? 115200}`;
    case 'local':
      return s.shell || 'Default shell';
  }
}
