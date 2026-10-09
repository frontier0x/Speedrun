import type { AppState, SpeedrunApi } from '../api.js';
import {
  ancestorsOf, childrenOf, formatDuration, formatEstimate, isSection, isSectionDone, liveElapsed, pausedTotal, sessionElapsed, taskKey,
  timeSaved, totalElapsed, totalEstimate, type Run, type Task,
} from '../runs.js';
import { palette, paletteVars, paintSolid, resolveMode } from '../theme.js';

const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ESTIMATE_PRESETS = ['5m', '10m', '15m', '25m', '45m', '1h', '1h30m', '2h'];

let state: AppState;
let golds = new Map<string, number>();
let editing = false; // hold list re-renders while an inline editor is open
let pickerFor: string | null = null; // task whose estimate picker is open in the list
let subFor: string | null = null; // task whose "add a subtask" field is open in the list

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
}

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
  const [hms, milli] = clockParts(Math.abs(net));
  $('savedHms').textContent = (net < 0 ? '−' : '+') + hms;
  $('savedMs').textContent = milli;
  $('savedClock').className = 'clock ' + (!saved ? 'idle' : net >= 0 ? 'ahead' : 'behind');
  $('savedLabel').textContent = !saved
    ? 'Give tasks an estimate to see how much time you save.'
    : net >= 0
      ? 'saved against your plan'
      : 'over your plan';
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

// ---------- more ----------

function renderControls() {
  const sw = $('countdownBtn');
  sw.classList.toggle('on', state.settings.countdown);
  sw.setAttribute('aria-checked', String(state.settings.countdown));
  $('endBtn').hidden = !state.run;
}

function closePicker() {
  editing = false;
}

let dragId: string | null = null;

function renderList() {
  const list = $('list');
  list.replaceChildren();
  const run = state.run;
  if (!run || !run.tasks.length) return;
  const current = currentTask();
  const finished = (t: Task) => (isSection(run, t) ? isSectionDone(run, t) : t.done);
  // Up next in priority order, finished ones underneath; subtasks sit under their task, indented.
  const add = (tasks: Task[], depth: number) => {
    for (const t of [...tasks.filter((x) => !finished(x)), ...tasks.filter(finished)]) {
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
}

/** Type a subtask and hit Enter; the field stays open for the next one. */
function subtaskField(parent: Task, depth: number): HTMLLIElement {
  const li = el('li', 'row-sub');
  li.style.paddingLeft = 8 + depth * 18 + 'px';
  const input = el('input');
  input.placeholder = `Subtask of ${parent.title}, e.g. Hero 20m`;
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
  } else li.append(estimateButton(t, est));
  li.append(subtaskButton(t), removeButton(t));
  return li;
}

function estimateButton(t: Task, est = t.estimateMs): HTMLButtonElement {
  const b = el('button', 'est' + (t.estimateMs === undefined && est !== undefined ? ' summed' : ''), est !== undefined ? formatEstimate(est) : 'estimate');
  b.type = 'button';
  b.title = t.estimateMs === undefined && est !== undefined ? 'The sum of its subtasks. Click to set one for the whole task.' : 'How long do you think this takes?';
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
    li.append(subtaskButton(t));
    li.title = 'Click to pick this task back up';
    li.onclick = () => void api.act({ type: 'reopen', id: t.id });
  } else {
    if (spent >= 1000 || current) li.append(timeCell(t, spent, 'num'));
    li.append(estimateButton(t), subtaskButton(t));
    // Click a task to work on it; click the current one while paused to carry on.
    const runningThis = current && isRunning();
    li.title = runningThis ? '' : current ? 'Click to carry on' : 'Click to switch to this task';
    li.onclick = () => !runningThis && void api.act(current ? { type: 'togglePause' } : { type: 'start', id: t.id });
  }

  li.append(removeButton(t));

  li.draggable = true;
  li.ondragstart = () => (dragId = t.id);
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

function frame() {
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

    let tone = 'idle';
    if (t && isRunning()) tone = t.estimateMs === undefined ? '' : ms <= t.estimateMs ? 'ahead' : 'behind';
    else if (t && ms > 0) tone = 'paused';
    clock.className = 'clock ' + tone;

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
      // Times in the list tick along too.
      for (const c of document.querySelectorAll<HTMLElement>('.list [data-time]')) {
        const task = run?.tasks.find((x) => x.id === c.dataset.time);
        if (run && task && !task.done) c.textContent = formatDuration(liveElapsed(run, task));
      }
      const delta = $('delta');
      if (t?.estimateMs !== undefined && ms > 0) {
        const d = t.estimateMs - ms;
        // Counting down, the clock already shows what's left, so say how long it's been instead.
        if (state.settings.countdown) delta.textContent = `${formatDuration(ms)} in`;
        else delta.textContent = d >= 0 ? `${formatDuration(d)} left` : `${formatDuration(-d)} over`;
        delta.className = 'delta ' + (d >= 0 ? 'ahead' : 'behind');
      } else delta.textContent = '';
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
    if (start && !dragged) {
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
  $('countdownBtn').onclick = () => void api.act({ type: 'settings', patch: { countdown: !state.settings.countdown } });

  $('addForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('addInput');
    if (input.value.trim()) void api.act({ type: 'quickAdd', text: input.value });
    input.value = '';
  };

  const paste = $('paste');
  $('pasteBtn').onclick = () => {
    paste.hidden = !paste.hidden;
    if (!paste.hidden) $('pasteText').focus();
  };
  $('pasteCancel').onclick = () => (paste.hidden = true);
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
    if (pickerFor || subFor || !paste.hidden) {
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

wire();
api.onState((s) => {
  state = s;
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
