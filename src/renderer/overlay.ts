import type { AppState, SpeedrunApi } from '../api.js';
import {
  breakElapsed, formatDuration, formatEstimate, isSection, isSectionDone, liveElapsed, sessionDelta, sessionElapsed, taskKey,
  type Run, type Task,
} from '../runs.js';

const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ESTIMATE_PRESETS = ['5m', '10m', '15m', '25m', '45m', '1h', '1h30m', '2h'];

let state: AppState;
let golds = new Map<string, number>();
let editing = false; // hold list re-renders while an inline editor is open
let pickerFor: string | null = null; // task whose estimate picker is open in the list

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 1:02:03 and .456, the clock's two parts. Hours always show, so the width never jumps. */
function clockParts(ms: number): [string, string] {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return [`${h}:${pad(m)}:${pad(s)}`, '.' + String(total % 1000).padStart(3, '0')];
}

/** The task on the clock: the running one, or the next one up. */
function currentTask(): Task | undefined {
  const run = state.run;
  if (!run) return undefined;
  return run.tasks.find((t) => t.id === run.activeTaskId) ?? run.tasks.find((t) => !t.done && !isSection(run, t));
}

/** A finished session to recap: every task done, or the one you just ended. */
function recapRun(): Run | null {
  const run = state.run;
  if (run?.tasks.length && !currentTask()) return run;
  return run ? null : state.lastRun;
}

const tone = (delta: number | undefined) => (delta === undefined ? '' : delta <= 0 ? 'ahead' : 'behind');

const isRunning = () => Boolean(state.run?.activeTaskId && state.run.activeSince !== undefined);
const isOpen = () => !$('more').hidden;

// ---------- estimate picker ----------

