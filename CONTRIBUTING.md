# Contributing to NexTerm

Thanks for your interest in improving NexTerm. Bug reports, fixes, documentation and ideas are all welcome.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug** with the [bug report form](https://github.com/ShubratoDn/NexTerm/issues/new?template=bug_report.yml). Steps to reproduce and your OS and NexTerm version make fixes much faster.
- **Suggest a feature** with the [feature request form](https://github.com/ShubratoDn/NexTerm/issues/new?template=feature_request.yml). Describe the problem first; the solution can come second.
- **Test on macOS or Linux.** Those platforms are untested, and reports are very valuable.
- **Fix something.** Issues labelled `good first issue` are a good start.

Security problems should **not** go in public issues; see [SECURITY.md](SECURITY.md).

## Development setup

```bash
git clone https://github.com/ShubratoDn/NexTerm.git
cd NexTerm
npm install
npm start
```

Requires Node.js 22 or newer. If Electron did not download, run `node node_modules/electron/install.js`.

| Command | What it does |
|---|---|
| `npm start` | Build and launch the app |
| `npm run typecheck` | Strict type-check of all code |
| `npm test` | Compile and run the test suite |
| `npm run package` | Build a portable app folder into `release/` |
| `npm run release` | Type-check, test, package, zip and checksum the current platform's build |
| `npm run package:linux` | Linux packages into `release/linux/` (see below) |
| `npm run brand` | Regenerate logos, icons and banner from `assets/icon.svg` |

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing anything that crosses the main / renderer boundary.

### Linux packages

`npm run package:linux` builds with [electron-builder](https://www.electron.build/). Which formats you get depends on the machine:

| Build machine | Formats |
|---|---|
| Linux (or WSL / a Linux VM) | AppImage, `.deb`, `.rpm` and `.tar.gz` |
| Windows or macOS | `.tar.gz` only (the others need Linux packaging tools). The script stages a copy with the Linux native modules installed and re-creates the archive with correct Unix permissions |

Choose formats with `npm run package:linux -- --targets=deb,rpm` and the CPU with `-- --arch=arm64`. To build everything on Windows, install WSL (`wsl --install`), install Node.js 22+ inside it, clone the repository there and run the same command.

## Making a change

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Create a branch from `main`: `git checkout -b fix/short-description`.
3. Keep the change focused. Unrelated clean-ups belong in a separate pull request.
4. Add or update tests for behaviour you change. Protocol code, validation and anything in `src/main` should have tests.
5. Run `npm run typecheck` and `npm test`; both must pass.
6. If you change the interface, include a before/after screenshot in the pull request.
7. Open the pull request and fill in the template.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sftp): add recursive folder upload
fix(ssh): report the real reason when a host key is rejected
docs: explain MultiExec in the README
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`.

## Code guidelines

- **TypeScript strict.** No `any` without a comment explaining why.
- **Main process is the trust boundary.** Validate everything that arrives over IPC; never expose a new capability to the renderer without a validated, typed API.
- **No secrets in logs, errors or the renderer.**
- **UI:** build DOM with the `h()` helper (text is never inserted as HTML); keep every action reachable by keyboard; support both themes; use the existing design tokens in `styles.css` instead of new colours.
- **Icons** come from [Lucide](https://lucide.dev/); add them in `src/renderer/icons.ts`.
- **Dependencies:** prefer none. A new runtime dependency needs a clear reason in the pull request.

## Brand assets

`assets/icon.svg` is the single source of the NexTerm mark. Never edit the generated PNG / ICO files by hand; change the SVG and run `npm run brand`.

## Licensing

By contributing you agree that your contribution is licensed under the project's [MIT License](LICENSE). Only contribute work you have the right to share; do not copy code or assets from proprietary software.
