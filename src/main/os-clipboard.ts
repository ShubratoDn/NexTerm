import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The most files taken from the clipboard in one paste. */
export const MAX_CLIPBOARD_FILES = 1000;

/** Local paths from a text/uri-list or "x-special/gnome-copied-files" clipboard text (Linux file managers). */
export function parseUriList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('file://')) continue; // skips comments, "copy" / "cut" markers and other schemes
    try {
      const p = fileURLToPath(line);
      if (path.isAbsolute(p)) out.push(p);
    } catch {
      /* a malformed URI is ignored */
    }
    if (out.length >= MAX_CLIPBOARD_FILES) break;
  }
  return out;
}

/** Local paths from the lines printed by the Windows reader, each one base64 of the UTF-8 path (safe for any file name). */
export function parseEncodedPaths(output: string): string[] {
  const out: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || !/^[A-Za-z0-9+/=]+$/.test(t)) continue;
    const p = Buffer.from(t, 'base64').toString('utf8');
    if (path.isAbsolute(p) && !p.includes('\0')) out.push(p);
    if (out.length >= MAX_CLIPBOARD_FILES) break;
  }
  return out;
}

const run = (cmd: string, args: string[], timeout = 8000): Promise<string> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => resolve(err ? '' : stdout));
  });

// Fixed script, nothing from the page or the clipboard is ever put into it. Each path is printed as base64 so that
// accents, spaces and other characters survive whatever code page the console uses.
const WINDOWS_READER = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
  [System.Windows.Forms.Clipboard]::GetFileDropList() | ForEach-Object { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_)) }
}`;

/**
 * The files and folders that the user copied in the system's file manager (Explorer, Files, Nautilus...).
 * Returns an empty list when the clipboard holds none, or when this platform cannot say.
 */
export async function readClipboardFiles(): Promise<string[]> {
  if (process.platform === 'win32') {
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return parseEncodedPaths(await run(ps, ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_READER]));
  }
  if (process.platform === 'linux') {
    // Wayland first, then X11; GNOME's own format carries the same URIs.
    const attempts: [string, string[]][] = [
      ['wl-paste', ['--no-newline', '--type', 'text/uri-list']],
      ['xclip', ['-selection', 'clipboard', '-o', '-t', 'text/uri-list']],
      ['wl-paste', ['--no-newline', '--type', 'x-special/gnome-copied-files']],
      ['xclip', ['-selection', 'clipboard', '-o', '-t', 'x-special/gnome-copied-files']],
    ];
    for (const [cmd, args] of attempts) {
      const files = parseUriList(await run(cmd, args, 3000));
      if (files.length) return files;
    }
  }
  return [];
}
