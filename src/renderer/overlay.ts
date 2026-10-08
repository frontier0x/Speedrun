import type { AppState, SpeedrunApi } from '../api.js';
import {
  formatDuration, formatEstimate, isSection, isSectionDone, liveElapsed, pausedTotal, sessionElapsed, taskKey, timeSaved,
  type Run, type Task,
} from '../runs.js';
import { palette, paletteVars, paintSolid, resolveMode } from '../theme.js';

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
  const task = $('task');
  task.textContent = t ? t.title : state.run?.tasks.length ? 'All done. GG.' : 'Click to add your first task';
  task.className = 'task' + (t ? '' : ' empty');
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
  applyTheme();
  const fin = state.finished;
  $('summary').hidden = !fin;
  $('face').hidden = Boolean(fin);
  if (fin) {
    $('more').hidden = true;
    renderSummary(fin);
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
    if (!$('picker').hidden || pickerFor || !paste.hidden) {
      closePicker();
      pickerFor = null;
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
requestAnimationFrame(frame);
