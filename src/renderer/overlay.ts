import type { AppState, SpeedrunApi } from '../api.js';
import {
  displayHex, joinHex, paintColor, paintCss, parseHex, PRESETS, ROLES, splitHex,
  type Appearance, type Paint, type Role, type Theme,
} from '../theme.js';
import {
  clampScale, DEFAULT_SETTINGS, formatDuration, formatEstimate, isSection, isSectionDone, liveElapsed, pausedTotal, sessionElapsed, taskKey, timeSaved,
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

/**
 * 1:02:03 and .456, the clock's two parts. Hours always show, so the width never jumps. Seconds and
 * milliseconds follow Settings; without seconds it's 1:02, without milliseconds the small part is empty.
 */
function clockParts(ms: number, detail = true): [string, string] {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const { showSeconds, showMs } = state?.settings ?? DEFAULT_SETTINGS;
  if (detail && !showSeconds) return [`${h}:${pad(m)}`, ''];
  return [`${h}:${pad(m)}:${pad(s)}`, detail && showMs ? '.' + String(total % 1000).padStart(3, '0') : ''];
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
  $('savedClock').className = 'clock paint ' + (!saved ? 'idle' : net >= 0 ? 'ahead' : 'behind');
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
    li.append(el('span', 'num paint' + (gold ? ' gold' : ''), formatDuration(t.elapsedMs)));
    if (t.estimateMs !== undefined) {
      const d = t.elapsedMs - t.estimateMs;
      li.append(el('span', 'num paint ' + (d <= 0 ? 'ahead' : 'behind'), formatDuration(d, { signed: true })));
    }
  } else {
    const spent = liveElapsed(run, t);
    if (spent >= 1000 && !current) li.append(el('span', 'num paint', formatDuration(spent)));
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
    clock.className = 'clock paint ' + tone;

    // Session: all time on this run's tasks, colored by what you've saved or lost so far.
    const session = $('session');
    session.hidden = !run?.tasks.length;
    if (run && !session.hidden) {
      $('sessionTime').textContent = clockParts(sessionElapsed(run, state.settings.pausesCount))[0];
      const saved = timeSaved(run);
      const planned = run.tasks.some((t) => t.estimateMs !== undefined);
      const net = saved?.savedMs ?? 0;
      const tone = !planned ? '' : net >= 0 ? 'ahead' : 'behind';
      $('sessionTime').className = 'time paint ' + (isRunning() ? tone : 'paused');
      const out = $('sessionSaved');
      out.textContent = !planned ? '' : !saved ? 'on plan' : net >= 0 ? `${formatDuration(net)} saved` : `${formatDuration(-net)} behind`;
      out.className = 'saved paint ' + (tone || 'dim');
      if (run.pausedSince !== undefined) {
        out.textContent = `Pause ${formatDuration(pausedTotal(run))}`;
        out.className = 'saved paint paused';
      }
    }

    if (isOpen()) {
      const delta = $('delta');
      if (t?.estimateMs !== undefined && ms > 0) {
        const d = t.estimateMs - ms;
        delta.textContent = d >= 0 ? `${formatDuration(d)} left` : `${formatDuration(-d)} over`;
        delta.className = 'delta paint ' + (d >= 0 ? 'ahead' : 'behind');
      } else delta.textContent = '';
    }
  }
  requestAnimationFrame(frame);
}

// ---------- size ----------

const SIZES: [string, number][] = [['S', 0.75], ['M', 1], ['L', 1.3], ['XL', 1.6]];
let liveScale = 1;

function fitWindow() {
  const r = $('panel').getBoundingClientRect();
  void api.act({ type: 'fit', width: r.width, height: r.height });
}

function applyScale(scale: number) {
  if (scale === liveScale && $('panel').style.zoom) return;
  liveScale = scale;
  $('panel').style.zoom = String(scale);
  fitWindow();
}

/** Drag the corner: the whole timer scales with you. Saved when you let go. */
function wireGrip() {
  const grip = $('grip');
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startX = e.screenX;
    const startScale = liveScale;
    const startWidth = $('panel').getBoundingClientRect().width;
    const move = (m: PointerEvent) => applyScale(clampScale(startScale * ((startWidth + m.screenX - startX) / startWidth)));
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      void api.act({ type: 'settings', patch: { scale: Math.round(liveScale * 100) / 100 } });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
}

// ---------- colors ----------

let themeDraft: Theme = DEFAULT_SETTINGS.theme;
let themeSaving = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let openRole: Role | null = null;

const resolvedAppearance = (t: Theme): 'dark' | 'light' =>
  t.appearance === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t.appearance;

/** Relative luminance of a hex color, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const h = parseHex(hex) ?? '#000000ff';
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function applyTheme() {
  const palette = themeDraft[resolvedAppearance(themeDraft)];
  const root = document.documentElement.style;
  for (const [role] of ROLES) {
    root.setProperty(`--${role}`, paintColor(palette[role]));
    root.setProperty(`--${role}-fill`, paintCss(palette[role]));
  }
  // Text on the Start button: black on light buttons, white on dark ones.
  root.setProperty('--button-ink', luminance(paintColor(palette.button)) > 0.45 ? '#000' : '#fff');
}

/** Live while you edit; saved shortly after you stop. */
function updateTheme(next: Theme) {
  themeDraft = next;
  applyTheme();
  themeSaving = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await api.act({ type: 'settings', patch: { theme: themeDraft } });
    themeSaving = false;
  }, 300);
}

