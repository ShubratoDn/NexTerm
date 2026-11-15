# Changelog

All notable changes to NexTerm are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Paste files copied in Windows Explorer** (or in a Linux file manager) into the file browser: copy files or folders on your computer, then `Ctrl+V` or right-click, Paste, uploads them, with the usual progress card. Existing server files are never replaced; a name that is taken becomes `name (1).ext`. Files copied inside NexTerm are still pasted on the server, and whichever you copied last wins

### Added
- **Zoom with Ctrl + mouse wheel** (wheel up zooms in, wheel down zooms out; a trackpad pinch works too). Over the terminal or the file browser, only those two change size. Anywhere else the interface text size changes, and the terminal follows by the same amount so everything stays in proportion. `Ctrl+=` and `Ctrl+-` behave the same way according to where the keyboard focus is, and `Ctrl+0` resets all sizes. The file browser now has its own size, kept relative to the interface size

### Fixed
- Copying sometimes failed with "Failed to execute 'writeText' on 'Clipboard': Write permission denied". Copy and paste (terminal, file browser, Properties, server summary) now go through the application itself instead of the browser clipboard, which needed a permission the app always refuses

## [0.6.0] - 2026-11-15

### Added
- **Copy, cut and paste** of files and folders in the file browser (`Ctrl+C`, `Ctrl+X`, `Ctrl+V`, or the right-click menu), within one server or between two servers. Nothing is overwritten: a name that already exists becomes `name (1).ext`. Cut items are dimmed until pasted, and the paths are also copied to the system clipboard as text
- **Edit** a remote file in a local editor: double-click it (or `F4`, or right-click, Edit). The file is downloaded to a private temporary folder, opened, and every time you save it there it is uploaded back automatically. If the file changed on the server in the meantime, NexTerm asks before replacing it
- **Open with…** any program on your computer, and **Open with default app** (refused for file types that would run, such as `.exe`, `.bat`, `.ps1` or `.sh`)
- **Editor setting** in Settings → Files: choose the program used by Edit, or keep the system text editor (Notepad, TextEdit, or the first editor found on Linux)
- Copying shows the same live progress card as uploads and downloads
- **The version number is shown** in the status bar, on the start screen and in Settings → About

### Security
- The editor program can only be chosen through a native file chooser; the page cannot set or run one. Local copies of edited files are kept in a private folder and deleted when NexTerm closes

## [0.5.0] - 2026-11-15

### Added
- **Live transfer progress** for uploads and downloads of files and folders: how much has been sent of the total, percent, current speed, time left and, for several files, which file is in progress

### Packaging
- **Windows setup program** (`NexTerm-v0.5.0-win-x64-setup.exe`) and **MSI** (`NexTerm-v0.5.0-win-x64.msi`), built with `npm run package:win-installers`
- **Debian package** (`NexTerm-v0.5.0-linux-x64.deb`), built with `npm run package:deb` (works on Windows too)

### Fixed
- The buttons on the start screen (New session, Quick connect, Local terminal, Import connections, Command palette and the recent sessions) did nothing when clicked, because an empty layer covered them

## [0.4.0] - 2026-11-12

### Added
- **Properties** for any file or folder: type, path, size, dates, owner and editable permissions (checkboxes and octal), a "Calculate size" button for folders, and a summary when several items are selected
- Much richer right-click menus in the file browser for files, folders and empty space: open, download, upload here, new file or folder inside, rename, move to, copy path or name, open terminal here, properties, delete
- Download, upload and delete of whole folders, including drag and drop of folders; "Delete with contents" shows how many files and folders will go before it asks
- **Interface font and size** in Settings → Appearance, applied immediately

### Fixed
- Double-clicking a folder in the file browser did nothing with a real mouse, because the list was redrawn on the first click

## [0.3.0] - 2026-11-12

### Added
- **Server status bar** under SSH terminals: host, CPU with a history graph, memory, upload and download speed, uptime, logged-in users and disk usage per mount, with a details panel (load, swap, network interfaces, disks, busiest processes). Agentless and read-only; only the visible tab is sampled; configurable or off in Settings and the command palette
- Linux packaging: `npm run package:linux` builds a `.tar.gz` on any OS and AppImage, `.deb` and `.rpm` on Linux (or WSL)
- 512 px application icon generated from the same source logo

## [0.2.0] - 2026-11-11

### Added
- **Import connections** from MobaXterm (`MobaXterm.ini` or an exported `.mxtsessions` file), PuTTY (registry, or `~/.putty/sessions`) and OpenSSH config files, with automatic detection, a grouped and searchable preview, duplicate detection and a one-click import
- First-run welcome card that offers the connections it found, so a new install does not start empty
- **SFTP-only sessions** for servers that do not allow a shell: a full-width file browser with no terminal
- A clear message for PuTTY key formats that cannot be used directly, with the conversion steps

### Fixed
- The app could fail to open its window if the legacy data migration threw
- Key files with no file extension were not recognised as keys when importing

## [0.1.0] - 2026-11-11

First public version.

### Added
- Tabbed sessions: SSH, Telnet, serial and local shell
- Saved sessions with folders, search, duplicate and quick connect (`user@host:port`)
- SSH authentication with password, private key (passphrase prompt) and SSH agent
- SFTP file browser beside every SSH terminal: breadcrumbs, sortable columns, multi-select, keyboard control, upload (including drag and drop), download, rename, create folder, delete
- Host key verification with trust on first use and refusal on key change
- Passwords encrypted with the operating system credential store
- MultiExec: send input to every connected tab
- In-terminal search, copy / paste, zoom, configurable font, cursor and scrollback
- Command palette and `Ctrl+Shift` keyboard shortcuts
- Connection states: connecting, failed (Retry / Edit session) and disconnected (Reconnect banner)
- Light, dark and system themes; bundled Inter and JetBrains Mono fonts and Lucide icons
- Windows packaging: `npm run package` and `npm run release` build a portable folder and a zip with checksums
- Smaller package: Chromium translation files other than en-US are not shipped (about 48 MB saved)
- Generated brand assets (icons, banner, social preview) from a single source logo

[Unreleased]: https://github.com/ShubratoDn/NexTerm/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ShubratoDn/NexTerm/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ShubratoDn/NexTerm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ShubratoDn/NexTerm/releases/tag/v0.1.0
