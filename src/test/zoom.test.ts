import test from 'node:test';
import assert from 'node:assert/strict';
import { ZOOM_DEFAULT, filesFontSize, nextZoom } from '../shared/zoom';

test('zooming over the terminal or files changes only those, not the interface', () => {
  const z = nextZoom(ZOOM_DEFAULT, 1, 'content');
  assert.equal(z.fontSize, 14);
  assert.equal(z.uiFontSize, 13);
  assert.equal(filesFontSize(z.uiFontSize, z.filesFontOffset), 14);
  const out = nextZoom(z, -2, 'content');
  assert.equal(out.fontSize, 12);
  assert.equal(filesFontSize(out.uiFontSize, out.filesFontOffset), 12);
});

test('zooming anywhere else changes the interface, and the terminal and files follow', () => {
  const z = nextZoom(ZOOM_DEFAULT, 2, 'interface');
  assert.equal(z.uiFontSize, 15);
  assert.equal(z.fontSize, 15);
  assert.equal(filesFontSize(z.uiFontSize, z.filesFontOffset), 15);
});

test('the file browser keeps its own offset when the interface changes', () => {
  const big = nextZoom(ZOOM_DEFAULT, 3, 'content'); // files 16, interface 13
  const ui = nextZoom(big, 1, 'interface'); // interface 14
  assert.equal(filesFontSize(ui.uiFontSize, ui.filesFontOffset), 17);
});

test('limits are respected and the terminal never drifts from the interface at a limit', () => {
  let z = ZOOM_DEFAULT;
  for (let i = 0; i < 50; i++) z = nextZoom(z, 1, 'interface');
  assert.equal(z.uiFontSize, 20);
  assert.equal(z.fontSize, 20); // 13 + 7, and not a pixel more
  const again = nextZoom(z, 1, 'interface');
  assert.deepEqual(again, z);
  let t = ZOOM_DEFAULT;
  for (let i = 0; i < 100; i++) t = nextZoom(t, -1, 'content');
  assert.equal(t.fontSize, 8);
  assert.equal(filesFontSize(t.uiFontSize, t.filesFontOffset), 9);
});

test('reset restores everything', () => {
  const z = nextZoom(nextZoom(ZOOM_DEFAULT, 4, 'interface'), 3, 'content');
  assert.deepEqual(nextZoom(z, 'reset', 'content'), ZOOM_DEFAULT);
  assert.deepEqual(nextZoom(z, 'reset', 'interface'), ZOOM_DEFAULT);
});
