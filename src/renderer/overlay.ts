import type { AppState, SpeedrunApi } from '../api.js';
import {
  ancestorsOf, childrenOf, formatDuration, formatEstimate, isComplete, isSection, isSectionDone, liveElapsed, medal, pausedTotal, pbPace, runElapsed,
  sessionElapsed, taskKey, timeSaved, totalElapsed, totalEstimate, type Run, type Task,
} from '../runs.js';
import { palette, paletteVars, paintSolid, resolveMode } from '../theme.js';
import { play, type Sound } from './sound.js';

const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ESTIMATE_PRESETS = ['5m', '10m', '15m', '25m', '45m', '1h', '1h30m', '2h'];

let state: AppState;
let golds = new Map<string, number>();
let editing = false; // hold list re-renders while an inline editor is open
let pickerFor: string | null = null; // task whose estimate picker is open in the list
let subFor: string | null = null; // task whose "add a subtask" field is open in the list
/** For a moment after you tick a task off, its result stands where the task name is. */
let flash: { text: string; tone: string; until: number } | null = null;
let savedTemplateFor: string | null = null; // the finished session you just saved as a template
let addIndent = false; // the add field is tabbed in: new tasks become subtasks of the last task

/** Tabs the add field in or out. In only works under a task. */
function setIndent(on: boolean) {
  const last = state.run?.tasks.filter((t) => !t.parentId).at(-1);
  addIndent = on && Boolean(last);
  $('addForm').classList.toggle('indent', addIndent);
  $<HTMLInputElement>('addInput').placeholder = addIndent && last ? `Subtask of ${last.title}, e.g. Hero 20m` : 'New task, e.g. Emails 15m';
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The clock's two parts, e.g. 1:02:03 and .456. Hours always show, so the width never jumps.
 * With less precision the small part is empty: 1:02:03 for seconds, 1:02 for minutes.
 */
function clockParts(ms: number, precision: 'ms' | 's' | 'm' = state?.settings.precision ?? 'ms'): [string, string] {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (precision === 'm') return [`${h}:${pad(m)}`, ''];
  if (precision === 's') return [`${h}:${pad(m)}:${pad(s)}`, ''];
  return [`${h}:${pad(m)}:${pad(s)}`, '.' + String(total % 1000).padStart(3, '0')];
}

// ---------- theme ----------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

/** Your colors for the current mode, as CSS variables on :root. */
function applyTheme() {
  const s = state.settings;
  const colors = palette(resolveMode(s.theme, darkQuery.matches), s.colors);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(paletteVars(colors))) root.setProperty(k, v);
  root.setProperty('--button-ink', inkFor(paintSolid(colors.button)));
  root.setProperty('--clock-weight', String(s.clockWeight));
  document.body.classList.toggle('style-speedrun', s.clockStyle === 'speedrun');
}

const sfx = (sound: Sound) => state.settings.sounds && play(sound, state.settings.volume);

/** Your best for the task when you race it. */
const bestOf = (t: Task | undefined) => (t && state.settings.race ? state.bests[t.id] : undefined);

const ORD = ['th', 'st', 'nd', 'rd'];
const ordinal = (n: number) => n + (ORD[(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10] ?? 'th');

/** Black or white, whichever reads better on the color. */
function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000' : '#fff';
}

/** The task on the clock: the running one, or the next one up. */
function currentTask(): Task | undefined {
  const run = state.run;
  if (!run) return undefined;
  return run.tasks.find((t) => t.id === run.activeTaskId) ?? run.tasks.find((t) => !t.done && !isSection(run, t));
}

const isRunning = () => Boolean(state.run?.activeTaskId && state.run.activeSince !== undefined);
const isOpen = () => !$('more').hidden;

// ---------- estimate picker ----------

/** Preset chips plus a free field. Used under the clock and under a task in the list. */
function estimatePicker(t: Task, onDone: () => void): HTMLElement {
  const box = el('div', 'picker');
  const set = (text: string) => {
    editing = false; // the field goes away with the picker, so its blur may never come
    onDone();
    void api.act({ type: 'setEstimate', id: t.id, text });
  };
  const currentText = t.estimateMs !== undefined ? formatEstimate(t.estimateMs).replace(' ', '') : '';
  for (const p of ESTIMATE_PRESETS) {
    const b = el('button', p === currentText ? 'on' : '', p);
    b.type = 'button';
    b.onclick = (e) => {
      e.stopPropagation();
      set(p);
    };
    box.append(b);
  }
  const custom = el('input');
  custom.placeholder = 'other';
  custom.title = 'Any time, e.g. 20m, 1h15m, 90s';
  custom.onclick = (e) => e.stopPropagation();
  custom.onfocus = () => (editing = true);
  custom.onblur = () => (editing = false);
  custom.onkeydown = (k) => {
    if (k.key === 'Enter' && custom.value.trim()) set(custom.value);
    if (k.key === 'Escape') {
      editing = false;
      onDone();
    }
  };
  box.append(custom);
  if (t.estimateMs !== undefined) {
    const clear = el('button', 'clear', 'clear');
    clear.type = 'button';
    clear.onclick = (e) => {
      e.stopPropagation();
      set('');
    };
    box.append(clear);
  }
  return box;
}

