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
