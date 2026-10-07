import type { AppState, SpeedrunApi } from '../api.js';
import {
  ACCENTS, formatDuration, formatEstimate, isSection, isSectionDone, liveElapsed, runElapsed, taskKey, totalElapsed,
  totalEstimate, type Run, type Task,
} from '../runs.js';

const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let state: AppState;
let golds = new Map<string, number>();
let editing = false; // pause list re-renders while an inline editor is open

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function depth(run: Run, t: Task): number {
  let d = 0;
  for (let p = t.parentId; p; p = run.tasks.find((x) => x.id === p)?.parentId) d++;
  return d;
}

const minutes = (ms: number) =>
  ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m` : ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 1000)}s`;

/** The task the bar shows: the running one, or the next one up. */
function shownTask(): Task | undefined {
  const run = state.run;
  if (!run) return undefined;
  return run.tasks.find((t) => t.id === run.activeTaskId) ?? run.tasks.find((t) => !t.done && !isSection(run, t));
}

const isRunning = () => Boolean(state.run?.activeTaskId && state.run.activeSince !== undefined);

/** Inline editor that replaces `target` until Enter, Escape or blur. */
function inlineEdit(target: HTMLElement, value: string, placeholder: string, save: (v: string) => void) {
  editing = true;
  const input = el('input');
  input.value = value;
  input.placeholder = placeholder;
  input.style.padding = '1px 6px';
  input.style.width = target.classList.contains('chip') ? '64px' : '100%';
  target.replaceWith(input);
  input.focus();
  input.select();
  let closed = false;
  const done = (ok: boolean) => {
    if (closed) return;
    closed = true;
    editing = false;
    if (ok) save(input.value);
    else render();
  };
  input.addEventListener('keydown', (k) => {
    if (k.key === 'Enter') done(true);
    if (k.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true), { once: true });
}

// ---------- bar ----------

function renderBar() {
  const shown = shownTask();
  const running = isRunning();
  const task = $('task');
  task.textContent = shown ? shown.title : state.run?.tasks.length ? 'All done. GG.' : 'Add a task to start';
  task.className = 'task' + (shown ? '' : ' placeholder');

  const play = $('play');
  play.textContent = running ? '❚❚' : '▶';
  play.title = running ? 'Pause' : shown ? 'Start' : 'Add a task first';
  play.classList.toggle('on', running);
  $('split').hidden = !shown;

  const dot = $('dot');
  dot.className = 'dot' + (running && state.focus.current ? ' ' + state.focus.current.kind : '');
  dot.title = running && state.focus.current ? `${state.focus.current.key}: ${state.focus.current.kind}` : '';
}

function renderNudge() {
  const n = state.focus.nudge;
  const box = $('nudge');
  box.hidden = !n;
  if (!n) return;
  const text = $('nudgeText');
  text.replaceChildren(el('b', '', `${formatDuration(n.ms)} on ${n.key}.`), ` Still on “${shownTask()?.title ?? 'your task'}”?`);
}

// ---------- expanded ----------

function renderFocus() {
  const box = $('focus');
  box.replaceChildren();
  if (state.focus.browserBlocked) {
    const line = el('div', 'notice', `${state.focus.browserBlocked} didn't share its open tab, so it counts as context. `);
    const fix = el('button', 'link', 'Allow in Settings');
    fix.onclick = () => void api.act({ type: 'openAutomationSettings' });
    line.append(fix);
    box.append(line);
  }
  const t = shownTask();
  if (!state.settings.focusTracking || !t?.focus) return;
  const f = t.focus;
  const total = f.work + f.context + f.distraction;
  if (total < 1000) return;
  const bar = el('div', 'split');
  for (const k of ['work', 'context', 'distraction'] as const) {
    const s = el('span', k);
    s.style.width = (f[k] / total) * 100 + '%';
    bar.append(s);
  }
  const legend = el('div', 'legend');
  const item = (cls: string, label: string) => {
    const s = el('span');
    s.append(el('i', ''), label);
    (s.firstChild as HTMLElement).style.background = `var(--${cls === 'work' ? 'ahead' : cls === 'distraction' ? 'behind' : 'context'})`;
    legend.append(s);
  };
  item('work', `work ${minutes(f.work)}`);
  item('context', `context ${minutes(f.context)}`);
  item('distraction', `distraction ${minutes(f.distraction)}`);
  const top = Object.entries(t.sources ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
  box.append(bar, legend);
  if (top.length) box.append(el('div', '', top.map(([k, ms]) => `${k} ${minutes(ms)}`).join(' · ')));
}

let dragId: string | null = null;

function renderList() {
  const list = $('list');
  list.replaceChildren();
  const run = state.run;
  if (!run || !run.tasks.length) {
    list.append(el('li', 'empty', 'Type a task below, or Import your notes.'));
    return;
  }
  // Unfinished first in priority order, finished ones sink to the bottom.
  const open = run.tasks.filter((t) => (isSection(run, t) ? !isSectionDone(run, t) : !t.done));
  const done = run.tasks.filter((t) => !open.includes(t) && !isSection(run, t));
  for (const t of [...open, ...done]) list.append(row(run, t));

  list.ondragover = (e) => e.preventDefault();
  list.ondrop = (e) => {
    if (e.target === list && dragId) void api.act({ type: 'move', id: dragId, beforeId: null });
  };
}

function row(run: Run, t: Task): HTMLLIElement {
  const section = isSection(run, t);
  const li = el('li');
  if (section) li.classList.add('section');
  if (t.done) li.classList.add('done');
  if (run.activeTaskId === t.id) li.classList.add('active');
  li.style.paddingLeft = 8 + depth(run, t) * 14 + 'px';

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
    inlineEdit(name, t.title, '', (v) => v.trim() && void api.act({ type: 'rename', id: t.id, title: v }));
  };
  li.append(name);

  const time = el('span', 't mono muted');
  time.dataset.time = t.id;
  li.append(time);
  if (t.done && !section) {
    if (t.estimateMs !== undefined) {
      const d = t.elapsedMs - t.estimateMs;
      li.append(el('span', 't mono ' + (d <= 0 ? 'ahead' : 'behind'), formatDuration(d, { signed: true })));
    }
    const best = golds.get(taskKey(t.title));
    if (best !== undefined && t.elapsedMs <= best) li.append(el('span', 'gold', '★'));
  } else if (section) {
    const est = totalEstimate(run, t);
    if (est !== undefined) li.append(el('span', 'chip', formatEstimate(est)));
  } else {
    const chip = el('span', 'chip editable', t.estimateMs !== undefined ? formatEstimate(t.estimateMs) : 'est');
    chip.title = 'How long do you think this takes? e.g. 25m, 1h30m';
    chip.onclick = (e) => {
      e.stopPropagation();
      inlineEdit(chip, t.estimateMs !== undefined ? formatEstimate(t.estimateMs).replace(' ', '') : '', '25m', (v) =>
        void api.act({ type: 'setEstimate', id: t.id, text: v }),
      );
    };
    li.append(chip);
  }

  const remove = el('button', 'ic remove', '×');
  remove.title = 'Remove';
  remove.onclick = (e) => {
    e.stopPropagation();
    void api.act({ type: 'remove', id: t.id });
  };
  li.append(remove);

  if (!section && !t.done) {
    li.title = 'Click to work on this';
    li.onclick = () => void api.act({ type: 'start', id: t.id });
  }

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
    e.stopPropagation();
    li.classList.remove('drop-before');
    if (dragId && dragId !== t.id) void api.act({ type: 'move', id: dragId, beforeId: t.id });
  };
  return li;
}