// ---------- face ----------

function renderFace() {
  const run = state.run;
  const t = currentTask();
  const task = $('task');
  task.replaceChildren();
  // A subtask shows where it sits: "Build page › Hero".
  if (run && t) for (const a of ancestorsOf(run, t)) task.append(el('span', 'crumb', a.title + ' › '));
  task.append(t ? t.title : run?.tasks.length ? 'All done. GG.' : 'Click to add your first task');
  task.className = 'task' + (t ? '' : ' empty');
  if (flash && flash.until > Date.now()) {
    task.textContent = flash.text;
    task.className = 'task flash ' + flash.tone;
  }
  $('resetBtn').hidden = !run?.templateId;
  $('tick').hidden = !t;
  $('go').hidden = !t;
  $('go').classList.toggle('running', isRunning());
  $('go').title = isRunning() ? 'Pause (⌘⇧Space)' : 'Go (⌘⇧Space)';
  const parent = run && t ? ancestorsOf(run, t).at(-1) : undefined;
  $('group').hidden = !parent;
  if (parent) $('groupName').textContent = parent.title;
}

// ---------- summary ----------

/** End of a session: the big number is the time you saved (green) or lost (red) against your estimates. */
function renderSummary(run: Run) {
  const saved = timeSaved(run);
  const total = sessionElapsed(run, state.settings.pausesCount);
  const net = saved?.savedMs ?? 0;
  const rec = state.record;
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
    const [hms, milli] = clockParts(Math.abs(net));
    $('sumTitle').textContent = 'Session done';
    $('savedHms').textContent = (net < 0 ? '−' : '+') + hms;
    $('savedMs').textContent = milli;
    $('savedClock').className = 'clock ' + (!saved ? 'idle' : net >= 0 ? 'ahead' : 'behind');
    label.className = 'saved-label';
    label.textContent = !saved
      ? 'Give tasks an estimate to see how much time you save.'
      : net >= 0
        ? 'saved against your plan'
        : 'over your plan';
  }
  renderMedals(run);
  const tpl = state.templates.find((t) => t.id === run.templateId);
  const btn = $('saveTpl');
  btn.textContent = savedTemplateFor === run.id ? 'Saved ✓' : tpl ? 'Update template' : 'Save as template';
  btn.title = tpl ? `Save the tasks of this session into “${tpl.name}”` : 'Run these tasks again any time, and race your best';
  const leaves = run.tasks.filter((t) => !isSection(run, t));
  $('factTotal').textContent = formatDuration(total);
  $('factPaused').textContent = formatDuration(pausedTotal(run));
  $('factPlanned').textContent = saved ? formatDuration(saved.plannedMs) : '–';
  $('factActual').textContent = saved ? formatDuration(saved.actualMs) : '–';
  $('factTasks').textContent = `${leaves.filter((t) => t.done).length}/${leaves.length}`;
  const tot = state.totals;
  $('totToday').textContent = `${formatDuration(tot.todayMs)} · ${formatDuration(tot.todayPausedMs)} paused`;
  $('totWeek').textContent = `${formatDuration(tot.weekMs)} · ${formatDuration(tot.weekPausedMs)} paused`;
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

// ---------- more ----------

function renderControls() {
  const sw = $('countdownBtn');
  sw.classList.toggle('on', state.settings.countdown);
  sw.setAttribute('aria-checked', String(state.settings.countdown));
  $('endBtn').hidden = !state.run;
  if (document.activeElement?.id !== 'addInput' || !state.run) setIndent(addIndent);
  // An empty session: your templates, one click to start.
  const chips = $('tplChips');
  const empty = !state.run?.tasks.length;
  chips.hidden = !empty || !state.templates.length;
  chips.replaceChildren();
  if (!chips.hidden) {
    chips.append(el('span', 'label', 'Start a template'));
    for (const tpl of state.templates) {
      const b = el('button', '', tpl.name);
      b.type = 'button';
      b.onclick = () => void api.act({ type: 'startTemplate', id: tpl.id });
      chips.append(b);
    }
  }
  const names = $('taskNames');
  if (names.childElementCount !== state.suggestions.length || names.firstElementChild?.getAttribute('value') !== state.suggestions[0]) {
    names.replaceChildren(...state.suggestions.map((v) => Object.assign(document.createElement('option'), { value: v })));
  }
}

