import type { ImportedSession, SessionKind } from '../../shared/types';

export interface ParseResult {
  sessions: ImportedSession[];
  /** Entries that cannot be imported, keyed by a human-readable reason. */
  unsupported: Map<string, number>;
  /** Heads-ups about sessions that are imported but may need attention. */
  notes: Map<string, number>;
}

export const emptyResult = (): ParseResult => ({ sessions: [], unsupported: new Map(), notes: new Map() });

export function addUnsupported(r: ParseResult, reason: string): void {
  r.unsupported.set(reason, (r.unsupported.get(reason) ?? 0) + 1);
}

export function addNote(r: ParseResult, note: string): void {
  r.notes.set(note, (r.notes.get(note) ?? 0) + 1);
}

const toList = (m: Map<string, number>) => [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
export const unsupportedList = (r: ParseResult) => toList(r.unsupported);
export const notesList = (r: ParseResult) => toList(r.notes);

/** Two sessions are "the same" when they reach the same endpoint as the same user. */
export function sessionKey(s: { kind: SessionKind; host?: string; port?: number; username?: string; serialPath?: string }): string {
  if (s.kind === 'serial') return `serial|${(s.serialPath ?? '').toLowerCase()}`;
  const port = s.port ?? (s.kind === 'telnet' ? 23 : 22);
  return `${s.kind}|${(s.host ?? '').toLowerCase()}|${port}|${(s.username ?? '').toLowerCase()}`;
}

/** Splits "user@host" into its parts; a missing or empty user part yields undefined. */
export function splitUserHost(value: string): { host: string; username?: string } {
  const at = value.lastIndexOf('@');
  if (at <= 0) return { host: value.trim() };
  return { username: value.slice(0, at).trim() || undefined, host: value.slice(at + 1).trim() };
}

export const toPort = (v: string | undefined): number | undefined => {
  if (!v || !/^\d+$/.test(v.trim())) return undefined;
  const n = Number(v);
  return n >= 1 && n <= 65535 ? n : undefined;
};

/** Reads a short text file; refuses anything unreasonably large. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
