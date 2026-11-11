import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS } from '../shared/types';
import type { SessionInput, SessionSummary, Settings } from '../shared/types';

export class JsonFile<T> {
  constructor(
    private readonly file: string,
    private readonly fallback: () => T,
  ) {}

  read(): T {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as T;
    } catch {
      return this.fallback();
    }
  }

  write(value: T): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

type Stored = Omit<SessionInput, 'password'> & { id: string; passwordEnc?: string };

export interface ResolvedSession extends Omit<SessionInput, 'password' | 'id'> {
  id: string;
  password?: string;
}

function dir(): string {
  return app.getPath('userData');
}

export class SessionStore {
  private file = new JsonFile<Stored[]>(path.join(dir(), 'sessions.json'), () => []);

  private summary(s: Stored): SessionSummary {
    const { passwordEnc, ...rest } = s;
    return { ...rest, hasPassword: !!passwordEnc } as SessionSummary;
  }

  list(): SessionSummary[] {
    return this.file.read().map((s) => this.summary(s));
  }

  save(input: SessionInput): SessionSummary {
    const all = this.file.read();
    const { password, ...rest } = input;
    const id = input.id ?? randomUUID();
    const idx = all.findIndex((s) => s.id === id);
    if (input.id && idx < 0) throw new Error('session not found');
    const prev = idx >= 0 ? all[idx] : undefined;

    let passwordEnc = prev?.passwordEnc;
    if (password === null) passwordEnc = undefined;
    else if (typeof password === 'string') {
      // Secrets are only persisted when the OS can encrypt them.
      passwordEnc = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(password).toString('base64')
        : undefined;
    }
    const rec: Stored = { ...rest, id, passwordEnc };
    if (idx >= 0) all[idx] = rec;
    else all.push(rec);
    this.file.write(all);
    return this.summary(rec);
  }

  /** Copies a session including its stored (still encrypted) password. */
  duplicate(id: string): SessionSummary {
    const all = this.file.read();
    const src = all.find((s) => s.id === id);
    if (!src) throw new Error('session not found');
    const copy: Stored = { ...src, id: randomUUID(), name: `${src.name} (copy)`.slice(0, 100) };
    all.push(copy);
    this.file.write(all);
    return this.summary(copy);
  }

  delete(id: string): void {
    this.file.write(this.file.read().filter((s) => s.id !== id));
  }

  resolve(id: string): ResolvedSession {
    const s = this.file.read().find((x) => x.id === id);
    if (!s) throw new Error('session not found');
    const { passwordEnc, ...rest } = s;
    let password: string | undefined;
    if (passwordEnc) {
      try {
        password = safeStorage.decryptString(Buffer.from(passwordEnc, 'base64'));
      } catch {
        password = undefined;
      }
    }
    return { ...rest, password };
  }
}

export class SettingsStore {
  private file = new JsonFile<Partial<Settings>>(path.join(dir(), 'settings.json'), () => ({}));

  get(): Settings {
    return { ...DEFAULT_SETTINGS, ...this.file.read() };
  }

  patch(p: Partial<Settings>): Settings {
    const next = { ...this.get(), ...p };
    this.file.write(next);
    return next;
  }
}

export class KnownHosts {
  private file = new JsonFile<Record<string, string>>(path.join(dir(), 'known_hosts.json'), () => ({}));

  get(host: string, port: number): string | undefined {
    return this.file.read()[`${host}:${port}`];
  }

  set(host: string, port: number, fingerprint: string): void {
    const all = this.file.read();
    all[`${host}:${port}`] = fingerprint;
    this.file.write(all);
  }
}
