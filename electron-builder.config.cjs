// Linux packaging (AppImage, deb, rpm, tar.gz). Windows builds use scripts/package.mjs instead.
// Run through `npm run package:linux`, which prepares the right native modules first.
module.exports = {
  appId: 'io.github.shubratodn.nexterm',
  productName: 'NexTerm',
  copyright: 'Copyright (c) 2026 Shubrato Debnath',

  directories: { output: 'release/linux', buildResources: 'assets' },

  files: ['dist/**/*', 'assets/icon.png', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '!**/*.map',
    // serialport ships binaries for every platform; keep only Linux ones
    '!**/@serialport/bindings-cpp/prebuilds/android-*/**',
    '!**/@serialport/bindings-cpp/prebuilds/darwin-*/**',
    '!**/@serialport/bindings-cpp/prebuilds/win32-*/**',
  ],

  // Native add-ons (node-pty, serialport) are loaded from disk, so the app is not packed into an asar archive.
  asar: false,
  npmRebuild: false,
  nodeGypRebuild: false,

  artifactName: 'NexTerm-v${version}-linux-${arch}.${ext}',

  linux: {
    icon: 'assets/icon-512.png',
    category: 'Network',
    maintainer: 'Shubrato Debnath <ShubratoDn@users.noreply.github.com>',
    synopsis: 'Tabbed SSH, SFTP, Telnet, serial and local terminals',
    description:
      'NexTerm is a terminal workspace: SSH with a built-in SFTP file browser, SFTP-only sessions, Telnet, serial and local shells ' +
      'in one tabbed window, with saved sessions and import from MobaXterm, PuTTY and OpenSSH config.',
    desktop: {
      entry: {
        Name: 'NexTerm',
        Comment: 'SSH, SFTP, Telnet, serial and local terminals in one window',
        Keywords: 'ssh;sftp;telnet;serial;terminal;console;',
        StartupWMClass: 'NexTerm',
        Terminal: 'false',
      },
    },
  },
  deb: { packageCategory: 'net' },
  rpm: { packageCategory: 'Applications/Internet' },
};
