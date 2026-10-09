// The end of a session: what you saved (or, for a template, how the run went) and what to do next.

import {
  ancestorsOf, childrenOf, formatDuration, formatEstimate, isComplete, isSection, isSectionDone, liveElapsed, medal, pausedTotal, pbPace, runElapsed,
  sessionElapsed, taskKey, timeSaved, totalElapsed, totalEstimate, type Run, type Task,
} from '../runs.js';
import { $, clockParts, bestOf, el, ordinal, ui } from './shared.js';

// ---------- summary ----------

/** End of a session: the big number is the time you saved (green) or lost (red) against your estimates. */
export function renderSummary(run: Run) {
  const saved = timeSaved(run);
  const total = sessionElapsed(run, ui.state.settings.pausesCount);
  const net = saved?.savedMs ?? 0;
  const rec = ui.state.record;
  const label = $('savedLabel');
  const rank = $('rankLine');
  rank.hidden = true;
  if (rec && isComplete(run)) {
    // A template run all the way through: the big number is your time, raced against your PB.
    const ms = runElapsed(run);
    const [hms, milli] = clockParts(ms);
    $('sumTitle').textContent = rec.name;
    $('savedHms').textContent = hms;
    $('savedMs').textContent = milli;
    const prev = rec.prevPbMs;
    const pb = prev === undefined || ms < prev;
    $('savedClock').className = 'clock ' + (prev === undefined ? 'ahead' : pb ? 'gold shine' : '');
    label.textContent = prev === undefined ? 'First run. That’s your PB to beat.' : pb ? `★ NEW PB  −${formatDuration(prev - ms)}` : `+${formatDuration(ms - prev)} on your PB`;
    label.className = 'saved-label ' + (prev === undefined ? '' : pb ? 'gold' : 'behind');
    const bits = [];
    if (rec.attempts > 1 && rec.rank) bits.push(`${rec.rank === 1 ? 'Fastest' : ordinal(rec.rank) + ' fastest'} of ${rec.attempts} attempts`);
    if (rec.resets) bits.push(`${rec.resets} reset${rec.resets === 1 ? '' : 's'}`);
    if (saved) bits.push(net >= 0 ? `${formatDuration(net)} saved` : `${formatDuration(-net)} over plan`);
    rank.textContent = bits.join(' · ');
    rank.hidden = !bits.length;
  } else {
    // Nothing to compare yet: show how long the session was instead of a meaningless +0:00:00.
    const [hms, milli] = clockParts(saved ? Math.abs(net) : total);
    $('sumTitle').textContent = 'Session done';
    $('savedHms').textContent = (saved ? (net < 0 ? '−' : '+') : '') + hms;
    $('savedMs').textContent = milli;
    $('savedClock').className = 'clock ' + (!saved ? 'idle' : net >= 0 ? 'ahead' : 'behind');
    label.className = 'saved-label';
    const estimated = run.tasks.some((t) => t.estimateMs !== undefined);
    label.textContent = saved
      ? net >= 0
        ? 'saved against your plan'
        : 'over your plan'
      : estimated
        ? 'on tasks. Finish a task with an estimate to see what you save.'
        : 'on tasks. Give tasks an estimate to see what you save.';
  }
  renderMedals(run);
  const tpl = ui.state.templates.find((t) => t.id === run.templateId);
  const btn = $('saveTpl');
  btn.textContent = ui.savedTemplateFor === run.id ? 'Saved ✓' : tpl ? 'Update template' : 'Save as template';
  btn.title = tpl ? `Save the tasks of this session into “${tpl.name}”` : 'Run these tasks again any time, and race your best';
  const leaves = run.tasks.filter((t) => !isSection(run, t));
  $('factTotal').textContent = formatDuration(total);
  $('factPaused').textContent = formatDuration(pausedTotal(run));
  $('factPlanned').textContent = saved ? formatDuration(saved.plannedMs) : '–';
  $('factActual').textContent = saved ? formatDuration(saved.actualMs) : '–';
  // No plan to compare, no Planned/Actual to show.
  $('factPlanned').parentElement!.hidden = !saved;
  $('factActual').parentElement!.hidden = !saved;
  $('factTasks').textContent = `${leaves.filter((t) => t.done).length}/${leaves.length}`;
}

/** A medal per finished task: gold for a new best, silver under the estimate, bronze just over. */
function renderMedals(run: Run) {
  const list = $('medals');
  list.replaceChildren();
  const done = run.tasks.filter((t) => t.done && !isSection(run, t));
  const rows = done.map((t) => {
    const best = bestOf(t);
    const m = medal(t, best);
    const li = el('li');
    li.append(el('span', 'm ' + (m ?? '')), el('span', 't', t.title));
    const d = best ? t.elapsedMs - best.ms : t.estimateMs !== undefined ? t.elapsedMs - t.estimateMs : undefined;
    li.append(el('span', 'num', formatDuration(t.elapsedMs)));
    if (d !== undefined) li.append(el('span', 'num ' + (m === 'gold' ? 'gold' : d <= 0 ? 'ahead' : 'behind'), formatDuration(d, { signed: true })));
    if (m) li.title = { gold: 'New best', silver: 'Under your estimate', bronze: 'Up to 10 % over your estimate' }[m];
    return { li, counts: d !== undefined };
  });
  // Only worth showing when there's something to measure against.
  if (!rows.some((r) => r.counts)) return;
  const MAX = 8;
  for (const r of rows.slice(0, MAX)) list.append(r.li);
  if (rows.length > MAX) list.append(el('li', 'more-tasks', `+${rows.length - MAX} more`));
}

