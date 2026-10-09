import type { AppState, SpeedrunApi } from '../api.js';
import {
  ancestorsOf, childrenOf, formatDuration, formatEstimate, isComplete, isSection, isSectionDone, liveElapsed, medal, pausedTotal, pbPace, runElapsed,
  sessionElapsed, taskKey, timeSaved, totalElapsed, totalEstimate, type Run, type Task,
} from '../runs.js';
import { palette, paletteVars, paintSolid, resolveMode } from '../theme.js';
import { play, type Sound } from './sound.js';
import { closePicker, estimatePicker, liveDelta, renderList } from './list.js';
import { $, api, bestOf, clockParts, currentTask, el, isOpen, isRunning, ordinal, setIndent, ui } from './shared.js';
import { renderSummary } from './summary.js';



/** For a moment after you tick a task off, its result stands where the task name is. */
let flash: { text: string; tone: string; until: number } | null = null;

// ---------- theme ----------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

/** Your colors for the current mode, as CSS variables on :root. */
function applyTheme() {
  const s = ui.state.settings;
  const colors = palette(resolveMode(s.theme, darkQuery.matches), s.colors);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(paletteVars(colors))) root.setProperty(k, v);
  root.setProperty('--button-ink', inkFor(paintSolid(colors.button)));
  root.setProperty('--clock-weight', String(s.clockWeight));
  document.body.classList.toggle('style-speedrun', s.clockStyle === 'speedrun');
}

const sfx = (sound: Sound) => ui.state.settings.sounds && play(sound, ui.state.settings.volume);

/** Your best for the task when you race it. */

/** Black or white, whichever reads better on the color. */
function inkFor(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000' : '#fff';
}


// ---------- face ----------