function renderLook() {
  const sw = $('swatches');
  sw.replaceChildren();
  for (const c of ACCENTS) {
    const s = el('span', 'swatch' + (c === state.settings.accent ? ' on' : ''));
    s.style.background = c;
    s.onclick = () => void api.act({ type: 'settings', patch: { accent: c } });
    sw.append(s);
  }
  const custom = el('input');
  custom.type = 'color';
  custom.value = state.settings.accent;
  custom.title = 'Any color';
  custom.oninput = () => document.documentElement.style.setProperty('--accent', custom.value);
  custom.onchange = () => void api.act({ type: 'settings', patch: { accent: custom.value } });
  sw.append(custom);
  $<HTMLInputElement>('opacity').value = String(state.settings.opacity);
}

// ---------- live ticking ----------

function tick() {
  if (!state) return;
  const now = Date.now();
  const run = state.run;
  const shown = shownTask();
  const time = $('time');
  const delta = $('delta');
  const progress = $('progress');

  if (run && shown) {
    const elapsed = liveElapsed(run, shown, now);
    time.textContent = formatDuration(elapsed);
    time.className = 'time mono' + (isRunning() ? '' : ' paused');
    if (shown.estimateMs !== undefined && elapsed > 0) {
      const d = elapsed - shown.estimateMs;
      delta.textContent = formatDuration(d, { signed: true });
      delta.className = 'delta mono ' + (d <= 0 ? 'ahead' : 'behind');
      progress.style.width = Math.min(100, (elapsed / shown.estimateMs) * 100) + '%';
      progress.parentElement!.classList.toggle('over', d > 0);
    } else {
      delta.textContent = '';
      progress.style.width = '0';
    }
  } else {
    time.textContent = run ? formatDuration(runElapsed(run, now)) : '0:00';
    time.className = 'time mono paused';
    delta.textContent = '';
    progress.style.width = '0';
  }

  if (run && !$('more').hidden) {
    for (const span of document.querySelectorAll<HTMLElement>('[data-time]')) {
      const t = run.tasks.find((x) => x.id === span.dataset.time);
      if (!t) continue;
      const ms = totalElapsed(run, t, now);
      span.textContent = ms >= 1000 ? formatDuration(ms) : '';
    }
  }
}

