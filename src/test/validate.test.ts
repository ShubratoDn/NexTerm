import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSize, parseSessionInput, parseSettingsPatch } from '../main/validate';
import { assertBaseName, uniqueName } from '../main/sftp';

test('uniqueName avoids collisions and keeps extensions', () => {
  const taken = new Set(['a.txt', 'a (1).txt', 'noext', '.bashrc']);
  const free = (c: string) => taken.has(c);
  assert.equal(uniqueName('b.txt', free), 'b.txt');
  assert.equal(uniqueName('a.txt', free), 'a (2).txt');
  assert.equal(uniqueName('noext', free), 'noext (1)');
  assert.equal(uniqueName('.bashrc', free), '.bashrc (1)');
});

test('ssh session gets defaults', () => {
  const s = parseSessionInput({ name: 'web', kind: 'ssh', host: 'example.org' });
  assert.equal(s.port, 22);
  assert.equal(s.authMethod, 'password');
});

test('telnet default port', () => {
  assert.equal(parseSessionInput({ name: 't', kind: 'telnet', host: 'h' }).port, 23);
});

test('rejects bad input', () => {
  assert.throws(() => parseSessionInput(null));
  assert.throws(() => parseSessionInput({ name: 'x', kind: 'rdp' }));
  assert.throws(() => parseSessionInput({ name: '', kind: 'local' }));
  assert.throws(() => parseSessionInput({ name: 'x', kind: 'ssh', host: 'a b' }));
  assert.throws(() => parseSessionInput({ name: 'x', kind: 'ssh', host: 'h', port: 70000 }));
  assert.throws(() => parseSessionInput({ name: 'x', kind: 'ssh', host: 'h', authMethod: 'key' }));
  assert.throws(() => parseSessionInput({ name: 'x', kind: 'serial' }));
  assert.throws(() => parseSessionInput({ name: 'a\0b', kind: 'local' }));
});

test('password semantics: undefined keeps, null clears, string sets', () => {
  const base = { name: 'x', kind: 'ssh', host: 'h' };
  assert.equal(parseSessionInput(base).password, undefined);
  assert.equal(parseSessionInput({ ...base, password: null }).password, null);
  assert.equal(parseSessionInput({ ...base, password: 'pw' }).password, 'pw');
});

test('serial defaults', () => {
  const s = parseSessionInput({ name: 's', kind: 'serial', serialPath: 'COM3' });
  assert.equal(s.baudRate, 115200);
});

test('settings patch validation', () => {
  assert.deepEqual(parseSettingsPatch({ fontSize: 16, theme: 'light' }), { fontSize: 16, theme: 'light' });
  assert.throws(() => parseSettingsPatch({ fontSize: 2 }));
  assert.throws(() => parseSettingsPatch({ theme: 'blue' }));
  assert.throws(() => parseSettingsPatch('x'));
});

test('terminal size bounds', () => {
  assert.deepEqual(checkSize(80, 24), { cols: 80, rows: 24 });
  assert.throws(() => checkSize(0, 24));
  assert.throws(() => checkSize(80, 'a'));
  assert.throws(() => checkSize(undefined, undefined));
});

test('sftp base name check', () => {
  assertBaseName('file.txt');
  for (const bad of ['', '.', '..', 'a/b', 'a\\b']) assert.throws(() => assertBaseName(bad));
});
