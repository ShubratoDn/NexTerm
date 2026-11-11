// Renders every brand asset from the single source mark in assets/icon.svg so logos can never drift apart:
//   assets/icon.png, assets/icon.ico            application / executable icon
//   docs/assets/logo.png                         README / avatar logo
//   docs/assets/banner.png                       README banner
//   docs/assets/social-preview.png               GitHub social preview (1280x640)
// Run with: npm run brand
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.commandLine.appendSwitch('force-device-scale-factor', '1'); // pixel-exact output regardless of display scaling

const root = path.join(__dirname, '..');
const assets = path.join(root, 'assets');
const docs = path.join(root, 'docs', 'assets');
const markSvg = fs.readFileSync(path.join(assets, 'icon.svg'));
const mark = `data:image/svg+xml;base64,${markSvg.toString('base64')}`;
const fontUrl = pathToFileURL(path.join(root, 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2')).href;
const hero = path.join(docs, 'screenshots', 'hero-dark.png');

const base = `
  @font-face { font-family: 'Inter'; src: url('${fontUrl}') format('woff2'); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
`;

const BANNER = `<html><style>${base}
  body { width: 1600px; height: 400px; background: #0e0f13; display: flex; align-items: center; padding: 0 120px; gap: 56px; color: #f2f4f8; }
  img { width: 176px; height: 176px; }
  h1 { font-size: 112px; font-weight: 750; letter-spacing: -3px; line-height: 1; }
  p { margin-top: 18px; font-size: 32px; color: #9aa3b2; }
  .chips { margin-top: 26px; font-size: 22px; letter-spacing: 1px; color: #6b7384; font-weight: 500; }
  .chips b { color: #4d8bff; font-weight: 600; }
</style><body><img src="${mark}"><div><h1>NexTerm</h1><p>One tabbed workspace for every remote and local shell.</p>
<div class="chips">SSH <b>/</b> SFTP <b>/</b> TELNET <b>/</b> SERIAL <b>/</b> LOCAL</div></div></body></html>`;

const SOCIAL = (withHero) => `<html><style>${base}
  body { width: 1280px; height: 640px; background: #0e0f13; color: #f2f4f8; position: relative; overflow: hidden; }
  .text { position: absolute; left: 80px; top: 0; bottom: 0; width: 520px; display: flex; flex-direction: column; justify-content: center; }
  img.mark { width: 120px; height: 120px; margin-bottom: 36px; }
  h1 { font-size: 92px; font-weight: 750; letter-spacing: -2.5px; line-height: 1; }
  p { margin-top: 22px; font-size: 29px; line-height: 1.35; color: #9aa3b2; }
  .shot { position: absolute; left: 650px; top: 120px; width: 900px; border-radius: 14px; border: 1px solid #2b2d33; box-shadow: 0 30px 80px rgba(0,0,0,.6); }
</style><body><div class="text"><img class="mark" src="${mark}"><h1>NexTerm</h1><p>SSH with a built-in SFTP browser, Telnet, serial and local shells in one window.</p></div>
${withHero ? `<img class="shot" src="${pathToFileURL(hero).href}">` : ''}</body></html>`;

async function render(html, w, h, outFile) {
  const tmp = path.join(require('node:os').tmpdir(), `nexterm-render-${process.pid}.html`);
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL(pathToFileURL(tmp).href);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 300)))');
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, img.toPNG());
  win.destroy();
  fs.unlinkSync(tmp);
  console.log('wrote', path.relative(root, outFile), `${img.getSize().width}x${img.getSize().height}`);
}

app.on('window-all-closed', () => {}); // keep running between renders; we quit explicitly at the end

app.whenReady().then(async () => {
  // Application icon (PNG + multi-size ICO holding PNG images).
  const SIZES = [16, 24, 32, 48, 64, 128, 256];
  const win = new BrowserWindow({ show: false, width: 256, height: 256, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;base64,' + Buffer.from(`<html><body style="margin:0;background:transparent"><img src="${mark}" width="256" height="256"></body></html>`).toString('base64'));
  await new Promise((r) => setTimeout(r, 500));
  const full = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  win.destroy();
  const pngs = SIZES.map((s) => ({ s, buf: (s === 256 ? full : full.resize({ width: s, height: s, quality: 'best' })).toPNG() }));
  fs.writeFileSync(path.join(assets, 'icon.png'), pngs.find((p) => p.s === 256).buf);

  // Linux packages want a 512 px icon; render it straight from the vector so it stays sharp.
  const big = new BrowserWindow({ show: false, width: 512, height: 512, useContentSize: true, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await big.loadURL('data:text/html;base64,' + Buffer.from(`<html><body style="margin:0;background:transparent"><img src="${mark}" width="512" height="512"></body></html>`).toString('base64'));
  await new Promise((r) => setTimeout(r, 500));
  fs.writeFileSync(path.join(assets, 'icon-512.png'), (await big.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })).toPNG());
  big.destroy();
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'logo.png'), full.resize({ width: 256, height: 256, quality: 'best' }).toPNG());

  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(({ s, buf }) => {
    const e = Buffer.alloc(16);
    e[0] = e[1] = s === 256 ? 0 : s;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });
  fs.writeFileSync(path.join(assets, 'icon.ico'), Buffer.concat([header, ...dir, ...pngs.map((p) => p.buf)]));
  console.log('wrote assets/icon.png, assets/icon.ico');

  await render(BANNER, 1600, 400, path.join(docs, 'banner.png'));
  await render(SOCIAL(fs.existsSync(hero)), 1280, 640, path.join(docs, 'social-preview.png'));
  fs.copyFileSync(path.join(assets, 'icon.svg'), path.join(docs, 'logo.svg'));
  app.quit();
});
