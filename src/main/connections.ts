import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { Client } from 'ssh2';
import type { ConnectConfig, SFTPWrapper } from 'ssh2';
import * as pty from '@lydell/node-pty';
import { SerialPort } from 'serialport';
import { TelnetFilter, escapeOutgoing } from './telnet-filter';
import type { ResolvedSession } from './store';

export interface Conn {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
  sftp?(): Promise<SFTPWrapper>;
  /** Runs a command on a separate channel, feeding input on stdin, and resolves with its stdout (SSH only). */
  exec?(command: string, input: string, timeoutMs: number): Promise<string>;
}

export interface Handlers {
  onData(data: Uint8Array): void;
  onClose(reason?: string): void;
}

export interface Size {
  cols: number;
  rows: number;
}

/** Returns true to trust the key. Throws to abort. */
export type HostVerifier = (host: string, port: number, fingerprint: string) => Promise<boolean>;

function expandHome(p: string): string {
  return p.startsWith('~') ? os.homedir() + p.slice(1) : p;
}

/** Reads a private key, translating PuTTY formats ssh2 cannot parse into an actionable message. */
export function readPrivateKey(p: string): Buffer {
  const buf = fs.readFileSync(expandHome(p));
  const m = /^PuTTY-User-Key-File-(\d+): (\S+)/.exec(buf.subarray(0, 80).toString('latin1'));
  if (m && (m[1] !== '2' || !/^ssh-(rsa|dss)$/.test(m[2]))) {
    throw new Error(
      `This PuTTY key (format ${m[1]}, ${m[2]}) cannot be used directly. In PuTTYgen choose Conversions > Export OpenSSH key, then select the exported file.`,
    );
  }
  return buf;
}

/**
 * Opens an SSH connection. In 'shell' mode it starts an interactive shell (SFTP stays available);
 * in 'sftp' mode it only opens the file-transfer subsystem, for servers that do not allow a shell.
 */
export function openSsh(s: ResolvedSession, size: Size, h: Handlers, verify: HostVerifier, mode: 'shell' | 'sftp' = 'shell'): Promise<Conn> {
  return new Promise<Conn>((resolve, reject) => {
    const host = s.host!;
    const port = s.port ?? 22;
    const client = new Client();
    let ready = false;
    let sftpP: Promise<SFTPWrapper> | undefined;

    const opts: ConnectConfig = {
      host,
      port,
      username: s.username || os.userInfo().username,
      tryKeyboard: s.authMethod === 'password',
      keepaliveInterval: 15000,
      readyTimeout: 20000,
      hostHash: 'sha256',
      // ssh2 ignores an undefined return value and waits for the callback; its typings only declare the sync form.
      hostVerifier: ((hashHex: string, cb: (ok: boolean) => void): void => {
        const fp = Buffer.from(hashHex, 'hex').toString('base64').replace(/=+$/, '');
        verify(host, port, `SHA256:${fp}`).then(cb, (e: Error) => {
          // Report our specific reason first; ssh2's own "Host denied" error would otherwise win.
          client.emit('error', e);
          cb(false);
        });
      }) as unknown as (fingerprint: string) => boolean,
    };

    try {
      if (s.authMethod === 'key') {
        opts.privateKey = readPrivateKey(s.keyPath!);
        if (s.password) opts.passphrase = s.password;
      } else if (s.authMethod === 'agent') {
        const sock = process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK;
        if (!sock) throw new Error('No SSH agent available (SSH_AUTH_SOCK not set)');
        opts.agent = sock;
      } else {
        opts.password = s.password ?? '';
      }
    } catch (e) {
      reject(e);
      return;
    }

    client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => {
      finish(prompts.map(() => s.password ?? ''));
    });

    const execCommand = (command: string, input: string, timeoutMs: number): Promise<string> =>
      new Promise<string>((res, rej) => {
        client.exec(command, (err, stream) => {
          if (err) return rej(err);
          let out = '';
          let done = false;
          const finish = (fn: () => void) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            fn();
          };
          const timer = setTimeout(() => {
            finish(() => {
              stream.close();
              rej(new Error('The server did not answer in time'));
            });
          }, timeoutMs);
          stream.on('data', (d: Buffer) => {
            if (out.length < 1_000_000) out += d.toString('utf8');
          });
          stream.stderr.on('data', () => undefined); // drain so the channel can close
          stream.on('close', () => finish(() => res(out)));
          stream.on('error', (e: Error) => finish(() => rej(e)));
          stream.end(input);
        });
      });

    const getSftp = () =>
      (sftpP ??= new Promise<SFTPWrapper>((res, rej) =>
        client.sftp((e, sftp) => {
          if (e) {
            sftpP = undefined;
            rej(e);
          } else res(sftp);
        }),
      ));

    client.on('ready', () => {
      if (mode === 'sftp') {
        // Prove the subsystem works now, so a server without SFTP fails the connect instead of an empty browser.
        getSftp().then(
          () => {
            ready = true;
            resolve({ write: () => undefined, resize: () => undefined, close: () => client.end(), sftp: getSftp });
          },
          (e: Error) => {
            client.end();
            reject(new Error(`The server did not start the SFTP subsystem: ${e.message}`));
          },
        );
        return;
      }
      client.shell({ term: 'xterm-256color', cols: size.cols, rows: size.rows }, (err, stream) => {
        if (err) {
          client.end();
          reject(err);
          return;
        }
        ready = true;
        stream.on('data', (d: Buffer) => h.onData(d));
        stream.stderr.on('data', (d: Buffer) => h.onData(d));
        stream.on('close', () => {
          client.end();
          h.onClose();
        });
        resolve({
          write: (d) => void stream.write(d),
          resize: (c, r) => void stream.setWindow(r, c, 0, 0),
          close: () => client.end(),
          sftp: getSftp,
          exec: execCommand,
        });
      });
    });

    client.on('error', (e: Error) => {
      if (!ready) reject(e);
      else h.onClose(e.message);
    });
    client.on('close', () => {
      if (ready) h.onClose();
    });

    client.connect(opts);
  });
}

