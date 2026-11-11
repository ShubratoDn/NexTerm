# Changelog

All notable changes to NexTerm are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/ShubratoDn/NexTerm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ShubratoDn/NexTerm/releases/tag/v0.1.0
