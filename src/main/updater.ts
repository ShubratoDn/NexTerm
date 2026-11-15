import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/types';

const FIRST_CHECK_MS = 20 * 1000;
const EVERY_MS = 4 * 60 * 60 * 1000;

/**
 * Whether this copy of the application can replace itself. That needs a packaged build that was made by the setup
 * program (it writes `app-update.yml` next to the application). A portable folder, a development run and an MSI
 * deployment cannot, and say so instead of failing.
 */
export function updateSupport(): { ok: boolean; reason: string } {
  if (!app.isPackaged) return { ok: false, reason: 'This is a development run.' };
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    return { ok: false, reason: 'This is a portable copy. Install NexTerm with the setup program to get updates automatically.' };
  }
  if (process.platform !== 'win32' && !(process.platform === 'linux' && process.env.APPIMAGE)) {
    return { ok: false, reason: 'Automatic updates are available for the Windows setup program.' };
  }
  return { ok: true, reason: '' };
}

/** Looks for a newer version on GitHub, downloads it in the background and installs it when NexTerm restarts. */
export class Updater {
  private status: UpdateStatus;
  private timer: NodeJS.Timeout | undefined;
  private checking = false;
  readonly supported: boolean;

  constructor(
    private readonly send: (s: UpdateStatus) => void,
    /** Whether the user allows automatic checks (Settings). A check started by the user always runs. */
    private readonly automatic: () => boolean,
  ) {
    const s = updateSupport();
    this.supported = s.ok;
    this.status = { state: s.ok ? 'idle' : 'unsupported', current: app.getVersion(), ...(s.ok ? {} : { message: s.reason }) };
    if (!s.ok) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true; // a normal quit installs a downloaded update
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = { info: () => undefined, warn: () => undefined, error: (m: unknown) => console.error('[updater]', m), debug: () => undefined };

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'current', version: undefined, percent: undefined, checkedAt: Date.now() }));
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version, percent: 100 }));
    autoUpdater.on('error', (e) => this.set({ state: 'error', message: friendly(e) }));
  }

  /** Starts the automatic checks: shortly after start, then every few hours. */
  start(): void {
    if (!this.supported) return;
    const tick = () => {
      if (this.automatic()) void this.check();
    };
    setTimeout(tick, FIRST_CHECK_MS).unref();
    this.timer = setInterval(tick, EVERY_MS);
    this.timer.unref();
  }

  get current(): UpdateStatus {
    return this.status;
  }

  async check(): Promise<UpdateStatus> {
    if (!this.supported || this.checking || this.status.state === 'downloading' || this.status.state === 'ready') return this.status;
    this.checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      this.set({ state: 'error', message: friendly(e) });
    } finally {
      this.checking = false;
    }
    return this.status;
  }

  /** Restarts NexTerm into the downloaded version. */
  install(): void {
    if (this.status.state !== 'ready') throw new Error('There is no update ready to install.');
    // Silent install, then start the new version again.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    if (patch.state === 'error') this.status.percent = undefined;
    this.send(this.status);
  }
}

function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|net::ERR|getaddrinfo/i.test(m)) return 'Could not reach the update server. Check your internet connection.';
  if (/404|Not Found|Cannot find latest/i.test(m)) return 'No update information was found for the latest release.';
  if (/sha512|checksum/i.test(m)) return 'The downloaded update failed its integrity check and was discarded.';
  return m.split('\n')[0].slice(0, 200);
}
