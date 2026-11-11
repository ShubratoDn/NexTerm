// Builds a portable, unpacked application folder for the current platform into ./release.
// Usage: npm run package
import { packager } from '@electron/packager';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const platform = process.platform;
const iconFile = platform === 'win32' ? 'assets/icon.ico' : platform === 'darwin' ? 'assets/icon.icns' : 'assets/icon.png';

const out = await packager({
  dir: '.',
  name: 'NexTerm',
  out: 'release',
  overwrite: true,
  prune: true,
  // Native add-ons (node-pty, serialport) are loaded from disk, so the app is not packed into an asar archive.
  asar: false,
  platform,
  arch: process.arch,
  appCopyright: 'Copyright (c) 2026 Shubrato Debnath',
  // Shown in the executable's Properties dialog (instead of Electron's defaults).
  win32metadata: {
    CompanyName: 'Shubrato Debnath',
    FileDescription: 'NexTerm',
    ProductName: 'NexTerm',
    InternalName: 'NexTerm',
    OriginalFilename: 'NexTerm.exe',
  },
  ...(existsSync(iconFile) ? { icon: iconFile } : {}),
  ignore: [/^\/(src|scripts|docs|release|\.github)(\/|$)/, /^\/tsconfig.*\.json$/, /^\/(README|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)\.md$/, /^\/\.[^/]+$/, /\.map$/],
});

// The interface is English-only, so Chromium's 55 translation files (~49 MB) are dead weight.
// Chromium falls back to en-US when a locale file is missing.
for (const dir of out) {
  const locales = join(dir, 'locales');
  if (!existsSync(locales)) continue; // macOS keeps its locales inside the .app bundle
  for (const file of readdirSync(locales)) {
    if (file.endsWith('.pak') && file !== 'en-US.pak') rmSync(join(locales, file));
  }
}

console.log(`Packaged to: ${out.join(', ')}`);
