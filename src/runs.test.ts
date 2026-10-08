import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addTasks, completeActive, formatClock, goldSplits, moveTask, newRun, nextTask, parseDuration, parseQuickAdd,
  parseTaskList, projectedRemaining, removeTask, resume, runEstimate, startTask, summarize, totalElapsed,
  totalEstimate,
} from './runs.js';

const MIN = 60_000;

test('parses durations', () => {
  assert.equal(parseDuration('25m'), 25 * MIN);
  assert.equal(parseDuration('1h30m'), 90 * MIN);
  assert.equal(parseDuration('1.5h'), 90 * MIN);
  assert.equal(parseDuration('45min'), 45 * MIN);
  assert.equal(parseDuration('2std'), 120 * MIN);
  assert.equal(parseDuration('20'), 20 * MIN);
  assert.equal(parseDuration('soon'), undefined);
});

test('imports notes with sections, checkboxes and estimates', () => {
  const tasks = parseTaskList(`
# Launch
- Write landing copy ~45m
- [x] Buy domain (5m)
- Build page
  - Hero section [1h]
  - Pricing table 30m
Reply to emails
`);
  const titles = tasks.map((t) => t.title);
  assert.deepEqual(titles, ['Launch', 'Write landing copy', 'Buy domain', 'Build page', 'Hero section', 'Pricing table', 'Reply to emails']);
  const byTitle = Object.fromEntries(tasks.map((t) => [t.title, t]));
  assert.equal(byTitle['Write landing copy'].estimateMs, 45 * MIN);
  assert.equal(byTitle['Buy domain'].done, true);
  assert.equal(byTitle['Hero section'].parentId, byTitle['Build page'].id);
  assert.equal(byTitle['Build page'].parentId, byTitle['Launch'].id);
  assert.equal(byTitle['Reply to emails'].parentId, byTitle['Launch'].id);

  const run = addTasks(newRun('manual'), tasks);
  assert.equal(totalEstimate(run, byTitle['Build page']), 90 * MIN);
  assert.equal(runEstimate(run), 45 * MIN + 5 * MIN + 90 * MIN); // the heading section rolls up everything under it
});

test('quick add supports estimates and "!" for top priority', () => {
  const q = parseQuickAdd('! Fix login bug 20m')!;
  assert.equal(q.urgent, true);
  assert.equal(q.task.title, 'Fix login bug');
  assert.equal(q.task.estimateMs, 20 * MIN);
  assert.equal(parseQuickAdd('   '), null);
});

test('splitting finishes the task, starts the next and rolls time up into sections', () => {
  const run = addTasks(newRun('manual'), parseTaskList('- Build\n  - A ~10m\n  - B ~10m\n- C'));
  const [build, a, b, c] = run.tasks;
  assert.equal(nextTask(run)?.id, a.id);
  resume(run, 0);
  assert.equal(run.activeTaskId, a.id);
  completeActive(run, 8 * MIN);
  assert.equal(a.done, true);
  assert.equal(a.elapsedMs, 8 * MIN);
  assert.equal(run.activeTaskId, b.id);
  assert.equal(totalElapsed(run, build, 11 * MIN), 11 * MIN);
  assert.equal(projectedRemaining(run, 11 * MIN), 7 * MIN);
  completeActive(run, 20 * MIN);
  assert.equal(run.activeTaskId, c.id);
  completeActive(run, 25 * MIN);
  assert.ok(run.endedAt);
  assert.equal(summarize(run).tasksDone, 3);
  assert.equal(summarize(run).onEstimateRate, 0.5);
});

test('switching tasks banks the time on the previous one', () => {
  const run = addTasks(newRun('manual'), parseTaskList('- A\n- B'));
  const [a, b] = run.tasks;
  startTask(run, a.id, 0);
  startTask(run, b.id, 5 * MIN);
  assert.equal(a.elapsedMs, 5 * MIN);
  assert.equal(a.done, false);
});

test('reordering and removing keep subtasks with their section', () => {
  const run = addTasks(newRun('manual'), parseTaskList('- A\n- S\n  - S1\n- B'));
  const ids = () => run.tasks.map((t) => t.title).join(',');
  moveTask(run, run.tasks[1].id, run.tasks[0].id);
  assert.equal(ids(), 'S,S1,A,B');
  moveTask(run, run.tasks[2].id, null);
  assert.equal(ids(), 'S,S1,B,A');
  removeTask(run, run.tasks[0].id);
  assert.equal(ids(), 'B,A');
});

test('gold splits keep the best time per task across runs', () => {
  const r1 = addTasks(newRun('manual'), parseTaskList('- Inbox zero'));
  r1.tasks[0].done = true;
  r1.tasks[0].elapsedMs = 20 * MIN;
  const r2 = addTasks(newRun('manual'), parseTaskList('- inbox  zero'));
  r2.tasks[0].done = true;
  r2.tasks[0].elapsedMs = 12 * MIN;
  assert.equal(goldSplits([r1, r2]).get('inbox zero'), 12 * MIN);
});

test('the big timer always shows hours, minutes, seconds and milliseconds', () => {
  assert.deepEqual(formatClock(0), { main: '0:00:00', ms: '.000' });
  assert.deepEqual(formatClock(4 * MIN + 7250), { main: '0:04:07', ms: '.250' });
  assert.deepEqual(formatClock(2 * 60 * MIN + 5), { main: '2:00:00', ms: '.005' });
});