function closePicker() {
  editing = false;
}

let dragId: string | null = null;

function renderList() {
  const list = $('list');
  // Moving a task with the keyboard redraws the list; keep the focus on it, but only if it was there.
  const hadFocus = list.contains(document.activeElement);
  list.replaceChildren();
  const run = state.run;
  if (!run || !run.tasks.length) return;
  const current = currentTask();
  // Your order, top to bottom: new tasks go at the end and finished ones stay where they are.
  // Subtasks sit under their task, indented.
  const add = (tasks: Task[], depth: number) => {
    for (const t of tasks) {
      list.append(row(run, t, t === current, depth));
      if (pickerFor === t.id) {
        const li = el('li', 'row-picker');
        li.style.paddingLeft = 32 + depth * 18 + 'px';
        li.append(estimatePicker(t, () => {
          pickerFor = null;
          render();
        }));
        list.append(li);
      }
      add(childrenOf(run, t.id), depth + 1);
      if (subFor === t.id) list.append(subtaskField(t, depth + 1));
    }
  };
  add(run.tasks.filter((t) => !t.parentId || !run.tasks.some((p) => p.id === t.parentId)), 0);
  if (hadFocus && focusId) list.querySelector<HTMLElement>(`li[data-id="${focusId}"]`)?.focus();
}

/** Type a subtask and hit Enter; the field stays open for the next one. */
function subtaskField(parent: Task, depth: number): HTMLLIElement {
  const li = el('li', 'row-sub');
  li.style.paddingLeft = 8 + depth * 18 + 'px';
  const input = el('input');
  input.placeholder = `Subtask of ${parent.title}, e.g. Hero 20m`;
  input.setAttribute('list', 'taskNames');
  input.onclick = (e) => e.stopPropagation();
  input.onfocus = () => (editing = true);
  input.onblur = () => {
    editing = false;
    if (!input.value.trim()) {
      subFor = null;
      render();
    }
  };
  input.onkeydown = (k) => {
    if (k.key === 'Enter' && input.value.trim()) {
      const text = input.value;
      input.value = '';
      editing = false;
      void api.act({ type: 'addSubtask', parentId: parent.id, text }).then(() => {
        (document.querySelector('.row-sub input') as HTMLInputElement | null)?.focus();
      });
    }
    if (k.key === 'Escape') {
      k.stopPropagation();
      subFor = null;
      editing = false;
      render();
    }
    // Shift-Tab: back to plain tasks, in the add field at the bottom.
    if (k.key === 'Tab' && k.shiftKey) {
      k.preventDefault();
      const text = input.value;
      subFor = null;
      editing = false;
      setIndent(false);
      render();
      const add = $<HTMLInputElement>('addInput');
      add.value = text;
      add.focus();
    }
  };
  li.append(input);
  queueMicrotask(() => input.focus());
  return li;
}

/** A task with subtasks: its rolled-up time and estimate. Tick it to finish them all. */
function groupRow(run: Run, t: Task, depth: number): HTMLLIElement {
  const li = el('li', 'group');
  li.style.paddingLeft = 8 + depth * 18 + 'px';
  const done = isSectionDone(run, t);
  if (done) li.classList.add('done');
  const box = el('span', 'box', '✓');
  box.title = done ? 'Mark all its subtasks as not done' : 'Mark it and all its subtasks done';
  box.onclick = (e) => {
    e.stopPropagation();
    void api.act({ type: 'toggleDone', id: t.id });
  };
  const kids = run.tasks.filter((x) => ancestorsOf(run, x).includes(t) && !isSection(run, x));
  const name = el('span', 'name', t.title);
  const count = el('span', 'count', `${kids.filter((k) => k.done).length}/${kids.length}`);
  const spent = el('span', 'num', formatDuration(totalElapsed(run, t)));
  spent.dataset.group = t.id;
  li.append(box, name, count, spent);
  const est = totalEstimate(run, t);
  if (done && est !== undefined) {
    const d = totalElapsed(run, t) - est;
    li.append(el('span', 'num ' + (d <= 0 ? 'ahead' : 'behind'), formatDuration(d, { signed: true })));
  } else li.append(estimateButton(t, est, totalElapsed(run, t)));
  li.append(subtaskButton(t), removeButton(t));
  draggable(li, t);
  return li;
}

/** Drag a task to move it, its subtasks come along; drop it on a subtask to make it one. */
let focusId: string | null = null; // the task you're moving with the keyboard, focused again after a redraw

