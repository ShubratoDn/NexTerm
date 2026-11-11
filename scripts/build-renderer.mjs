import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const out = 'dist/renderer';
mkdirSync(`${out}/fonts`, { recursive: true });

await build({
  entryPoints: ['src/renderer/index.ts'],
  bundle: true,
  outfile: `${out}/app.js`,
  platform: 'browser',
  target: 'chrome140',
  sourcemap: true,
  loader: { '.svg': 'text' },
  logLevel: 'info',
});

cpSync('src/renderer/index.html', `${out}/index.html`);
cpSync('src/renderer/styles.css', `${out}/styles.css`);
cpSync('node_modules/@xterm/xterm/css/xterm.css', `${out}/xterm.css`);
cpSync('assets/icon.svg', `${out}/icon.svg`);

// Fonts (SIL OFL): Inter for the interface, JetBrains Mono for the terminal.
cpSync('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', `${out}/fonts/inter.woff2`);
for (const w of [400, 500, 700]) {
  cpSync(`node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`, `${out}/fonts/jetbrains-mono-${w}.woff2`);
}
