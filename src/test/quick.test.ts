import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickTarget } from '../shared/quick';

test('parses user@host:port', () => {
  assert.deepEqual(parseQuickTarget('root@10.0.0.5:2222'), { host: '10.0.0.5', port: 2222, username: 'root' });
});

test('parses bare host and host:port', () => {
  assert.deepEqual(parseQuickTarget('example.org'), { host: 'example.org', port: undefined, username: undefined });
  assert.deepEqual(parseQuickTarget('example.org:23'), { host: 'example.org', port: 23, username: undefined });
});

test('handles IPv6', () => {
  assert.deepEqual(parseQuickTarget('[::1]:2222'), { host: '::1', port: 2222, username: undefined });
  assert.deepEqual(parseQuickTarget('u@[fe80::1]'), { host: 'fe80::1', port: undefined, username: 'u' });
  assert.deepEqual(parseQuickTarget('fe80::1'), { host: 'fe80::1', port: undefined, username: undefined });
});

test('user names may contain @', () => {
  assert.deepEqual(parseQuickTarget('me@corp.com@host'), { host: 'host', port: undefined, username: 'me@corp.com' });
});

test('rejects unusable input', () => {
  for (const bad of ['', '  ', 'a b', '@host', 'host:abc', 'host:0', 'host:70000', 'u@']) {
    assert.equal(parseQuickTarget(bad), null, bad);
  }
});