function draggable(li: HTMLLIElement, t: Task) {
  // Keyboard: select a task, then ⌥↑ / ⌥↓ moves it (with its subtasks), Tab / Shift+Tab nests it,
  // ↑ / ↓ go to the task above or below, Enter works like a click.
  li.tabIndex = 0;
  li.dataset.id = t.id;
  li.addEventListener('focus', () => (focusId = t.id));
  li.addEventListener('keydown', (e) => {
    if (e.target !== li) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      void api.act({ type: 'shift', id: t.id, dir: e.key === 'ArrowUp' ? -1 : 1 });
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const rows = [...$('list').querySelectorAll<HTMLElement>('li[data-id]')];
      rows[rows.indexOf(li) + (e.key === 'ArrowUp' ? -1 : 1)]?.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      void api.act({ type: e.shiftKey ? 'outdent' : 'indent', id: t.id });
    } else if (e.key === 'Enter') li.click();
  });
  li.draggable = true;
  li.ondragstart = (e) => {
    e.stopPropagation();
    dragId = t.id;
  };
  li.ondragend = () => (dragId = null);
  li.ondragover = (e) => {
    e.preventDefault();
    li.classList.add('drop');
  };
  li.ondragleave = () => li.classList.remove('drop');
  li.ondrop = (e) => {
    e.preventDefault();
    li.classList.remove('drop');
    if (dragId && dragId !== t.id) void api.act({ type: 'move', id: dragId, beforeId: t.id });
  };
}

/** Under the task's estimate while it runs: how far under (green) or over (red) it is. */
function liveDelta(spent: number, est: number): { text: string; tone: string } {
  const d = spent - est;
  return { text: formatDuration(d, { signed: true }), tone: d <= 0 ? 'ahead' : 'behind' };
}

/** The estimate; once the task has time on it, how far under or over it is, live. Click to change it. */
function estimateButton(t: Task, est = t.estimateMs, spent = 0): HTMLButtonElement {
  const summed = t.estimateMs === undefined && est !== undefined;
  const b = el('button', 'est' + (summed ? ' summed' : ''), est !== undefined ? formatEstimate(est) : 'estimate');
  b.type = 'button';
  b.title = summed ? 'The sum of its subtasks. Click to set one for the whole task.' : 'How long do you think this takes?';
  if (est !== undefined && spent >= 1000) {
    const d = liveDelta(spent, est);
    b.textContent = d.text;
    b.classList.add('live', d.tone);
    b.dataset.delta = t.id;
    b.dataset.est = String(est);
    b.title = `Against your ${formatEstimate(est)} estimate. Click to change it.`;
  }
  b.onclick = (e) => {
    e.stopPropagation();
    pickerFor = pickerFor === t.id ? null : t.id;
    render();
  };
  return b;
}

function subtaskButton(t: Task): HTMLButtonElement {
  const b = el('button', 'plus', '+');
  b.type = 'button';
  b.title = 'Add a subtask';
  b.onclick = (e) => {
    e.stopPropagation();
    subFor = subFor === t.id ? null : t.id;
    render();
  };
  return b;
}

function removeButton(t: Task): HTMLButtonElement {
  const x = el('button', 'x', '×');
  x.type = 'button';
  x.title = 'Remove';
  x.onclick = (e) => {
    e.stopPropagation();
    void api.act({ type: 'remove', id: t.id });
  };
  return x;
}

