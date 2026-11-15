// Builds the Windows setup program (.exe) and the MSI into ./release/installers from the app that
// `npm run package` produced (release/NexTerm-win32-x64). Nothing is installed on this machine.
//
//   npm run package:win-installers
import { Arch, Platform, build } from 'electron-builder';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

if (process.platform !== 'win32') {
  console.error('The Windows installers are built on Windows.');
  process.exit(1);
}
const require = createRequire(import.meta.url);
const config = require('../electron-builder.win.cjs');
const prepackaged = resolve('release', 'NexTerm-win32-x64');
if (!existsSync(join(prepackaged, 'NexTerm.exe'))) {
  console.error('Run "npm run package" first: release/NexTerm-win32-x64/NexTerm.exe is missing.');
  process.exit(1);
}
const outDir = resolve(config.directories.output);
for (const f of existsSync(outDir) ? readdirSync(outDir) : []) {
  if (/\.(exe|msi|blockmap)$/.test(f)) rmSync(join(outDir, f), { force: true });
}

await build({
  targets: Platform.WINDOWS.createTarget(['nsis', 'msi'], Arch.x64),
  prepackaged,
  config,
  publish: 'never',
});

console.log('\nWindows installers:');
const sums = [];
for (const f of readdirSync(outDir)) {
  const p = join(outDir, f);
  if (statSync(p).isFile() && /\.(exe|msi)$/.test(f) && !f.includes('__uninstaller')) {
    console.log(`  release/installers/${f}  (${(statSync(p).size / 1024 / 1024).toFixed(1)} MB)`);
    sums.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${f}`);
  }
}
writeFileSync(join(outDir, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log('  release/installers/SHA256SUMS.txt');
