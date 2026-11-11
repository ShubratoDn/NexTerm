import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMobaXterm, expandMobaPath } from '../main/importers/mobaxterm';
import { decodePuttyName, parsePuttyRegQuery, parsePuttySessionFile } from '../main/importers/putty';
import { parseOpenSshConfig } from '../main/importers/openssh';
import { notesList, sessionKey, splitUserHost, unsupportedList } from '../main/importers/common';

// Synthetic data in the shape of real MobaXterm.ini files (field order: host, port, user, ..., key file at index 13).
const ssh = (host: string, port: string, user: string, key = '') => `#109#0%${host}%${port}%${user}%%-1%-1%%%%%0%0%0%${key}%%-1%-1%0%0%%x%%0%0%1%%0%%%%0%-1%-1%0%%#MobaXterm#`;
const sftp = (host: string, port: string, user: string) => `#140#7%${host}%${port}%${user}%-1%0%%0%0%%0%%%%%%0#MobaXterm#`;

const INI = [
  '\uFEFF[Misc]',
  'SomeSetting=1',
  '[Bookmarks]',
  'SubRep=',
  'ImgNum=42',
  `web-01=${ssh('10.0.0.11', '22', 'deploy')}`,
  `db with key = ${ssh('10.0.0.21', '2222', 'postgres', '_ProfileDir_\\.ssh\\id_ed25519')}`,
  `files=${sftp('10.0.0.31', '5522', 'backup')}`,
  `switch=#98#1%192.168.0.2%23%%`,
  `console=#126#8%COM3%9600%0%0%0`,
  `desktop=#91#4%10.0.0.50%3389%admin%`,
  `remote-view=#128#5%10.0.0.51%5900%%`,
  `broken=#109#0%%22%user%`,
  'not a session line',
  '[Bookmarks_1]',
  'SubRep=Work\\Servers',
  'ImgNum=41',
  `app-01=${ssh('app.example.com', '22', 'ops')}`,
  '[Passwords]',
  'ops@app.example.com=SUPERSECRETVALUE',
  '[Sesspass]',
  'Check=ENCRYPTEDCHECKVALUE',
].join('\r\n');

test('mobaxterm: reads ssh, sftp, telnet and serial sessions', () => {
  const r = parseMobaXterm(INI, { profileDir: 'C:\\Users\\me' });
  const by = Object.fromEntries(r.sessions.map((s) => [s.name, s]));
  assert.deepEqual(by['web-01'], { name: 'web-01', kind: 'ssh', host: '10.0.0.11', port: 22, username: 'deploy', authMethod: 'password' });
  assert.equal(by['files'].kind, 'sftp');
  assert.equal(by['files'].port, 5522);
  assert.equal(by['files'].username, 'backup');
  assert.equal(by['switch'].kind, 'telnet');
  assert.equal(by['switch'].port, 23);
  assert.equal(by['console'].kind, 'serial');
  assert.equal(by['console'].serialPath, 'COM3');
  assert.equal(by['console'].baudRate, 9600);
});

test('mobaxterm: trims names, expands key path variables and switches to key auth', () => {
  const r = parseMobaXterm(INI, { profileDir: 'C:\\Users\\me' });
  const s = r.sessions.find((x) => x.name === 'db with key')!;
  assert.equal(s.authMethod, 'key');
  assert.equal(s.keyPath, 'C:\\Users\\me\\.ssh\\id_ed25519');
  assert.equal(s.port, 2222);
});

test('mobaxterm: a key file without an extension is still recognised from its slot', () => {
  const text = `[Bookmarks]\nSubRep=\nplain=${ssh('h.example.com', '22', 'u', 'D:\\keys\\prod_server')}\nnokey=${ssh('h2.example.com', '22', 'u', '')}\n`;
  const r = parseMobaXterm(text);
  const by = Object.fromEntries(r.sessions.map((s) => [s.name, s]));
  assert.equal(by['plain'].keyPath, 'D:\\keys\\prod_server');
  assert.equal(by['plain'].authMethod, 'key');
  assert.equal(by['nokey'].keyPath, undefined);
  assert.equal(by['nokey'].authMethod, 'password');
});

test('mobaxterm: folders come from SubRep and nest with a separator', () => {
  const r = parseMobaXterm(INI);
  assert.equal(r.sessions.find((s) => s.name === 'web-01')!.folder, undefined);
  assert.equal(r.sessions.find((s) => s.name === 'app-01')!.folder, 'Work / Servers');
});

test('mobaxterm: unsupported types are counted, incomplete entries are reported', () => {
  const r = parseMobaXterm(INI);
  const u = Object.fromEntries(unsupportedList(r).map((x) => [x.label, x.count]));
  assert.equal(u['RDP sessions'], 1);
  assert.equal(u['VNC sessions'], 1);
  assert.equal(u['Incomplete entries (no host name)'], 1);
  assert.equal(r.sessions.length, 6);
});

test('mobaxterm: never reads secrets', () => {
  const dump = JSON.stringify(parseMobaXterm(INI));
  assert.ok(!dump.includes('SUPERSECRETVALUE'));
  assert.ok(!dump.includes('ENCRYPTEDCHECKVALUE'));
});

test('mobaxterm: ignores files without sessions', () => {
  assert.equal(parseMobaXterm('[Misc]\nA=1\n').sessions.length, 0);
  assert.equal(parseMobaXterm('').sessions.length, 0);
});

