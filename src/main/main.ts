import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SerialPort } from 'serialport';
import { KnownHosts, SessionStore, SettingsStore } from './store';
import type { ResolvedSession } from './store';
import { openLocal, openSerial, openSsh, openTelnet } from './connections';
import type { Conn } from './connections';
import { assertBaseName, joinRemote, sftpOps, uniqueName } from './sftp';
import { checkSize, parseSessionInput, parseSettingsPatch } from './validate';
import { REGISTRY, buildPreview, detectSources, loadSource } from './importers';
import { sessionKey } from './importers/common';
import type { ImportSourceId, OpenRequest, OpenResult } from '../shared/types';

const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');
const INDEX_URL = pathToFileURL(INDEX).href;

interface Live {
  conn: Conn;
  owner: number;
  closed: boolean;
}
const live = new Map<string, Live>();
const dropped = new Set<string>();
const importAllowed = new Set<string>();
const TITLEBAR_HEIGHT = 40;

let sessions: SessionStore;
let settings: SettingsStore;
let knownHosts: KnownHosts;

function trusted(e: IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  const url = e.senderFrame?.url ?? '';
  if (url.split('#')[0] !== INDEX_URL) throw new Error('untrusted sender');
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 4096 || v.includes('\0')) {
    throw new Error(`invalid ${field}`);
  }
  return v;
}

function getLive(connId: unknown, owner: number): Live {
  const l = live.get(str(connId, 'connection'));
  if (!l || l.owner !== owner) throw new Error('connection not found');
  return l;
}

async function getSftp(connId: unknown, owner: number) {
  const l = getLive(connId, owner);
  if (!l.conn.sftp) throw new Error('SFTP is only available for SSH sessions');
  return l.conn.sftp();
}

async function verifyHostKey(host: string, port: number, fingerprint: string): Promise<boolean> {
  const known = knownHosts.get(host, port);
  if (known === fingerprint) return true;
  if (known) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Host key changed',
      message: `The host key for ${host}:${port} has CHANGED.`,
      detail:
        `Stored:  ${known}\nOffered: ${fingerprint}\n\nThis could mean someone is intercepting the connection. ` +
        'The connection was refused. If the change is expected, remove the entry from known_hosts.json in the app data folder.',
    });
    throw new Error('Host key verification failed (key changed)');
  }
  const r = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Trust and connect', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Unknown host',
    message: `The authenticity of ${host}:${port} cannot be established.`,
    detail: `Key fingerprint: ${fingerprint}\n\nOnly continue if you recognise this fingerprint.`,
  });
  if (r.response !== 0) throw new Error('Host key rejected by user');
  knownHosts.set(host, port, fingerprint);
  return true;
}

function resolveRequest(req: OpenRequest): { session: ResolvedSession; title: string } {
  let session: ResolvedSession;
  if (req.sessionId) {
    session = sessions.resolve(str(req.sessionId, 'session'));
  } else if (req.quick) {
    session = { ...parseSessionInput(req.quick), id: 'quick', password: undefined };
    if (typeof req.quick.password === 'string') session.password = req.quick.password;
  } else {
    throw new Error('no session given');
  }
  if (typeof req.password === 'string') session.password = req.password;
  const title =
    session.name || (session.kind === 'ssh' || session.kind === 'sftp' ? `${session.username ?? ''}@${session.host}` : (session.host ?? session.kind));
  return { session, title };
}

async function openConnection(e: IpcMainInvokeEvent, req: OpenRequest): Promise<OpenResult> {
  const size = checkSize(req.cols, req.rows);
  const { session, title } = resolveRequest(req);
  const connId = randomUUID();
  const owner = e.sender.id;
  const sender = e.sender;

  const handlers = {
    onData: (d: Uint8Array) => {
      if (!sender.isDestroyed()) sender.send('conn:data', connId, d);
    },
    onClose: (reason?: string) => {
      const l = live.get(connId);
      if (!l || l.closed) return;
      l.closed = true;
      live.delete(connId);
      if (!sender.isDestroyed()) sender.send('conn:closed', connId, reason);
    },
  };

  let conn: Conn;
  switch (session.kind) {
    case 'ssh':
      conn = await openSsh(session, size, handlers, verifyHostKey);
      break;
    case 'sftp':
      conn = await openSsh(session, size, handlers, verifyHostKey, 'sftp');
      break;
    case 'telnet':
      conn = await openTelnet(session, size, handlers);
      break;
    case 'local':
      conn = await openLocal(session, size, handlers);
      break;
    case 'serial':
      conn = await openSerial(session, handlers);
      break;
  }
  live.set(connId, { conn, owner, closed: false });
  return { connId, title, sftp: session.kind === 'ssh' || session.kind === 'sftp' };
}

