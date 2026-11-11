import type { AuthMethod, SessionInput, SessionKind, Settings } from '../shared/types';

const KINDS: SessionKind[] = ['ssh', 'sftp', 'telnet', 'local', 'serial'];
const isSsh = (k: SessionKind) => k === 'ssh' || k === 'sftp';
const AUTHS: AuthMethod[] = ['password', 'key', 'agent'];

function str(v: unknown, field: string, max: number, required = false): string | undefined {
  if (v === undefined || v === null || v === '') {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw new Error(`${field} must be a string`);
  if (v.length > max) throw new Error(`${field} is too long`);
  if (v.includes('\0')) throw new Error(`${field} contains invalid characters`);
  return v;
}

function int(v: unknown, field: string, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return v;
}

export function parseSessionInput(x: unknown): SessionInput {
  if (typeof x !== 'object' || x === null) throw new Error('invalid session');
  const o = x as Record<string, unknown>;
  const kind = o.kind as SessionKind;
  if (!KINDS.includes(kind)) throw new Error('invalid session type');

  const out: SessionInput = {
    id: str(o.id, 'id', 64),
    name: str(o.name, 'name', 100, true)!,
    kind,
    folder: str(o.folder, 'folder', 100),
  };

  if (isSsh(kind) || kind === 'telnet') {
    out.host = str(o.host, 'host', 255, true)!.trim();
    if (/\s/.test(out.host)) throw new Error('host must not contain spaces');
    out.port = int(o.port, 'port', 1, 65535) ?? (kind === 'telnet' ? 23 : 22);
  }
  if (isSsh(kind)) {
    out.username = str(o.username, 'username', 128);
    const auth = (o.authMethod ?? 'password') as AuthMethod;
    if (!AUTHS.includes(auth)) throw new Error('invalid authentication method');
    out.authMethod = auth;
    out.keyPath = str(o.keyPath, 'keyPath', 1024);
    if (auth === 'key' && !out.keyPath) throw new Error('private key path is required');
  }
  if (isSsh(kind)) {
    if (o.password === null) out.password = null;
    else out.password = str(o.password, 'password', 1024);
  }
  if (kind === 'local') out.shell = str(o.shell, 'shell', 1024);
  if (kind === 'serial') {
    out.serialPath = str(o.serialPath, 'serialPath', 256, true);
    out.baudRate = int(o.baudRate, 'baudRate', 50, 4_000_000) ?? 115200;
  }
  return out;
}

export function parseSettingsPatch(x: unknown): Partial<Settings> {
  if (typeof x !== 'object' || x === null) throw new Error('invalid settings');
  const o = x as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (o.fontSize !== undefined) out.fontSize = int(o.fontSize, 'fontSize', 6, 72);
  if (o.scrollback !== undefined) out.scrollback = int(o.scrollback, 'scrollback', 0, 1_000_000);
  if (o.fontFamily !== undefined) out.fontFamily = str(o.fontFamily, 'fontFamily', 200, true);
  if (o.theme !== undefined) {
    if (o.theme !== 'dark' && o.theme !== 'light' && o.theme !== 'system') throw new Error('invalid theme');
    out.theme = o.theme;
  }
  if (o.cursorStyle !== undefined) {
    if (o.cursorStyle !== 'block' && o.cursorStyle !== 'bar' && o.cursorStyle !== 'underline') {
      throw new Error('invalid cursor style');
    }
    out.cursorStyle = o.cursorStyle;
  }
  if (o.cursorBlink !== undefined) {
    if (typeof o.cursorBlink !== 'boolean') throw new Error('invalid cursorBlink');
    out.cursorBlink = o.cursorBlink;
  }
  return out;
}

export function checkSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const c = int(cols, 'cols', 1, 1000);
  const r = int(rows, 'rows', 1, 1000);
  if (c === undefined || r === undefined) throw new Error('invalid terminal size');
  return { cols: c, rows: r };
}