/** Preset chips plus a free field. Used under the clock and under a task in the list. */
function estimatePicker(t: Task, onDone: () => void): HTMLElement {
  const box = el('div', 'picker');
  const set = (text: string) => {
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
    if (k.key === 'Escape') onDone();
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
  const t = currentTask();
  const recap = recapRun();
  const task = $('task');
  if (t) task.textContent = t.title;
  else if (recap) {
    const d = sessionDelta(recap);
    task.textContent = d === undefined ? 'Session done' : d <= 0 ? 'Session done. You saved' : 'Session done. Over your estimates by';
  } else task.textContent = 'Click to add your first task';
  task.className = 'task' + (t ? '' : ' empty');
}

/** Under the clock: session time and delta while you work, the recap once you're done. */
function sessionLine(now: number) {
  const box = $('session');
  const time = $('sessionTime');
  const delta = $('sessionDelta');
  const recap = recapRun();
  const run = state.run;

  const countBreaks = state.settings.countBreaks;
  if (recap) {
    // The big clock shows what you saved; this line keeps the session's length, tasks and breaks.
    const leaves = recap.tasks.filter((x) => !isSection(recap, x));
    const breaks = breakElapsed(recap, now);
    box.hidden = false;
    box.className = 'session recap';
    $('sessionLabel').textContent = 'Session';
    time.textContent = clockParts(sessionElapsed(recap, countBreaks, now))[0];
    time.className = 'num';
    delta.textContent = `${leaves.filter((x) => x.done).length} of ${leaves.length} tasks` + (breaks >= 1000 ? `, ${formatDuration(breaks)} break` : '');
    delta.className = '';
    delta.title = breaks >= 1000 ? (countBreaks ? 'Breaks are included in the session time' : 'Breaks are not included in the session time') : '';
    return;
  }
  const total = run ? sessionElapsed(run, countBreaks, now) : 0;
  box.hidden = total < 1000;
  if (box.hidden) return;
  const d = sessionDelta(run!, now);
  delta.textContent = d === undefined ? '' : d <= 0 ? `${formatDuration(-d)} saved` : `${formatDuration(d)} over`;
  delta.className = 'num ' + tone(d);
  delta.title = d === undefined ? '' : d <= 0 ? 'Saved so far against your estimates' : 'Over your estimates so far';
  if (run!.breakSince !== undefined) {
    // On a break: this line becomes the break's own clock.
    box.className = 'session on-break';
    $('sessionLabel').textContent = 'Break';
    time.textContent = clockParts(now - run!.breakSince)[0];
    time.className = 'num';
    return;
  }
  box.className = 'session';
  $('sessionLabel').textContent = 'Session';
  time.textContent = clockParts(total)[0];
  time.className = 'num ' + tone(d);
}

// ---------- more ----------

function renderControls() {
  const t = currentTask();
  const running = isRunning();

  const est = $('estimate');
  est.hidden = !t;
  est.textContent = t?.estimateMs !== undefined ? `Estimate ${formatEstimate(t.estimateMs)}` : 'Set an estimate';
  est.className = 'estimate' + (t?.estimateMs !== undefined ? '' : ' unset');

  const picker = $('picker');
  if (!picker.hidden && t && !editing) picker.replaceChildren(...estimatePicker(t, closePicker).childNodes);
  if (!t) picker.hidden = true;

  const play = $<HTMLButtonElement>('play');
  play.textContent = running ? 'Pause' : 'Start';
  play.className = 'act' + (running ? '' : ' primary');
  // Nothing to time yet: the add field is the only thing to do.
  $('actions').hidden = !t;
  $('endBtn').hidden = !state.run;
}

function closePicker() {
  $('picker').hidden = true;
  editing = false;
}

let dragId: string | null = null;

function renderList() {
  const list = $('list');
  list.replaceChildren();
  const run = state.run;
  if (!run || !run.tasks.length) return;
  const current = currentTask();
  // Up next in priority order, finished ones underneath.
  const open = run.tasks.filter((t) => (isSection(run, t) ? !isSectionDone(run, t) : !t.done));
  const done = run.tasks.filter((t) => !open.includes(t) && !isSection(run, t));
  for (const t of [...open, ...done]) {
    list.append(row(run, t, t === current));
    if (pickerFor === t.id) {
      const li = el('li', 'row-picker');
      li.append(estimatePicker(t, () => {
        pickerFor = null;
        render();
      }));
      list.append(li);
    }
  }
}

function row(run: Run, t: Task, current: boolean): HTMLLIElement {
  const li = el('li');
  if (isSection(run, t)) {
    li.className = 'section';
    li.textContent = t.title;
    return li;
  }
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

  if (t.done) {
    // Finished: time, delta against the estimate, gold on a new best.
    const best = golds.get(taskKey(t.title));
    const gold = best !== undefined && t.elapsedMs <= best;
    li.append(el('span', 'num' + (gold ? ' gold' : ''), formatDuration(t.elapsedMs)));
    if (t.estimateMs !== undefined) {
      const d = t.elapsedMs - t.estimateMs;
      li.append(el('span', 'num ' + (d <= 0 ? 'ahead' : 'behind'), formatDuration(d, { signed: true })));
    }
  } else {
    const spent = liveElapsed(run, t);
    if (spent >= 1000 && !current) li.append(el('span', 'num', formatDuration(spent)));
    const est = el('button', 'est', t.estimateMs !== undefined ? formatEstimate(t.estimateMs) : 'estimate');
    est.type = 'button';
    est.title = 'How long do you think this takes?';
    est.onclick = (e) => {
      e.stopPropagation();
      pickerFor = pickerFor === t.id ? null : t.id;
      render();
    };
    li.append(est);
    li.title = current ? '' : 'Click to switch to this task';
    li.onclick = () => !current && void api.act({ type: 'start', id: t.id });
  }

  const x = el('button', 'x', '×');
  x.type = 'button';
  x.title = 'Remove';
  x.onclick = (e) => {
    e.stopPropagation();
    void api.act({ type: 'remove', id: t.id });
  };
  li.append(x);

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

// ---------- the clock ----------

function frame() {
  if (state) {
    const now = Date.now();
    const run = state.run;
    const t = currentTask();
    const recap = recapRun();
    const clock = $('clock');
    // The big clock is the task's time; once the session is done, the time you saved (or lost).
    const recapDelta = recap ? sessionDelta(recap, now) : undefined;
    const ms = run && t ? liveElapsed(run, t, now) : recap ? (recapDelta !== undefined ? Math.abs(recapDelta) : sessionElapsed(recap, state.settings.countBreaks, now)) : 0;
    // Countdown: show what's left of the estimate, then how far past it you are, with a minus.
    const counting = Boolean(t && state.settings.countdown && t.estimateMs !== undefined);
    const shown = counting ? t!.estimateMs! - ms : ms;
    const [hms, milli] = clockParts(Math.abs(shown));
    $('sign').textContent = shown < 0 ? '−' : '';
    $('hms').textContent = hms;
    $('ms').textContent = milli;

    let look = 'idle';
    if (t && isRunning()) look = t.estimateMs === undefined ? '' : ms <= t.estimateMs ? 'ahead' : 'behind';
    else if (t && ms > 0) look = 'paused';
    else if (recap) look = tone(recapDelta);
    clock.className = 'clock ' + look;
    sessionLine(now);

    if (isOpen()) {
      const delta = $('delta');
      if (t?.estimateMs !== undefined && ms > 0) {
        const d = t.estimateMs - ms;
        delta.textContent = d >= 0 ? `${formatDuration(d)} left` : `${formatDuration(-d)} over`;
        delta.className = 'delta ' + (d >= 0 ? 'ahead' : 'behind');
      } else delta.textContent = '';
    }
  }
  requestAnimationFrame(frame);
}

// ---------- wiring ----------

function render() {
  golds = new Map(state.golds);
  $<HTMLInputElement>('optCountdown').checked = state.settings.countdown;
  $<HTMLInputElement>('optBreaks').checked = state.settings.countBreaks;
  renderFace();
  if (isOpen()) {
    renderControls();
    if (!editing) renderList();
  }
}

function setOpen(open: boolean) {
  $('more').hidden = !open;
  if (!open) {
    closePicker();
    pickerFor = null;
    $('paste').hidden = true;
    $('settings').hidden = true;
  }
  render();
}

/** The face moves the window when dragged and opens or closes the panel when clicked. */
function wireFace() {
  const face = $('face');
  let start: { x: number; y: number; lastX: number; lastY: number } | null = null;
  let dragged = false;
  face.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.screenX, y: e.screenY, lastX: e.screenX, lastY: e.screenY };
    dragged = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!start) return;
    if (!dragged && Math.hypot(e.screenX - start.x, e.screenY - start.y) < 4) return;
    dragged = true;
    void api.act({ type: 'moveBy', dx: e.screenX - start.lastX, dy: e.screenY - start.lastY });
    start.lastX = e.screenX;
    start.lastY = e.screenY;
  });
  window.addEventListener('mouseup', () => {
    if (start && !dragged) {
      setOpen(!isOpen());
      if (isOpen() && !currentTask()) $('addInput').focus();
    }
    start = null;
  });
}

