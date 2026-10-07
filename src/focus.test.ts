import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, Nudger, sourceKey, STREAK_MS } from './focus.js';

test('classifies browser tabs by site and apps by name', () => {
  assert.equal(classify({ app: 'Google Chrome', url: 'https://www.youtube.com/watch?v=1' }), 'distraction');
  assert.equal(classify({ app: 'Google Chrome', url: 'https://m.youtube.com/' }), 'distraction');
  assert.equal(classify({ app: 'Safari', url: 'https://github.com/x/y' }), 'work');
  assert.equal(classify({ app: 'Safari', url: 'https://www.google.com/search?q=css' }), 'context');
  assert.equal(classify({ app: 'Figma' }), 'work');
  assert.equal(classify({ app: 'Visual Studio Code' }), 'work');
  assert.equal(classify({ app: 'Slack' }), 'context');
  assert.equal(classify({ app: 'Google Chrome' }), 'context');
});

test('sites you mark as part of a task count as work for that task', () => {
  const f = { app: 'Google Chrome', url: 'https://youtube.com/watch?v=tutorial' };
  assert.equal(sourceKey(f), 'youtube.com');
  assert.equal(classify(f, ['youtube.com']), 'work');
});

test('short hops never nudge, a long distraction does', () => {
  const n = new Nudger();
  let t = 0;
  const feed = (kind: 'work' | 'distraction', key: string, seconds: number) => {
    let last = null;
    for (let i = 0; i < seconds; i++) last = n.observe(kind, key, 1000, (t += 1000));
    return last;
  };
  feed('work', 'Figma', 120);
  assert.equal(feed('distraction', 'youtube.com', 45), null);
  feed('work', 'Figma', 300);
  assert.equal(feed('distraction', 'x.com', STREAK_MS / 1000 - 5), null);
  const nudge = feed('distraction', 'x.com', 10);
  assert.equal(nudge?.key, 'x.com');
  n.dismiss(t);
  assert.equal(feed('distraction', 'x.com', 60), null);
});
