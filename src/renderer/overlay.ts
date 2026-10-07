import type { AppState, SpeedrunApi } from '../api.js';
import {
  ACCENTS, formatDuration, formatEstimate, isSection, isSectionDone, liveElapsed, projectedRemaining, runElapsed,
  taskKey, totalElapsed, totalEstimate, type Run, type Task,
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

/** Delta against estimate, coloured like a speedrun split: green under, red over. */
function deltaSpan(actual: number, estimate?: number): HTMLElement | null {
  if (estimate === undefined) return null;
  const d = actual - estimate;
  return el('span', 'mono ' + (d <= 0 ? 'ahead' : 'behind'), formatDuration(d, { signed: true }));
}

function estimateChip(t: Task, label?: string): HTMLElement {
  const chip = el('span', 'chip editable', label ?? (t.estimateMs !== undefined ? formatEstimate(t.estimateMs) : '+ est'));
  chip.title = 'How long do you think this takes? e.g. 25m, 1h30m';
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    editing = true;
    const input = el('input');
    input.value = t.estimateMs !== undefined ? formatEstimate(t.estimateMs).replace(' ', '') : '';
    input.placeholder = '25m';
    input.style.width = '70px';
    input.style.padding = '1px 6px';
    chip.replaceWith(input);
    input.focus();
    let closed = false;
    const done = (save: boolean) => {
      if (closed) return;
      closed = true;
      editing = false;
      if (save) void api.act({ type: 'setEstimate', id: t.id, text: input.value });
      else render();
    };
    input.addEventListener('keydown', (k) => {
      if (k.key === 'Enter') done(true);
      if (k.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true), { once: true });
  });
  return chip;
}

// ---------- current split ----------

function renderCurrent() {
  const box = $('current');
  box.replaceChildren();
  const run = state.run;

  if (state.settings.mode === 'auto') {
    const a = state.activity;
    box.append(el('div', 'title' + (a ? '' : ' placeholder'), a ? a.app : state.idle ? 'Idle' : 'Watching…'));
    const row = el('div', 'timer-row');
    row.append(el('div', 'timer mono' + (state.idle ? ' paused' : ''), '0:00'));
    box.append(row);
    if (a?.title) box.append(el('div', 'meta muted', a.title));
    box.append(el('div', 'meta muted small', 'AutoCapture is recording app and tab switches. AI task detection is next.'));
    return;
  }

  const active = run?.tasks.find((t) => t.id === run.activeTaskId);
  const next = run?.tasks.find((t) => !t.done && !isSection(run, t));
  const shown = active ?? next;

  const title = el('div', 'title' + (shown ? '' : ' placeholder'), shown ? shown.title : run?.tasks.length ? 'All done. GG.' : 'Add your first task below');
  if (shown) {
    title.title = 'Double-click to rename';
    title.addEventListener('dblclick', () => {
      editing = true;
      const input = el('input');
      input.value = shown.title;
      title.replaceWith(input);
      input.focus();
      input.select();
      let closed = false;
      const done = (save: boolean) => {
        if (closed) return;
        closed = true;
        editing = false;
        if (save && input.value.trim()) void api.act({ type: 'rename', id: shown.id, title: input.value });
        else render();
      };
      input.addEventListener('keydown', (k) => {
        if (k.key === 'Enter') done(true);
        if (k.key === 'Escape') done(false);
      });
      input.addEventListener('blur', () => done(true), { once: true });
    });
  }
  box.append(title);

  const row = el('div', 'timer-row');
  const running = Boolean(active && run?.activeSince !== undefined);
  row.append(el('div', 'timer mono' + (running ? '' : ' paused'), '0:00'));
  if (shown) {
    const controls = el('div', 'controls');
    const play = el('button', '', running ? '❚❚' : '▶');
    play.title = running ? 'Pause' : 'Start';
    play.onclick = () => (active ? api.act({ type: 'togglePause' }) : api.act({ type: 'start', id: shown.id }));
    const split = el('button', 'primary', '✓ Split');
    split.title = 'Finish this task and start the next (⌘⇧↩)';
    split.onclick = () => (active ? api.act({ type: 'split' }) : api.act({ type: 'toggleDone', id: shown.id }));
    controls.append(play, split);
    row.append(controls);
  }
  box.append(row);

  if (shown) {
    const meta = el('div', 'meta');
    meta.append(estimateChip(shown, shown.estimateMs !== undefined ? 'est ' + formatEstimate(shown.estimateMs) : '+ estimate'));
    meta.append(el('span', 'delta'));
    const best = golds.get(taskKey(shown.title));
    if (best !== undefined) meta.append(el('span', 'chip gold', '★ best ' + formatDuration(best)));
    box.append(meta);
    const bar = el('div', 'bar');
    bar.append(el('div'));
    box.append(bar);
  }
}

// ---------- list ----------

let dragId: string | null = null;

