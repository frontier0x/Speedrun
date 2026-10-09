import type { AppState, SpeedrunApi } from '../api.js';
import { palette, paletteVars, paintSolid, resolveMode } from '../theme.js';
import {
  childrenOf, formatDuration, formatEstimate, isSection, isSectionDone, summarize, taskKey, templateToText, totalElapsed, totalEstimate,
  type Run, type RunSummary, type Task, type Template, type TemplateRecord,
} from '../runs.js';

const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
const $ = (id: string) => document.getElementById(id)!;

let runs: Run[] = [];
let summaries: RunSummary[] = [];
let golds = new Map<string, number>();
let open: string | null = null; // session shown with its tasks
let liveRunId: string | null = null;
let period: 'today' | 'week' = 'today';
let templates: Template[] = [];
let records: Record<string, TemplateRecord> = {};
let openTpl: string | null = null; // template shown with its records and tasks

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const dayKey = (d: Date) => d.toLocaleDateString('sv-SE');
const startOfDay = (daysAgo: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
};
/** h:mm:ss, like the timer. */
function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
/** Short, for under the bars: 45m, 2.5h. */
const short = (ms: number) => (ms >= 3_600_000 ? (ms / 3_600_000).toFixed(1).replace(/\.0$/, '') + 'h' : Math.round(ms / 60_000) + 'm');

// ---------- overview ----------

