import type { AppState, SpeedrunApi } from '../api.js';
import { palette, paletteVars, paintSolid, resolveMode } from '../theme.js';
import {
  childrenOf, formatDuration, formatEstimate, isSection, isSectionDone, summarize, taskKey, totalElapsed, totalEstimate,
  type Run, type RunSummary, type Task,
} from '../runs.js';

const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
const $ = (id: string) => document.getElementById(id)!;

let runs: Run[] = [];
let summaries: RunSummary[] = [];
let golds = new Map<string, number>();
let open: string | null = null; // session shown with its tasks
let liveRunId: string | null = null;
let period: 'today' | 'week' = 'today';
let templates: AppState['templates'] = [];
let openTemplate: string | null = null; // template shown with its tasks; 'new' for a new one

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
  for (const s of summaries) {
    const li = el('li', s.id === open ? 'on' : '');
    const row = el('div', 'row');
    const run = runs.find((r) => r.id === s.id);
    // Open, its name is the place to rename it.
    const title = s.id === open && run ? nameField(run) : el('span', 'title', s.name);
    if (s.id === liveRunId && !s.endedAt) title.append(el('span', 'live', '● NOW'));
    if (s.reset) title.append(el('span', 'tag', 'reset'));
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
  // Run it again and race this one: save it as a template.
  if (!run.templateId && run.tasks.length) {
    const save = el('button', 'link', 'Save as template');
    save.type = 'button';
    save.title = 'Run these tasks again and race your best';
    save.onclick = () => void api.act({ type: 'saveTemplate', runId: run.id, name: run.name });
    box.append(save);
  }
  return box;
}

// ---------- templates ----------

/** Your templates: name, tasks, attempts and best run. Click one to edit, start or delete it. */
function renderTemplates() {
  const list = $('templates');
  list.replaceChildren();
  if (openTemplate === 'new') list.append(templateEditor());
  if (!templates.length && openTemplate !== 'new') {
    list.append(el('li', 'empty', 'Save a session as a template to run it again and race your best.'));
    return;
  }
  for (const t of templates) {
    const li = el('li', t.id === openTemplate ? 'on' : '');
    const row = el('div', 'row');
    row.append(
      el('span', 'title', t.name),
      el('span', 'count', `${t.tasks} task${t.tasks === 1 ? '' : 's'}`),
      el('span', 'when', `${t.attempts} attempt${t.attempts === 1 ? '' : 's'}` + (t.resets ? `, ${t.resets} reset` : '')),
      el('span', 'num', t.bestMs !== undefined ? hms(t.bestMs) : '–'),
    );
    row.title = t.bestMs !== undefined ? 'Your fastest run' : 'No finished run yet';
    row.onclick = () => {
      openTemplate = openTemplate === t.id ? null : t.id;
      renderTemplates();
    };
    li.append(row);
    if (t.id === openTemplate) li.append(templateEditor(t));
    list.append(li);
  }
}

/** Name and tasks as text, like Paste a list. Unchanged task names keep their history. */
function templateEditor(t?: AppState['templates'][number]): HTMLElement {
  const box = el('div', 'tpl-edit');
  const name = el('input');
  name.placeholder = 'Name, e.g. Morning routine';
  name.value = t?.name ?? '';
  const text = el('textarea');
  text.placeholder = '- Mails 10m\n- Plan the day\n  - Calendar 5m\n  - Goals 10m';
  text.value = t?.text ?? '';
  const actions = el('div', 'actions');
  const save = el('button', 'primary', t ? 'Save' : 'Create template');
  save.type = 'button';
  save.onclick = () => {
    if (!text.value.trim()) return;
    void api.act(t ? { type: 'updateTemplate', id: t.id, name: name.value, text: text.value } : { type: 'createTemplate', name: name.value, text: text.value });
    openTemplate = null;
  };
  actions.append(save);
  if (t) {
    const start = el('button', 'link', 'Start it');
    start.type = 'button';
    start.onclick = () => void api.act({ type: 'startTemplate', id: t.id });
    const del = el('button', 'link', 'Delete');
    del.type = 'button';
    del.onclick = () => void api.act({ type: 'deleteTemplate', id: t.id });
    actions.append(start, el('span', 'spacer'), del);
  } else {
    const cancel = el('button', 'link', 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => {
      openTemplate = null;
      renderTemplates();
    };
    actions.append(cancel);
  }
  box.append(name, text, el('div', 'hint', 'One task per line, indent for subtasks, add a time like 15m for an estimate.'), actions);
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

/** The session's name: click it to rename. */
function nameField(run: Run): HTMLElement {
  const h = el('span', 'name', run.name);
  h.title = 'Click to rename';
  h.onclick = (e) => {
    e.stopPropagation();
    const input = el('input', 'name-input');
    input.value = run.name;
    h.replaceWith(input);
    input.focus();
    input.select();
    let closed = false;
    const finish = (save: boolean) => {
      if (closed) return;
      closed = true;
      const name = input.value.trim();
      if (save && name && name !== run.name) {
        run.name = name;
        const s = summaries.find((x) => x.id === run.id);
        if (s) s.name = name;
        void api.act({ type: 'renameRun', id: run.id, name });
      }
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
  templates = s.templates;
  renderOverview();
  renderChart();
  if (!editingName()) renderSessions();
  if (!$('templates').contains(document.activeElement)) renderTemplates();
}

let pending: ReturnType<typeof setTimeout> | undefined;
api.onState((s) => {
  clearTimeout(pending);
  pending = setTimeout(() => void load(s), 250);
});
$('newTemplate').onclick = () => {
  openTemplate = openTemplate === 'new' ? null : 'new';
  renderTemplates();
  $('templates').querySelector('input')?.focus();
};
await load();
setInterval(() => void load(), 15_000);