function render() {
  document.documentElement.style.setProperty('--accent', state.settings.accent);
  golds = new Map(state.golds);
  renderBar();
  renderNudge();
  if (!$('more').hidden) {
    renderFocus();
    if (!editing) renderList();
    if (!$('look').hidden) renderLook();
  }
  const focusBtn = $('focusBtn');
  focusBtn.textContent = state.settings.focusTracking ? 'Focus ✓' : 'Focus off';
  focusBtn.title = 'Notices which app or site you are in while a task runs and nudges you after long distractions. No screenshots.';
  focusBtn.classList.toggle('on', state.settings.focusTracking);
  $('endBtn').hidden = !state.run;
  tick();
}

function setExpanded(open: boolean) {
  $('more').hidden = !open;
  $('expand').classList.toggle('open', open);
  render();
}

function wire() {
  $('play').onclick = () => {
    const shown = shownTask();
    if (!shown) {
      setExpanded(true);
      $('addInput').focus();
    } else if (state.run?.activeTaskId) void api.act({ type: 'togglePause' });
    else void api.act({ type: 'start', id: shown.id });
  };
  $('split').onclick = () => {
    const shown = shownTask();
    if (!shown) return;
    void (state.run?.activeTaskId ? api.act({ type: 'split' }) : api.act({ type: 'toggleDone', id: shown.id }));
  };
  $('expand').onclick = () => setExpanded($('more').hidden);

  for (const b of document.querySelectorAll<HTMLElement>('[data-answer]')) {
    b.onclick = () => void api.act({ type: 'nudge', answer: b.dataset.answer as 'back' | 'pause' | 'allow' });
  }

  $('dashBtn').onclick = () => void api.act({ type: 'openDashboard' });
  $('hideBtn').onclick = () => void api.act({ type: 'hideOverlay' });
  $('endBtn').onclick = () => void api.act({ type: 'endRun' });
  $('focusBtn').onclick = () => void api.act({ type: 'settings', patch: { focusTracking: !state.settings.focusTracking } });
  $('lookBtn').onclick = () => {
    $('look').hidden = !$('look').hidden;
    render();
  };
  $<HTMLInputElement>('opacity').oninput = (e) =>
    void api.act({ type: 'settings', patch: { opacity: Number((e.target as HTMLInputElement).value) } });

  const imp = $('import');
  $('importBtn').onclick = () => {
    imp.hidden = !imp.hidden;
    if (!imp.hidden) $<HTMLTextAreaElement>('importText').focus();
  };
  $('importCancel').onclick = () => (imp.hidden = true);
  $('importFile').onclick = () => {
    imp.hidden = true;
    void api.act({ type: 'importFile' });
  };
  $('importGo').onclick = () => {
    const ta = $<HTMLTextAreaElement>('importText');
    if (ta.value.trim()) void api.act({ type: 'import', text: ta.value });
    ta.value = '';
    imp.hidden = true;
  };

  $('addForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('addInput');
    if (input.value.trim()) void api.act({ type: 'quickAdd', text: input.value });
    input.value = '';
  };
  api.onFocusAdd(() => {
    setExpanded(true);
    $('addInput').focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      imp.hidden = true;
      $('look').hidden = true;
    }
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
setInterval(tick, 250);
