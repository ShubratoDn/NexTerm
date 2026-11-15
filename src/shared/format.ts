/** Kibibytes (what /proc and df report) as "4.96 GB", "512 MB" or "300 KB". */
export function formatKb(kb: number): string {
  if (!Number.isFinite(kb) || kb < 0) return '–';
  if (kb >= 1024 * 1024 * 1024) return `${(kb / 1024 / 1024 / 1024).toFixed(2)} TB`;
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  if (kb >= 1024) return `${Math.round(kb / 1024)} MB`;
  return `${Math.round(kb)} KB`;
}

/** Bytes as "1.5 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? Math.round(v) : v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${units[i]}`;
}

/** Bytes per second as "12 KB/s"; null (no sample yet) as a dash. */
export function formatRate(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps)) return '–';
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(bps < 10 * 1024 ? 1 : 0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(2)} MB/s`;
}

/** Seconds of uptime as "25 days", "3 h 12 min" or "12 min". */
export function formatUptime(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '–';
  const days = Math.floor(sec / 86400);
  if (days >= 1) return `${days} ${days === 1 ? 'day' : 'days'}`;
  const hours = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  return hours >= 1 ? `${hours} h ${mins} min` : `${Math.max(mins, 0)} min`;
}

export type Level = 'ok' | 'warn' | 'bad';

/** Colour band for a usage percentage. */
export function levelFor(percent: number | null): Level {
  if (percent === null) return 'ok';
  return percent >= 90 ? 'bad' : percent >= 75 ? 'warn' : 'ok';
}

/* ---------- permissions ---------- */

/** A Unix mode as "drwxr-xr-x" (type letter first). */
export function modeToSymbolic(mode: number, kind: 'file' | 'dir' | 'link' = 'file'): string {
  const bits = 'rwxrwxrwx';
  let out = kind === 'dir' ? 'd' : kind === 'link' ? 'l' : '-';
  for (let i = 0; i < 9; i++) out += mode & (1 << (8 - i)) ? bits[i] : '-';
  const chars = out.split('');
  if (mode & 0o4000) chars[3] = chars[3] === 'x' ? 's' : 'S'; // setuid
  if (mode & 0o2000) chars[6] = chars[6] === 'x' ? 's' : 'S'; // setgid
  if (mode & 0o1000) chars[9] = chars[9] === 'x' ? 't' : 'T'; // sticky
  return chars.join('');
}

/** "755" or "0644" as a number; null when it is not 1 to 4 octal digits. */
export function parseOctalMode(text: string): number | null {
  const t = text.trim();
  if (!/^[0-7]{1,4}$/.test(t)) return null;
  return parseInt(t, 8);
}

export const formatOctal = (mode: number): string => (mode & 0o7777).toString(8).padStart(4, '0');

/** Quotes a path so a POSIX shell (and fish) reads it as one literal word. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** "45 s", "3 min 20 s", "1 h 05 min": a time left, short enough for a progress line. */
export function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '–';
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