export function openTelnet(s: ResolvedSession, size: Size, h: Handlers): Promise<Conn> {
  return new Promise<Conn>((resolve, reject) => {
    const filter = new TelnetFilter();
    filter.setSize(size.cols, size.rows);
    const sock = net.connect({ host: s.host!, port: s.port ?? 23 });
    let connected = false;
    sock.setTimeout(20000, () => sock.destroy(new Error('connection timed out')));

    sock.on('connect', () => {
      connected = true;
      sock.setTimeout(0);
      resolve({
        write: (d) => void sock.write(escapeOutgoing(Buffer.from(d, 'utf8'))),
        resize: (c, r) => {
          const frame = filter.setSize(c, r);
          if (frame.length) sock.write(frame);
        },
        close: () => sock.end(),
      });
    });
    sock.on('data', (chunk: Buffer) => {
      const { output, replies } = filter.process(chunk);
      if (replies.length) sock.write(replies);
      if (output.length) h.onData(output);
    });
    sock.on('error', (e) => {
      if (!connected) reject(e);
      else h.onClose(e.message);
    });
    sock.on('close', () => {
      if (connected) h.onClose();
    });
  });
}

export function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/sh';
}

export function openLocal(s: ResolvedSession, size: Size, h: Handlers): Promise<Conn> {
  return new Promise<Conn>((resolve, reject) => {
    try {
      const p = pty.spawn(s.shell || defaultShell(), [], {
        name: 'xterm-256color',
        cols: size.cols,
        rows: size.rows,
        cwd: os.homedir(),
        env: process.env as Record<string, string>,
      });
      p.onData((d: string) => h.onData(Buffer.from(d, 'utf8')));
      p.onExit(() => h.onClose());
      resolve({
        write: (d) => p.write(d),
        resize: (c, r) => {
          try {
            p.resize(c, r);
          } catch {
            /* process already gone */
          }
        },
        close: () => {
          try {
            p.kill();
          } catch {
            /* already gone */
          }
        },
      });
    } catch (e) {
      reject(e);
    }
  });
}

export function openSerial(s: ResolvedSession, h: Handlers): Promise<Conn> {
  return new Promise<Conn>((resolve, reject) => {
    const port = new SerialPort({ path: s.serialPath!, baudRate: s.baudRate ?? 115200, autoOpen: false });
    port.open((err) => {
      if (err) {
        reject(err);
        return;
      }
      port.on('data', (d: Buffer) => h.onData(d));
      port.on('close', () => h.onClose());
      port.on('error', (e) => h.onClose(e.message));
      resolve({
        write: (d) => void port.write(d),
        resize: () => undefined,
        close: () => {
          if (port.isOpen) port.close();
        },
      });
    });
  });
}
