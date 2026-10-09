import type { AppState, SpeedrunApi } from '../api.js';
import { palette, paletteVars, paintSolid, resolveMode } from '../theme.js';
import {
  formatDuration, formatEstimate, isSection, isSectionDone, periodTotals, runElapsed, startOfWeek, summarize, taskKey,
  totalElapsed, totalEstimate, type Run, type RunSummary, type Task,
} from '../runs.js';

const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
const $ = (id: string) => document.getElementById(id)!;

let runs: Run[] = [];
let summaries: RunSummary[] = [];
let golds = new Map<string, number>();
let selected: string | null = null;
let liveRunId: string | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const dayKey = (d: Date) => d.toLocaleDateString('sv-SE');
const hours = (ms: number) => (ms >= 3_600_000 ? (ms / 3_600_000).toFixed(1) + 'h' : Math.round(ms / 60_000) + 'm');

function fact(value: string, label: string) {
  const t = el('div', 'fact');
  t.append(el('div', 'v', value), el('div', 'k', label));
  return t;
}

/** Today and this week: the big number is time on tasks; under it, pauses and what you saved. */
function renderPeriods() {
  const totals = periodTotals(summaries);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const week = startOfWeek(new Date());
  const savedSince = (from: Date) =>
    summaries.filter((s) => new Date(s.startedAt) >= from).reduce((a, s) => a + (s.savedMs ?? 0), 0);
  const period = (label: string, tasksMs: number, pausedMs: number, savedMs: number) => {
    const box = el('div', 'period');
    box.append(el('h2', '', label), el('div', 'big', formatDuration(tasksMs)));
    const lines = el('div', 'lines');
    const line = (value: string, text: string, cls = '') => {
      const span = el('span');
      span.append(el('b', cls, value), ' ' + text);
      lines.append(span);
    };
    lines.append(el('span', '', 'on tasks'));
    line(formatDuration(pausedMs), 'paused');
    if (savedMs !== 0) line(formatDuration(Math.abs(savedMs)), savedMs > 0 ? 'saved' : 'over plan', savedMs > 0 ? 'ahead' : 'behind');
    box.append(lines);
    return box;
  };
  $('periods').replaceChildren(
    period('Today', totals.todayMs, totals.todayPausedMs, savedSince(today)),
    period('This week', totals.weekMs, totals.weekPausedMs, savedSince(week)),
  );
}