function row(run: Run, t: Task, current: boolean, depth: number): HTMLLIElement {
  if (isSection(run, t)) return groupRow(run, t, depth);
  const li = el('li');
  li.style.paddingLeft = 8 + depth * 18 + 'px';
  if (t.done) li.classList.add('done');
  if (current) li.classList.add('current');

  const box = el('span', 'box', '✓');
  box.title = t.done ? 'Mark as not done' : 'Mark done';
  box.onclick = (e) => {
    e.stopPropagation();
    void api.act({ type: 'toggleDone', id: t.id });
  };

  const name = el('span', 'name', t.title);
  name.title = 'Double-click to rename';
  name.ondblclick = (e) => {
    e.stopPropagation();
    editing = true;
    const input = el('input');
    input.value = t.title;
    input.style.padding = '2px 6px';
    name.replaceWith(input);
    input.focus();
    input.select();
    let closed = false;
    const finish = (save: boolean) => {
      if (closed) return;
      closed = true;
      editing = false;
      if (save && input.value.trim()) void api.act({ type: 'rename', id: t.id, title: input.value });
      else render();
    };
    input.onkeydown = (k) => {
      if (k.key === 'Enter') finish(true);
      if (k.key === 'Escape') finish(false);
      // Tab makes it a subtask of the task above, Shift-Tab a task again.
      if (k.key === 'Tab') {
        k.preventDefault();
        finish(true);
        void api.act({ type: k.shiftKey ? 'outdent' : 'indent', id: t.id });
      }
    };
    input.onblur = () => finish(true);
  };
  li.append(box, name);

  const spent = t.done ? t.elapsedMs : liveElapsed(run, t);
  if (t.done) {
    // Finished: time, delta against the estimate, gold on a new best.
    const best = golds.get(taskKey(t.title));
    const gold = best !== undefined && t.elapsedMs <= best;
    li.append(timeCell(t, spent, 'num' + (gold ? ' gold' : '')));
    if (t.estimateMs !== undefined) {
      const d = t.elapsedMs - t.estimateMs;
      li.append(el('span', 'num ' + (d <= 0 ? 'ahead' : 'behind'), formatDuration(d, { signed: true })));
    }
    if (!t.parentId) li.append(subtaskButton(t));
    li.title = 'Click to pick this task back up';
    li.onclick = () => void api.act({ type: 'reopen', id: t.id });
  } else {
    if (spent >= 1000 || current) li.append(timeCell(t, spent, 'num'));
    li.append(estimateButton(t, t.estimateMs, spent));
    // Tasks and subtasks: two levels are enough.
    if (!t.parentId) li.append(subtaskButton(t));
    // Click a task to work on it; click the current one while paused to carry on.
    const runningThis = current && isRunning();
    li.title = runningThis ? '' : current ? 'Click to carry on' : 'Click to switch to this task';
    li.onclick = () => !runningThis && void api.act(current ? { type: 'togglePause' } : { type: 'start', id: t.id });
  }

  li.append(removeButton(t));
  draggable(li, t);
  return li;
}

/** A task's time. Click it to correct it: 12:30, 1:02:03 or 25m. */
function timeCell(t: Task, ms: number, cls: string): HTMLElement {
  const cell = el('button', cls + ' time-edit', formatDuration(ms));
  cell.type = 'button';
  cell.dataset.time = t.id;
  cell.title = 'Click to correct this time';
  cell.onclick = (e) => {
    e.stopPropagation();
    editing = true;
    const input = el('input', 'time-input');
    input.value = formatDuration(t.done || !state.run ? t.elapsedMs : liveElapsed(state.run, t));
    input.title = 'e.g. 12:30, 1:02:03 or 25m. Enter to save, Esc to cancel.';
    cell.replaceWith(input);
    input.focus();
    input.select();
    let closed = false;
    const finish = (save: boolean) => {
      if (closed) return;
      closed = true;
      editing = false;
      if (save && input.value.trim()) void api.act({ type: 'setTime', id: t.id, text: input.value });
      else render();
    };
    input.onclick = (k) => k.stopPropagation();
    input.onkeydown = (k) => {
      if (k.key === 'Enter') finish(true);
      if (k.key === 'Escape') finish(false);
    };
    input.onblur = () => finish(true);
  };
  return cell;
}

// ---------- the clock ----------

let countShown = '';
let raceHtml = '';

/** "3, 2, 1, Go" in place of the clock, kept as wide as the clock so nothing jumps. */
function countInFrame(until: number): boolean {
  const clock = $('clock');
  const rem = until - Date.now();
  const label = rem > 1500 ? '3' : rem > 1000 ? '2' : rem > 500 ? '1' : 'GO';
  if (!countShown) clock.style.minWidth = clock.offsetWidth + 'px';
  if (label !== countShown) sfx(label === 'GO' ? 'go' : 'count');
  countShown = label;
  $('hms').textContent = label;
  $('ms').textContent = '';
  clock.className = 'clock count-in ' + (label === 'GO' ? 'ahead' : '');
  return true;
}