function registerIpc(): void {
  const handle = (ch: string, fn: (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown) =>
    ipcMain.handle(ch, async (e, ...a) => {
      trusted(e);
      return fn(e, ...a);
    });

  handle('sessions:list', () => sessions.list());
  handle('sessions:save', (_e, input) => sessions.save(parseSessionInput(input)));
  handle('sessions:delete', (_e, id) => sessions.delete(str(id, 'id')));
  handle('sessions:duplicate', (_e, id) => sessions.duplicate(str(id, 'id')));
  handle('settings:get', () => settings.get());
  handle('settings:set', (_e, patch) => settings.patch(parseSettingsPatch(patch)));
  handle('serial:list', async () =>
    (await SerialPort.list()).map((p) => ({ path: p.path, manufacturer: p.manufacturer })),
  );
  handle('dialog:key', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showOpenDialog(win, { title: 'Select private key', properties: ['openFile'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // ---- importing connections from other tools
  const importSource = (v: unknown): ImportSourceId => {
    if (v !== 'mobaxterm' && v !== 'putty' && v !== 'openssh') throw new Error('unknown import source');
    return v;
  };
  const allowImport = (p: string) => importAllowed.add(path.resolve(p));

  handle('import:detect', () => detectSources(allowImport));
  handle('import:pick', async (e, source) => {
    const id = importSource(source);
    if (id === 'putty') throw new Error('PuTTY sessions are read from the system');
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const filters =
      id === 'mobaxterm'
        ? [{ name: 'MobaXterm sessions', extensions: ['ini', 'mxtsessions'] }, { name: 'All files', extensions: ['*'] }]
        : [{ name: 'All files', extensions: ['*'] }];
    const r = await dialog.showOpenDialog(win, { title: id === 'mobaxterm' ? 'Select MobaXterm.ini or an exported .mxtsessions file' : 'Select an SSH config file', properties: ['openFile'], filters });
    if (r.canceled || !r.filePaths[0]) return null;
    allowImport(r.filePaths[0]);
    return r.filePaths[0];
  });
  handle('import:preview', async (_e, source, p) => {
    const id = importSource(source);
    const location = str(p, 'path');
    // Only locations the app itself found or the user chose in the file dialog may be read.
    if (id === 'putty' ? location !== REGISTRY : !importAllowed.has(path.resolve(location))) throw new Error('That location was not selected');
    const result = await loadSource(id, id === 'putty' ? REGISTRY : path.resolve(location));
    const existing = new Set(sessions.list().map((s) => sessionKey(s)));
    return buildPreview(id, location, result, existing);
  });
  handle('import:commit', (_e, items, skip) => {
    if (!Array.isArray(items) || items.length === 0 || items.length > 2000) throw new Error('invalid session list');
    const valid = items.map((i) => parseSessionInput({ ...(i as object), id: undefined, password: undefined }));
    return sessions.importMany(valid, skip !== false);
  });

  handle('conn:open', (e, req) => openConnection(e, req as OpenRequest));

  // Fire-and-forget channels.
  ipcMain.on('conn:write', (e, connId, data) => {
    try {
      trusted(e);
      if (typeof data !== 'string' || data.length > 1_000_000) return;
      getLive(connId, e.sender.id).conn.write(data);
    } catch {
      /* connection gone */
    }
  });
  ipcMain.on('conn:resize', (e, connId, cols, rows) => {
    try {
      trusted(e);
      const s = checkSize(cols, rows);
      getLive(connId, e.sender.id).conn.resize(s.cols, s.rows);
    } catch {
      /* ignore */
    }
  });
  ipcMain.on('conn:close', (e, connId) => {
    try {
      trusted(e);
      getLive(connId, e.sender.id).conn.close();
    } catch {
      /* ignore */
    }
  });

  ipcMain.on('drop:register', (e, p) => {
    try {
      trusted(e);
      if (typeof p === 'string' && path.isAbsolute(p) && !p.includes('\0')) {
        if (dropped.size > 5000) dropped.clear();
        dropped.add(p);
      }
    } catch {
      /* ignore */
    }
  });
  ipcMain.on('ui:titlebar', (e, bg, fg) => {
    try {
      trusted(e);
      const color = /^#[0-9a-f]{6}$/i;
      if (process.platform !== 'win32' || typeof bg !== 'string' || typeof fg !== 'string') return;
      if (!color.test(bg) || !color.test(fg)) return;
      BrowserWindow.fromWebContents(e.sender)?.setTitleBarOverlay({ color: bg, symbolColor: fg, height: TITLEBAR_HEIGHT });
    } catch {
      /* ignore */
    }
  });

  handle('sftp:uploadPaths', async (e, id, dir, paths) => {
    const s = await getSftp(id, e.sender.id);
    const remoteDir = str(dir, 'path');
    if (!Array.isArray(paths) || paths.length > 1000) throw new Error('invalid file list');
    let uploaded = 0;
    let skipped = 0;
    for (const p of paths) {
      const local = str(p, 'path');
      // Only files the user dropped onto the window are accepted, and each registration is single-use.
      if (!dropped.delete(local)) {
        skipped++;
        continue;
      }
      let isFile = false;
      try {
        isFile = fs.statSync(local).isFile();
      } catch {
        /* vanished */
      }
      if (!isFile) {
        skipped++;
        continue;
      }
      const name = path.basename(local);
      assertBaseName(name);
      await sftpOps.put(s, local, joinRemote(remoteDir, name));
      uploaded++;
    }
    return { uploaded, skipped };
  });

  handle('sftp:realpath', async (e, id, p) => sftpOps.realpath(await getSftp(id, e.sender.id), str(p, 'path')));
  handle('sftp:list', async (e, id, p) => sftpOps.list(await getSftp(id, e.sender.id), str(p, 'path')));
  handle('sftp:mkdir', async (e, id, p) => sftpOps.mkdir(await getSftp(id, e.sender.id), str(p, 'path')));
  handle('sftp:rename', async (e, id, a, b) =>
    sftpOps.rename(await getSftp(id, e.sender.id), str(a, 'path'), str(b, 'path')),
  );
  handle('sftp:remove', async (e, id, p, isDir) => {
    const s = await getSftp(id, e.sender.id);
    return isDir === true ? sftpOps.rmdir(s, str(p, 'path')) : sftpOps.unlink(s, str(p, 'path'));
  });
  handle('sftp:download', async (e, id, remote) => {
    const s = await getSftp(id, e.sender.id);
    const remotePath = str(remote, 'path');
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showSaveDialog(win, { defaultPath: path.posix.basename(remotePath) });
    if (r.canceled || !r.filePath) return null;
    await sftpOps.get(s, remotePath, r.filePath);
    return r.filePath;
  });
  handle('sftp:downloadMany', async (e, id, remotes) => {
    const s = await getSftp(id, e.sender.id);
    if (!Array.isArray(remotes) || remotes.length === 0 || remotes.length > 1000) throw new Error('invalid file list');
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showOpenDialog(win, { title: 'Choose download folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { saved: 0, skipped: 0, dir: null };
    const dir = r.filePaths[0];
    let saved = 0;
    let skipped = 0;
    for (const remote of remotes) {
      const remotePath = str(remote, 'path');
      const name = path.posix.basename(remotePath);
      assertBaseName(name);
      if (await sftpOps.isDir(s, remotePath)) {
        skipped++; // folder download is not supported yet
        continue;
      }
      const target = path.join(dir, uniqueName(name, (c) => fs.existsSync(path.join(dir, c))));
      await sftpOps.get(s, remotePath, target);
      saved++;
    }
    return { saved, skipped, dir };
  });
  handle('sftp:upload', async (e, id, dir) => {
    const s = await getSftp(id, e.sender.id);
    const remoteDir = str(dir, 'path');
    const win = BrowserWindow.fromWebContents(e.sender)!;
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
    if (r.canceled) return 0;
    for (const f of r.filePaths) {
      const name = path.basename(f);
      assertBaseName(name);
      await sftpOps.put(s, f, joinRemote(remoteDir, name));
    }
    return r.filePaths.length;
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: 'NexTerm',
    backgroundColor: '#17181b',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    ...(process.platform === 'win32'
      ? {
          // Tabs live in the title bar; Windows draws the caption buttons over it.
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#17181b', symbolColor: '#e6e7ea', height: TITLEBAR_HEIGHT },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (ev, url) => {
    if (url.split('#')[0] !== INDEX_URL) ev.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  void win.loadFile(INDEX);
}

/** Early builds were named "termdeck"; carry their saved data over once. */
function migrateLegacyData(): void {
  try {
    // Everything here is best effort and must never stop the app from starting.
    const target = app.getPath('userData');
    const legacy = path.join(app.getPath('appData'), 'termdeck');
    if (legacy === target || !fs.existsSync(legacy) || fs.existsSync(path.join(target, 'sessions.json'))) return;
    fs.mkdirSync(target, { recursive: true });
    for (const f of ['sessions.json', 'settings.json', 'known_hosts.json']) {
      const src = path.join(legacy, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, f));
    }
  } catch {
    /* best effort: the app simply starts fresh if this fails */
  }
}

app.whenReady().then(() => {
  migrateLegacyData();
  sessions = new SessionStore();
  settings = new SettingsStore();
  knownHosts = new KnownHosts();
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  for (const l of live.values()) {
    try {
      l.conn.close();
    } catch {
      /* ignore */
    }
  }
});

app.on('window-all-closed', () => app.quit());
