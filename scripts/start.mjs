// Launches Electron. Some hosts (e.g. VS Code terminals) export ELECTRON_RUN_AS_NODE=1,
// which makes electron.exe behave like plain Node and crash on startup, so strip it.
//   node scripts/start.mjs                    -> run the app
//   node scripts/start.mjs scripts/foo.cjs    -> run an Electron-context script
import { spawn } from 'node:child_process';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const [first, ...rest] = process.argv.slice(2);
const args = first && /\.c?js$/.test(first) ? [first, ...rest] : ['.', ...(first ? [first] : []), ...rest];

const child = spawn(electron, args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