function frame() {
  if (state?.countInUntil && !state.finished) {
    countInFrame(state.countInUntil);
    requestAnimationFrame(frame);
    return;
  }
  if (countShown) {
    countShown = '';
    $('clock').style.minWidth = '';
  }
  if (state) {
    const run = state.run;
    const t = currentTask();
    const clock = $('clock');
    const ms = run && t ? liveElapsed(run, t) : 0;
    // Countdown: show what's left of the estimate, then how far over with a minus.
    const left = state.settings.countdown && t?.estimateMs !== undefined ? t.estimateMs - ms : undefined;
    const [hms, milli] = clockParts(left === undefined ? ms : Math.abs(left));
    $('hms').textContent = (left !== undefined && left < 0 ? '−' : '') + hms;
    $('ms').textContent = milli;

    // Racing your best, the clock's color says whether you're beating it; otherwise your estimate.
    const best = bestOf(t);
    const target = best && !state.settings.countdown ? best.ms : t?.estimateMs;
    let tone = 'idle';
    if (t && isRunning()) tone = target === undefined ? '' : ms <= target ? 'ahead' : 'behind';
    else if (t && ms > 0) tone = 'paused';
    clock.className = 'clock ' + tone + (flash?.tone === 'gold' && flash.until > Date.now() ? ' shine' : '');

    // Session: all time on this run's tasks, colored by what you've saved or lost so far.
    const session = $('session');
    session.hidden = !run?.tasks.length;
    if (run && !session.hidden) {
      $('sessionTime').textContent = clockParts(sessionElapsed(run, state.settings.pausesCount))[0];
      const saved = timeSaved(run);
      const planned = run.tasks.some((t) => t.estimateMs !== undefined);
      const net = saved?.savedMs ?? 0;
      const tone = !planned ? '' : net >= 0 ? 'ahead' : 'behind';
      $('sessionTime').className = 'time ' + (isRunning() ? tone : 'paused');
      const out = $('sessionSaved');
      out.textContent = !planned ? '' : !saved ? 'on plan' : net >= 0 ? `${formatDuration(net)} saved` : `${formatDuration(-net)} behind`;
      out.className = 'saved ' + tone;
      if (run.pausedSince !== undefined) {
        out.textContent = `Pause ${formatDuration(pausedTotal(run))}`;
        out.className = 'saved paused';
      }
    }

    // A subtask's group: its total time, and what's left of the group's estimate.
    const parent = run && t ? ancestorsOf(run, t).at(-1) : undefined;
    if (run && parent) {
      const spent = totalElapsed(run, parent);
      const est = totalEstimate(run, parent);
      $('groupTime').textContent = clockParts(spent)[0];
      const left = $('groupLeft');
      left.textContent = est === undefined ? '' : spent <= est ? `${formatDuration(est - spent)} left` : `${formatDuration(spent - est)} over`;
      const tone = est === undefined ? '' : spent <= est ? 'ahead' : 'behind';
      left.className = 'saved ' + tone;
      $('groupTime').className = 'time ' + (isRunning() ? tone : 'paused');
    }

    if (isOpen()) {
      for (const c of document.querySelectorAll<HTMLElement>('.list [data-group]')) {
        const g = run?.tasks.find((x) => x.id === c.dataset.group);
        if (run && g) c.textContent = formatDuration(totalElapsed(run, g));
      }
      for (const c of document.querySelectorAll<HTMLElement>('.list [data-delta]')) {
        const task = run?.tasks.find((x) => x.id === c.dataset.delta);
        if (!run || !task) continue;
        const d = liveDelta(isSection(run, task) ? totalElapsed(run, task) : liveElapsed(run, task), Number(c.dataset.est));
        c.textContent = d.text;
        c.className = 'est live ' + d.tone;
      }
      // Times in the list tick along too.
      for (const c of document.querySelectorAll<HTMLElement>('.list [data-time]')) {
        const task = run?.tasks.find((x) => x.id === c.dataset.time);
        if (run && task && !task.done) c.textContent = formatDuration(liveElapsed(run, task));
      }
      // Your best for this task, live, and for a template how you're doing against your PB run.
      const race = $('race');
      const pace = state.settings.race && run && state.record?.pb ? pbPace(run, state.record.pb.tasks) : undefined;
      let html = '';
      // The clock's color says whether you're beating it; how far under or over sits by the task in the list.
      if (best) html = `Best ${formatDuration(best.ms)}`;
      if (pace !== undefined) html += (html ? ' · ' : '') + `PB <span class="${pace <= 0 ? 'ahead' : 'behind'}">${formatDuration(pace, { signed: true })}</span>`;
      if (html !== raceHtml) {
        raceHtml = html;
        race.innerHTML = html;
        race.hidden = !html;
        race.classList.toggle('fuzzy', Boolean(best?.fuzzy));
        race.title = best
          ? `Your best: ${formatDuration(best.ms)}, ${best.from}, ${new Date(best.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}` +
            (best.fuzzy ? `. Matched a similar task (“${best.key}”): click if it's not the same.` : '')
          : 'Against your fastest run of this template';
      }
    }
  }
  requestAnimationFrame(frame);
}

// ---------- wiring ----------

function render() {
  golds = new Map(state.golds);
  applyTheme();
  const fin = state.finished;
  $('summary').hidden = !fin;
  $('face').hidden = Boolean(fin);
  if (fin) {
    $('more').hidden = true;
    renderSummary(fin);
    if (document.activeElement?.id !== 'continueInput') $('continueInput').focus();
    return;
  }
  renderFace();
  if (isOpen()) {
    renderControls();
    if (!editing) renderList();
  }
}

