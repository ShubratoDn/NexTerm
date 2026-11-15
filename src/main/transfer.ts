import type { TransferProgress } from '../shared/types';

/** What the SFTP code reports while it moves data. */
export interface Progress {
  /** A file is about to start. */
  file(name: string): void;
  /** Bytes moved since the last call. */
  bytes(n: number): void;
  /** The file finished successfully. */
  fileDone(): void;
}

const WINDOW_MS = 3000;

/** Counts bytes and turns them into a speed and a time estimate. Pure, so it can be tested with a fake clock. */
export class TransferMeter {
  totalBytes = 0;
  doneBytes = 0;
  filesTotal = 0;
  filesDone = 0;
  current = '';
  private readonly started: number;
  /** Cumulative byte counts over the last few seconds; the first entry is the baseline for the speed. */
  private samples: { t: number; bytes: number }[];

  constructor(private readonly now: () => number = Date.now) {
    this.started = now();
    this.samples = [{ t: this.started, bytes: 0 }];
  }

  setTotals(bytes: number, files: number): void {
    this.totalBytes = Math.max(0, bytes);
    this.filesTotal = Math.max(0, files);
  }

  add(n: number): void {
    if (!(n > 0)) return;
    this.doneBytes += n;
    const t = this.now();
    this.samples.push({ t, bytes: this.doneBytes });
    this.trim(t);
  }

  private trim(t: number): void {
    // Keep one sample that is older than the window, so the speed always spans the whole window.
    while (this.samples.length > 1 && this.samples[1].t <= t - WINDOW_MS) this.samples.shift();
  }

  /** Bytes per second over the last few seconds. It drops towards zero when the transfer stalls. */
  speed(): number {
    const t = this.now();
    this.trim(t);
    const base = this.samples[0];
    const seconds = Math.max(0.25, (t - base.t) / 1000);
    return (this.doneBytes - base.bytes) / seconds;
  }

  etaSec(): number | null {
    const s = this.speed();
    const left = this.totalBytes - this.doneBytes;
    if (s < 1 || this.totalBytes <= 0) return null;
    return Math.max(0, Math.round(left / s));
  }

  snapshot(): Pick<TransferProgress, 'totalBytes' | 'doneBytes' | 'speed' | 'etaSec' | 'filesDone' | 'filesTotal' | 'current'> {
    return {
      totalBytes: this.totalBytes,
      // Never report more than the total: sizes can change while a file is copied.
      doneBytes: this.totalBytes > 0 ? Math.min(this.doneBytes, this.totalBytes) : this.doneBytes,
      speed: Math.round(this.speed()),
      etaSec: this.etaSec(),
      filesDone: this.filesDone,
      filesTotal: this.filesTotal,
      current: this.current,
    };
  }
}

let nextId = 1;

/** One transfer as the user sees it: a meter plus throttled updates to the window. */
export class Transfer implements Progress {
  readonly id = nextId++;
  readonly meter: TransferMeter;
  private last = 0;
  private finished = false;

  constructor(
    private readonly direction: TransferProgress['direction'],
    private readonly title: string,
    private readonly emit: (p: TransferProgress) => void,
    private readonly now: () => number = Date.now,
    private readonly minGapMs = 100,
  ) {
    this.meter = new TransferMeter(now);
    this.send('preparing', true);
  }

  setTotals(bytes: number, files: number): void {
    this.meter.setTotals(bytes, files);
    this.send('running', true);
  }

  file(name: string): void {
    this.meter.current = name;
    this.send('running', true);
  }

  bytes(n: number): void {
    this.meter.add(n);
    this.send('running');
  }

  fileDone(): void {
    this.meter.filesDone++;
    this.send('running');
  }

  /** Call exactly once, with the error message if the whole transfer failed. */
  finish(error?: string): void {
    if (this.finished) return;
    this.finished = true;
    this.send(error ? 'error' : 'done', true, error);
  }

  private send(state: TransferProgress['state'], force = false, error?: string): void {
    if (this.finished && state !== 'done' && state !== 'error') return;
    const t = this.now();
    if (!force && t - this.last < this.minGapMs) return;
    this.last = t;
    this.emit({ id: this.id, direction: this.direction, title: this.title, state, ...this.meter.snapshot(), ...(error ? { error } : {}) });
  }
}
