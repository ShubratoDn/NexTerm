export type SessionKind = 'ssh' | 'sftp' | 'telnet' | 'local' | 'serial';
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

/* ------------------------------------------------------------------ importing existing connections */

export type ImportSourceId = 'mobaxterm' | 'putty' | 'openssh';

/** A connection read from another tool. Never carries a secret. */
export interface ImportedSession {
  name: string;
  kind: SessionKind;
  folder?: string;
  host?: string;
  port?: number;
  username?: string;
  authMethod?: AuthMethod;
  keyPath?: string;
  serialPath?: string;
  baudRate?: number;
}

export interface ImportLocation {
  /** Absolute file path, or the literal "registry" for the Windows registry. */
  path: string;
  label: string;
  count: number;
}

export interface ImportSourceInfo {
  id: ImportSourceId;
  label: string;
  description: string;
  found: ImportLocation[];
  /** Whether the user can pick a file by hand. */
  canBrowse: boolean;
}

export interface ImportPreviewItem extends ImportedSession {
  /** Already saved in NexTerm (same type, host, port and user). */
  duplicate: boolean;
  /** The referenced private key file does not exist on this computer. */
  keyMissing: boolean;
}

export interface ImportPreview {
  source: ImportSourceId;
  path: string;
  sessions: ImportPreviewItem[];
  /** Entries that cannot be imported, grouped by reason. */
  unsupported: { label: string; count: number }[];
  /** Imported entries that may need attention. */
  notes: { label: string; count: number }[];
}

export interface ImportResult {
  added: number;
  skipped: number;
}