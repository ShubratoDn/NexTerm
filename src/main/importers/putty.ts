import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ImportedSession } from '../../shared/types';
import { addUnsupported, emptyResult, splitUserHost, toPort } from './common';
import type { ParseResult } from './common';

/** PuTTY escapes unusual characters in session names as %XX. */
export function decodePuttyName(s: string): string {
  return s.replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

type Settings = Record<string, string>;

/** Converts one PuTTY session (already reduced to key/value pairs) into a NexTerm session. */
export function puttySession(rawName: string, kv: Settings, result: ParseResult): void {
  const full = decodePuttyName(rawName);
  if (!full || full === 'Default Settings') return;
  const slash = full.lastIndexOf('/');
  const folder = slash > 0 ? full.slice(0, slash).split('/').filter(Boolean).join(' / ') : undefined;
  const name = slash > 0 ? full.slice(slash + 1) : full;
  const base = { name: name || full, ...(folder ? { folder } : {}) };
  const protocol = (kv.Protocol ?? 'ssh').toLowerCase();

  if (protocol === 'ssh' || protocol === 'telnet') {
    const { host, username: inlineUser } = splitUserHost(kv.HostName ?? '');
    if (!host) {
      addUnsupported(result, 'Incomplete entries (no host name)');
      return;
    }
    const s: ImportedSession = { ...base, kind: protocol, host, port: toPort(kv.PortNumber) ?? (protocol === 'ssh' ? 22 : 23) };
    if (protocol === 'ssh') {
      const username = (kv.UserName ?? '').trim() || inlineUser;
      if (username) s.username = username;
      s.authMethod = 'password';
      if (kv.PublicKeyFile?.trim()) {
        s.keyPath = kv.PublicKeyFile.trim();
        s.authMethod = 'key';
      }
    }
    result.sessions.push(s);
  } else if (protocol === 'serial') {
    const serialPath = (kv.SerialLine ?? '').trim();
    if (!serialPath) {
      addUnsupported(result, 'Incomplete entries (no serial port)');
      return;
    }
    const baud = Number(kv.SerialSpeed);
    result.sessions.push({ ...base, kind: 'serial', serialPath, baudRate: baud > 0 ? baud : 9600 });
  } else {
    addUnsupported(result, `${protocol || 'unknown'} sessions`);
  }
}

/** Parses the output of: reg query HKCU\Software\SimonTatham\PuTTY\Sessions /s */
export function parsePuttyRegQuery(text: string): ParseResult {
  const result = emptyResult();
  let name: string | null = null;
  let kv: Settings = {};
  const flush = () => {
    if (name !== null) puttySession(name, kv, result);
    kv = {};
  };

  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) {
      flush();
      const parts = line.trim().split('\\');
      // ...\PuTTY\Sessions\<name>
      const idx = parts.findIndex((p) => p.toLowerCase() === 'sessions');
      name = idx >= 0 && parts.length > idx + 1 ? parts.slice(idx + 1).join('\\') : null;
      continue;
    }
    const m = /^\s+(\S+)\s+REG_(\w+)\s*(.*)$/.exec(line);
    if (!m || name === null) continue;
    const [, key, type, valueRaw] = m;
    const value = valueRaw.trim();
    kv[key] = type === 'DWORD' && /^0x[0-9a-f]+$/i.test(value) ? String(parseInt(value, 16)) : value;
  }
  flush();
  return result;
}

/** Parses the per-session files PuTTY uses on Linux and macOS (~/.putty/sessions/<name>). */
export function parsePuttySessionFile(name: string, text: string, result: ParseResult = emptyResult()): ParseResult {
  const kv: Settings = {};
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq > 0) kv[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  puttySession(name, kv, result);
  return result;
}

const REG_KEY = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions';

function regQuery(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', REG_KEY, '/s'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
      resolve(err ? null : Buffer.from(stdout).toString('latin1'));
    });
  });
}

const sessionsDir = () => path.join(os.homedir(), '.putty', 'sessions');

/** Loads PuTTY sessions from the registry (Windows) or the sessions folder (Linux / macOS). */
export async function loadPutty(): Promise<ParseResult | null> {
  if (process.platform === 'win32') {
    const out = await regQuery();
    return out === null ? null : parsePuttyRegQuery(out);
  }
  const dir = sessionsDir();
  if (!fs.existsSync(dir)) return null;
  const result = emptyResult();
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile() && fs.statSync(p).size < 64 * 1024) parsePuttySessionFile(f, fs.readFileSync(p, 'utf8'), result);
  }
  return result;
}