function wire() {
  wireFace();

  $('estimate').onclick = () => {
    const p = $('picker');
    p.hidden = !p.hidden;
    render();
  };
  $('play').onclick = () => {
    const t = currentTask();
    if (!t) return;
    void (state.run?.activeTaskId ? api.act({ type: 'togglePause' }) : api.act({ type: 'start', id: t.id }));
  };
  $('done').onclick = () => {
    const t = currentTask();
    if (!t) return;
    closePicker();
    void (state.run?.activeTaskId ? api.act({ type: 'split' }) : api.act({ type: 'toggleDone', id: t.id }));
  };

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

  $('statsBtn').onclick = () => void api.act({ type: 'openDashboard' });
  $('settingsBtn').onclick = () => ($('settings').hidden = !$('settings').hidden);
  $<HTMLInputElement>('optCountdown').onchange = (e) =>
    void api.act({ type: 'settings', patch: { countdown: (e.target as HTMLInputElement).checked } });
  $<HTMLInputElement>('optBreaks').onchange = (e) =>
    void api.act({ type: 'settings', patch: { countBreaks: (e.target as HTMLInputElement).checked } });
  $('endBtn').onclick = () => void api.act({ type: 'endRun' });
  $('hideBtn').onclick = () => void api.act({ type: 'hideOverlay' });

  api.onFocusAdd(() => {
    setOpen(true);
    $('addInput').focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('picker').hidden || pickerFor || !paste.hidden) {
      closePicker();
      pickerFor = null;
      paste.hidden = true;
      render();
    } else setOpen(false);
  });

  // The window is always exactly as tall as what's showing.
  new ResizeObserver(() => void api.act({ type: 'fitHeight', height: $('panel').offsetHeight })).observe($('panel'));
}

wire();
api.onState((s) => {
  state = s;
  render();
});
state = await api.getState();
render();
requestAnimationFrame(frame);
