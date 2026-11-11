export type SessionKind = 'ssh' | 'telnet' | 'local' | 'serial';
export type AuthMethod = 'password' | 'key' | 'agent';

/** What the renderer sends when creating/editing a session. */
export interface SessionInput {
  id?: string;
  name: string;
  kind: SessionKind;
  folder?: string;
  host?: string;
  port?: number;
  username?: string;
  authMethod?: AuthMethod;
  /** undefined = keep stored value, null = clear, string = set (also used as key passphrase). */
  password?: string | null;
  keyPath?: string;
  shell?: string;
  serialPath?: string;
  baudRate?: number;
}

/** What the renderer receives: never contains secrets. */
export interface SessionSummary {
  id: string;
  name: string;
  kind: SessionKind;
  folder?: string;
  host?: string;
  port?: number;
  username?: string;
  authMethod?: AuthMethod;
  keyPath?: string;
  shell?: string;
  serialPath?: string;
  baudRate?: number;
  hasPassword: boolean;
}

export interface Settings {
  fontSize: number;
  /** First font family name; the renderer appends fallbacks. */
  fontFamily: string;
  theme: 'system' | 'dark' | 'light';
  scrollback: number;
  cursorBlink: boolean;
  cursorStyle: 'block' | 'bar' | 'underline';
}

export const DEFAULT_SETTINGS: Settings = {
  fontSize: 13,
  fontFamily: 'JetBrains Mono',
  theme: 'system',
  scrollback: 10000,
  cursorBlink: true,
  cursorStyle: 'bar',
};

export interface OpenRequest {
  sessionId?: string;
  /** Unsaved "quick connect" session. */
  quick?: SessionInput;
  /** One-off secret supplied at connect time (never persisted). */
  password?: string;
  cols: number;
  rows: number;
}

export interface OpenResult {
  connId: string;
  title: string;
  sftp: boolean;
}

export interface SftpEntry {
  name: string;
  isDir: boolean;
  isLink: boolean;
  size: number;
  mtimeMs: number;
  mode: number;
}

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
}
