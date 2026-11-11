// Builds the app, packages it, zips it and writes checksums. Everything lands in ./release.
// Usage: npm run release
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

const folder = readdirSync('release', { withFileTypes: true }).find((d) => d.isDirectory());
if (!folder) throw new Error('packager produced no folder');

console.log(`\n== zip ${zipName} ==`);
if (existsSync(zipPath)) rmSync(zipPath);
if (process.platform === 'win32') {
  // The .NET writer at its fastest level is several times quicker than Compress-Archive on this package.
  const ps = `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
    `[IO.Compression.ZipFile]::CreateFromDirectory('${join(process.cwd(), 'release', folder.name)}', '${join(process.cwd(), zipPath)}', [IO.Compression.CompressionLevel]::Fastest, $true)`;
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
