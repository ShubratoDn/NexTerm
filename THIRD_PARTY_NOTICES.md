# Third-party notices

NexTerm is built on the open-source components below. Each keeps its own licence; the full text ships with the package in `node_modules/<name>/` and, for bundled assets, in the upstream repository.

| Component | Use | Licence |
|---|---|---|
| [Electron](https://www.electronjs.org/) | Application shell | MIT |
| [xterm.js](https://github.com/xtermjs/xterm.js) (`@xterm/xterm`, fit and search add-ons) | Terminal emulator | MIT |
| [ssh2](https://github.com/mscdex/ssh2) | SSH and SFTP | MIT |
| [node-pty](https://github.com/microsoft/node-pty) via [@lydell/node-pty](https://github.com/lydell/node-pty) | Local pseudo-terminals | MIT |
| [serialport](https://github.com/serialport/node-serialport) | Serial connections | MIT |
| [Lucide](https://lucide.dev/) (`lucide-static`) | Interface icons | ISC |
| [Inter](https://rsms.me/inter/) (`@fontsource-variable/inter`) | Interface typeface | SIL Open Font License 1.1 |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (`@fontsource/jetbrains-mono`) | Terminal typeface | SIL Open Font License 1.1 |
| [esbuild](https://esbuild.github.io/), [TypeScript](https://www.typescriptlang.org/), [@electron/packager](https://github.com/electron/packager) | Build tooling (not shipped) | MIT / Apache-2.0 |

Run `npm ls --all` for the complete dependency tree.
