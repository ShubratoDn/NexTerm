import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CLIPBOARD_FILES, parseEncodedPaths, parseUriList } from '../main/os-clipboard';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

test('paths printed by the Windows reader are decoded, accents and spaces included', () => {
  const out = [b64('C:\\Users\\me\\café notes.txt'), b64('D:\\data\\folder one'), ''].join('\r\n');
  assert.deepEqual(parseEncodedPaths(out), ['C:\\Users\\me\\café notes.txt', 'D:\\data\\folder one']);
});

test('anything that is not a base64 line or not an absolute path is ignored', () => {
  assert.deepEqual(parseEncodedPaths(['hello world!', b64('relative\\path.txt'), b64('a\0b'), b64('C:\\ok.txt')].join('\n')), ['C:\\ok.txt']);
  assert.deepEqual(parseEncodedPaths(''), []);
});

test('the number of files taken is limited', () => {
  const many = Array.from({ length: MAX_CLIPBOARD_FILES + 50 }, (_, i) => b64(`C:\\f\\${i}.txt`)).join('\n');
  assert.equal(parseEncodedPaths(many).length, MAX_CLIPBOARD_FILES);
});

test('file URIs from a Linux file manager are turned into paths', { skip: process.platform === 'win32' }, () => {
  const text = 'copy\nfile:///home/me/My%20File.txt\nfile:///home/me/dir\n# comment\nhttps://example.com/x\n';
  assert.deepEqual(parseUriList(text), ['/home/me/My File.txt', '/home/me/dir']);
});

test('URIs that are not local files are ignored', () => {
  assert.deepEqual(parseUriList('https://example.com/a\nftp://host/b\n'), []);
});
