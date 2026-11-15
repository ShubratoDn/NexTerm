// Windows installers (NSIS .exe and MSI), made from the app that `npm run package` already built.
// Run through `npm run package:win-installers`.
module.exports = {
  appId: 'io.github.shubratodn.nexterm',
  productName: 'NexTerm',
  copyright: 'Copyright (c) 2026 Shubrato Debnath',
  directories: { output: 'release/installers', buildResources: 'assets' },
  win: { icon: 'assets/icon.ico' },

  // Where installed copies look for new versions: the files of the latest GitHub release. Nothing is uploaded by the
  // build itself (it runs with publish "never"); this only writes app-update.yml into the app and latest.yml next to
  // the installer.
  publish: { provider: 'github', owner: 'ShubratoDn', repo: 'NexTerm', releaseType: 'release' },

  // Setup program: installs for the current user (no administrator rights), lets the user pick the folder.
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'NexTerm',
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    uninstallDisplayName: 'NexTerm',
    // Sessions and settings live in %APPDATA%\NexTerm; uninstalling must never delete them.
    deleteAppDataOnUninstall: false,
    artifactName: 'NexTerm-v${version}-win-x64-setup.exe',
  },

  // MSI for administrators who deploy with Group Policy, Intune or SCCM: installs for all users.
  msi: {
    oneClick: false,
    perMachine: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'NexTerm',
    artifactName: 'NexTerm-v${version}-win-x64.msi',
  },
};
