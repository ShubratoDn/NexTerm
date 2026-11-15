// Builds a .deb from the Linux build in release/linux/linux-unpacked, using only Node.
// It exists because electron-builder needs Linux tools to make a .deb and this can be run on Windows too.
// A .deb is an "ar" archive holding debian-binary, control.tar.gz and data.tar.gz; all three are written here.
//
//   npm run package:linux            (builds linux-unpacked)
//   npm run package:deb              (this script)
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const unpacked = resolve('release', 'linux', 'linux-unpacked');
if (!existsSync(join(unpacked, 'nexterm'))) {
  console.error('release/linux/linux-unpacked is missing. Run "npm run package:linux" first.');
  process.exit(1);
}
const arch = process.argv.includes('--arch=arm64') ? 'arm64' : 'amd64';
const APP = '/opt/NexTerm';
const MAINTAINER = 'Shubrato Debnath <ShubratoDn@users.noreply.github.com>';
const HOMEPAGE = 'https://github.com/ShubratoDn/NexTerm';
const DEPENDS = [
  'libgtk-3-0 | libgtk-3-0t64',
  'libnotify4',
  'libnss3',
  'libxss1',
  'libxtst6',
  'xdg-utils',
  'libatspi2.0-0 | libatspi2.0-0t64',
  'libuuid1',
  'libsecret-1-0',
  'libgbm1',
  'libasound2 | libasound2t64',
].join(', ');
const EXEC = new Set(['nexterm', 'chrome_crashpad_handler']);
const SKIP = new Set(['README.txt']); // that file explains the tar.gz; the package sets the permissions itself
const MTIME = Math.floor(Date.now() / 1000);

/* ------------------------------------------------------------------ tar (ustar with GNU long names) */

const octal = (n, width) => n.toString(8).padStart(width - 1, '0') + '\0';

function header({ name, mode, size, type, link = '' }) {
  const buf = Buffer.alloc(512);
  const put = (text, at, max) => buf.write(text.slice(0, max), at, 'utf8');
  put(name, 0, 100);
  put(octal(mode, 8), 100, 8);
  put(octal(0, 8), 108, 8); // uid 0
  put(octal(0, 8), 116, 8); // gid 0
  put(octal(size, 12), 124, 12);
  put(octal(MTIME, 12), 136, 12);
  buf.write('        ', 148, 'ascii'); // checksum placeholder: eight spaces
  buf.write(type, 156, 'ascii');
  put(link, 157, 100);
  buf.write('ustar\0', 257, 'ascii');
  buf.write('00', 263, 'ascii');
  put('root', 265, 32);
  put('root', 297, 32);
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return buf;
}

const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);

class TarWriter {
  parts = [];
  add({ name, mode, type = '0', data = Buffer.alloc(0), link = '' }) {
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(link) > 100) {
      // GNU long-name record: dpkg and every common tar read it.
      for (const [kind, text] of [['L', name], ['K', link]]) {
        if (kind === 'K' && Buffer.byteLength(link) <= 100) continue;
        if (kind === 'L' && Buffer.byteLength(name) <= 100) continue;
        const body = Buffer.from(text + '\0');
        this.parts.push(header({ name: '././@LongLink', mode: 0o644, size: body.length, type: kind }), body, pad(body.length));
      }
    }
    this.parts.push(header({ name, mode, size: type === '0' ? data.length : 0, type, link }));
    if (type === '0' && data.length) this.parts.push(data, pad(data.length));
  }
  finish() {
    return Buffer.concat([...this.parts, Buffer.alloc(1024)]);
  }
}

/* ------------------------------------------------------------------ ar */

function ar(members) {
  const out = [Buffer.from('!<arch>\n')];
  for (const [name, data] of members) {
    const head = name.padEnd(16) + String(MTIME).padEnd(12) + '0'.padEnd(6) + '0'.padEnd(6) + '100644'.padEnd(8) + String(data.length).padEnd(10) + '`\n';
    out.push(Buffer.from(head, 'ascii'), data);
    if (data.length % 2) out.push(Buffer.from('\n'));
  }
  return Buffer.concat(out);
}

/* ------------------------------------------------------------------ package contents */

const data = new TarWriter();
const md5s = [];
let installedBytes = 0;
const addDir = (name) => data.add({ name: name.endsWith('/') ? name : name + '/', mode: 0o755, type: '5' });
const addFile = (path, mode, content) => {
  data.add({ name: path, mode, data: content });
  installedBytes += content.length;
  md5s.push(`${createHash('md5').update(content).digest('hex')}  ${path.replace(/^\.\//, '')}`);
};