function renderFace() {
  const run = ui.state.run;
  const t = currentTask();
  const task = $('task');
  task.replaceChildren();
  // A subtask shows where it sits: "Build page › Hero".
  if (run && t) for (const a of ancestorsOf(run, t)) task.append(el('span', 'crumb', a.title + ' › '));
  task.append(t ? t.title : run?.tasks.length ? 'All done. Add the next task, or End session.' : 'Click to add your first task');
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

// ---------- more ----------

function renderControls() {
  const sw = $('countdownBtn');
  sw.classList.toggle('on', ui.state.settings.countdown);
  sw.setAttribute('aria-checked', String(ui.state.settings.countdown));
  $('endBtn').hidden = !ui.state.run;
  if (document.activeElement?.id !== 'addInput' || !ui.state.run) setIndent(ui.addIndent);
  // An empty session: your templates, one click to start.
  const chips = $('tplChips');
  const empty = !ui.state.run?.tasks.length;
  chips.hidden = !empty || !ui.state.templates.length;
  chips.replaceChildren();
  if (!chips.hidden) {
    chips.append(el('span', 'label', 'Start a template'));
    for (const tpl of ui.state.templates) {
      const b = el('button', '', tpl.name);
      b.type = 'button';
      b.onclick = () => void api.act({ type: 'startTemplate', id: tpl.id });
      chips.append(b);
    }
  }
  const names = $('taskNames');
  if (names.childElementCount !== ui.state.suggestions.length || names.firstElementChild?.getAttribute('value') !== ui.state.suggestions[0]) {
    names.replaceChildren(...ui.state.suggestions.map((v) => Object.assign(document.createElement('option'), { value: v })));
  }
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
  if (ui.state?.countInUntil && !ui.state.finished) {
    countInFrame(ui.state.countInUntil);
    requestAnimationFrame(frame);
    return;
  }
  if (countShown) {
    countShown = '';
    $('clock').style.minWidth = '';
  }
  if (ui.state) {
    const run = ui.state.run;
    const t = currentTask();
    const clock = $('clock');
    const ms = run && t ? liveElapsed(run, t) : 0;
    // Countdown: show what's left of the estimate, then how far over with a minus.
    const left = ui.state.settings.countdown && t?.estimateMs !== undefined ? t.estimateMs - ms : undefined;
    const [hms, milli] = clockParts(left === undefined ? ms : Math.abs(left));
    $('hms').textContent = (left !== undefined && left < 0 ? '−' : '') + hms;
    $('ms').textContent = milli;

    // Racing your best, the clock's color says whether you're beating it; otherwise your estimate.
    const best = bestOf(t);
    const target = best && !ui.state.settings.countdown ? best.ms : t?.estimateMs;
    let tone = 'idle';
    if (t && isRunning()) tone = target === undefined ? '' : ms <= target ? 'ahead' : 'behind';
    else if (t && ms > 0) tone = 'paused';
    clock.className = 'clock ' + tone + (flash?.tone === 'gold' && flash.until > Date.now() ? ' shine' : '');

    // Session: all time on this run's tasks, colored by what you've saved or lost so far.
    const session = $('session');
    session.hidden = !run?.tasks.length;
    if (run && !session.hidden) {
      $('sessionTime').textContent = clockParts(sessionElapsed(run, ui.state.settings.pausesCount))[0];
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
      const pace = ui.state.settings.race && run && ui.state.record?.pb ? pbPace(run, ui.state.record.pb.tasks) : undefined;
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
  ui.golds = new Map(ui.state.golds);
  applyTheme();
  const fin = ui.state.finished;
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
    if (!ui.editing) renderList();
  }
}

function setOpen(open: boolean) {
  $('more').hidden = !open;
  $('panel').classList.toggle('open', open);
  if (!open) {
    closePicker();
    ui.pickerFor = null;
    $('paste').hidden = true;
  }
  ui.render();
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
    if (start && !dragged && ui.state.countInUntil) void api.act({ type: 'skipCountIn' });
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
    void (ui.state.run?.activeTaskId ? api.act({ type: 'togglePause' }) : api.act({ type: 'start', id: t.id }));
  };
  $('tick').onclick = () => {
    const t = currentTask();
    if (!t) return;
    void (ui.state.run?.activeTaskId === t.id ? api.act({ type: 'split' }) : api.act({ type: 'toggleDone', id: t.id }));
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
  $('countdownBtn').onclick = () => void api.act({ type: 'settings', patch: { countdown: !ui.state.settings.countdown } });

  $('addForm').onsubmit = (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('addInput');
    if (input.value.trim()) void api.act({ type: 'quickAdd', text: input.value, subtask: ui.addIndent });
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
  // On the timer's task line and on the summary's title line.
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-win]')) {
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.onclick = () => void api.act({ type: b.dataset.win === 'quit' ? 'quit' : 'hideOverlay' });
  }

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
    const fin = ui.state.finished;
    if (!fin || ui.savedTemplateFor === fin.id) return;
    if (ui.state.templates.some((t) => t.id === fin.templateId)) {
      ui.savedTemplateFor = fin.id;
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
    if (!name || !ui.state.finished) return;
    ui.savedTemplateFor = ui.state.finished.id;
    $('tplForm').hidden = true;
    void api.act({ type: 'saveTemplate', name });
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
    if (ui.state.countInUntil) void api.act({ type: 'skipCountIn' });
    else if (ui.pickerFor || ui.subFor || !paste.hidden) {
      closePicker();
      ui.pickerFor = null;
      ui.subFor = null;
      paste.hidden = true;
      ui.render();
    } else setOpen(false);
  });

  // The window is always exactly as tall as what's showing.
  const panel = $('panel');
  new ResizeObserver(() => void api.act({ type: 'fitSize', width: panel.offsetWidth, height: panel.offsetHeight })).observe(panel);
  darkQuery.addEventListener('change', () => ui.state && applyTheme());
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
    ui.render();
  }, 1650);
}

ui.render = render;
wire();
api.onState((s) => {
  const prev = ui.state;
  ui.state = s;
  if (prev) noticeDone(prev, s);
  ui.render();
});
ui.state = await api.getState();
ui.render();
// First start: open up with the tips.
if (!ui.state.settings.onboarded && !ui.state.finished) {
  $('tips').hidden = false;
  setOpen(true);
}
requestAnimationFrame(frame);
