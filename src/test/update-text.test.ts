import test from 'node:test';
import assert from 'node:assert/strict';
import { describeUpdate } from '../shared/update-text';

test('a portable copy explains why it cannot update and offers no buttons', () => {
  const v = describeUpdate({ state: 'unsupported', current: '0.6.0', message: 'This is a portable copy.' });
  assert.equal(v.text, 'This is a portable copy.');
  assert.equal(v.canCheck, false);
  assert.equal(v.canInstall, false);
});

test('while downloading, the version and percentage are shown and nothing can be clicked', () => {
  const v = describeUpdate({ state: 'downloading', current: '0.6.0', version: '0.6.1', percent: 42 });
  assert.match(v.text, /0\.6\.1.*42%/);
  assert.equal(v.canCheck, false);
  assert.equal(v.canInstall, false);
});

test('a downloaded update can be installed', () => {
  const v = describeUpdate({ state: 'ready', current: '0.6.0', version: '0.6.1' });
  assert.match(v.text, /0\.6\.1 is downloaded/);
  assert.equal(v.canInstall, true);
});

test('being up to date and failing both allow checking again', () => {
  assert.equal(describeUpdate({ state: 'current', current: '0.6.1', checkedAt: Date.now() }).canCheck, true);
  const e = describeUpdate({ state: 'error', current: '0.6.0', message: 'Could not reach the update server.' });
  assert.match(e.text, /Could not reach the update server/);
  assert.equal(e.canCheck, true);
});

test('before the state is known nothing is offered', () => {
  const v = describeUpdate(null);
  assert.equal(v.canCheck, false);
  assert.equal(v.canInstall, false);
});