function setOpen(open: boolean) {
  $('more').hidden = !open;
  $('panel').classList.toggle('open', open);
  if (!open) {
    closePicker();
    pickerFor = null;
    $('paste').hidden = true;
  }
  render();
}

/** The face moves the window when dragged and opens or closes the panel when clicked. */
function wireFace() {
  const face = $('face');
  let start: { x: number; y: number } | null = null;
  let dragged = false;
  face.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.screenX, y: e.screenY };
    dragged = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!start) return;
    if (!dragged) {
      if (Math.hypot(e.screenX - start.x, e.screenY - start.y) < 4) return;
      dragged = true;
      void api.act({ type: 'dragStart', mode: 'move' });
    }
    void api.act({ type: 'dragMove' });
  });
  window.addEventListener('mouseup', () => {
    if (start && dragged) void api.act({ type: 'dragEnd' });
    if (start && !dragged && state.countInUntil) void api.act({ type: 'skipCountIn' });
    else if (start && !dragged) {
      setOpen(!isOpen());
      if (isOpen() && !currentTask()) $('addInput').focus();
    }
    start = null;
  });
}

function wire() {
  wireFace();

  // The round button and the circle sit on the face, so keep their clicks from opening or dragging it.
  for (const id of ['go', 'tick']) $(id).addEventListener('mousedown', (e) => e.stopPropagation());
  $('go').onclick = () => {
    const t = currentTask();
    if (!t) return;
    void (state.run?.activeTaskId ? api.act({ type: 'togglePause' }) : api.act({ type: 'start', id: t.id }));
  };
  $('tick').onclick = () => {
    const t = currentTask();
    if (!t) return;
    void (state.run?.activeTaskId === t.id ? api.act({ type: 'split' }) : api.act({ type: 'toggleDone', id: t.id }));
  };
  // Reset: the first click arms it, a second within 3 seconds throws the attempt away and starts the route over.
  $('resetBtn').addEventListener('mousedown', (e) => e.stopPropagation());
  let armed: ReturnType<typeof setTimeout> | undefined;
  $('resetBtn').onclick = () => {
    const b = $('resetBtn');
    if (!b.classList.contains('armed')) {
      b.classList.add('armed');
      b.title = 'Click again to reset this run';
      armed = setTimeout(() => b.classList.remove('armed'), 3000);
      return;
    }
    clearTimeout(armed);
    b.classList.remove('armed');
    void api.act({ type: 'resetRun' });
  };
  $('race').onclick = () => {
    if ($('race').classList.contains('fuzzy')) $('notSame').hidden = !$('notSame').hidden;
  };
  $('notSame').onclick = () => {
    const t = currentTask();
    $('notSame').hidden = true;
    raceHtml = '';
    if (t) void api.act({ type: 'notSame', taskId: t.id });
  };
  $('countdownBtn').onclick = () => void api.act({ type: 'settings', patch: { countdown: !state.settings.countdown } });

  $('addForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('addInput');
    if (input.value.trim()) void api.act({ type: 'quickAdd', text: input.value, subtask: addIndent });
    input.value = '';
  };
  // Tab: what you type becomes a subtask of the last task. Shift-Tab: a task again.
  $('addInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    setIndent(!e.shiftKey);
  });

  const paste = $('paste');
  $('pasteBtn').onclick = () => {
    paste.hidden = !paste.hidden;
    if (!paste.hidden) $('pasteText').focus();
  };
  $('pasteTpl').onclick = () => {
    if (!$<HTMLTextAreaElement>('pasteText').value.trim()) return $('pasteText').focus();
    $('pasteTplName').hidden = false;
    $('pasteTplName').focus();
  };
  $('pasteTplName').onkeydown = (k) => {
    const input = $<HTMLInputElement>('pasteTplName');
    if (k.key !== 'Enter' || !input.value.trim()) return;
    const ta = $<HTMLTextAreaElement>('pasteText');
    void api.act({ type: 'importTemplate', name: input.value.trim(), text: ta.value });
    input.value = '';
    input.hidden = true;
    ta.value = '';
    paste.hidden = true;
  };
  $('pasteFile').onclick = () => {
    paste.hidden = true;
    void api.act({ type: 'importFile' });
  };
  $('pasteGo').onclick = () => {
    const ta = $<HTMLTextAreaElement>('pasteText');
    if (ta.value.trim()) void api.act({ type: 'import', text: ta.value });
    ta.value = '';
    paste.hidden = true;
  };

  $('tipsOk').onclick = () => {
    $('tips').hidden = true;
    void api.act({ type: 'settings', patch: { onboarded: true } });
    $('addInput').focus();
  };
  $('statsBtn').onclick = () => void api.act({ type: 'openDashboard' });
  $('settingsBtn').onclick = () => void api.act({ type: 'openSettings' });

  // Hide to the menu bar, or quit. They sit on the face, so keep their clicks from opening it.
  for (const id of ['minBtn', 'quitBtn']) $(id).addEventListener('mousedown', (e) => e.stopPropagation());
  $('minBtn').onclick = () => void api.act({ type: 'hideOverlay' });
  $('quitBtn').onclick = () => void api.act({ type: 'quit' });

  // Drag the corner to resize: the whole timer scales, so it stays sharp at any size.
  $('grip').addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void api.act({ type: 'dragStart', mode: 'resize' });
    const move = () => void api.act({ type: 'dragMove' });
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      void api.act({ type: 'dragEnd' });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  $('summaryStats').onclick = () => void api.act({ type: 'openDashboard' });
  $('saveTpl').onclick = () => {
    const fin = state.finished;
    if (!fin || savedTemplateFor === fin.id) return;
    if (state.templates.some((t) => t.id === fin.templateId)) {
      savedTemplateFor = fin.id;
      void api.act({ type: 'saveTemplate', name: '' });
      return;
    }
    const form = $('tplForm');
    form.hidden = !form.hidden;
    const input = $<HTMLInputElement>('tplName');
    input.value = fin.name;
    if (!form.hidden) (input.focus(), input.select());
  };
  $('tplForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>('tplName').value.trim();
    if (!name || !state.finished) return;
    savedTemplateFor = state.finished.id;
    $('tplForm').hidden = true;
    void api.act({ type: 'saveTemplate', name });
  };
  $('copyBtn').onclick = async () => {
    const r = $('result').getBoundingClientRect();
    await api.act({ type: 'copyResult', rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
    $('copyBtn').textContent = 'Copied ✓';
    setTimeout(() => ($('copyBtn').textContent = 'Copy'), 1500);
  };
  $('continueForm').onsubmit = async (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('continueInput');
    if (!input.value.trim()) return;
    const text = input.value;
    input.value = '';
    await api.act({ type: 'continueWith', text });
    setOpen(true);
  };
  $('newSession').onclick = async () => {
    await api.act({ type: 'dismissSummary' });
    setOpen(true);
    $('addInput').focus();
  };
  $('endBtn').onclick = () => void api.act({ type: 'endRun' });

  api.onFocusAdd(() => {
    setOpen(true);
    $('addInput').focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.countInUntil) void api.act({ type: 'skipCountIn' });
    else if (pickerFor || subFor || !paste.hidden) {
      closePicker();
      pickerFor = null;
      subFor = null;
      paste.hidden = true;
      render();
    } else setOpen(false);
  });

  // The window is always exactly as tall as what's showing.
  const panel = $('panel');
  new ResizeObserver(() => void api.act({ type: 'fitSize', width: panel.offsetWidth, height: panel.offsetHeight })).observe(panel);
  darkQuery.addEventListener('change', () => state && applyTheme());
}