function renderTiles() {
  const rates = summaries.map((s) => s.onEstimateRate).filter((r): r is number => r !== undefined);
  const accuracy = rates.length ? Math.round((rates.reduce((a, r) => a + r, 0) / rates.length) * 100) + '%' : '–';

  // Streak: consecutive days, ending today or yesterday, with at least one finished task.
  const activeDays = new Set(summaries.filter((s) => s.tasksDone > 0).map((s) => dayKey(new Date(s.startedAt))));
  let streak = 0;
  const d = new Date();
  if (!activeDays.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (activeDays.has(dayKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  $('tiles').replaceChildren(
    fact(String(summaries.reduce((a, s) => a + s.tasksDone, 0)), 'tasks finished'),
    fact(accuracy, 'on or under estimate'),
    fact(String(golds.size), 'personal bests'),
    fact(streak + (streak === 1 ? ' day' : ' days'), 'streak'),
    fact(hours(summaries.reduce((a, s) => a + s.elapsedMs, 0)), 'on tasks, all time'),
  );
  $('subtitle').textContent = summaries.length ? `${summaries.length} since ${new Date(summaries.at(-1)!.startedAt).toLocaleDateString()}` : '';
}

/** Last 14 days: time on tasks, with pauses stacked on top. */
function renderChart() {
  const byDay = new Map<string, { work: number; pause: number }>();
  for (const s of summaries) {
    const k = dayKey(new Date(s.startedAt));
    const v = byDay.get(k) ?? { work: 0, pause: 0 };
    v.work += s.elapsedMs;
    v.pause += s.pausedMs;
    byDay.set(k, v);
  }
  const days: { date: Date; work: number; pause: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push({ date, ...(byDay.get(dayKey(date)) ?? { work: 0, pause: 0 }) });
  }
  const max = Math.max(...days.map((d) => d.work + d.pause), 3_600_000);
  const chart = $('chart');
  chart.replaceChildren();
  const labels = el('div', 'chart-labels');
  const tip = $('tooltip');
  days.forEach((d, i) => {
    const col = el('div', 'col' + (i === days.length - 1 ? ' today' : ''));
    const stack = el('div', 'stack');
    stack.style.height = ((d.work + d.pause) / max) * 100 + '%';
    const pause = el('div', 'pause');
    const work = el('div', 'work');
    const total = d.work + d.pause || 1;
    pause.style.height = (d.pause / total) * 100 + '%';
    work.style.height = (d.work / total) * 100 + '%';
    stack.append(pause, work);
    col.append(stack);
    col.onmousemove = (e) => {
      tip.hidden = false;
      const day = d.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      tip.textContent = d.work || d.pause ? `${day}: ${formatDuration(d.work)} on tasks, ${formatDuration(d.pause)} paused` : `${day}: nothing tracked`;
      tip.style.left = e.clientX + 12 + 'px';
      tip.style.top = e.clientY - 30 + 'px';
    };
    col.onmouseleave = () => (tip.hidden = true);
    chart.append(col);
    labels.append(el('span', '', i % 2 === 1 || i === days.length - 1 ? d.date.toLocaleDateString([], { day: 'numeric', month: 'numeric' }) : ''));
  });
  chart.after(labels);
  document.querySelectorAll('.chart-labels').forEach((n, i, all) => i < all.length - 1 && n.remove());
}

/** Sessions saved before they were called sessions keep their old "Fri, Oct 9 run" name; show it the new way. */
const displayName = (name: string) => name.replace(/ run$/, ' session');

/** The session's name, click to rename it. Enter saves, Esc cancels. */
function titleEditor(run: Run): HTMLElement {
  const h = el('h3', 'rename', displayName(run.name));
  h.title = 'Click to rename this session';
  h.onclick = () => {
    const input = el('input', 'rename-input');
    input.value = displayName(run.name);
    h.replaceWith(input);
    input.focus();
    input.select();
    let closed = false;
    const finish = (save: boolean) => {
      if (closed) return;
      closed = true;
      const name = input.value.trim();
      if (save && name && name !== displayName(run.name)) {
        run.name = name;
        void api.act({ type: 'renameRun', id: run.id, name });
      }
      renderRuns();
      renderDetail();
    };
    input.onkeydown = (k) => {
      if (k.key === 'Enter') finish(true);
      if (k.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);
  };
  return h;
}

function renderRuns() {
  const list = $('runs');
  list.replaceChildren();
  if (!summaries.length) {
    list.append(el('li', 'empty', 'No sessions yet'));
    return;
  }
  for (const s of summaries) {
    const li = el('li', s.id === selected ? 'on' : '');
    const r1 = el('div', 'r1');
    const name = el('span', '', displayName(s.name));
    if (s.id === liveRunId && !s.endedAt) name.append(' ', el('span', 'live', '● now'));
    r1.append(name, el('span', 't', formatDuration(s.elapsedMs)));
    const r2 = el('div', 'r2');
    r2.append(
      el('span', '', new Date(s.startedAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
      el('span', '', `${s.tasksDone}/${s.tasksTotal} tasks`),
    );
    li.append(r1, r2);
    li.onclick = () => {
      selected = s.id;
      renderRuns();
      renderDetail();
    };
    list.append(li);
  }
}

function deltaCell(actual: number, estimate?: number) {
  const td = el('td');
  if (estimate !== undefined && actual > 0) {
    const d = actual - estimate;
    td.textContent = formatDuration(d, { signed: true });
    td.className = d <= 0 ? 'ahead' : 'behind';
  }
  return td;
}

function renderDetail() {
  const box = $('detail');
  box.replaceChildren();
  const run = runs.find((r) => r.id === selected);
  if (!run) {
    box.append(el('div', 'empty', 'Pick a session to see its tasks.'));
    return;
  }
  const s = summarize(run);
  box.append(titleEditor(run));
  box.append(
    el('div', 'sub', new Date(run.startedAt).toLocaleString() + (run.endedAt ? ' → ' + new Date(run.endedAt).toLocaleTimeString() : ' · in progress')),
  );

  // Sum of best: what this run would take if every task matched your best ever time.
  const leaves = run.tasks.filter((t) => !isSection(run, t));
  const sob = leaves.every((t) => golds.has(taskKey(t.title))) && leaves.length ? leaves.reduce((a, t) => a + golds.get(taskKey(t.title))!, 0) : undefined;

  const stats = el('div', 'stats');
  const stat = (v: string, k: string) => {
    const d = el('div');
    d.append(el('div', 'v', v), el('div', 'k', k));
    stats.append(d);
  };
  stat(formatDuration(runElapsed(run)), 'total time');
  if (s.estimateMs !== undefined) stat(formatEstimate(s.estimateMs), 'estimated');
  stat(`${s.tasksDone}/${s.tasksTotal}`, 'tasks done');
  if (s.pausedMs >= 1000) stat(formatDuration(s.pausedMs), 'paused');
  if (s.savedMs !== undefined) stat(formatDuration(Math.abs(s.savedMs)), s.savedMs >= 0 ? 'saved vs. plan' : 'over plan');
  if (s.onEstimateRate !== undefined) stat(Math.round(s.onEstimateRate * 100) + '%', 'on estimate');
  if (sob !== undefined) stat(formatDuration(sob), 'best possible');
  box.append(stats);

  if (!run.tasks.length) {
    box.append(el('div', 'empty', 'No tasks in this session.'));
    return;
  }

  const table = el('table');
  const head = el('tr');
  for (const h of ['Task', 'Estimate', 'Time', '+/−', 'Best']) head.append(el('th', '', h));
  table.append(head);
  for (const t of run.tasks) table.append(taskRow(run, t));
  box.append(table);
}

function taskRow(run: Run, t: Task) {
  const section = isSection(run, t);
  const tr = el('tr', section ? 'section' : t.done ? '' : 'open');
  let depth = 0;
  for (let p = t.parentId; p; p = run.tasks.find((x) => x.id === p)?.parentId) depth++;
  const name = el('td', '', (t.done && !section ? '✓ ' : '') + t.title);
  name.style.paddingLeft = 8 + depth * 16 + 'px';
  const est = section ? totalEstimate(run, t) : t.estimateMs;
  const time = totalElapsed(run, t);
  const best = section ? undefined : golds.get(taskKey(t.title));
  const timeCell = el('td', section ? 'mono-cell' : '', time ? formatDuration(time) : '');
  const bestCell = el('td', 'muted', best !== undefined ? formatDuration(best) : '');
  if (best !== undefined && t.done && t.elapsedMs <= best) {
    timeCell.classList.add('gold');
    timeCell.textContent += ' ★';
  }
  tr.append(name, el('td', 'muted' + (section ? ' mono-cell' : ''), est !== undefined ? formatEstimate(est) : ''), timeCell, deltaCell(time, (section ? isSectionDone(run, t) : t.done) ? est : undefined), bestCell);
  return tr;
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
let lastState: AppState | undefined;

/** The dashboard wears the timer's colors: day or night, your palette. */
function applyTheme(s: AppState) {
  lastState = s;
  const mode = resolveMode(s.settings.theme, darkQuery.matches);
  const colors = palette(mode, s.settings.colors);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(paletteVars(colors))) root.setProperty(k, v);
  // A window needs a solid base under a see-through or gradient background.
  root.setProperty('--bg-solid', paintSolid(colors.background).slice(0, 7));
  root.setProperty('--accent', paintSolid(colors.clock));
  root.colorScheme = mode;
}
darkQuery.addEventListener('change', () => lastState && applyTheme(lastState));

async function load(state?: AppState) {
  const s = state ?? (await api.getState());
  applyTheme(s);
  golds = new Map(s.golds);
  liveRunId = s.run?.id ?? null;
  const data = await api.listRuns();
  runs = data.runs;
  summaries = data.summaries;
  if (!selected || !runs.some((r) => r.id === selected)) selected = runs[0]?.id ?? null;
  renderPeriods();
  renderTiles();
  renderChart();
  renderRuns();
  renderDetail();
}

let pending: ReturnType<typeof setTimeout> | undefined;
api.onState((s) => {
  clearTimeout(pending);
  pending = setTimeout(() => void load(s), 250);
});
await load();
setInterval(() => void load(), 15_000);