test('mobaxterm: path variables', () => {
  assert.equal(expandMobaPath('_MyDocuments_\\k.ppk', { profileDir: 'C:\\U\\me' }), 'C:\\U\\me\\Documents\\k.ppk');
  assert.equal(expandMobaPath('_CurrentDrive_\\keys\\a.pem', { currentDrive: 'D:' }), 'D:\\keys\\a.pem');
});

const REG = `
HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Default%20Settings
    HostName    REG_SZ
    Protocol    REG_SZ    ssh

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\My%20Server
    HostName    REG_SZ    203.0.113.10
    PortNumber    REG_DWORD    0x16
    Protocol    REG_SZ    ssh
    UserName    REG_SZ    root
    PublicKeyFile    REG_SZ    C:\\keys\\prod.ppk

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Lab%2FSwitch
    HostName    REG_SZ    admin@192.0.2.7
    PortNumber    REG_DWORD    0x17
    Protocol    REG_SZ    telnet

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Console
    Protocol    REG_SZ    serial
    SerialLine    REG_SZ    COM4
    SerialSpeed    REG_DWORD    0x2580

HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\raw-socket
    HostName    REG_SZ    198.51.100.1
    Protocol    REG_SZ    raw
`;

test('putty: reads ssh, telnet and serial sessions from reg query output', () => {
  const r = parsePuttyRegQuery(REG);
  const by = Object.fromEntries(r.sessions.map((s) => [s.name, s]));
  assert.deepEqual(by['My Server'], { name: 'My Server', kind: 'ssh', host: '203.0.113.10', port: 22, username: 'root', authMethod: 'key', keyPath: 'C:\\keys\\prod.ppk' });
  assert.equal(by['Switch'].kind, 'telnet');
  assert.equal(by['Switch'].folder, 'Lab');
  assert.equal(by['Switch'].host, '192.0.2.7');
  assert.equal(by['Console'].serialPath, 'COM4');
  assert.equal(by['Console'].baudRate, 9600);
});

test('putty: skips Default Settings and reports unsupported protocols', () => {
  const r = parsePuttyRegQuery(REG);
  assert.ok(!r.sessions.some((s) => s.name === 'Default Settings'));
  assert.equal(r.unsupported.get('raw sessions'), 1);
  assert.equal(r.sessions.length, 3);
});

test('putty: name decoding and session files', () => {
  assert.equal(decodePuttyName('My%20Server%2FA'), 'My Server/A');
  const r = parsePuttySessionFile('web', 'Protocol=ssh\nHostName=deploy@example.org\nPortNumber=2200\n');
  assert.deepEqual(r.sessions[0], { name: 'web', kind: 'ssh', host: 'example.org', port: 2200, username: 'deploy', authMethod: 'password' });
});

const SSH_CONFIG = `
# global defaults
Host *
    User defaultuser
    ServerAliveInterval 30

Host web web-alias
    HostName 10.1.1.5
    Port 2201

Host db
    HostName db.internal
    User postgres
    IdentityFile ~/.ssh/id_ed25519

Host *.corp !bad
    User wildcard

Host behind
    HostName 10.9.9.9
    ProxyJump bastion

Match host something
    User ignored
`;

test('openssh: aliases become sessions, wildcards do not', () => {
  const r = parseOpenSshConfig(SSH_CONFIG, '/home/me');
  const names = r.sessions.map((s) => s.name);
  assert.deepEqual(names, ['web', 'web-alias', 'db', 'behind']);
});

test('openssh: options, defaults and key paths', () => {
  const r = parseOpenSshConfig(SSH_CONFIG, '/home/me');
  const by = Object.fromEntries(r.sessions.map((s) => [s.name, s]));
  assert.equal(by['web'].host, '10.1.1.5');
  assert.equal(by['web'].port, 2201);
  assert.equal(by['web'].username, 'defaultuser'); // from Host *
  assert.equal(by['db'].username, 'postgres'); // block value wins over the default
  assert.equal(by['db'].authMethod, 'key');
  assert.ok(by['db'].keyPath!.endsWith('.ssh' + (by['db'].keyPath!.includes('\\') ? '\\' : '/') + 'id_ed25519'));
});

test('openssh: jump hosts are imported with a note', () => {
  const r = parseOpenSshConfig(SSH_CONFIG);
  assert.ok(r.sessions.some((s) => s.name === 'behind'));
  assert.equal(notesList(r).length, 1);
  assert.equal(notesList(r)[0].count, 1);
});

test('duplicate detection key ignores name and case', () => {
  const a = sessionKey({ kind: 'ssh', host: 'Example.ORG', port: 22, username: 'Root' });
  const b = sessionKey({ kind: 'ssh', host: 'example.org', username: 'root' });
  assert.equal(a, b);
  assert.notEqual(a, sessionKey({ kind: 'sftp', host: 'example.org', port: 22, username: 'root' }));
  assert.notEqual(a, sessionKey({ kind: 'ssh', host: 'example.org', port: 2222, username: 'root' }));
});

test('splitUserHost', () => {
  assert.deepEqual(splitUserHost('me@host'), { username: 'me', host: 'host' });
  assert.deepEqual(splitUserHost('host'), { host: 'host' });
  assert.deepEqual(splitUserHost('@host'), { host: '@host' });
});
