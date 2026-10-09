import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addTasks, completeActive, goldSplits, moveTask, newRun, nextTask, parseDuration, parseQuickAdd,
  parseTaskList, projectedRemaining, removeTask, resume, runEstimate, startTask, summarize, totalElapsed,
  pause, pausedTotal, sessionElapsed, timeSaved, totalEstimate, parseTimeInput, reopenTask, setElapsed,
  addSubtask, toggleDone, ancestorsOf, matchKey, similarity, templateFromRun, runFromTemplate, templateRecord, templateToText,
  templateFromText, bestFor, bestIndex, pbPace, medal, pairKey, type Run,
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

test('counts time saved against estimates', () => {
  const run = newRun('manual', new Date(0));
  addTasks(run, parseTaskList('- A 30m\n- B 10m\n- C\n- D 5m'));
  const [a, b, c, d] = run.tasks;
  assert.equal(timeSaved(run, 0), undefined);
  a.elapsedMs = 20 * MIN; a.done = true; // 10m saved
  b.elapsedMs = 15 * MIN; b.done = true; // 5m lost
  c.elapsedMs = 60 * MIN; c.done = true; // no estimate, ignored
  d.elapsedMs = 3 * MIN; // running under estimate: nothing saved yet
  assert.deepEqual(timeSaved(run, 0), { savedMs: 5 * MIN, plannedMs: 40 * MIN, actualMs: 35 * MIN });
  d.elapsedMs = 9 * MIN; // 4m over and still going
  assert.equal(timeSaved(run, 0)!.savedMs, 1 * MIN);
});

test('counts pause time and leaves it out of the session unless asked', () => {
  const run = newRun('manual', new Date(0));
  addTasks(run, parseTaskList('- A\n- B'));
  startTask(run, run.tasks[0].id, 0);
  pause(run, 10 * MIN); // 10m work, then a 5m pause
  assert.equal(pausedTotal(run, 15 * MIN), 5 * MIN);
  resume(run, 15 * MIN);
  pause(run, 20 * MIN); // 5m more work, then a pause still going on
  assert.equal(pausedTotal(run, 22 * MIN), 7 * MIN);
  assert.equal(sessionElapsed(run, false, 22 * MIN), 15 * MIN);
  assert.equal(sessionElapsed(run, true, 22 * MIN), 22 * MIN);
  startTask(run, run.tasks[1].id, 23 * MIN); // switching tasks ends the pause too
  assert.equal(run.pausedSince, undefined);
  assert.equal(pausedTotal(run, 30 * MIN), 8 * MIN);
});

test('parses corrected times', () => {
  assert.equal(parseTimeInput('12:30'), (12 * 60 + 30) * 1000);
  assert.equal(parseTimeInput('1:02:03'), (3600 + 120 + 3) * 1000);
  assert.equal(parseTimeInput('25m'), 25 * MIN);
  assert.equal(parseTimeInput('12:75'), undefined);
  assert.equal(parseTimeInput('soon'), undefined);
});

test('correcting a time keeps a running task running, and finished tasks can be picked back up', () => {
  const run = newRun('manual', new Date(0));
  addTasks(run, parseTaskList('- A 10m\n- B'));
  const [a, b] = run.tasks;
  startTask(run, a.id, 0);
  setElapsed(run, a.id, 5 * MIN, 2 * MIN); // forgot to start 3 minutes earlier
  assert.equal(totalElapsed(run, a, 3 * MIN), 6 * MIN);
  completeActive(run, 3 * MIN);
  assert.equal(a.done, true);
  reopenTask(run, a.id, 10 * MIN);
  assert.equal(a.done, false);
  assert.equal(run.activeTaskId, a.id);
  assert.equal(totalElapsed(run, a, 11 * MIN), 7 * MIN);
  assert.equal(b.elapsedMs, 7 * MIN); // B ran from 3 to 10 before A was picked back up
});

test('subtasks roll up, take over the clock from their parent, and count the most detailed estimate', () => {
  const run = addTasks(newRun('manual'), parseTaskList('- Build page 1h\n- Emails 10m'));
  const [page, emails] = run.tasks;
  startTask(run, page.id, 0);
  addSubtask(run, page.id, parseQuickAdd('Hero 20m')!.task, 5 * MIN);
  addSubtask(run, page.id, parseQuickAdd('Pricing 15m')!.task, 5 * MIN);
  const [, hero, pricing] = run.tasks;
  assert.deepEqual(run.tasks.map((t) => t.title), ['Build page', 'Hero', 'Pricing', 'Emails']);
  assert.equal(run.activeTaskId, hero.id, 'the clock moves to the first subtask');
  assert.deepEqual(ancestorsOf(run, pricing).map((t) => t.id), [page.id]);
  completeActive(run, 15 * MIN); // Hero: 10m against 20m
  assert.equal(run.activeTaskId, pricing.id);
  completeActive(run, 35 * MIN); // Pricing: 20m against 15m
  assert.equal(totalElapsed(run, page, 35 * MIN), 35 * MIN, 'the parent keeps its own 5m and adds its subtasks');
  assert.equal(run.activeTaskId, emails.id);
  // Subtask estimates count, the parent's 1h doesn't count twice: +10m, -5m.
  assert.equal(timeSaved(run, 35 * MIN)?.savedMs, 5 * MIN);
});

