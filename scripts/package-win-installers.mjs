// Builds the Windows setup program (.exe) and the MSI into ./release/installers from the app that
// `npm run package` produced (release/NexTerm-win32-x64). Nothing is installed on this machine.
//
//   npm run package:win-installers
//
// Only the setup program can update itself, so only its copy of the app gets `resources/app-update.yml`, which tells the
// application where to look for new versions. The portable folder and the MSI (installed for all users, deployed by an
// administrator) are left without it, and then the application says that it cannot update itself.
import { Arch, Platform, build } from 'electron-builder';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  if (/\.(exe|msi|blockmap|yml)$/.test(f)) rmSync(join(outDir, f), { force: true });
}

// 1. The MSI, from the plain folder.
// (electron-builder rewrites the configuration it is given, so every build gets its own copy.)
await build({ targets: Platform.WINDOWS.createTarget(['msi'], Arch.x64), prepackaged, config: structuredClone(config), publish: 'never' });

// 2. The setup program, from a copy that knows where updates come from.
const staged = resolve('release', '.stage-setup');
rmSync(staged, { recursive: true, force: true });
cpSync(prepackaged, staged, { recursive: true });
const feed = config.publish;
writeFileSync(
  join(staged, 'resources', 'app-update.yml'),
  [`owner: ${feed.owner}`, `repo: ${feed.repo}`, `provider: ${feed.provider}`, `releaseType: ${feed.releaseType ?? 'release'}`, 'updaterCacheDirName: nexterm-updater', ''].join('\n'),
);
try {
  await build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), prepackaged: staged, config: structuredClone(config), publish: 'never' });
} finally {
  rmSync(staged, { recursive: true, force: true });
}

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
for (const f of ['latest.yml']) if (existsSync(join(outDir, f))) console.log(`  release/installers/${f}  (the update feed: upload it with the release)`);
