// Builds Linux packages into ./release/linux.
//
//   npm run package:linux                       all formats this host can build
//   npm run package:linux -- --targets=deb,rpm  choose formats (AppImage, deb, rpm, tar.gz)
//   npm run package:linux -- --arch=arm64       x64 (default) or arm64
//
// On Linux the project is packaged in place. On Windows or macOS it is staged first: a Windows node_modules only
// holds Windows binaries, so the Linux ones (node-pty) are installed into a throw-away copy.
// AppImage, deb and rpm need Linux tooling; from Windows/macOS only tar.gz is attempted unless you ask for more.
import { Arch, Platform, build } from 'electron-builder';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import * as tar from 'tar';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const config = require('../electron-builder.config.cjs');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const onLinux = process.platform === 'linux';
const archName = arg('arch') === 'arm64' ? 'arm64' : 'x64';
const targets = (arg('targets') ?? (onLinux ? 'AppImage,deb,rpm,tar.gz' : 'tar.gz')).split(',').map((t) => t.trim()).filter(Boolean);
const electronVersion = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version;
const outDir = resolve('release', 'linux');

// AppImage, deb and rpm are assembled with Linux tools and rely on Unix permissions that Windows cannot record,
// so a package built elsewhere could be silently broken. Only tar.gz is safe to build off-Linux (it is re-created with
// explicit permissions below).
const linuxOnly = targets.filter((t) => t !== 'tar.gz');
if (!onLinux && linuxOnly.length > 0 && !process.argv.includes('--force')) {
  console.error(
    `${linuxOnly.join(', ')} must be built on Linux (a Linux machine, a VM, or WSL: "wsl --install").\n` +
      'Run this same command there, or add --force to try anyway (the result may not run).',
  );
  process.exit(1);
}
let projectDir = process.cwd();
if (!onLinux) {
  projectDir = resolve('release', '.stage-linux');
  console.log(`Staging a Linux build in ${projectDir}`);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
  for (const p of ['dist', 'assets', 'package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    cpSync(p, join(projectDir, p), { recursive: true });
  }
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this through npm: npm run package:linux');
  const r = spawnSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--os=linux', `--cpu=${archName}`, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: projectDir, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Installing the Linux dependencies failed');
}

console.log(`\nBuilding ${targets.join(', ')} for linux-${archName} (Electron ${electronVersion})`);
// Clear stale output for the formats being built, but keep packages built earlier in other formats.
const EXT = { AppImage: '.AppImage', deb: '.deb', rpm: '.rpm', 'tar.gz': '.tar.gz' };
mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'linux-unpacked'), { recursive: true, force: true });
for (const f of readdirSync(outDir)) {
  if (targets.some((t) => EXT[t] && f.endsWith(EXT[t]))) rmSync(join(outDir, f), { force: true });
}
await build({
  projectDir,
  targets: Platform.LINUX.createTarget(targets, archName === 'arm64' ? Arch.arm64 : Arch.x64),
  config: { ...config, electronVersion, directories: { ...config.directories, output: outDir } },
  publish: 'never',
});

if (!onLinux) rmSync(projectDir, { recursive: true, force: true });

/**
 * Windows has no Unix permission bits, so a tar.gz written there would ship an app that is not executable.
 * Re-create the archive from the unpacked folder with explicit modes.
 */
async function repackTarGz() {
  const unpacked = join(outDir, 'linux-unpacked');
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const top = `NexTerm-v${version}-linux-${archName}`;
  const file = join(outDir, `${top}.tar.gz`);
  const EXECUTABLE = new Set(['nexterm', 'chrome_crashpad_handler', 'chrome-sandbox']);

  writeFileSync(
    join(unpacked, 'README.txt'),
    [
      'NexTerm for Linux',
      '',
      'Run:   ./nexterm',
      '',
      'If it exits at once with a message about the "SUID sandbox helper" (common on Ubuntu 24.04 and newer, which',
      'restrict unprivileged user namespaces), do ONE of these:',
      '  - start it with the sandbox disabled:      ./nexterm --no-sandbox',
      '  - or give the helper the expected owner:   sudo chown root chrome-sandbox && sudo chmod 4755 chrome-sandbox',
      '',
      'Serial ports need membership of the "dialout" group (sudo usermod -aG dialout $USER, then log in again).',
      '',
      'https://github.com/ShubratoDn/NexTerm',
      '',
    ].join('\n'),
  );

  rmSync(file, { force: true });
  await tar.c(
    {
      gzip: { level: 9 },
      file,
      cwd: unpacked,
      prefix: top,
      portable: true,
      // tar derives the header mode from entry.stat, so that is what has to change (not entry.mode).
      onWriteEntry(entry) {
        const isDir = entry.type === 'Directory';
        const perms = isDir || EXECUTABLE.has(basename(entry.path)) ? 0o755 : 0o644;
        entry.stat.mode = (entry.stat.mode & ~0o7777) | perms;
      },
    },
    readdirSync(unpacked),
  );
  console.log(`Re-packed ${file} with Unix permissions`);
}
if (!onLinux && targets.includes('tar.gz')) await repackTarGz();

console.log('\nLinux packages:');
const sums = [];
for (const f of readdirSync(outDir)) {
  const s = statSync(join(outDir, f));
  if (s.isFile() && Object.values(EXT).some((e) => f.endsWith(e))) {
    console.log(`  release/linux/${f}  (${(s.size / 1024 / 1024).toFixed(1)} MB)`);
    const digest = createHash('sha256').update(readFileSync(join(outDir, f))).digest('hex');
    sums.push(`${digest}  ${f}`);
  }
}
writeFileSync(join(outDir, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log('  release/linux/SHA256SUMS.txt');