function renderOverview() {
  for (const b of $('period').querySelectorAll<HTMLButtonElement>('button')) {
    b.classList.toggle('on', b.dataset.v === period);
    b.onclick = () => {
      period = b.dataset.v as typeof period;
      renderOverview();
    };
  }
  const since = startOfDay(period === 'today' ? 0 : 6).getTime();
  const inPeriod = summaries.filter((s) => new Date(s.startedAt).getTime() >= since);
  const taskMs = inPeriod.reduce((a, s) => a + s.elapsedMs, 0);
  const pauseMs = inPeriod.reduce((a, s) => a + s.pausedMs, 0);
  const planned = inPeriod.filter((s) => s.savedMs !== undefined);
  const saved = planned.reduce((a, s) => a + s.savedMs!, 0);

  $('taskTime').textContent = hms(taskMs);
  $('caption').textContent = period === 'today' ? 'on tasks today' : 'on tasks in the last 7 days';
  $('pauseTime').textContent = hms(pauseMs);
  const savedEl = $('savedTime');
  savedEl.textContent = planned.length ? `${hms(Math.abs(saved))} ${saved >= 0 ? 'saved' : 'over'}` : '–';
  savedEl.className = 'num ' + (!planned.length ? '' : saved >= 0 ? 'ahead' : 'behind');
  $('tasksDone').textContent = String(inPeriod.reduce((a, s) => a + s.tasksDone, 0));

  // Streak: days in a row, up to today or yesterday, with at least one task done.
  const active = new Set(summaries.filter((s) => s.tasksDone > 0).map((s) => dayKey(new Date(s.startedAt))));
  let streak = 0;
  const d = new Date();
  if (!active.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (active.has(dayKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  $('streak').textContent = streak + (streak === 1 ? ' day' : ' days');
}

// ---------- last 7 days ----------

function renderChart() {
  const days = [6, 5, 4, 3, 2, 1, 0].map((ago) => {
    const date = startOfDay(ago);
    const of = summaries.filter((s) => dayKey(new Date(s.startedAt)) === dayKey(date));
    return { date, ago, task: of.reduce((a, s) => a + s.elapsedMs, 0), pause: of.reduce((a, s) => a + s.pausedMs, 0) };
  });
  const max = Math.max(...days.map((d) => d.task + d.pause), 3_600_000);
  const tip = $('tooltip');
  $('chart').replaceChildren(
    ...days.map((d) => {
      const day = el('div', 'day' + (d.ago === 0 ? ' today' : ''));
      const bars = el('div', 'bars');
      if (d.pause) {
        const p = el('i', 'pause');
        p.style.height = (d.pause / max) * 100 + '%';
        bars.append(p);
      }
      if (d.task) {
        const t = el('i', 'task');
        t.style.height = (d.task / max) * 100 + '%';
        bars.append(t);
      }
      day.append(bars, el('span', 'val', d.task ? short(d.task) : '–'), el('span', 'name', d.ago === 0 ? 'Today' : d.date.toLocaleDateString([], { weekday: 'short' })));
      day.onmousemove = (e) => {
        tip.hidden = false;
        tip.textContent = `${d.date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}: ${hms(d.task)} on tasks, ${hms(d.pause)} paused`;
        tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px';
        tip.style.top = e.clientY - 34 + 'px';
      };
      day.onmouseleave = () => (tip.hidden = true);
      return day;
    }),
  );
}

// ---------- sessions ----------

function renderSessions() {
  const list = $('sessions');
  list.replaceChildren();
  if (!summaries.length) {
    list.append(el('li', 'empty', 'Finish your first task and its session shows up here.'));
    return;
  }
  // A reset attempt counts in your totals, not as a session of its own.
  for (const s of summaries.filter((x) => !x.reset)) {
    const li = el('li', s.id === open ? 'on' : '');
    const row = el('div', 'row');
    const run = runs.find((r) => r.id === s.id);
    // Open, its name is the place to rename it.
    const title = s.id === open && run ? sessionName(run) : el('span', 'title', s.name);
    if (s.id === liveRunId && !s.endedAt) title.append(el('span', 'live', '● NOW'));
    row.append(
      title,
      el('span', 'when', new Date(s.startedAt).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })),
      el('span', 'count', `${s.tasksDone}/${s.tasksTotal}`),
      el('span', 'num', hms(s.elapsedMs)),
    );
    row.onclick = () => {
      open = open === s.id ? null : s.id;
      renderSessions();
    };
    li.append(row);
    if (s.id === open && run) li.append(detail(run));
    list.append(li);
  }
}

function detail(run: Run): HTMLElement {
  const box = el('div', 'detail');
  const s = summarize(run);
  const facts = el('dl', 'facts');
  const fact = (k: string, v: string, cls = '') => {
    const d = el('div');
    d.append(el('dt', '', k), el('dd', cls, v));
    facts.append(d);
  };
  fact('On tasks', hms(s.elapsedMs));
  fact('Pauses', hms(s.pausedMs));
  fact('Tasks', `${s.tasksDone}/${s.tasksTotal}`);
  if (s.estimateMs !== undefined) fact('Planned', formatEstimate(s.estimateMs));
  if (s.savedMs !== undefined) fact(s.savedMs >= 0 ? 'Saved' : 'Over', hms(Math.abs(s.savedMs)), s.savedMs >= 0 ? 'ahead' : 'behind');
  if (s.onEstimateRate !== undefined) fact('On estimate', Math.round(s.onEstimateRate * 100) + '%');
  box.append(facts);

  const tasks = el('ol', 'tasks');
  const add = (list: Task[], depth: number) => {
    for (const t of list) {
      tasks.append(taskRow(run, t, depth));
      add(childrenOf(run, t.id), depth + 1);
    }
  };
  add(run.tasks.filter((t) => !t.parentId || !run.tasks.some((p) => p.id === t.parentId)), 0);
  if (run.tasks.length) box.append(tasks);

  // The session as a picture, ready to paste anywhere (it used to sit on the timer's summary).
  const copy = el('button', 'link', 'Copy as picture');
  copy.type = 'button';
  copy.onclick = async (e) => {
    e.stopPropagation();
    const card = box.closest('li') ?? box;
    copy.style.visibility = 'hidden';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = card.getBoundingClientRect();
    await api.act({ type: 'copyResult', from: 'stats', rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
    copy.style.visibility = '';
    copy.textContent = 'Copied ✓';
    setTimeout(() => (copy.textContent = 'Copy as picture'), 1500);
  };
  box.append(copy);
  return box;
}

/** A task like in the timer's list: circle, name, time, and how far under or over its estimate. */
function taskRow(run: Run, t: Task, depth: number): HTMLLIElement {
  const group = isSection(run, t);
  const done = group ? isSectionDone(run, t) : t.done;
  const li = el('li', (group ? 'group ' : '') + (done ? 'done' : 'open'));
  li.style.paddingLeft = depth * 18 + 'px';
  const time = totalElapsed(run, t);
  const est = group ? totalEstimate(run, t) : t.estimateMs;
  const best = group ? undefined : golds.get(taskKey(t.title));
  const personalBest = best !== undefined && t.done && t.elapsedMs <= best;
  li.append(el('span', 'box', '✓'), el('span', 't', t.title));
  const timeCell = el('span', 'num' + (personalBest ? ' gold' : ''), time ? formatDuration(time) + (personalBest ? ' ★' : '') : '');
  if (personalBest) timeCell.title = 'Your best time for this task';
  li.append(timeCell);
  const delta = el('span', 'num');
  if (done && est !== undefined && time > 0) {
    const d = time - est;
    delta.textContent = formatDuration(d, { signed: true });
    delta.className = 'num ' + (d <= 0 ? 'ahead' : 'behind');
  } else if (est !== undefined) delta.textContent = formatEstimate(est);
  li.append(delta);
  return li;
}

// ---------- templates ----------

function renderTemplates() {
  $('templatesSection').hidden = !templates.length;
  const list = $('templates');
  list.replaceChildren();
  for (const tpl of templates) {
    const rec = records[tpl.id];
    const li = el('li', tpl.id === openTpl ? 'on' : '');
    const row = el('div', 'row');
    const title =
      tpl.id === openTpl
        ? nameField(tpl.name, (name) => {
            tpl.name = name;
            void api.act({ type: 'renameTemplate', id: tpl.id, name });
          })
        : el('span', 'title', tpl.name);
    const runs = rec ? rec.attempts - rec.resets : 0;
    row.append(title, el('span', 'count', runs === 1 ? '1 run' : `${runs} runs`), el('span', 'num' + (rec?.pb ? ' gold' : ''), rec?.pb ? hms(rec.pb.ms) : '–'));
    row.title = 'Your best run';
    row.onclick = () => {
      openTpl = openTpl === tpl.id ? null : tpl.id;
      renderTemplates();
    };
    li.append(row);
    if (tpl.id === openTpl) li.append(templateDetail(tpl, rec));
    list.append(li);
  }
}

function templateDetail(tpl: Template, rec: TemplateRecord | undefined): HTMLElement {
  const box = el('div', 'detail');
  const facts = el('dl', 'facts');
  const fact = (k: string, v: string, cls = '', tip = '') => {
    const d = el('div');
    d.append(el('dt', '', k), el('dd', cls, v));
    if (tip) d.title = tip;
    facts.append(d);
  };
  fact('Best run', rec?.pb ? hms(rec.pb.ms) : '–', rec?.pb ? 'gold' : '');
  fact('Possible', rec?.sumOfBest !== undefined ? hms(rec.sumOfBest) : '–', '', 'Your best time for every task, added up: what a perfect run would take');
  fact('Attempts', rec ? `${rec.attempts}${rec.resets ? ` · ${rec.resets} reset` : ''}` : '0');
  box.append(facts);
  if (rec?.pb && rec.sumOfBest !== undefined && rec.pb.ms > rec.sumOfBest)
    box.append(el('p', 'hint', `${formatDuration(rec.pb.ms - rec.sumOfBest)} left to find between your best run and what's possible.`));

  // The tasks, as text like "Paste a list": edit and save. Renamed tasks start fresh, unchanged ones keep their bests.
  const text = el('textarea', 'tpl-text');
  text.value = templateToText(tpl);
  text.rows = Math.min(12, Math.max(3, tpl.tasks.length + 1));
  text.spellcheck = false;
  text.onclick = (e) => e.stopPropagation();
  const save = el('button', 'act small', 'Save tasks');
  save.type = 'button';
  save.disabled = true;
  text.oninput = () => (save.disabled = text.value === templateToText(tpl));
  save.onclick = () => {
    void api.act({ type: 'editTemplate', id: tpl.id, text: text.value });
    save.disabled = true;
  };
  const start = el('button', 'act small primary', 'Start');
  start.type = 'button';
  start.onclick = () => void api.act({ type: 'startTemplate', id: tpl.id });
  const del = el('button', 'text danger', 'Delete');
  del.type = 'button';
  del.title = 'Delete this template. Its past sessions stay.';
  del.onclick = () => {
    if (del.textContent === 'Delete') {
      del.textContent = 'Click again to delete';
      setTimeout(() => (del.textContent = 'Delete'), 3000);
      return;
    }
    openTpl = null;
    void api.act({ type: 'deleteTemplate', id: tpl.id });
  };
  const row = el('div', 'actions');
  row.append(del, el('span', 'spacer'), save, start);
  box.append(text, row);
  return box;
}

/** A name you click to rename. */
function nameField(name: string, onRename: (name: string) => void): HTMLElement {
  const h = el('span', 'name', name);
  h.title = 'Click to rename';
  h.onclick = (e) => {
    e.stopPropagation();
    const input = el('input', 'name-input');
    input.value = name;
    h.replaceWith(input);
    input.focus();
    input.select();
    let closed = false;
    const finish = (save: boolean) => {
      if (closed) return;
      closed = true;
      const next = input.value.trim();
      if (save && next && next !== name) onRename(next);
      renderTemplates();
      renderSessions();
    };
    input.onclick = (k) => k.stopPropagation();
    input.onkeydown = (k) => {
      if (k.key === 'Enter') finish(true);
      if (k.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);
  };
  return h;
}

/** The session's name: click it to rename. */
function sessionName(run: Run): HTMLElement {
  return nameField(run.name, (name) => {
    run.name = name;
    const s = summaries.find((x) => x.id === run.id);
    if (s) s.name = name;
    void api.act({ type: 'renameRun', id: run.id, name });
  });
}

// ---------- theme & data ----------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
let lastState: AppState | undefined;

/** Stats wears the timer's colors: day or night, your palette. */
function applyTheme(s: AppState) {
  lastState = s;
  const mode = resolveMode(s.settings.theme, darkQuery.matches);
  const colors = palette(mode, s.settings.colors);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(paletteVars(colors))) root.setProperty(k, v);
  // A window needs a solid base under a see-through or gradient background.
  root.setProperty('--bg-solid', paintSolid(colors.background).slice(0, 7));
  const n = parseInt(paintSolid(colors.button).slice(1, 7), 16);
  root.setProperty('--button-ink', 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#000' : '#fff');
  root.setProperty('--clock-weight', String(s.settings.clockWeight));
  root.colorScheme = mode;
}
darkQuery.addEventListener('change', () => lastState && applyTheme(lastState));

let editingName = () => document.activeElement?.classList.contains('name-input') ?? false;

async function load(state?: AppState) {
  const s = state ?? (await api.getState());
  applyTheme(s);
  golds = new Map(s.golds);
  liveRunId = s.run?.id ?? null;
  const data = await api.listRuns();
  runs = data.runs;
  summaries = data.summaries;
  records = data.records;
  templates = s.templates;
  renderOverview();
  renderChart();
  const busy = editingName() || document.activeElement?.classList.contains('tpl-text');
  if (!busy) {
    renderTemplates();
    renderSessions();
  }
}

let pending: ReturnType<typeof setTimeout> | undefined;
api.onState((s) => {
  clearTimeout(pending);
  pending = setTimeout(() => void load(s), 250);
});
await load();
setInterval(() => void load(), 15_000);
