import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { generateKeyPairSync } from 'node:crypto';
import { Server, utils } from 'ssh2';
import { openSsh, openTelnet } from '../main/connections';
import type { Conn } from '../main/connections';
import { sftpOps } from '../main/sftp';
import type { ResolvedSession } from '../main/store';

const { STATUS_CODE } = utils.sftp;

const hostKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).privateKey;

function startSshServer(): Promise<{ port: number; close: () => void }> {
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => undefined);
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'u' && ctx.password === 'pw') ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acc) => acc());
        session.on('window-change', (acc) => acc?.());
        session.on('shell', (acc) => {
          const stream = acc();
          stream.write('welcome\r\n');
          stream.on('data', (d: Buffer) => stream.write(`echo:${d.toString()}`));
        });
        session.on('sftp', (acc) => {
          const sftp = acc();
          let sent = false;
          sftp.on('REALPATH', (id) => sftp.name(id, [{ filename: '/home/u', longname: '', attrs: {} as never }]));
          sftp.on('OPENDIR', (id) => sftp.handle(id, Buffer.from('h')));
          sftp.on('READDIR', (id) => {
            if (sent) return sftp.status(id, STATUS_CODE.EOF);
            sent = true;
            const mk = (filename: string, mode: number, size: number) => ({
              filename,
              longname: filename,
              attrs: { mode, size, uid: 0, gid: 0, atime: 1, mtime: 1_700_000_000 },
            });
            sftp.name(id, [mk('b.txt', 0o100644, 12), mk('docs', 0o040755, 0), mk('a.txt', 0o100600, 3)]);
          });
          sftp.on('CLOSE', (id) => sftp.status(id, STATUS_CODE.OK));
        });
      });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() }),
    ),
  );
}

const session = (port: number, over: Partial<ResolvedSession> = {}): ResolvedSession => ({
  id: 't',
  name: 't',
  kind: 'ssh',
  host: '127.0.0.1',
  port,
  username: 'u',
  authMethod: 'password',
  password: 'pw',
  ...over,
});

function collect(): { text: () => string; h: { onData: (d: Uint8Array) => void; onClose: (r?: string) => void }; closed: () => boolean } {
  let buf = '';
  let closed = false;
  return {
    text: () => buf,
    closed: () => closed,
    h: { onData: (d) => (buf += Buffer.from(d).toString()), onClose: () => (closed = true) },
  };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('ssh: password login, shell I/O, host key callback, sftp listing', async () => {
  const srv = await startSshServer();
  const out = collect();
  const seen: string[] = [];
  let conn: Conn | undefined;
  try {
    conn = await openSsh(session(srv.port), { cols: 80, rows: 24 }, out.h, async (host, port, fp) => {
      seen.push(`${host}:${port}:${fp}`);
      return true;
    });
    await until(() => out.text().includes('welcome'));
    conn.write('ping');
    await until(() => out.text().includes('echo:ping'));
    conn.resize(100, 30);

    assert.equal(seen.length, 1);
    assert.match(seen[0], new RegExp(`^127\\.0\\.0\\.1:${srv.port}:SHA256:[A-Za-z0-9+/]{43}$`));

    const sftp = await conn.sftp!();
    assert.equal(await sftpOps.realpath(sftp, '.'), '/home/u');
    const list = await sftpOps.list(sftp, '/home/u');
    assert.deepEqual(list.map((e) => e.name), ['docs', 'a.txt', 'b.txt']); // directories first, then by name
    assert.equal(list[0].isDir, true);
    assert.equal(list[2].size, 12);
    assert.equal(list[1].mode, 0o600);
  } finally {
    conn?.close();
    srv.close();
  }
});

test('ssh: wrong password is rejected', async () => {
  const srv = await startSshServer();
  try {
    await assert.rejects(
      openSsh(session(srv.port, { password: 'nope' }), { cols: 80, rows: 24 }, collect().h, async () => true),
      /authentication/i,
    );
  } finally {
    srv.close();
  }
});

test('ssh: refusing the host key aborts the connection', async () => {
  const srv = await startSshServer();
  try {
    await assert.rejects(
      openSsh(session(srv.port), { cols: 80, rows: 24 }, collect().h, async () => {
        throw new Error('Host key rejected by user');
      }),
      /Host key rejected/,
    );
  } finally {
    srv.close();
  }
});

test('ssh: missing key file is reported', async () => {
  await assert.rejects(
    openSsh(session(1, { authMethod: 'key', keyPath: 'Z:\\does\\not\\exist' }), { cols: 80, rows: 24 }, collect().h, async () => true),
    /ENOENT/,
  );
});

test('telnet: negotiates options and strips protocol bytes', async () => {
  const received: Buffer[] = [];
  const server = net.createServer((sock) => {
    sock.on('data', (d) => received.push(Buffer.from(d)));
    // IAC DO TERMINAL-TYPE, IAC WILL ECHO, then text containing an escaped 0xFF
    sock.write(Buffer.from([255, 253, 24, 255, 251, 1]));
    sock.write(Buffer.concat([Buffer.from('login: '), Buffer.from([255, 255])]));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  const out = collect();
  let conn: Conn | undefined;
  try {
    conn = await openTelnet({ id: 't', name: 't', kind: 'telnet', host: '127.0.0.1', port }, { cols: 80, rows: 24 }, out.h);
    await until(() => out.text().includes('login: '));
    assert.ok(!out.text().includes('\u00fd'), 'no protocol bytes leak into output');
    await until(() => Buffer.concat(received).length >= 6);
    const replies = [...Buffer.concat(received)];
    assert.deepEqual(replies.slice(0, 6), [255, 251, 24, 255, 253, 1]); // WILL TTYPE, DO ECHO
    conn.write('root\r');
    await until(() => Buffer.concat(received).toString('latin1').includes('root'));
  } finally {
    conn?.close();
    server.close();
  }
});

test('telnet: connection refused rejects', async () => {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  await assert.rejects(openTelnet({ id: 't', name: 't', kind: 'telnet', host: '127.0.0.1', port }, { cols: 80, rows: 24 }, collect().h), /ECONNREFUSED/);
});
