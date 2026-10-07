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
    const a = state.capturing ? state.activity : null;
    const title = el('div', 'title' + (a ? '' : ' placeholder'));
    title.append(el('span', 'rec' + (state.capturing && !state.idle ? '' : ' off')));
    title.append(document.createTextNode(!state.capturing ? 'Recording paused' : a ? a.app : state.idle ? 'Away (idle)' : 'Looking for the active app…'));
    box.append(title);
    const row = el('div', 'timer-row');
    row.append(el('div', 'timer mono' + (state.idle || !state.capturing ? ' paused' : ''), '0:00'));
    const controls = el('div', 'controls');
    const toggle = el('button', state.capturing ? '' : 'primary', state.capturing ? '❚❚ Pause' : '▶ Record');
    toggle.title = state.capturing ? 'Stop recording for now' : 'Start recording your apps and tabs';
    toggle.onclick = () => void api.act({ type: 'toggleCapture' });
    controls.append(toggle);
    row.append(controls);
    box.append(row);
    if (a?.title) box.append(el('div', 'meta muted', a.title));
    const missing = state.capturing ? permissionNotice() : null;
    if (missing) box.append(missing);
    return;
  }

  const active = run?.tasks.find((t) => t.id === run.activeTaskId);
  const next = run?.tasks.find((t) => !t.done && !isSection(run, t));
  const shown = active ?? next;

  const title = el('div', 'title' + (shown ? '' : ' placeholder'), shown ? shown.title : run?.tasks.length ? 'All done. GG.' : 'Press Start, or add tasks first');
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
  const controls = el('div', 'controls');
  const play = el('button', running ? '' : 'primary', running ? '❚❚ Pause' : '▶ Start');
  play.title = running ? 'Pause the timer' : 'Start the timer on this task';
  play.onclick = () => void api.act(active ? { type: 'togglePause' } : shown ? { type: 'start', id: shown.id } : { type: 'startRun' });
  controls.append(play);
  if (shown && (active || shown.elapsedMs > 0)) {
    const split = el('button', running ? 'primary' : '', '✓ Done');
    split.title = 'Finish this task and start the next one (⌘⇧↩)';
    split.onclick = () => void api.act(active ? { type: 'split' } : { type: 'toggleDone', id: shown.id });
    controls.append(split);
  }
  row.append(controls);
  box.append(row);

  if (shown) {
    const meta = el('div', 'meta');
    meta.append(estimateChip(shown, shown.estimateMs !== undefined ? 'est ' + formatEstimate(shown.estimateMs) : '+ estimate'));
    meta.append(el('span', 'delta'));
    const best = golds.get(taskKey(shown.title));
    if (best !== undefined) meta.append(el('span', 'chip gold', '★ best ' + formatDuration(best)));
    meta.append(endButton());
    box.append(meta);
    const bar = el('div', 'bar');
    bar.append(el('div'));
    box.append(bar);
  }
}

/** Ends the run: it goes to the dashboard and the list starts fresh. */
function endButton(): HTMLElement {
  const b = el('button', 'end', 'End run');
  b.title = 'Save this run to the dashboard and start a fresh one';
  const run = state.run;
  b.hidden = !run?.tasks.length;
  b.onclick = () => void api.act({ type: 'newRun' });
  return b;
}

/** In AutoCapture, say plainly which macOS permission is missing and link straight to it. */
function permissionNotice(): HTMLElement | null {
  const p = state.permissions;
  if (p.screen && p.accessibility) return null;
  const box = el('div', 'notice');
  box.append(
    el('div', 'notice-title', 'AutoCapture needs permission'),
    el('div', 'muted small', !p.screen
      ? 'Without Screen Recording it only sees app names: no window titles, no screenshots.'
      : 'Without Accessibility it can’t see which browser tab you’re on.'),
  );
  const row = el('div', 'row');
  const ask = (which: 'screen' | 'accessibility', label: string) => {
    const b = el('button', 'primary', label);
    b.onclick = () => void api.act({ type: 'openPermission', which });
    row.append(b);
  };
  if (!p.screen) ask('screen', 'Allow Screen Recording');
  if (!p.accessibility) ask('accessibility', 'Allow Accessibility');
  const restart = el('button', '', 'Restart');
  restart.title = 'macOS applies Screen Recording after a restart';
  restart.onclick = () => void api.act({ type: 'relaunch' });
  row.append(restart);
  box.append(row);
  return box;
}

// ---------- list ----------

let dragId: string | null = null;

function renderApps() {
  const list = $('list');
  list.className = 'apps no-drag';
  list.ondragover = list.ondrop = null;
  list.replaceChildren();
  const rows = appTotals(Date.now());
  if (!rows.length) {
    list.append(el('li', 'empty', state.capturing ? 'Recorded apps show up here as you switch between them.' : 'Press Record to start.'));
    return;
  }
  const max = rows[0][1];
  for (const [app, ms] of rows.slice(0, 8)) {
    const li = el('li');
    if (state.activity?.app === app && state.capturing) li.classList.add('now');
    li.append(el('span', 'name', app));
    const meter = el('span', 'meter');
    const fill = el('div');
    fill.style.width = (ms / max) * 100 + '%';
    meter.append(fill);
    li.append(meter, el('span', 'time mono muted', formatDuration(ms)));
    list.append(li);
  }
}

/** Today's time per app, including the stretch still running. */
function appTotals(now: number): [string, number][] {
  const totals = new Map(state.appTimes);
  const a = state.activity;
  if (a && state.capturing && !state.idle) totals.set(a.app, (totals.get(a.app) ?? 0) + Math.max(0, now - a.since));
  return [...totals].sort((x, y) => y[1] - x[1]);
}

function renderList() {
  const list = $('list');
  list.className = 'list no-drag';
  list.replaceChildren();
  const run = state.run;
  if (!run || !run.tasks.length) {
    list.append(el('li', 'empty', 'Type a task below, or click Import to paste a list from your notes.'));
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

let lastAppsSecond = 0;

function tick() {
  if (!state) return;
  const now = Date.now();
  const run = state.run;
  const timer = document.querySelector<HTMLElement>('.timer');

  if (state.settings.mode === 'auto') {
    const a = state.capturing && !state.idle ? state.activity : null;
    if (timer) timer.textContent = a ? formatDuration(now - a.since) : '0:00';
    if (Math.floor(now / 1000) !== lastAppsSecond) {
      lastAppsSecond = Math.floor(now / 1000);
      renderApps();
    }
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

  if (state.settings.mode === 'auto') {
    $('runTime').textContent = formatDuration(appTotals(now).reduce((sum, [, ms]) => sum + ms, 0));
    $('runTime').title = 'Recorded today';
    $('pace').textContent = '';
  } else if (run) {
    $('runTime').title = 'This run so far';
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
  const auto = state.settings.mode === 'auto';
  $('modeManual').classList.toggle('on', !auto);
  $('modeAuto').classList.toggle('on', auto);
  $('hint').textContent = auto
    ? 'Auto: records which app and tab you’re in and times them. Nothing to press. Saved on this Mac only.'
    : state.run?.tasks.length ? '' : 'Manual: write your tasks, press Start, and hit Done when one is finished. The timer moves to the next task.';
  $('importBtn').hidden = auto;
  $('addForm').hidden = auto;
  renderCurrent();
  if (auto) renderApps();
  else if (!editing) renderList();
  if (!$('settings').hidden) renderSettings();
  tick();
}

function wire() {
  $('modeManual').onclick = () => void api.act({ type: 'setMode', mode: 'manual' });
  $('modeAuto').onclick = () => void api.act({ type: 'setMode', mode: 'auto' });
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
