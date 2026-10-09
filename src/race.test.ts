import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestFor, pairKey, paceVsBest, rankOf, retext, runFromTemplate, saveAsTemplate, similar, templateFromText, templateRecord, templateText } from './race.js';
import { addTasks, completeActive, newRun, parseTaskList, startTask, taskKey, type Run } from './runs.js';

const MIN = 60_000;

/** Plays a template through: each task takes the given minutes. */
function play(tpl: ReturnType<typeof templateFromText>, minutes: number[], start = 0): Run {
  const run = runFromTemplate(tpl, new Date(start));
  let t = start;
  startTask(run, run.tasks[0].id, t);
  for (const m of minutes) completeActive(run, (t += m * MIN));
  run.endedAt = new Date(t).toISOString();
  return run;
}

test('task names match without dates, numbers, weekdays or estimates', () => {
  assert.equal(taskKey('Emails 9.10.'), 'emails');
  assert.equal(taskKey('emails!'), 'emails');
  assert.equal(taskKey('Emails (Mon) 15m'), 'emails');
  assert.equal(taskKey('Reply to emails – Freitag'), 'reply to emails');
  assert.ok(similar('reply emails', 'reply to emails'));
  assert.ok(!similar('call mom', 'call max'));
});

test('templates round-trip as text and keep task ids for unchanged names', () => {
  const tpl = templateFromText('Morning', '- Mails 10m\n- Plan\n  - Calendar 5m\n  - Goals 15m');
  assert.equal(templateText(tpl), '- Mails 10m\n- Plan\n  - Calendar 5m\n  - Goals 15m');
  const edited = retext(tpl, '- Mails 8m\n- Stretch 5m\n- Plan\n  - Calendar 5m');
  assert.equal(edited.tasks[0].id, tpl.tasks[0].id);
  assert.notEqual(edited.tasks[1].id, tpl.tasks[1].id);
  assert.equal(edited.tasks.find((t) => t.title === 'Calendar')!.parentId, edited.tasks.find((t) => t.title === 'Plan')!.id);
});

test('racing a template: best run, rank, pace and per-task best', () => {
  const tpl = templateFromText('Morning', '- Mails 10m\n- Calendar 5m\n- Planning 15m');
  const slow = play(tpl, [9, 4, 14]);
  const fast = play(tpl, [8, 3, 10], 100 * MIN);
  const reset = runFromTemplate(tpl, new Date(200 * MIN));
  reset.resetAt = reset.endedAt = new Date(201 * MIN).toISOString();
  const record = templateRecord(tpl.id, [slow, fast, reset]);
  assert.equal(record.best, fast);
  assert.deepEqual([record.attempts, record.resets, rankOf(slow, record)], [3, 1, 2]);

  // Today: Mails in 7:30, Calendar running 3:30 so far.
  const now = runFromTemplate(tpl, new Date(300 * MIN));
  startTask(now, now.tasks[0].id, 300 * MIN);
  completeActive(now, 300 * MIN + 7.5 * MIN);
  assert.equal(paceVsBest(now, fast, 300 * MIN + 9 * MIN), -0.5 * MIN); // Calendar not over yet
  assert.equal(paceVsBest(now, fast, 300 * MIN + 11 * MIN), 0); // Calendar 3:30 vs 3:00: +0:30
  const best = bestFor(now.tasks[1], now, [slow, fast, reset]);
  assert.equal(best?.ms, 3 * MIN);
});

test('free sessions find the best time by name, skipping mistakes and ruled-out matches', () => {
  const old = newRun('manual', new Date(0));
  addTasks(old, parseTaskList('- Emails 15m\n- Call Max 10m\n- Reply emails 15m'));
  startTask(old, old.tasks[0].id, 0);
  completeActive(old, 12 * MIN); // Emails 12:00
  completeActive(old, 12 * MIN + 2000); // Call Max ticked by mistake after 2s
  completeActive(old, 22 * MIN); // Reply emails 9:58
  old.endedAt = new Date(22 * MIN).toISOString();

  const today = newRun('manual', new Date(100 * MIN));
  addTasks(today, parseTaskList('- Emails 9.10.\n- Call Max\n- Reply to emails'));
  assert.equal(bestFor(today.tasks[0], today, [old])?.ms, 12 * MIN);
  assert.equal(bestFor(today.tasks[1], today, [old]), undefined); // 2s against a 10m estimate: a mistake
  assert.equal(bestFor(today.tasks[2], today, [old])?.ms, 10 * MIN - 2000);
  assert.equal(bestFor(today.tasks[2], today, [old], [pairKey('reply to emails', 'reply emails')]), undefined);
});

test('saving a finished session as a template makes it the run to beat', () => {
  const run = newRun('manual', new Date(0));
  addTasks(run, parseTaskList('- A 5m\n- B 5m'));
  startTask(run, run.tasks[0].id, 0);
  completeActive(run, 4 * MIN);
  completeActive(run, 9 * MIN);
  run.endedAt = new Date(9 * MIN).toISOString();
  const tpl = saveAsTemplate(run, 'AB');
  assert.equal(templateRecord(tpl.id, [run]).best, run);
});
