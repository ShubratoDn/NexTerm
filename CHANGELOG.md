# Changelog

All notable changes to NexTerm are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
