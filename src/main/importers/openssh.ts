import os from 'node:os';
import path from 'node:path';
import type { ImportedSession } from '../../shared/types';
import { addNote, emptyResult, toPort } from './common';
import type { ParseResult } from './common';

/**
 * Reads an OpenSSH client configuration (~/.ssh/config). Every concrete `Host` alias becomes an SSH session.
 * Wildcard patterns (`Host *`, `Host *.example.com`) are not sessions; `Host *` values are used as defaults.
 */
export function parseOpenSshConfig(text: string, home = os.homedir()): ParseResult {
  const result = emptyResult();

  interface Block {
    aliases: string[];
    opts: Record<string, string>;
  }
  const blocks: Block[] = [];
  let current: Block | null = null;
  let inMatch = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(\S+?)\s*(?:=|\s)\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim().replace(/^"(.*)"$/, '$1');

    if (key === 'host') {
      inMatch = false;
      current = { aliases: value.split(/\s+/), opts: {} };
      blocks.push(current);
    } else if (key === 'match') {
      inMatch = true; // conditional blocks are not supported
      current = null;
    } else if (current && !inMatch && !(key in current.opts)) {
      current.opts[key] = value; // OpenSSH uses the first value it finds
    }
  }

  const defaults = blocks.find((b) => b.aliases.includes('*'))?.opts ?? {};
  const expandHome = (p: string) => (p.startsWith('~') ? path.join(home, p.slice(1)) : p);

  for (const block of blocks) {
    for (const alias of block.aliases) {
      if (/[*?!]/.test(alias)) continue;
      const o = { ...defaults, ...block.opts };
      const host = (o.hostname ?? alias).replace(/%h/g, alias);
      const s: ImportedSession = { name: alias, kind: 'ssh', host, port: toPort(o.port) ?? 22, authMethod: 'password' };
      if (o.user) s.username = o.user;
      if (o.identityfile) {
        s.keyPath = expandHome(o.identityfile.replace(/%d/g, home));
        s.authMethod = 'key';
      }
      if (o.proxyjump || o.proxycommand) addNote(result, 'Sessions that use a jump host or proxy: imported without it, so they may not connect');
      result.sessions.push(s);
    }
  }
  return result;
}
