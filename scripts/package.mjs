// Builds a portable, unpacked application folder for the current platform into ./release.
// Usage: npm run package
import { packager } from '@electron/packager';
import { existsSync } from 'node:fs';

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
  ...(existsSync(iconFile) ? { icon: iconFile } : {}),
  ignore: [/^\/(src|scripts|docs|release|\.github)(\/|$)/, /^\/tsconfig.*\.json$/, /^\/(README|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY)\.md$/, /^\/\.[^/]+$/, /\.map$/],
});

console.log(`Packaged to: ${out.join(', ')}`);
