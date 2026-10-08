import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayHex, joinHex, normalizeTheme, NIGHT, paintCss, parseHex, splitHex } from './theme.js';

test('reads hex colors the way Figma takes them', () => {
  assert.equal(parseHex('#fff'), '#ffffffff');
  assert.equal(parseHex('a2b'), '#aa22bbff');
  assert.equal(parseHex('#A2B4C6'), '#a2b4c6ff');
  assert.equal(parseHex('#a2b4c680'), '#a2b4c680');
  assert.equal(parseHex('#xa2'), null);
  assert.equal(displayHex('#a2b4c6ff'), '#A2B4C6');
  assert.equal(displayHex('#a2b4c680'), '#A2B4C680');
  assert.deepEqual(splitHex('#ff000080'), { rgb: '#ff0000', alpha: 50 });
  assert.equal(joinHex('#ff0000', 50), '#ff000080');
});

test('paints become CSS images, solid or gradient', () => {
  assert.equal(paintCss({ kind: 'solid', color: '#ff0000ff' }), 'linear-gradient(#ff0000ff, #ff0000ff)');
  assert.equal(paintCss({ kind: 'gradient', angle: 90, stops: ['#000', '#fff'] }), 'linear-gradient(90deg, #000, #fff)');
});

test('a saved theme missing roles gets the defaults', () => {
  const t = normalizeTheme({ appearance: 'system', dark: { ahead: { kind: 'solid', color: '#00ff00ff' } } });
  assert.equal(t.appearance, 'system');
  assert.deepEqual(t.dark.ahead, { kind: 'solid', color: '#00ff00ff' });
  assert.deepEqual(t.dark.behind, NIGHT.behind);
  assert.equal(normalizeTheme(undefined).appearance, 'dark');
});
