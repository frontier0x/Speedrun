// The task list in the open timer: tasks and subtasks in your order, their times and estimates,
// and everything you do to them (start, finish, rename, estimate, nest, move, remove).

import {
  ancestorsOf, childrenOf, formatDuration, formatEstimate, isComplete, isSection, isSectionDone, liveElapsed, medal, pausedTotal, pbPace, runElapsed,
  sessionElapsed, taskKey, timeSaved, totalElapsed, totalEstimate, type Run, type Task,
} from '../runs.js';
import { $, api, currentTask, el, isRunning, setIndent, bestOf, ui } from './shared.js';

const ESTIMATE_PRESETS = ['5m', '10m', '15m', '25m', '45m', '1h', '1h30m', '2h'];
// ---------- estimate picker ----------

/** Preset chips plus a free field. Used under the clock and under a task in the list. */
export function estimatePicker(t: Task, onDone: () => void): HTMLElement {
  const box = el('div', 'picker');
  const set = (text: string) => {
    ui.editing = false; // the field goes away with the picker, so its blur may never come
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
  custom.onfocus = () => (ui.editing = true);
  custom.onblur = () => (ui.editing = false);
  custom.onkeydown = (k) => {
    if (k.key === 'Enter' && custom.value.trim()) set(custom.value);
    if (k.key === 'Escape') {
      ui.editing = false;
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

export function closePicker() {
  ui.editing = false;
}

let dragId: string | null = null;

export function renderList() {
  const list = $('list');
  // Moving a task with the keyboard redraws the list; keep the focus on it, but only if it was there.
  const hadFocus = list.contains(document.activeElement);
  list.replaceChildren();
  const run = ui.state.run;
  if (!run || !run.tasks.length) return;
  const current = currentTask();
  // Your order, top to bottom: new tasks go at the end and finished ones stay where they are.
  // Subtasks sit under their task, indented.
  const add = (tasks: Task[], depth: number) => {
    for (const t of tasks) {
      list.append(row(run, t, t === current, depth));
      if (ui.pickerFor === t.id) {
        const li = el('li', 'row-picker');
        li.style.paddingLeft = 32 + depth * 18 + 'px';
        li.append(estimatePicker(t, () => {
          ui.pickerFor = null;
          ui.render();
        }));
        list.append(li);
      }
      add(childrenOf(run, t.id), depth + 1);
      if (ui.subFor === t.id) list.append(subtaskField(t, depth + 1));
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
  input.onfocus = () => (ui.editing = true);
  input.onblur = () => {
    ui.editing = false;
    if (!input.value.trim()) {
      ui.subFor = null;
      ui.render();
    }
  };
  input.onkeydown = (k) => {
    if (k.key === 'Enter' && input.value.trim()) {
      const text = input.value;
      input.value = '';
      ui.editing = false;
      void api.act({ type: 'addSubtask', parentId: parent.id, text }).then(() => {
        (document.querySelector('.row-sub input') as HTMLInputElement | null)?.focus();
      });
    }
    if (k.key === 'Escape') {
      k.stopPropagation();
      ui.subFor = null;
      ui.editing = false;
      ui.render();
    }
    // Shift-Tab: back to plain tasks, in the add field at the bottom.
    if (k.key === 'Tab' && k.shiftKey) {
      k.preventDefault();
      const text = input.value;
      ui.subFor = null;
      ui.editing = false;
      setIndent(false);
      ui.render();
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

/** While a task runs: its estimate, until it goes over; then how far over, in red. */
export function liveDelta(spent: number, est: number): { text: string; tone: string } {
  const d = spent - est;
  return d <= 0 ? { text: formatEstimate(est), tone: 'ahead' } : { text: formatDuration(d, { signed: true }), tone: 'behind' };
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
    ui.pickerFor = ui.pickerFor === t.id ? null : t.id;
    ui.render();
  };
  return b;
}

function subtaskButton(t: Task): HTMLButtonElement {
  const b = el('button', 'plus', '+');
  b.type = 'button';
  b.title = 'Add a subtask';
  b.onclick = (e) => {
    e.stopPropagation();
    ui.subFor = ui.subFor === t.id ? null : t.id;
    ui.render();
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
    ui.editing = true;
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
      ui.editing = false;
      if (save && input.value.trim()) void api.act({ type: 'rename', id: t.id, title: input.value });
      else ui.render();
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
    const best = ui.golds.get(taskKey(t.title));
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
    ui.editing = true;
    const input = el('input', 'time-input');
    input.value = formatDuration(t.done || !ui.state.run ? t.elapsedMs : liveElapsed(ui.state.run, t));
    input.title = 'e.g. 12:30, 1:02:03 or 25m. Enter to save, Esc to cancel.';
    cell.replaceWith(input);
    input.focus();
    input.select();
    let closed = false;
    const finish = (save: boolean) => {
      if (closed) return;
      closed = true;
      ui.editing = false;
      if (save && input.value.trim()) void api.act({ type: 'setTime', id: t.id, text: input.value });
      else ui.render();
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