/** Ticking a task off: a sound, and for a moment its result where the task name is. */
function noticeDone(prev: AppState, next: AppState) {
  const before = prev.run;
  if (!before) return;
  const after = next.run?.id === before.id ? next.run : next.finished?.id === before.id ? next.finished : null;
  if (!after) return;
  const done = after.tasks.filter((t) => t.done && !isSection(after, t) && before.tasks.some((b) => b.id === t.id && !b.done));
  if (!done.length) return;
  if (after === next.finished) return void sfx('finish');
  if (done.length > 1) return void sfx('done');
  const t = done[0];
  const best = prev.settings.race ? prev.bests[t.id] : undefined;
  if (best && t.elapsedMs < best.ms) {
    flash = { text: `★ NEW BEST  −${formatDuration(best.ms - t.elapsedMs)}`, tone: 'gold', until: Date.now() + 1600 };
    sfx('best');
  } else {
    const ref = best?.ms ?? t.estimateMs;
    const d = ref === undefined ? undefined : t.elapsedMs - ref;
    flash = {
      text: d === undefined ? `✓ ${t.title}  ${formatDuration(t.elapsedMs)}` : `✓ ${formatDuration(d, { signed: true })}${best ? ' on your best' : ''}`,
      tone: d === undefined ? '' : d <= 0 ? 'ahead' : 'behind',
      until: Date.now() + 1600,
    };
    sfx('done');
  }
  setTimeout(() => {
    flash = null;
    render();
  }, 1650);
}

wire();
api.onState((s) => {
  const prev = state;
  state = s;
  if (prev) noticeDone(prev, s);
  render();
});
state = await api.getState();
render();
// First start: open up with the tips.
if (!state.settings.onboarded && !state.finished) {
  $('tips').hidden = false;
  setOpen(true);
}
requestAnimationFrame(frame);
