import path from 'node:path';
import type { ImportedSession } from '../../shared/types';
import { addUnsupported, emptyResult, toPort } from './common';
import type { ParseResult } from './common';

/**
 * Reads the session list of a MobaXterm settings file (MobaXterm.ini) or a session export (.mxtsessions).
 *
 * Layout, as observed in real files:
 *   [Bookmarks] / [Bookmarks_N]      one section per folder; SubRep=<folder path>, ImgNum=<icon>
 *   <name>=#<icon>#<type>%<host>%<port>%<user>%...%<key file>%...
 * Only host, port, user, key file path and folder are read. Passwords live in other, protected sections
 * that this importer never touches.
 */

/** Session type numbers used by MobaXterm. */
const TYPE_NAMES: Record<number, string> = {
  2: 'Rsh',
  3: 'XDMCP',
  4: 'RDP',
  5: 'VNC',
  6: 'FTP',
  9: 'File',
  10: 'Shell',
  11: 'Browser',
  12: 'Mosh',
  13: 'AWS S3',
  14: 'WSL',
};

export interface MobaOptions {
  /** Used to expand MobaXterm path variables such as _ProfileDir_. Defaults to the current user's profile. */
  profileDir?: string;
  /** Drive used for _CurrentDrive_; defaults to the drive of the file being read. */
  currentDrive?: string;
}

/** Expands the path variables MobaXterm writes into key file locations. */
export function expandMobaPath(p: string, opts: MobaOptions): string {
  const profile = opts.profileDir ?? process.env.USERPROFILE ?? process.env.HOME ?? '';
  const drive = opts.currentDrive ?? 'C:';
  return p
    .replace(/_CurrentDrive_:?/gi, drive)
    .replace(/_(ProfileDir|HomeDir|UserProfile)_/gi, profile)
    .replace(/_MyDocuments_/gi, path.join(profile, 'Documents'))
    .replace(/_Desktop_/gi, path.join(profile, 'Desktop'));
}

const looksLikeKeyPath = (f: string) => /\.(ppk|pem|key|pub)$/i.test(f) || /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)[\w.-]*$/i.test(f);

export function parseMobaXterm(text: string, opts: MobaOptions = {}): ParseResult {
  const result = emptyResult();
  let inBookmarks = false;
  let folder = '';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '');
    const section = /^\[(.+)\]\s*$/.exec(line);
    if (section) {
      inBookmarks = section[1] === 'Bookmarks' || /^Bookmarks_\d+$/.test(section[1]);
      folder = '';
      continue;
    }
    if (!inBookmarks) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trimStart();

    if (key === 'SubRep') {
      // "Work\Servers" becomes "Work / Servers"
      folder = value.split(/[\\/]/).map((p) => p.trim()).filter(Boolean).join(' / ');
      continue;
    }
    if (key === 'ImgNum') continue;

    const m = /^#(\d+)#(\d+)%(.*)$/s.exec(value);
    if (!m) continue; // not a session entry
    const type = Number(m[2]);
    const f = m[3].split('%');
    const name = key;
    const base = { name, ...(folder ? { folder } : {}) };

    if (type === 0 || type === 7) {
      const host = f[0]?.trim();
      if (!host) {
        addUnsupported(result, 'Incomplete entries (no host name)');
        continue;
      }
      const s: ImportedSession = { ...base, kind: type === 0 ? 'ssh' : 'sftp', host, port: toPort(f[1]) ?? 22, authMethod: 'password' };
      if (f[2]?.trim()) s.username = f[2].trim();
      // MobaXterm keeps the private key in a fixed slot; any path-like value there counts, even without an extension.
      const slot = (f[13] ?? '').trim();
      const keyField = slot && (/[\\/]/.test(slot) || looksLikeKeyPath(slot)) ? slot : f.find((x) => x && looksLikeKeyPath(x));
      if (keyField) {
        s.keyPath = expandMobaPath(keyField.trim(), opts);
        s.authMethod = 'key';
      }
      result.sessions.push(s);
    } else if (type === 1) {
      const host = f[0]?.trim();
      if (!host) {
        addUnsupported(result, 'Incomplete entries (no host name)');
        continue;
      }
      result.sessions.push({ ...base, kind: 'telnet', host, port: toPort(f[1]) ?? 23 });
    } else if (type === 8) {
      const serialPath = f[0]?.trim();
      if (!serialPath) {
        addUnsupported(result, 'Incomplete entries (no serial port)');
        continue;
      }
      result.sessions.push({ ...base, kind: 'serial', serialPath, baudRate: Number(f[1]) > 0 ? Number(f[1]) : 115200 });
    } else {
      addUnsupported(result, `${TYPE_NAMES[type] ?? `Other (type ${type})`} sessions`);
    }
  }
  return result;
}
