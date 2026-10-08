import type { AppState, SpeedrunApi } from '../api.js';
import {
  formatClock, formatDuration, formatEstimate, isSection, isSectionDone, liveElapsed, totalElapsed, type Run, type Task,
} from '../runs.js';

const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let state: AppState;
let open = false;
let editing = false; // don't rebuild the list under an open inline editor

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The task the clock belongs to: the running one, else the next one up. */
function shownTask(run: Run | null): Task | undefined {
  if (!run) return undefined;
  return run.tasks.find((t) => t.id === run.activeTaskId) ?? run.tasks.find((t) => !t.done && !isSection(run, t));
}

const running = () => Boolean(state.run?.activeTaskId && state.run.activeSince !== undefined);

// ---------- face ----------

function renderFace() {
  const t = shownTask(state.run);
  const task = $('task');
  task.textContent = t ? t.title : state.run?.tasks.length ? 'All done. GG.' : 'Click to add your first task';
  task.classList.toggle('on', Boolean(t));
  $('est').textContent = t?.estimateMs !== undefined ? 'est ' + formatEstimate(t.estimateMs) : '';

  const play = $('play');
  play.textContent = running() ? '❚❚' : '▶';
  play.title = running() ? 'Pause' : 'Start';
  $('split').hidden = !t;

  const big = $('playBig');
  big.textContent = running() ? '❚❚ Pause' : '▶ Start';
  big.className = running() ? '' : 'primary';
  $('current').hidden = !t;
  const est = $<HTMLInputElement>('estInput');
  if (document.activeElement !== est) est.value = t?.estimateMs !== undefined ? formatEstimate(t.estimateMs).replace(' ', '') : '';
}

function togglePlay() {
  const run = state.run;
  const t = shownTask(run);
  if (!t) {
    setOpen(true);
    $('addInput').focus();
    return;
  }
  void api.act(run?.activeTaskId ? { type: 'togglePause' } : { type: 'start', id: t.id });
}

// ---------- list ----------

let dragId: string | null = null;

function renderList() {
  const list = $('list');
  list.replaceChildren();
  const run = state.run;
  if (!run) return;
  // Open tasks in priority order, finished ones sink to the bottom.
  const openTasks = run.tasks.filter((t) => (isSection(run, t) ? !isSectionDone(run, t) : !t.done));
  const done = run.tasks.filter((t) => !openTasks.includes(t) && !isSection(run, t));
  for (const t of [...openTasks, ...done]) list.append(row(run, t));
}

function row(run: Run, t: Task): HTMLLIElement {
  const section = isSection(run, t);
  const li = el('li');
  if (section) li.classList.add('section');
  if (t.done) li.classList.add('done');
  if (run.activeTaskId === t.id) li.classList.add('active');
  let depth = 0;
  for (let p = t.parentId; p; p = run.tasks.find((x) => x.id === p)?.parentId) depth++;
  li.style.paddingLeft = 8 + depth * 14 + 'px';

  if (!section) {
    const check = el('span', 'check', '✓');
    check.title = t.done ? 'Mark as not done' : 'Mark done';
    check.onclick = (e) => {
      e.stopPropagation();
      void api.act({ type: 'toggleDone', id: t.id });
    };
    li.append(check);
  }
  const name = el('span', 'name', t.title);
  name.title = 'Double-click to rename';
  name.ondblclick = (e) => {
    e.stopPropagation();
    inlineEdit(name, t.title, (v) => v.trim() && api.act({ type: 'rename', id: t.id, title: v }));
  };
  li.append(name);

  const spent = el('span', 'spent mono');
  spent.dataset.time = t.id;
  li.append(spent);

  if (!section) {
    const chip = el('span', 'chip editable', t.estimateMs !== undefined ? formatEstimate(t.estimateMs) : '+ est');
    chip.title = 'Your estimate, e.g. 25m or 1h30m';
    chip.onclick = (e) => {
      e.stopPropagation();
      inlineEdit(chip, t.estimateMs !== undefined ? formatEstimate(t.estimateMs).replace(' ', '') : '', (v) =>
        api.act({ type: 'setEstimate', id: t.id, text: v }),
      );
    };
    li.append(chip);
  }

  const remove = el('button', 'remove', '×');
  remove.title = 'Remove';
  remove.onclick = (e) => {
    e.stopPropagation();
    void api.act({ type: 'remove', id: t.id });
  };
  li.append(remove);

  if (!section && !t.done) li.onclick = () => void api.act({ type: 'start', id: t.id });

  li.draggable = true;
  li.ondragstart = () => (dragId = t.id);
  li.ondragend = () => (dragId = null);
  li.ondragover = (e) => {
    e.preventDefault();
    li.classList.add('drop-before');
  };
  li.ondragleave = () => li.classList.remove('drop-before');
  li.ondrop = (e) => {
    e.preventDefault();
    li.classList.remove('drop-before');
    if (dragId && dragId !== t.id) void api.act({ type: 'move', id: dragId, beforeId: t.id });
  };
  return li;
}