const editedPalette = () => resolvedAppearance(themeDraft);

function setPaint(role: Role, paint: Paint) {
  const which = editedPalette();
  updateTheme({ ...themeDraft, [which]: { ...themeDraft[which], [role]: paint } });
}

function renderSettings() {
  $<HTMLInputElement>('setCountdown').checked = state.settings.countdown;
  $<HTMLInputElement>('setPauses').checked = state.settings.pausesCount;
  $<HTMLInputElement>('setSeconds').checked = state.settings.showSeconds;
  $<HTMLInputElement>('setMs').checked = state.settings.showMs;
  $<HTMLInputElement>('setMs').disabled = !state.settings.showSeconds;

  const sizes = $('sizes');
  sizes.replaceChildren(
    ...SIZES.map(([label, scale]) => {
      const b = el('button', Math.abs(liveScale - scale) < 0.04 ? 'on' : '', label);
      b.type = 'button';
      b.title = 'Or drag the bottom-right corner';
      b.onclick = () => void api.act({ type: 'settings', patch: { scale } });
      return b;
    }),
  );

  for (const b of document.querySelectorAll<HTMLElement>('#appearance [data-appearance]')) {
    b.classList.toggle('on', b.dataset.appearance === themeDraft.appearance);
  }
  // Don't rebuild the color editor under your cursor while you type in it.
  if ($('roles').contains(document.activeElement)) return;
  renderPresets();
  renderRoles();
}

function renderPresets() {
  const which = editedPalette();
  $('presets').replaceChildren(
    ...PRESETS.filter((p) => p.appearance === which).map((p) => {
      const b = el('button');
      b.type = 'button';
      const dot = el('i');
      dot.style.background = `${paintCss(p.palette.running)}, ${paintCss(p.palette.background)}`;
      dot.style.backgroundSize = '50% 100%, 100% 100%';
      dot.style.backgroundRepeat = 'no-repeat';
      b.append(dot, p.name);
      b.onclick = () => {
        updateTheme({ ...themeDraft, [which]: { ...p.palette } });
        openRole = null;
        renderRoles();
      };
      return b;
    }),
  );
}

const paintLabel = (p: Paint) => (p.kind === 'solid' ? displayHex(p.color) : 'Gradient');

function renderRoles() {
  const palette = themeDraft[editedPalette()];
  const box = $('roles');
  box.replaceChildren();
  for (const [role, label] of ROLES) {
    const row = el('button', 'role' + (openRole === role ? ' open' : ''));
    row.type = 'button';
    const chip = el('span', 'chip');
    chip.style.background = paintCss(palette[role]);
    const hex = el('span', 'hex', paintLabel(palette[role]));
    row.append(chip, el('span', 'name', label), hex);
    row.onclick = () => {
      openRole = openRole === role ? null : role;
      renderRoles();
    };
    box.append(row);
    if (openRole === role) box.append(paintEditor(role, palette[role], (p) => {
      chip.style.background = paintCss(p);
      hex.textContent = paintLabel(p);
    }));
  }
}

/** One color: picker, hex (3, 4, 6 or 8 digits, with or without #) and opacity in percent. */
function colorField(hex: string, onChange: (hex: string) => void, onRemove?: () => void): HTMLElement {
  const box = el('div', 'color-field');
  let { rgb, alpha } = splitHex(hex);
  const picker = el('input');
  picker.type = 'color';
  picker.value = rgb;
  const text = el('input', 'hex-in');
  text.value = displayHex(hex);
  text.spellcheck = false;
  const a = el('input', 'alpha');
  a.type = 'number';
  a.min = '0';
  a.max = '100';
  a.value = String(alpha);
  a.title = 'Opacity';
  const emit = () => {
    const out = joinHex(rgb, alpha);
    text.value = displayHex(out);
    text.classList.remove('bad');
    onChange(out);
  };
  picker.oninput = () => {
    rgb = picker.value;
    emit();
  };
  const fromText = () => {
    const parsed = parseHex(text.value);
    text.classList.toggle('bad', !parsed);
    if (!parsed) return;
    ({ rgb, alpha } = splitHex(parsed));
    picker.value = rgb;
    a.value = String(alpha);
    onChange(parsed);
  };
  text.oninput = () => parseHex(text.value) && fromText();
  text.onchange = fromText;
  text.onkeydown = (k) => k.key === 'Enter' && fromText();
  a.oninput = () => {
    alpha = Math.max(0, Math.min(100, Number(a.value) || 0));
    emit();
  };
  box.append(picker, text, a, el('span', 'pct', '%'));
  if (onRemove) {
    const rm = el('button', 'rm', '×');
    rm.type = 'button';
    rm.title = 'Remove this color';
    rm.onclick = onRemove;
    box.append(rm);
  }
  return box;
}

