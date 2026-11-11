import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ImportLocation, ImportPreview, ImportSourceId, ImportSourceInfo } from '../../shared/types';
import { MAX_IMPORT_BYTES, notesList, sessionKey, unsupportedList } from './common';
import type { ParseResult } from './common';
import { expandMobaPath, parseMobaXterm } from './mobaxterm';
import { parseOpenSshConfig } from './openssh';
import { loadPutty } from './putty';

export const REGISTRY = 'registry';

function readText(file: string): string {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('Not a file');
  if (stat.size > MAX_IMPORT_BYTES) throw new Error('The file is too large to be a connection list');
  const buf = fs.readFileSync(file);
  const utf8 = buf.toString('utf8');
  // MobaXterm writes legacy code pages on some systems; fall back when the bytes are not valid UTF-8.
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

/** Reads and parses one source. The caller must already have checked that `p` is an allowed location. */
export async function loadSource(source: ImportSourceId, p: string): Promise<ParseResult> {
  switch (source) {
    case 'mobaxterm': {
      const drive = path.parse(path.resolve(p)).root.replace(/[\\/]+$/, '');
      return parseMobaXterm(readText(p), { currentDrive: drive || undefined });
    }
    case 'openssh':
      return parseOpenSshConfig(readText(p));
    case 'putty': {
      if (p !== REGISTRY) throw new Error('PuTTY sessions are read from the system, not from a file');
      const r = await loadPutty();
      if (!r) throw new Error('No PuTTY sessions were found on this computer');
      return r;
    }
  }
}

export function buildPreview(source: ImportSourceId, p: string, result: ParseResult, existing: Set<string>): ImportPreview {
  return {
    source,
    path: p,
    sessions: result.sessions.map((s) => ({
      ...s,
      duplicate: existing.has(sessionKey(s)),
      keyMissing: !!s.keyPath && !fs.existsSync(s.keyPath),
    })),
    unsupported: unsupportedList(result),
    notes: notesList(result),
  };
}

function candidates(): { source: 'mobaxterm' | 'openssh'; file: string; label: string }[] {
  const env = process.env;
  const home = os.homedir();
  const list: { source: 'mobaxterm' | 'openssh'; file: string; label: string }[] = [];
  if (process.platform === 'win32') {
    const moba = [
      [path.join(env.APPDATA ?? '', 'MobaXterm', 'MobaXterm.ini'), 'MobaXterm (installed edition)'],
      [path.join(env.ProgramFiles ?? '', 'Mobatek', 'MobaXterm', 'MobaXterm.ini'), 'MobaXterm (Program Files)'],
      [path.join(env['ProgramFiles(x86)'] ?? '', 'Mobatek', 'MobaXterm', 'MobaXterm.ini'), 'MobaXterm (Program Files x86)'],
      [path.join(home, 'Documents', 'MobaXterm', 'MobaXterm.ini'), 'MobaXterm (Documents)'],
    ];
    for (const [file, label] of moba) if (env.APPDATA || env.ProgramFiles) list.push({ source: 'mobaxterm', file, label });
  }
  list.push({ source: 'openssh', file: path.join(home, '.ssh', 'config'), label: 'OpenSSH config' });
  return list;
}

/** Finds importable connection lists on this computer. Reads only the connection fields, never secrets. */
export async function detectSources(allow: (p: string) => void): Promise<ImportSourceInfo[]> {
  const info: Record<ImportSourceId, ImportSourceInfo> = {
    mobaxterm: { id: 'mobaxterm', label: 'MobaXterm', description: 'Sessions from MobaXterm.ini or an exported .mxtsessions file', found: [], canBrowse: true },
    putty: { id: 'putty', label: 'PuTTY', description: 'Saved sessions from PuTTY', found: [], canBrowse: false },
    openssh: { id: 'openssh', label: 'OpenSSH config', description: 'Hosts from ~/.ssh/config', found: [], canBrowse: true },
  };

  for (const c of candidates()) {
    try {
      if (!fs.existsSync(c.file)) continue;
      const result = await loadSource(c.source, c.file);
      if (result.sessions.length === 0) continue;
      allow(c.file);
      info[c.source].found.push({ path: c.file, label: c.label, count: result.sessions.length } satisfies ImportLocation);
    } catch {
      /* unreadable candidate: treat as not found */
    }
  }

  try {
    const r = await loadPutty();
    if (r && r.sessions.length > 0) {
      info.putty.found.push({ path: REGISTRY, label: process.platform === 'win32' ? 'PuTTY (Windows registry)' : 'PuTTY (~/.putty/sessions)', count: r.sessions.length });
    }
  } catch {
    /* PuTTY not installed */
  }

  return [info.mobaxterm, info.putty, info.openssh];
}

export { expandMobaPath, sessionKey };