function inlineEdit(target: HTMLElement, value: string, save: (v: string) => unknown) {
  editing = true;
  const input = el('input');
  input.value = value;
  input.style.padding = '1px 6px';
  input.style.width = target.classList.contains('chip') ? '70px' : '100%';
  target.replaceWith(input);
  input.focus();
  input.select();
  let closed = false;
  const done = (ok: boolean) => {
    if (closed) return;
    closed = true;
    editing = false;
    if (ok) void save(input.value);
    render();
  };
  input.onkeydown = (k) => {
    if (k.key === 'Enter') done(true);
    if (k.key === 'Escape') done(false);
  };
  input.onblur = () => done(true);
}

// ---------- ticking ----------

function tick() {
  if (state) {
    const now = Date.now();
    const run = state.run;
    const t = shownTask(run);
    const elapsed = run && t ? liveElapsed(run, t, now) : 0;
    const clock = formatClock(elapsed);
    $('clockMain').textContent = clock.main;
    $('clockMs').textContent = clock.ms;

    const over = t?.estimateMs !== undefined && elapsed > t.estimateMs;
    const c = $('clock');
    c.classList.toggle('paused', !running());
    c.classList.toggle('over', over);

    const track = $('progressTrack');
    track.hidden = t?.estimateMs === undefined;
    if (t?.estimateMs) {
      $('progress').style.width = Math.min(100, (elapsed / t.estimateMs) * 100) + '%';
      track.classList.toggle('over', over);
    }

    if (open) {
      const delta = $('delta');
      if (t?.estimateMs !== undefined) {
        const d = elapsed - t.estimateMs;
        delta.textContent = d > 0 ? `${formatDuration(d)} over` : `${formatDuration(-d)} left`;
        delta.className = 'delta mono ' + (d > 0 ? 'behind' : 'muted');
      } else delta.textContent = '';
      if (run) {
        for (const span of document.querySelectorAll<HTMLElement>('[data-time]')) {
          const task = run.tasks.find((x) => x.id === span.dataset.time);
          const ms = task ? totalElapsed(run, task, now) : 0;
          span.textContent = ms >= 1000 ? formatDuration(ms) : '';
        }
      }
    }
  }
  requestAnimationFrame(tick);
}

// ---------- wiring ----------

function setOpen(v: boolean) {
  open = v;
  $('more').hidden = !open;
  $('panel').classList.toggle('open', open);
  render();
}

function render() {
  if (!state) return;
  document.documentElement.style.setProperty('--accent', state.settings.accent);
  renderFace();
  if (open && !editing) renderList();
}

/** Drag the face to move the window; a click without movement opens or closes the task list. */
function wireFace() {
  const face = $('face');
  let start: { x: number; y: number; lastX: number; lastY: number } | null = null;
  let moved = false;
  face.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    start = { x: e.screenX, y: e.screenY, lastX: e.screenX, lastY: e.screenY };
    moved = false;
    face.setPointerCapture(e.pointerId);
  });
  face.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!moved && Math.hypot(e.screenX - start.x, e.screenY - start.y) < 4) return;
    moved = true;
    void api.act({ type: 'moveBy', dx: e.screenX - start.lastX, dy: e.screenY - start.lastY });
    start.lastX = e.screenX;
    start.lastY = e.screenY;
  });
  face.addEventListener('pointerup', () => {
    if (!start) return;
    start = null;
    if (moved) void api.act({ type: 'savePosition' });
    else setOpen(!open);
  });
}

function wire() {
  wireFace();
  $('play').onclick = togglePlay;
  $('playBig').onclick = togglePlay;
  $('split').onclick = () => void api.act({ type: 'split' });
  $('doneBig').onclick = () => void api.act({ type: 'split' });

  const est = $<HTMLInputElement>('estInput');
  est.onchange = () => {
    const t = shownTask(state.run);
    if (t) void api.act({ type: 'setEstimate', id: t.id, text: est.value });
  };
  est.onkeydown = (k) => {
    if (k.key === 'Enter') est.blur();
  };

  const add = $<HTMLInputElement>('addInput');
  $('addForm').onsubmit = (e) => {
    e.preventDefault();
    if (add.value.trim()) void api.act({ type: 'quickAdd', text: add.value });
    add.value = '';
  };
  // Pasting several lines adds them all: bullets, checkboxes, headings and indentation become sections.
  add.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') ?? '';
    if (!text.includes('\n')) return;
    e.preventDefault();
    void api.act({ type: 'import', text });
  });
  api.onFocusAdd(() => {
    setOpen(true);
    add.focus();
  });

  $('dashBtn').onclick = () => void api.act({ type: 'openDashboard' });
  $('endBtn').onclick = () => void api.act({ type: 'endRun' });
  $('hideBtn').onclick = () => void api.act({ type: 'hideOverlay' });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open && !editing) setOpen(false);
  });

  // The window is exactly as tall as what's showing.
  new ResizeObserver(() => void api.act({ type: 'fitHeight', height: $('panel').offsetHeight })).observe($('panel'));
}

wire();
api.onState((s) => {
  state = s;
  render();
});
state = await api.getState();
render();
requestAnimationFrame(tick);
