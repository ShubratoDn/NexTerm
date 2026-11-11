import type { SessionKind } from './types';

export interface QuickTarget {
  host: string;
  port?: number;
  username?: string;
}

/**
 * Parses "user@host:port", "host", "[::1]:2222" or "user@[fe80::1]". Returns null when it is not a usable address.
 * A bare IPv6 address (several colons, no brackets) is treated as a host without port.
 */
export function parseQuickTarget(input: string): QuickTarget | null {
  let s = input.trim();
  if (!s || /\s/.test(s)) return null;
  let username: string | undefined;
  const at = s.lastIndexOf('@');
  if (at >= 0) {
    username = s.slice(0, at) || undefined;
    s = s.slice(at + 1);
    if (!username) return null;
  }
  let host = s;
  let port: number | undefined;
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(s);
  if (bracket) {
    host = bracket[1];
    if (bracket[2]) port = Number(bracket[2]);
  } else if ((s.match(/:/g) ?? []).length === 1) {
    const [h, p] = s.split(':');
    host = h;
    if (!/^\d+$/.test(p)) return null;
    port = Number(p);
  }
  if (!host) return null;
  if (port !== undefined && (port < 1 || port > 65535)) return null;
  return { host, port, username };
}

export function defaultPort(kind: SessionKind): number | undefined {
  return kind === 'ssh' ? 22 : kind === 'telnet' ? 23 : undefined;
}
