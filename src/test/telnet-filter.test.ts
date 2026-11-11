import test from 'node:test';
import assert from 'node:assert/strict';
import { TelnetFilter, escapeOutgoing } from '../main/telnet-filter';

const IAC = 255, DO = 253, DONT = 254, WILL = 251, WONT = 252, SB = 250, SE = 240;

test('plain data passes through', () => {
  const f = new TelnetFilter();
  const r = f.process(Buffer.from('hello'));
  assert.equal(r.output.toString(), 'hello');
  assert.equal(r.replies.length, 0);
});

test('escaped IAC becomes a literal 0xFF', () => {
  const r = new TelnetFilter().process(Buffer.from([65, IAC, IAC, 66]));
  assert.deepEqual([...r.output], [65, 255, 66]);
});

test('unsupported DO is refused with WONT', () => {
  const r = new TelnetFilter().process(Buffer.from([IAC, DO, 99]));
  assert.deepEqual([...r.replies], [IAC, WONT, 99]);
  assert.equal(r.output.length, 0);
});

test('WILL ECHO/SGA accepted, other WILL refused', () => {
  const f = new TelnetFilter();
  assert.deepEqual([...f.process(Buffer.from([IAC, WILL, 1])).replies], [IAC, DO, 1]);
  assert.deepEqual([...f.process(Buffer.from([IAC, WILL, 3])).replies], [IAC, DO, 3]);
  assert.deepEqual([...f.process(Buffer.from([IAC, WILL, 50])).replies], [IAC, DONT, 50]);
});

test('commands split across chunks are reassembled', () => {
  const f = new TelnetFilter();
  const a = f.process(Buffer.from([72, IAC]));
  const b = f.process(Buffer.from([DO]));
  const c = f.process(Buffer.from([99, 73]));
  assert.equal(a.output.toString(), 'H');
  assert.equal(b.output.length, 0);
  assert.deepEqual([...c.replies], [IAC, WONT, 99]);
  assert.equal(c.output.toString(), 'I');
});

test('terminal type request is answered', () => {
  const f = new TelnetFilter('vt100');
  assert.deepEqual([...f.process(Buffer.from([IAC, DO, 24])).replies], [IAC, WILL, 24]);
  const r = f.process(Buffer.from([IAC, SB, 24, 1, IAC, SE]));
  assert.deepEqual([...r.replies], [IAC, SB, 24, 0, ...Buffer.from('vt100'), IAC, SE]);
});

test('NAWS announces size and escapes 255', () => {
  const f = new TelnetFilter();
  f.setSize(255, 24);
  const r = f.process(Buffer.from([IAC, DO, 31]));
  assert.deepEqual([...r.replies], [IAC, WILL, 31, IAC, SB, 31, 0, IAC, IAC, 0, 24, IAC, SE]);
  // later resizes are sent as frames
  assert.deepEqual([...f.setSize(80, 30)], [IAC, SB, 31, 0, 80, 0, 30, IAC, SE]);
});

test('outgoing 0xFF is doubled', () => {
  assert.deepEqual([...escapeOutgoing(Buffer.from([1, 255, 2]))], [1, 255, 255, 2]);
  const same = Buffer.from('abc');
  assert.equal(escapeOutgoing(same), same);
});
