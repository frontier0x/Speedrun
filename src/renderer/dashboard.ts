import type { AppState, SpeedrunApi } from '../api.js';
import {
  formatDuration, formatEstimate, isSection, isSectionDone, runElapsed, summarize, taskKey, totalElapsed, totalEstimate,
  type Run, type RunSummary, type Task,
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

function tile(value: string, label: string) {
  const t = el('div', 'tile');
  t.append(el('div', 'v', value), el('div', 'k', label));
  return t;
}

function renderTiles() {
  const now = Date.now();
  const weekAgo = now - 7 * 86_400_000;
  const week = summaries.filter((s) => new Date(s.startedAt).getTime() >= weekAgo);
  const weekMs = week.reduce((a, s) => a + s.elapsedMs, 0);
  const weekSaved = week.reduce((a, s) => a + (s.deltaMs ?? 0), 0);
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
    tile(hours(weekMs), 'tracked this week'),
    tile(weekSaved <= 0 ? hours(-weekSaved) : '−' + hours(weekSaved), weekSaved <= 0 ? 'saved vs. estimates this week' : 'over estimates this week'),
    tile(String(summaries.reduce((a, s) => a + s.tasksDone, 0)), 'tasks finished'),
    tile(accuracy, 'on or under estimate'),
    tile(String(golds.size), 'gold splits'),
    tile(streak + (streak === 1 ? ' day' : ' days'), 'streak'),
  );
  $('subtitle').textContent = summaries.length
    ? `${summaries.length} run${summaries.length === 1 ? '' : 's'} since ${new Date(summaries.at(-1)!.startedAt).toLocaleDateString()}`
    : 'Finish your first run and it shows up here.';
}

function renderChart() {
  const byDay = new Map<string, number>();
  for (const s of summaries) {
    const k = dayKey(new Date(s.startedAt));
    byDay.set(k, (byDay.get(k) ?? 0) + s.elapsedMs);
  }
  const days: { key: string; date: Date; ms: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push({ key: dayKey(date), date, ms: byDay.get(dayKey(date)) ?? 0 });
  }
  const max = Math.max(...days.map((d) => d.ms), 3_600_000);
  const chart = $('chart');
  chart.replaceChildren();
  const labels = el('div', 'chart-labels');
  const tip = $('tooltip');
  days.forEach((d, i) => {
    const col = el('div', 'col' + (i === days.length - 1 ? ' today' : ''));
    const bar = el('div', 'bar');
    bar.style.height = (d.ms / max) * 100 + '%';
    col.append(bar);
    col.onmousemove = (e) => {
      tip.hidden = false;
      tip.textContent = `${d.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}: ${d.ms ? formatDuration(d.ms) : 'nothing tracked'}`;
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

function renderRuns() {
  const list = $('runs');
  list.replaceChildren();
  if (!summaries.length) {
    list.append(el('li', 'empty', 'No runs yet'));
    return;
  }
  for (const s of summaries) {
    const li = el('li', s.id === selected ? 'on' : '');
    const r1 = el('div', 'r1');
    const name = el('span', '', s.name);
    if (s.id === liveRunId && !s.endedAt) name.append(' ', el('span', 'live', '● LIVE'));
    r1.append(name, el('span', 'mono', formatDuration(s.elapsedMs)));
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
    box.append(el('div', 'empty', 'Pick a run to see its splits.'));
    return;
  }
  const s = summarize(run);
  box.append(el('h3', '', run.name));
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
  if (s.deltaMs !== undefined) stat(formatDuration(Math.abs(s.deltaMs)), s.deltaMs <= 0 ? 'saved vs. estimates' : 'over estimates');
  if (s.onEstimateRate !== undefined) stat(Math.round(s.onEstimateRate * 100) + '%', 'on estimate');
  if (sob !== undefined) stat(formatDuration(sob), 'sum of best');
  box.append(stats);

  if (!run.tasks.length) {
    box.append(el('div', 'empty', 'No tasks in this run.'));
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

async function load(state?: AppState) {
  const s = state ?? (await api.getState());
  document.documentElement.style.setProperty('--accent', s.settings.accent);
  golds = new Map(s.golds);
  liveRunId = s.run?.id ?? null;
  const data = await api.listRuns();
  runs = data.runs;
  summaries = data.summaries;
  if (!selected || !runs.some((r) => r.id === selected)) selected = runs[0]?.id ?? null;
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