for (const d of ['./', './opt/', `.${APP}/`, './usr/', './usr/bin/', './usr/share/', './usr/share/applications/', './usr/share/doc/', './usr/share/doc/nexterm/', './usr/share/icons/', './usr/share/icons/hicolor/', './usr/share/icons/hicolor/512x512/', './usr/share/icons/hicolor/512x512/apps/']) addDir(d);

// The application itself, with explicit modes (Windows file systems carry none).
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(dir, e.name);
    const rel = relative(unpacked, abs).split(sep).join('/');
    if (e.isDirectory()) {
      addDir(`.${APP}/${rel}`);
      walk(abs);
    } else if (e.isFile() && !SKIP.has(rel)) {
      const mode = rel === 'chrome-sandbox' ? 0o4755 : EXEC.has(rel) ? 0o755 : 0o644;
      addFile(`.${APP}/${rel}`, mode, readFileSync(abs));
    }
  }
};
walk(unpacked);

data.add({ name: './usr/bin/nexterm', mode: 0o777, type: '2', link: `${APP}/nexterm` });

const desktop = `[Desktop Entry]
Name=NexTerm
Comment=SSH, SFTP, Telnet, serial and local terminals in one window
Exec=/opt/NexTerm/nexterm %U
Terminal=false
Type=Application
Icon=nexterm
StartupWMClass=NexTerm
Categories=Network;RemoteAccess;System;TerminalEmulator;
Keywords=ssh;sftp;telnet;serial;terminal;console;
`;
addFile('./usr/share/applications/nexterm.desktop', 0o644, Buffer.from(desktop));
addFile('./usr/share/icons/hicolor/512x512/apps/nexterm.png', 0o644, readFileSync('assets/icon-512.png'));
const license = readFileSync('LICENSE', 'utf8');
addFile('./usr/share/doc/nexterm/copyright', 0o644, Buffer.from(`Upstream-Name: NexTerm\nSource: ${HOMEPAGE}\nLicense: MIT\n\n${license}\nThe bundled Electron and Chromium components keep their own licences: see ${APP}/LICENSE.electron.txt and ${APP}/LICENSES.chromium.html.\n`));

const control = [
  `Package: nexterm`,
  `Version: ${pkg.version}`,
  `Section: net`,
  `Priority: optional`,
  `Architecture: ${arch}`,
  `Depends: ${DEPENDS}`,
  `Installed-Size: ${Math.ceil(installedBytes / 1024)}`,
  `Maintainer: ${MAINTAINER}`,
  `Homepage: ${HOMEPAGE}`,
  `Description: Tabbed SSH, SFTP, Telnet, serial and local terminals`,
  ` NexTerm is a terminal workspace: SSH with a built-in SFTP file browser,`,
  ` SFTP-only sessions, Telnet, serial and local shells in one tabbed window,`,
  ` with saved sessions and import from MobaXterm, PuTTY and OpenSSH config.`,
  ``,
].join('\n');

// A desktop database refresh makes the menu entry appear without logging out; failures must not block the install.
const postinst = `#!/bin/sh
set -e
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi
exit 0
`;

const ctl = new TarWriter();
ctl.add({ name: './', mode: 0o755, type: '5' });
ctl.add({ name: './control', mode: 0o644, data: Buffer.from(control) });
ctl.add({ name: './md5sums', mode: 0o644, data: Buffer.from(md5s.join('\n') + '\n') });
ctl.add({ name: './postinst', mode: 0o755, data: Buffer.from(postinst) });

const deb = ar([
  ['debian-binary', Buffer.from('2.0\n')],
  ['control.tar.gz', gzipSync(ctl.finish(), { level: 9 })],
  ['data.tar.gz', gzipSync(data.finish(), { level: 9 })],
]);

const outDir = resolve('release', 'linux');
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `NexTerm-v${pkg.version}-linux-${arch === 'amd64' ? 'x64' : 'arm64'}.deb`);
writeFileSync(file, deb);
console.log(`Wrote ${file} (${(deb.length / 1024 / 1024).toFixed(1)} MB, ${md5s.length} files)`);
const sums = readdirSync(outDir)
  .filter((f) => /\.(tar\.gz|deb|rpm|AppImage)$/.test(f))
  .map((f) => `${createHash('sha256').update(readFileSync(join(outDir, f))).digest('hex')}  ${f}`);
writeFileSync(join(outDir, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log('Updated release/linux/SHA256SUMS.txt');