function paintEditor(role: Role, start: Paint, onPaint: (p: Paint) => void): HTMLElement {
  const box = el('div', 'paint-editor');
  let paint: Paint = start;
  const preview = el('div', 'preview');
  const commit = (p: Paint, rebuild = false) => {
    paint = p;
    preview.style.background = paintCss(p);
    onPaint(p);
    setPaint(role, p);
    if (rebuild) build();
  };

  const kinds = el('div', 'segmented');
  const build = () => {
    kinds.replaceChildren();
    for (const kind of ['solid', 'gradient'] as const) {
      const b = el('button', paint.kind === kind ? 'on' : '', kind === 'solid' ? 'Solid' : 'Gradient');
      b.type = 'button';
      b.onclick = () => {
        if (paint.kind === kind) return;
        const first = paintColor(paint);
        commit(kind === 'solid' ? { kind, color: first } : { kind, angle: 90, stops: [first, first] }, true);
      };
      kinds.append(b);
    }
    preview.style.background = paintCss(paint);
    box.replaceChildren(kinds, preview);

    if (paint.kind === 'solid') {
      box.append(colorField(paint.color, (c) => commit({ kind: 'solid', color: c })));
    } else {
      const g = paint;
      g.stops.forEach((stop, i) => {
        box.append(
          colorField(
            stop,
            (c) => commit({ ...g, stops: g.stops.map((x, j) => (j === i ? c : x)) }),
            g.stops.length > 2 ? () => commit({ ...g, stops: g.stops.filter((_, j) => j !== i) }, true) : undefined,
          ),
        );
      });
      const angle = el('div', 'angle');
      const range = el('input');
      range.type = 'range';
      range.min = '0';
      range.max = '360';
      range.value = String(g.angle);
      const deg = el('span', '', `${g.angle}°`);
      range.oninput = () => {
        deg.textContent = `${range.value}°`;
        commit({ ...(paint as typeof g), angle: Number(range.value) });
      };
      angle.append(el('span', '', 'Direction'), range, deg);
      box.append(angle);
    }

    const foot = el('div', 'editor-foot');
    if (paint.kind === 'gradient') {
      const add = el('button', 'text', 'Add a color');
      add.type = 'button';
      add.onclick = () => {
        const g = paint as Extract<Paint, { kind: 'gradient' }>;
        commit({ ...g, stops: [...g.stops, g.stops[g.stops.length - 1]] }, true);
      };
      foot.append(add);
    }
    const reset = el('button', 'text', 'Reset');
    reset.type = 'button';
    reset.title = 'Back to the default color';
    reset.onclick = () => commit((DEFAULT_SETTINGS.theme as Theme)[editedPalette()][role], true);
    foot.append(reset);
    box.append(foot);
  };
  build();
  return box;
}

// ---------- wiring ----------

function render() {
  golds = new Map(state.golds);
  if (!themeSaving) themeDraft = state.settings.theme;
  applyTheme();
  applyScale(state.settings.scale);
  const fin = state.finished;
  $('panel').classList.toggle('finished', Boolean(fin));
  $('panel').classList.toggle('open', isOpen() && !fin);
  if (!$('settings').hidden) renderSettings();
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
  $('settingsBtn').onclick = () => {
    const box = $('settings');
    box.hidden = !box.hidden;
    $('settingsBtn').classList.toggle('on', !box.hidden);
    openRole = null;
    if (!box.hidden) renderSettings();
  };
  $<HTMLInputElement>('setSeconds').onchange = (e) =>
    void api.act({ type: 'settings', patch: { showSeconds: (e.target as HTMLInputElement).checked } });
  $<HTMLInputElement>('setMs').onchange = (e) =>
    void api.act({ type: 'settings', patch: { showMs: (e.target as HTMLInputElement).checked } });
  for (const b of document.querySelectorAll<HTMLElement>('#appearance [data-appearance]')) {
    b.onclick = () => {
      updateTheme({ ...themeDraft, appearance: b.dataset.appearance as Appearance });
      renderSettings();
    };
  }
  $('minBtn').onclick = () => void api.act({ type: 'hideOverlay' });
  $('quitBtn').onclick = () => void api.act({ type: 'quit' });
  for (const id of ['minBtn', 'quitBtn', 'grip']) $(id).addEventListener('mousedown', (e) => e.stopPropagation());
  wireGrip();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
  $<HTMLInputElement>('setCountdown').onchange = (e) =>
    void api.act({ type: 'settings', patch: { countdown: (e.target as HTMLInputElement).checked } });
  $<HTMLInputElement>('setPauses').onchange = (e) =>
    void api.act({ type: 'settings', patch: { pausesCount: (e.target as HTMLInputElement).checked } });
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

  // The window is always exactly the size of what's showing.
  new ResizeObserver(fitWindow).observe($('panel'));
}

wire();
api.onState((s) => {
  state = s;
  render();
});
state = await api.getState();
render();
requestAnimationFrame(frame);