test('ticking a group ticks all its subtasks and moves the clock on', () => {
  const run = addTasks(newRun('manual'), parseTaskList('- Build\n  - A\n  - B\n- C'));
  const [build, a, b, c] = run.tasks;
  startTask(run, a.id, 0);
  toggleDone(run, build.id, MIN);
  assert.equal(a.done && b.done, true);
  assert.equal(run.activeTaskId, c.id);
  toggleDone(run, build.id, 2 * MIN);
  assert.equal(a.done || b.done, false);
});

test('task names boil down so the same task matches, with or without dates and estimates', () => {
  assert.equal(matchKey('Emails 9.10.'), 'emails');
  assert.equal(matchKey('emails!'), 'emails');
  assert.equal(matchKey('Emails (Mon) 15m'), 'emails');
  assert.equal(matchKey('Reply to emails – Freitag'), 'reply to emails');
  assert.ok(similarity('reply emails', 'reply to emails') >= 0.7);
  assert.ok(similarity('call mom', 'call max') < 0.7);
});

/** A finished session of a template, each task taking the given minutes. */
function attempt(tpl: ReturnType<typeof templateFromRun>, minutes: number[], at: number): Run {
  const run = runFromTemplate(tpl, new Date(at));
  run.tasks.forEach((t, i) => {
    t.elapsedMs = minutes[i] * MIN;
    t.done = true;
  });
  run.endedAt = new Date(at + 1).toISOString();
  return run;
}

test('templates keep their tasks, race by task, and know your PB and what is possible', () => {
  const first = addTasks(newRun('manual'), parseTaskList('- Mails 10m\n- Calendar 5m\n- Plan 15m'));
  const tpl = templateFromRun(first, 'Morning');
  assert.equal(templateToText(tpl), '- Mails 10m\n- Calendar 5m\n- Plan 15m');
  const a = attempt(tpl, [8, 3, 12], Date.UTC(2026, 9, 1));
  const b = attempt(tpl, [6, 4, 13], Date.UTC(2026, 9, 2));
  const reset = runFromTemplate(tpl, new Date(Date.UTC(2026, 9, 3)));
  reset.tasks[0].elapsedMs = 5 * MIN;
  reset.tasks[0].done = true;
  reset.reset = true;
  const rec = templateRecord(tpl, [a, b, reset]);
  assert.equal(rec.attempts, 3);
  assert.equal(rec.resets, 1);
  assert.equal(rec.pb?.ms, 23 * MIN, 'a reset never counts as a run');
  assert.equal(rec.sumOfBest, (5 + 3 + 12) * MIN, 'bests from every attempt, reset ones too');

  // Racing: the template task's best, even after a rename.
  const now = runFromTemplate(tpl, new Date(Date.UTC(2026, 9, 4)));
  now.tasks[1].title = 'Calendar and todos';
  assert.equal(bestFor(now.tasks[1], now, [a, b], bestIndex([a, b]), [])?.ms, 3 * MIN);
  // PB pace: 7m on Mails against the PB's 8m, and 4m into Calendar, already past its 3m.
  now.tasks[0].elapsedMs = 7 * MIN;
  now.tasks[0].done = true;
  now.tasks[1].elapsedMs = 4 * MIN;
  assert.equal(pbPace(now, rec.pb!.tasks), 0);

  // Editing the text keeps the ids of tasks whose names stay.
  const edited = templateFromText(tpl, '- Mails 10m\n- Stretch 5m\n- Plan 20m');
  assert.equal(edited.tasks[0].id, tpl.tasks[0].id);
  assert.notEqual(edited.tasks[1].id, tpl.tasks[1].id);
  assert.equal(edited.tasks[2].estimateMs, 20 * MIN);
});

test('free tasks race a similar name unless you said it is not the same task', () => {
  const past = addTasks(newRun('manual'), parseTaskList('- Reply to emails 9.10. 20m\n- Call Mom'));
  past.tasks[0].elapsedMs = 12 * MIN;
  past.tasks[0].done = true;
  past.tasks[1].elapsedMs = 6 * MIN;
  past.tasks[1].done = true;
  const now = addTasks(newRun('manual'), parseTaskList('- reply emails\n- Call Max\n- Accident 30m'));
  const index = bestIndex([past]);
  const best = bestFor(now.tasks[0], now, [past], index, []);
  assert.equal(best?.ms, 12 * MIN);
  assert.equal(best?.fuzzy, true);
  assert.equal(bestFor(now.tasks[0], now, [past], index, [pairKey('reply emails', 'reply to emails')]), undefined);
  assert.equal(bestFor(now.tasks[1], now, [past], index, []), undefined);
  // Medals: gold beats your best, silver is under the estimate, bronze up to 10 % over.
  const t = { ...now.tasks[2], done: true, elapsedMs: 32 * MIN };
  assert.equal(medal(t, undefined), 'bronze');
  assert.equal(medal({ ...t, elapsedMs: 25 * MIN }, undefined), 'silver');
  assert.equal(medal({ ...t, elapsedMs: 25 * MIN }, { ms: 26 * MIN, from: '', at: '', key: '', fuzzy: false }), 'gold');
});