function renderList() {
  const list = $('list');
  list.replaceChildren();
  const run = state.run;
  if (!run || !run.tasks.length) {
    list.append(el('li', 'empty', 'Type a task below or import your notes with ⇪'));
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
  li.dataset.id = t.id;
  if (section) li.classList.add('section');
  if (t.done) li.classList.add('done');
  if (run.activeTaskId === t.id) li.classList.add('active');
  li.style.paddingLeft = 6 + depth(run, t) * 14 + 'px';

  const grip = el('span', 'grip', '⋮⋮');
  li.append(grip);
  if (!section) {
    const check = el('span', 'check', '✓');
    check.title = t.done ? 'Mark as not done' : 'Mark done';
    check.onclick = (e) => {
      e.stopPropagation();
      void api.act({ type: 'toggleDone', id: t.id });
    };
    li.append(check);
  }
  li.append(el('span', 'name', t.title));

  const time = el('span', 'time mono muted');
  time.dataset.time = t.id;
  li.append(time);
  if (t.done && !section) {
    const d = deltaSpan(t.elapsedMs, t.estimateMs);
    if (d) li.append(d);
    const best = golds.get(taskKey(t.title));
    if (best !== undefined && t.elapsedMs <= best) li.append(el('span', 'gold', '★'));
  } else if (section) {
    const est = totalEstimate(run, t);
    if (est !== undefined) li.append(el('span', 'chip', formatEstimate(est)));
  } else {
    li.append(estimateChip(t));
  }

  const remove = el('button', 'icon remove', '×');
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
    e.stopPropagation();
    li.classList.remove('drop-before');
    if (dragId && dragId !== t.id) void api.act({ type: 'move', id: dragId, beforeId: t.id });
  };
  return li;
}

// ---------- live ticking ----------

function tick() {
  if (!state) return;
  const now = Date.now();
  const run = state.run;
  const timer = document.querySelector<HTMLElement>('.timer');

  if (state.settings.mode === 'auto') {
    if (timer) timer.textContent = state.activity ? formatDuration(now - state.activity.since) : '0:00';
  } else if (run) {
    const active = run.tasks.find((t) => t.id === run.activeTaskId) ?? run.tasks.find((t) => !t.done && !isSection(run, t));
    if (active && timer) {
      const elapsed = liveElapsed(run, active, now);
      timer.textContent = formatDuration(elapsed, { tenths: elapsed < 60_000 });
      const delta = document.querySelector<HTMLElement>('.meta .delta');
      if (delta) {
        delta.replaceChildren();
        const d = deltaSpan(elapsed, active.estimateMs);
        if (d) delta.append(d);
      }
      const bar = document.querySelector<HTMLElement>('.bar');
      if (bar && active.estimateMs) {
        const pct = (elapsed / active.estimateMs) * 100;
        (bar.firstElementChild as HTMLElement).style.width = Math.min(100, pct) + '%';
        bar.classList.toggle('over', pct > 100);
      } else if (bar) bar.style.visibility = 'hidden';
    }
    for (const span of document.querySelectorAll<HTMLElement>('[data-time]')) {
      const t = run.tasks.find((x) => x.id === span.dataset.time);
      if (!t) continue;
      const ms = totalElapsed(run, t, now);
      span.textContent = ms >= 1000 ? formatDuration(ms) : '';
    }
  }

  if (run) {
    $('runTime').textContent = formatDuration(runElapsed(run, now));
    const left = projectedRemaining(run, now);
    const finish = new Date(now + left);
    $('pace').textContent = left > 0 ? `· done ~${finish.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  } else {
    $('runTime').textContent = '0:00';
    $('pace').textContent = '';
  }
}

// ---------- settings, import, add ----------

function renderSettings() {
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

function render() {
  document.documentElement.style.setProperty('--accent', state.settings.accent);
  golds = new Map(state.golds);
  const mode = $('mode');
  mode.textContent = state.settings.mode === 'auto' ? '◉ AUTO' : 'MANUAL';
  mode.title = state.settings.mode === 'auto' ? 'AutoCapture: watches your apps and tabs. Click for Manual.' : 'Manual: your own task list. Click for AutoCapture.';
  renderCurrent();
  if (!editing) renderList();
  if (!$('settings').hidden) renderSettings();
  tick();
}

function wire() {
  $('mode').onclick = () => void api.act({ type: 'setMode', mode: state.settings.mode === 'auto' ? 'manual' : 'auto' });
  $('dashBtn').onclick = () => void api.act({ type: 'openDashboard' });
  $('hideBtn').onclick = () => void api.act({ type: 'hideOverlay' });
  $('settingsBtn').onclick = () => {
    const p = $('settings');
    p.hidden = !p.hidden;
    if (!p.hidden) renderSettings();
  };
  $<HTMLInputElement>('opacity').oninput = (e) =>
    void api.act({ type: 'settings', patch: { opacity: Number((e.target as HTMLInputElement).value) } });

  const modal = $('importModal');
  $('importBtn').onclick = () => {
    modal.hidden = false;
    $<HTMLTextAreaElement>('importText').focus();
  };
  $('importCancel').onclick = () => (modal.hidden = true);
  $('importFile').onclick = () => {
    modal.hidden = true;
    void api.act({ type: 'importFile' });
  };
  $('importGo').onclick = () => {
    const ta = $<HTMLTextAreaElement>('importText');
    if (ta.value.trim()) void api.act({ type: 'import', text: ta.value });
    ta.value = '';
    modal.hidden = true;
  };

  $('addForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('addInput');
    if (input.value.trim()) void api.act({ type: 'quickAdd', text: input.value });
    input.value = '';
  };
  api.onFocusAdd(() => $('addInput').focus());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('settings').hidden = true;
      modal.hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    const p = $('settings');
    if (!p.hidden && !p.contains(e.target as Node) && e.target !== $('settingsBtn')) p.hidden = true;
  });
}

wire();
api.onState((s) => {
  state = s;
  render();
});
state = await api.getState();
render();
setInterval(tick, 100);
