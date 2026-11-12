// Builds the app, packages it, zips it and writes checksums. Everything lands in ./release.
// Usage: npm run release
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
};

// Run npm through Node itself (no shell), which works the same on every platform.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this through npm: npm run release');
const npm = (args) => run(process.execPath, [npmCli, ...args]);

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const zipName = `NexTerm-v${version}-${platform}-${process.arch}.zip`;
const zipPath = join('release', zipName);

console.log(`\n== NexTerm ${version}: verify ==`);
npm(['run', 'typecheck']);
npm(['test']);

console.log('\n== package ==');
npm(['run', 'package']);

// Pick the packager's output by its exact name: release/ also holds other things (for example release/linux).
const folder = { name: `NexTerm-${process.platform}-${process.arch}` };
const exe = process.platform === 'win32' ? 'NexTerm.exe' : process.platform === 'darwin' ? 'NexTerm.app' : 'NexTerm';
if (!existsSync(join('release', folder.name, exe))) throw new Error(`release/${folder.name}/${exe} was not produced`);

console.log(`\n== zip ${zipName} ==`);
if (existsSync(zipPath)) rmSync(zipPath);
if (process.platform === 'win32') {
  // The .NET writer at its fastest level is several times quicker than Compress-Archive on this package.
  // Entries are added one by one so their names use forward slashes, as the ZIP format requires
  // (ZipFile.CreateFromDirectory on Windows PowerShell 5.1 writes backslashes, which other tools mis-extract).
  const ps =
    `Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem; ` +
    `$src='${join(process.cwd(), 'release', folder.name)}'; $zip='${join(process.cwd(), zipPath)}'; $base=Split-Path $src -Parent; ` +
    `$fs=[IO.File]::Open($zip,'Create'); $a=New-Object IO.Compression.ZipArchive($fs,[IO.Compression.ZipArchiveMode]::Create); ` +
    `Get-ChildItem -LiteralPath $src -Recurse -File | ForEach-Object { $rel=$_.FullName.Substring($base.Length+1).Replace('\\','/'); ` +
    `[void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($a,$_.FullName,$rel,[IO.Compression.CompressionLevel]::Fastest) }; ` +
    `$a.Dispose(); $fs.Dispose()`;
  run('powershell', ['-NoProfile', '-Command', ps]);
} else {
  run('zip', ['-r', '-q', '-9', `../${zipName}`, folder.name], { cwd: 'release' });
}

const sha256 = await new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(zipPath).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
writeFileSync(join('release', 'SHA256SUMS.txt'), `${sha256}  ${zipName}\n`);

console.log(`\nRelease ready:\n  ${zipPath}\n  release/SHA256SUMS.txt\n  sha256 ${sha256}`);
