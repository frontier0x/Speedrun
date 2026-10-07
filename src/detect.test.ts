import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangeTracker, classifyChange, normalizeTitle } from './detect.js';
import { dHash, hammingDistance } from './hash.js';

const chrome = (url: string, title = 'Docs') => ({ app: 'Google Chrome', bundleId: 'com.google.Chrome', title, url });
const code = { app: 'Code', bundleId: 'com.microsoft.VSCode', title: 'main.ts — speedrun' };

test('classifies app, tab and title changes', () => {
  assert.equal(classifyChange(undefined, code), 'app_switch');
  assert.equal(classifyChange(code, chrome('https://a.com')), 'app_switch');
  assert.equal(classifyChange(chrome('https://a.com'), chrome('https://b.com')), 'tab_switch');
  assert.equal(classifyChange(chrome('https://a.com/#x'), chrome('https://a.com/#y')), null);
  assert.equal(classifyChange(code, { ...code, title: 'store.ts — speedrun' }), 'title_change');
});

test('ignores unread counters and clocks in titles', () => {
  assert.equal(normalizeTitle('(3) Inbox - Gmail'), normalizeTitle('(12) Inbox - Gmail'));
  assert.equal(normalizeTitle('Standup 10:41'), normalizeTitle('Standup 10:42'));
});

test('only fires once a change has settled', () => {
  const t = new ChangeTracker(1500);
  assert.equal(t.poll(code, 0), null);
  assert.equal(t.poll(code, 1500)?.kind, 'app_switch');
  // Quick alt-tab away and back: nothing fires.
  assert.equal(t.poll(chrome('https://a.com'), 2000), null);
  assert.equal(t.poll(code, 2500), null);
  assert.equal(t.poll(code, 5000), null);
  // A real switch fires after it settles, and only once.
  assert.equal(t.poll(chrome('https://a.com'), 6000), null);
  assert.equal(t.poll(chrome('https://a.com'), 7600)?.kind, 'app_switch');
  assert.equal(t.poll(chrome('https://a.com'), 9000), null);
});

test('screen hash is stable for near-identical screens and differs for new ones', () => {
  const w = 64, h = 48;
  const gradient = new Uint8Array(w * h * 4);
  const flipped = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = (x * 4 + y) % 256;
    gradient.fill(v, i, i + 3);
    flipped.fill(255 - v, i, i + 3);
  }
  const noisy = gradient.map((v, i) => (i % 97 === 0 ? Math.min(255, v + 3) : v));
  assert.ok(hammingDistance(dHash(gradient, w, h), dHash(noisy, w, h)) <= 4);
  assert.ok(hammingDistance(dHash(gradient, w, h), dHash(flipped, w, h)) > 20);
});
