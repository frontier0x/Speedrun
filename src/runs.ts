// Pure run/task model shared by the main process, overlay and dashboard. No Node or Electron imports.

import type { ColorKey, Mode as ColorMode, Paint } from './theme.js';

export type Mode = 'manual' | 'auto';

export interface Task {
  id: string;
  title: string;
  /** Your guess for how long it takes. */
  estimateMs?: number;
  /** Time spent so far, not counting the currently running stretch. */
  elapsedMs: number;
  done: boolean;
  doneAt?: string;
  /** Tasks with children are sections; their time is the sum of their children. */
  parentId?: string;
  /** The task in the template this session was started from: stays the same when you rename it. */
  templateTaskId?: string;
}

export interface Run {
  id: string;
  name: string;
  mode: Mode;
  startedAt: string;
  endedAt?: string;
  /** Order is priority: the first unfinished task is up next. */
  tasks: Task[];
  activeTaskId?: string;
  /** Epoch ms when the active task last started ticking; undefined while paused. */
  activeSince?: number;
  /** Total time spent paused, not counting a pause still going on. */
  pausedMs?: number;
  /** Epoch ms when the current pause began; undefined unless you paused. */
  pausedSince?: number;
  /** The template this session was started from. */
  templateId?: string;
  /** You reset this attempt: kept for your totals, but it never counts as a finished run. */
  reset?: boolean;
}

/** A saved task list you run again and again, like a speedrun route. */
export interface Template {
  id: string;
  name: string;
  createdAt: string;
  tasks: TemplateTask[];
}

export interface TemplateTask {
  id: string;
  title: string;
  estimateMs?: number;
  parentId?: string;
}

export interface Settings {
  accent: string;
  opacity: number;
  /** Count the task clock down from its estimate instead of up. */
  countdown: boolean;
  /** Add pauses to the session time. Off: the session clock stops while you pause. */
  pausesCount: boolean;
  /** Day, night, or follow the Mac. */
  theme: 'system' | ColorMode;
  /** Your colors per mode; anything left out uses the default. */
  colors: Partial<Record<ColorMode, Partial<Record<ColorKey, Paint>>>>;
  /** Font weight of the big clock, 200–800. */
  clockWeight: number;
  /** How much of the clock to show: h:mm:ss.mmm, h:mm:ss or h:mm. */
  precision: 'ms' | 's' | 'm';
  /** Size of the floating timer, 1 = normal. */
  scale: number;
  /** The first-start tips have been seen. */
  onboarded: boolean;
  /** We've turned on "Open at login" once, on first start; after that it's yours to switch. */
  loginItemSet?: boolean;
  /** Race your best: compare each task with your best time for it. */
  race: boolean;
  /** Pairs of task names you said are not the same task ("a|b", see matchKey). */
  notSame: string[];
  /** Short sounds on go, done, a new best and the finish. */
  sounds: boolean;
  /** 0–1. */
  volume: number;
  /** "3, 2, 1, Go" before the first task of a session. */
  countIn: boolean;
  /** The clock's look: clean, or bold italic like a speedrun overlay. */
  clockStyle: 'clean' | 'speedrun';
  overlayBounds?: { x: number; y: number; width: number; height: number };
}

export const DEFAULT_SETTINGS: Settings = {
  accent: '#e8e8e8',
  opacity: 1,
  countdown: false,
  pausesCount: false,
  theme: 'system',
  colors: {},
  clockWeight: 400,
  precision: 'ms',
  scale: 1,
  onboarded: false,
  race: false,
  notSame: [],
  sounds: true,
  volume: 0.35,
  countIn: true,
  clockStyle: 'clean',
};

export const MIN_SCALE = 0.6;
export const MAX_SCALE = 2;
export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 100) / 100));

export const ACCENTS = ['#e8e8e8', '#7c5cff', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#e5e7eb'];

export const newId = () => Math.random().toString(36).slice(2, 10);

// ---------- durations ----------

/** A time you type to correct a task: clock style "1:02:03" or "12:30" (m:ss), or a duration like "25m". */
export function parseTimeInput(text: string): number | undefined {
  const t = text.trim();
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (clock) {
    const [a, b, c] = [clock[1], clock[2], clock[3]].map((x) => (x === undefined ? undefined : Number(x)));
    if (b! > 59 || (c ?? 0) > 59) return undefined;
    return c === undefined ? (a! * 60 + b!) * 1000 : (a! * 3600 + b! * 60 + c) * 1000;
  }
  return parseDuration(t);
}

/** Parses "25m", "1h", "1h30m", "1.5h", "90s", "45" (minutes). Returns ms or undefined. */
export function parseDuration(text: string): number | undefined {
  const s = text.trim().toLowerCase();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60_000);
  const re = /(\d+(?:\.\d+)?)\s*(hrs|hr|h|std|mins|min|m|sec|s)(?![a-z])/g;
  let total = 0;
  let matched = '';
  for (const m of s.matchAll(re)) {
    const n = parseFloat(m[1]);
    const unit = m[2];
    total += unit.startsWith('h') || unit === 'std' ? n * 3_600_000 : unit.startsWith('m') ? n * 60_000 : n * 1000;
    matched += m[0];
  }
  if (!matched || s.replace(re, '').trim() !== '') return undefined;
  return Math.round(total);
}

export function formatDuration(ms: number, opts: { signed?: boolean; tenths?: boolean } = {}): string {
  const sign = ms < 0 ? '-' : opts.signed ? '+' : '';
  const abs = Math.abs(ms);
  const totalS = Math.floor(abs / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const sec = totalS % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const tenths = opts.tenths ? '.' + Math.floor((abs % 1000) / 100) : '';
  return sign + (h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`) + tenths;
}

/** Short human estimate label, e.g. "25m", "1h 30m". */
export function formatEstimate(ms: number): string {
  const totalM = Math.round(ms / 60_000);
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ---------- parsing task lists ----------

/**
 * Pulls an estimate off the end of a task line. Accepts "Task ~30m", "Task (30m)", "Task [1h]",
 * "Task - 45min" and "Task 30m".
 */
export function splitEstimate(line: string): { title: string; estimateMs?: number } {
  const patterns = [/\s*[~≈]\s*([\d.]+\s*[a-z]*(?:\s*[\d.]+\s*[a-z]+)?)\s*$/i, /\s*[([]\s*([^)\]]+)\s*[)\]]\s*$/, /\s+[-–—]\s*([\d.]+\s*[a-z]+(?:\s*[\d.]+\s*[a-z]+)?)\s*$/i, /\s+((?:[\d.]+\s*(?:h|hr|hrs|std|m|min|mins)\s*)+)$/i];
  for (const p of patterns) {
    const m = line.match(p);
    if (m) {
      const est = parseDuration(m[1].replace(/\s+/g, ''));
      if (est !== undefined) return { title: line.slice(0, m.index).trim(), estimateMs: est };
    }
  }
  return { title: line.trim() };
}

/**
 * Turns pasted notes into tasks. Understands bullets ("-", "*", "•", "1."), checkboxes ("[ ]", "[x]"),
 * markdown headings and indentation. A line with indented lines under it becomes a section.
 */
export function parseTaskList(text: string): Task[] {
  const tasks: Task[] = [];
  const stack: { indent: number; id: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const heading = raw.match(/^\s*(#{1,6})\s+(.*)$/);
    let indent: number;
    let body: string;
    if (heading) {
      indent = heading[1].length - 7; // headings sit above every bullet
      body = heading[2];
    } else {
      indent = raw.match(/^\s*/)![0].replace(/\t/g, '    ').length;
      body = raw.trim();
    }
    let done = false;
    body = body.replace(/^([-*+•]|\d+[.)])\s+/, '');
    const box = body.match(/^\[([ xX✓])\]\s*/);
    if (box) {
      done = box[1] !== ' ';
      body = body.slice(box[0].length);
    }
    const { title, estimateMs } = splitEstimate(body);
    if (!title) continue;

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const task: Task = { id: newId(), title, estimateMs, elapsedMs: 0, done, parentId: stack.at(-1)?.id };
    if (done) task.doneAt = new Date().toISOString();
    tasks.push(task);
    stack.push({ indent, id: task.id });
  }
  return tasks;
}

/** Quick-add line from the overlay: same estimate syntax, a leading "!" puts it at the top. */
export function parseQuickAdd(text: string): { task: Task; urgent: boolean } | null {
  let s = text.trim();
  const urgent = s.startsWith('!');
  if (urgent) s = s.slice(1).trim();
  const { title, estimateMs } = splitEstimate(s);
  if (!title) return null;
  return { task: { id: newId(), title, estimateMs, elapsedMs: 0, done: false }, urgent };
}

// ---------- run queries ----------

export const childrenOf = (run: Run, id: string) => run.tasks.filter((t) => t.parentId === id);
export const isSection = (run: Run, t: Task) => run.tasks.some((c) => c.parentId === t.id);

/** Time on a task including the live stretch if it is running. */
export function liveElapsed(run: Run, t: Task, now = Date.now()): number {
  const live = run.activeTaskId === t.id && run.activeSince !== undefined ? now - run.activeSince : 0;
  return t.elapsedMs + live;
}

/** A task's total time: its own time plus all descendants', so sections roll up their splits. */
export function totalElapsed(run: Run, t: Task, now = Date.now()): number {
  return liveElapsed(run, t, now) + childrenOf(run, t.id).reduce((sum, c) => sum + totalElapsed(run, c, now), 0);
}

/** A section's estimate is its own, or else the sum of its children's. */
export function totalEstimate(run: Run, t: Task): number | undefined {
  if (t.estimateMs !== undefined) return t.estimateMs;
  const kids = childrenOf(run, t.id);
  if (!kids.length) return undefined;
  const ests = kids.map((k) => totalEstimate(run, k));
  return ests.every((e) => e === undefined) ? undefined : ests.reduce<number>((a, e) => a + (e ?? 0), 0);
}

export function isSectionDone(run: Run, t: Task): boolean {
  const kids = childrenOf(run, t.id);
  return kids.length ? kids.every((k) => isSectionDone(run, k)) : t.done;
}

/** Next task to work on: the first unfinished leaf in priority order. */
export function nextTask(run: Run): Task | undefined {
  return run.tasks.find((t) => !t.done && !isSection(run, t));
}

export function runElapsed(run: Run, now = Date.now()): number {
  return run.tasks.reduce((sum, t) => sum + liveElapsed(run, t, now), 0);
}

/** All the time you've paused this session, including a pause still going on. */
export function pausedTotal(run: Run, now = Date.now()): number {
  return (run.pausedMs ?? 0) + (run.pausedSince !== undefined ? now - run.pausedSince : 0);
}

/** The session clock: time on tasks, plus pauses if you count them. */
export function sessionElapsed(run: Run, pausesCount: boolean, now = Date.now()): number {
  return runElapsed(run, now) + (pausesCount ? pausedTotal(run, now) : 0);
}

export function runEstimate(run: Run): number | undefined {
  const roots = run.tasks.filter((t) => !t.parentId);
  const ests = roots.map((t) => totalEstimate(run, t));
  return ests.every((e) => e === undefined) ? undefined : ests.reduce<number>((a, e) => a + (e ?? 0), 0);
}

/** Projected finish: time spent plus what's left by estimate (or by time already spent if over). */
export function projectedRemaining(run: Run, now = Date.now()): number {
  return run.tasks
    .filter((t) => !t.done && !isSection(run, t))
    .reduce((sum, t) => sum + Math.max(0, (t.estimateMs ?? 0) - liveElapsed(run, t, now)), 0);
}

/**
 * Time saved against your estimates. Finished tasks count their full difference; an unfinished task
 * counts only once it runs past its estimate, since time still left on it isn't saved yet.
 * With subtasks, the most detailed estimate counts: a subtask's own, or else its parent's for the whole
 * group. Tasks without an estimate don't count. Undefined when nothing counts yet.
 */
export function timeSaved(run: Run, now = Date.now()): { savedMs: number; plannedMs: number; actualMs: number } | undefined {
  let savedMs = 0;
  let plannedMs = 0;
  let actualMs = 0;
  let any = false;
  const hasEstimateBelow = (t: Task): boolean => childrenOf(run, t.id).some((c) => c.estimateMs !== undefined || hasEstimateBelow(c));
  const visit = (t: Task) => {
    const section = isSection(run, t);
    if (t.estimateMs === undefined || (section && hasEstimateBelow(t))) {
      for (const c of childrenOf(run, t.id)) visit(c);
      return;
    }
    const spent = totalElapsed(run, t, now);
    if (section ? isSectionDone(run, t) : t.done) {
      plannedMs += t.estimateMs;
      actualMs += spent;
      savedMs += t.estimateMs - spent;
      any = true;
    } else if (spent > t.estimateMs) {
      savedMs -= spent - t.estimateMs;
      any = true;
    }
  };
  for (const t of run.tasks) if (!t.parentId) visit(t);
  return any ? { savedMs, plannedMs, actualMs } : undefined;
}

/** The parents of a task, outermost first. */
export function ancestorsOf(run: Run, t: Task): Task[] {
  const out: Task[] = [];
  for (let p = run.tasks.find((x) => x.id === t.parentId); p; p = run.tasks.find((x) => x.id === p!.parentId)) out.unshift(p);
  return out;
}

/** All tasks under a task, at any depth. */
export function descendantsOf(run: Run, id: string): Task[] {
  return childrenOf(run, id).flatMap((c) => [c, ...descendantsOf(run, c.id)]);
}

// ---------- mutations (return the same run, mutated) ----------

function stopClock(run: Run, now: number) {
  const active = run.tasks.find((t) => t.id === run.activeTaskId);
  if (active && run.activeSince !== undefined) active.elapsedMs += now - run.activeSince;
  run.activeSince = undefined;
}

/** Closes a pause that's going on, adding it to the session's pause time. */
export function endPause(run: Run, now = Date.now()): Run {
  if (run.pausedSince !== undefined) run.pausedMs = (run.pausedMs ?? 0) + (now - run.pausedSince);
  run.pausedSince = undefined;
  return run;
}

export function startTask(run: Run, id: string, now = Date.now()): Run {
  stopClock(run, now);
  endPause(run, now);
  run.activeTaskId = id;
  run.activeSince = now;
  return run;
}

/** Sets a task's time, e.g. when you forgot to start or pause. A running task keeps running from there. */
export function setElapsed(run: Run, id: string, ms: number, now = Date.now()): Run {
  const t = run.tasks.find((x) => x.id === id);
  if (!t) return run;
  const running = run.activeTaskId === id && run.activeSince !== undefined;
  if (running) stopClock(run, now);
  t.elapsedMs = Math.max(0, ms);
  if (running) run.activeSince = now;
  return run;
}

/** Picks a finished task back up: it's open again and its clock runs on from where it stopped. */
export function reopenTask(run: Run, id: string, now = Date.now()): Run {
  const t = run.tasks.find((x) => x.id === id);
  if (!t) return run;
  t.done = false;
  t.doneAt = undefined;
  run.endedAt = undefined;
  return startTask(run, id, now);
}

/** Stops the clock. Pausing a running task starts counting pause time. */
export function pause(run: Run, now = Date.now()): Run {
  if (run.activeSince !== undefined) run.pausedSince = now;
  stopClock(run, now);
  return run;
}

export function resume(run: Run, now = Date.now()): Run {
  if (!run.activeTaskId) {
    const next = nextTask(run);
    if (!next) return run;
    run.activeTaskId = next.id;
  }
  if (run.activeSince === undefined) run.activeSince = now;
  endPause(run, now);
  return run;
}

/** Splits: finishes the active task and starts the next one, like hitting the split key. */
export function completeActive(run: Run, now = Date.now()): Run {
  const active = run.tasks.find((t) => t.id === run.activeTaskId);
  if (!active) return resume(run, now);
  const wasRunning = run.activeSince !== undefined;
  stopClock(run, now);
  active.done = true;
  active.doneAt = new Date(now).toISOString();
  const next = nextTask(run);
  run.activeTaskId = next?.id;
  run.activeSince = next && wasRunning ? now : undefined;
  if (!next) run.endedAt = new Date(now).toISOString();
  return run;
}

export function toggleDone(run: Run, id: string, now = Date.now()): Run {
  const t = run.tasks.find((x) => x.id === id);
  if (!t) return run;
  if (isSection(run, t)) {
    // A task with subtasks is done when they all are: ticking it ticks (or unticks) them all.
    const done = !isSectionDone(run, t);
    const leaves = descendantsOf(run, id).filter((d) => !isSection(run, d));
    const wasRunning = run.activeSince !== undefined;
    if (done && leaves.some((d) => d.id === run.activeTaskId)) stopClock(run, now);
    for (const d of leaves) {
      d.done = done;
      d.doneAt = done ? new Date(now).toISOString() : undefined;
    }
    if (done && run.activeTaskId && leaves.some((d) => d.id === run.activeTaskId)) {
      const next = nextTask(run);
      run.activeTaskId = next?.id;
      run.activeSince = next && wasRunning ? now : undefined;
      if (!next) run.endedAt = new Date(now).toISOString();
    }
    if (!done) run.endedAt = undefined;
    return run;
  }
  if (run.activeTaskId === id && !t.done) return completeActive(run, now);
  t.done = !t.done;
  t.doneAt = t.done ? new Date(now).toISOString() : undefined;
  if (!t.done) run.endedAt = undefined;
  return run;
}

export function addTasks(run: Run, tasks: Task[], atTop = false): Run {
  run.tasks = atTop ? [...tasks, ...run.tasks] : [...run.tasks, ...tasks];
  return run;
}

/**
 * Adds a subtask under a task, after its other subtasks. The parent becomes a group whose time is the
 * sum of its subtasks. If the parent was on the clock, the clock moves to its first open subtask.
 */
export function addSubtask(run: Run, parentId: string, task: Task, now = Date.now()): Run {
  const parent = run.tasks.find((t) => t.id === parentId);
  if (!parent) return run;
  task.parentId = parentId;
  const block = [parent, ...descendantsOf(run, parentId)];
  const at = Math.max(...block.map((b) => run.tasks.indexOf(b))) + 1;
  run.tasks.splice(at, 0, task);
  parent.done = false;
  parent.doneAt = undefined;
  run.endedAt = undefined;
  if (run.activeTaskId === parentId) {
    const running = run.activeSince !== undefined;
    stopClock(run, now);
    const first = descendantsOf(run, parentId).find((d) => !d.done && !isSection(run, d))!;
    run.activeTaskId = first.id;
    if (running) run.activeSince = now;
  }
  return run;
}

/** Removes a task and its subtasks. */
export function removeTask(run: Run, id: string, now = Date.now()): Run {
  const doomed = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of run.tasks) if (t.parentId && doomed.has(t.parentId) && !doomed.has(t.id)) (doomed.add(t.id), (grew = true));
  }
  if (run.activeTaskId && doomed.has(run.activeTaskId)) {
    stopClock(run, now);
    run.activeTaskId = undefined;
  }
  run.tasks = run.tasks.filter((t) => !doomed.has(t.id));
  return run;
}

/**
 * Moves a task, with its subtasks, to sit before `beforeId` (or to the end). Dropped on a task, it joins
 * that task's level: a plain task dropped on a subtask becomes a subtask of the same task. Tasks and
 * subtasks are the only two levels, so a task with subtasks stays a task.
 */
export function moveTask(run: Run, id: string, beforeId: string | null): Run {
  const t = run.tasks.find((x) => x.id === id);
  if (!t) return run;
  const block = new Set([id, ...descendantsOf(run, id).map((d) => d.id)]);
  if (beforeId && block.has(beforeId)) return run;
  let before = beforeId ? run.tasks.find((x) => x.id === beforeId) : undefined;
  if (before?.parentId && isSection(run, t)) before = run.tasks.find((x) => x.id === before!.parentId);
  const moving = run.tasks.filter((x) => block.has(x.id));
  const rest = run.tasks.filter((x) => !block.has(x.id));
  const oldParent = t.parentId;
  t.parentId = before ? before.parentId : undefined;
  const at = before ? rest.indexOf(before) : -1;
  run.tasks = at < 0 ? [...rest, ...moving] : [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  if (oldParent !== t.parentId) reparented(run, t);
  return run;
}

/** After a task changes level: a new parent that was on the clock hands it to its first open subtask. */
function reparented(run: Run, t: Task, now = Date.now()) {
  const parent = run.tasks.find((x) => x.id === t.parentId);
  if (!parent || run.activeTaskId !== parent.id) return;
  const running = run.activeSince !== undefined;
  stopClock(run, now);
  const first = descendantsOf(run, parent.id).find((d) => !d.done && !isSection(run, d));
  run.activeTaskId = first?.id;
  if (running && first) run.activeSince = now;
  parent.done = false;
  parent.doneAt = undefined;
}

/** Tab: a task becomes a subtask of the task above it. Only tasks without subtasks of their own can. */
export function indentTask(run: Run, id: string, now = Date.now()): Run {
  const t = run.tasks.find((x) => x.id === id);
  if (!t || t.parentId || isSection(run, t)) return run;
  const roots = run.tasks.filter((x) => !x.parentId);
  const above = roots[roots.indexOf(t) - 1];
  if (!above) return run;
  // It goes last among the subtasks of the task above.
  run.tasks = run.tasks.filter((x) => x !== t);
  const block = [above, ...descendantsOf(run, above.id)];
  run.tasks.splice(Math.max(...block.map((b) => run.tasks.indexOf(b))) + 1, 0, t);
  t.parentId = above.id;
  if (!t.done) above.done = false;
  reparented(run, t, now);
  return run;
}

/** Shift-Tab: a subtask becomes a task again, right after the task it was under. */
export function outdentTask(run: Run, id: string): Run {
  const t = run.tasks.find((x) => x.id === id);
  const parent = t && run.tasks.find((x) => x.id === t.parentId);
  if (!t || !parent) return run;
  run.tasks = run.tasks.filter((x) => x !== t);
  const block = [parent, ...descendantsOf(run, parent.id)];
  run.tasks.splice(Math.max(...block.map((b) => run.tasks.indexOf(b))) + 1, 0, t);
  t.parentId = parent.parentId;
  return run;
}

export function newRun(mode: Mode, now = new Date()): Run {
  const name = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' session';
  return { id: now.toISOString().replace(/[:.]/g, '-'), name, mode, startedAt: now.toISOString(), tasks: [] };
}

// ---------- history ----------

export const taskKey = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim();

/** Best finished time per task title across past runs: the speedrunner's gold splits. */
export function goldSplits(runs: Run[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const run of runs)
    for (const t of run.tasks) {
      if (!t.done || isSection(run, t) || t.elapsedMs < 1000) continue;
      const k = taskKey(t.title);
      const prev = best.get(k);
      if (prev === undefined || t.elapsedMs < prev) best.set(k, t.elapsedMs);
    }
  return best;
}

export interface RunSummary {
  id: string;
  name: string;
  templateId?: string;
  reset?: boolean;
  mode: Mode;
  startedAt: string;
  endedAt?: string;
  elapsedMs: number;
  estimateMs?: number;
  tasksDone: number;
  tasksTotal: number;
  pausedMs: number;
  /** Share of finished, estimated tasks that came in at or under estimate. */
  onEstimateRate?: number;
  /** Time saved against your estimates; negative means over. See timeSaved. */
  savedMs?: number;
}

export function summarize(run: Run, now = Date.now()): RunSummary {
  const leaves = run.tasks.filter((t) => !isSection(run, t));
  const estimated = leaves.filter((t) => t.done && t.estimateMs);
  return {
    id: run.id,
    name: run.name,
    templateId: run.templateId,
    reset: run.reset,
    mode: run.mode,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    elapsedMs: runElapsed(run, now),
    estimateMs: runEstimate(run),
    tasksDone: leaves.filter((t) => t.done).length,
    tasksTotal: leaves.length,
    pausedMs: pausedTotal(run, now),
    onEstimateRate: estimated.length ? estimated.filter((t) => t.elapsedMs <= t.estimateMs!).length / estimated.length : undefined,
    savedMs: timeSaved(run, now)?.savedMs,
  };
}

// ---------- templates ----------

/** A template from a session's tasks. Updating one keeps the ids of tasks it already had, so their bests carry on. */
export function templateFromRun(run: Run, name: string, existing?: Template, now = new Date()): Template {
  const known = new Set(existing?.tasks.map((t) => t.id));
  const ids = new Map<string, string>();
  for (const t of run.tasks) ids.set(t.id, t.templateTaskId && known.has(t.templateTaskId) ? t.templateTaskId : newId());
  return {
    id: existing?.id ?? newId(),
    name: name.trim() || existing?.name || run.name,
    createdAt: existing?.createdAt ?? now.toISOString(),
    tasks: run.tasks.map((t) => ({
      id: ids.get(t.id)!,
      title: t.title,
      estimateMs: t.estimateMs,
      parentId: t.parentId ? ids.get(t.parentId) : undefined,
    })),
  };
}

/** A fresh session from a template: every task open, on 0:00, linked to its template task. */
export function runFromTemplate(tpl: Template, now = new Date()): Run {
  const run = newRun('manual', now);
  run.name = tpl.name;
  run.templateId = tpl.id;
  const ids = new Map(tpl.tasks.map((t) => [t.id, newId()]));
  run.tasks = tpl.tasks.map((t) => ({
    id: ids.get(t.id)!,
    title: t.title,
    estimateMs: t.estimateMs,
    elapsedMs: 0,
    done: false,
    parentId: t.parentId ? ids.get(t.parentId) : undefined,
    templateTaskId: t.id,
  }));
  return run;
}

/** A template as an editable list, like "Paste a list": two spaces per level, estimate at the end. */
export function templateToText(tpl: Template): string {
  const depth = (t: TemplateTask): number => {
    const p = tpl.tasks.find((x) => x.id === t.parentId);
    return p ? depth(p) + 1 : 0;
  };
  return tpl.tasks
    .map((t) => '  '.repeat(depth(t)) + '- ' + t.title + (t.estimateMs !== undefined ? ' ' + formatEstimate(t.estimateMs).replace(' ', '') : ''))
    .join('\n');
}

/** Reads an edited list back into the template. A task whose name is unchanged keeps its id, and so its bests. */
export function templateFromText(tpl: Template, text: string): Template {
  const parsed = parseTaskList(text);
  const free = [...tpl.tasks];
  const ids = new Map<string, string>();
  for (const t of parsed) {
    const i = free.findIndex((x) => matchKey(x.title) === matchKey(t.title));
    ids.set(t.id, i >= 0 ? free.splice(i, 1)[0].id : newId());
  }
  return {
    ...tpl,
    tasks: parsed.map((t) => ({ id: ids.get(t.id)!, title: t.title, estimateMs: t.estimateMs, parentId: t.parentId ? ids.get(t.parentId) : undefined })),
  };
}

/** A session that ran its whole route: every task done, and not reset. */
export const isComplete = (run: Run) => !run.reset && !!run.endedAt && run.tasks.length > 0 && run.tasks.every((t) => t.done || isSection(run, t));

export interface TemplateRecord {
  /** Every attempt, finished or reset. */
  attempts: number;
  resets: number;
  /** Your fastest finished run, its time and each task's time in it. */
  pb?: { runId: string; ms: number; startedAt: string; tasks: Record<string, number> };
  /** Your best time per template task, over every attempt. */
  bestByTask: Record<string, number>;
  /** The sum of those bests: what's possible if every task went your best way. */
  sumOfBest?: number;
  /** Finished runs, fastest first. */
  finishedMs: { runId: string; ms: number }[];
  lastAt?: string;
}

export function templateRecord(tpl: Template, runs: Run[], now = Date.now()): TemplateRecord {
  const mine = runs.filter((r) => r.templateId === tpl.id);
  const finished = mine.filter(isComplete).map((r) => ({ run: r, ms: runElapsed(r, now) })).sort((a, b) => a.ms - b.ms);
  const bestByTask: Record<string, number> = {};
  for (const r of mine)
    for (const t of r.tasks) {
      if (!t.templateTaskId || !t.done || isSection(r, t) || !countsAsBest(t)) continue;
      const prev = bestByTask[t.templateTaskId];
      if (prev === undefined || t.elapsedMs < prev) bestByTask[t.templateTaskId] = t.elapsedMs;
    }
  const leaves = tpl.tasks.filter((t) => !tpl.tasks.some((c) => c.parentId === t.id));
  const pbRun = finished[0]?.run;
  return {
    attempts: mine.length,
    resets: mine.filter((r) => r.reset).length,
    pb: pbRun && {
      runId: pbRun.id,
      ms: finished[0].ms,
      startedAt: pbRun.startedAt,
      tasks: Object.fromEntries(pbRun.tasks.filter((t) => t.templateTaskId && !isSection(pbRun, t)).map((t) => [t.templateTaskId!, t.elapsedMs])),
    },
    bestByTask,
    sumOfBest: leaves.length && leaves.every((t) => bestByTask[t.id] !== undefined) ? leaves.reduce((a, t) => a + bestByTask[t.id], 0) : undefined,
    finishedMs: finished.map((f) => ({ runId: f.run.id, ms: f.ms })),
    lastAt: mine.map((r) => r.startedAt).sort().at(-1),
  };
}

// ---------- racing your best ----------

const WEEKDAYS = /\b(mon|tue|wed|thu|fri|sat|sun|mo|di|mi|do|fr|sa|so|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|heute|kw)\b/g;

/**
 * A task name boiled down for comparing: lower case, no estimate, numbers, dates, weekdays or punctuation.
 * "Emails 9.10.", "emails!" and "Emails (Mon) 15m" all become "emails".
 */
export function matchKey(title: string): string {
  return splitEstimate(title)
    .title.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\d+/g, ' ')
    .replace(WEEKDAYS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** How alike two keys are, by shared words: 1 is the same, 0 nothing in common. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const wa = new Set(a.split(' ').filter(Boolean));
  const wb = new Set(b.split(' ').filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return (2 * shared) / (wa.size + wb.size);
}

export const SIMILAR = 0.7;
export const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** A finished time worth racing: not ticked off by accident seconds in, or at a third of its estimate. */
export function countsAsBest(t: Task): boolean {
  return t.elapsedMs >= 1000 && (t.estimateMs === undefined || t.elapsedMs >= t.estimateMs / 3);
}

export interface Best {
  ms: number;
  /** The session it's from, and when. */
  from: string;
  at: string;
  /** The name it matched, as a key; "" for a template task. */
  key: string;
  /** Matched by a similar name, not exactly: you can say it's not the same task. */
  fuzzy: boolean;
}

/** Every finished task in past sessions, ready to match against. */
export function bestIndex(runs: Run[]): { key: string; ms: number; from: string; at: string }[] {
  const out: { key: string; ms: number; from: string; at: string }[] = [];
  for (const r of runs)
    for (const t of r.tasks) {
      if (!t.done || isSection(r, t) || !countsAsBest(t)) continue;
      const key = matchKey(t.title);
      if (key) out.push({ key, ms: t.elapsedMs, from: r.name, at: r.startedAt });
    }
  return out;
}

/**
 * Your best time for a task. In a session from a template, it's the best for that template task.
 * Otherwise the best for the same name or a similar one, unless you said they're not the same.
 */
export function bestFor(t: Task, run: Run, past: Run[], index: ReturnType<typeof bestIndex>, notSame: string[]): Best | undefined {
  if (run.templateId && t.templateTaskId) {
    let best: Best | undefined;
    for (const r of past) {
      if (r.templateId !== run.templateId) continue;
      for (const x of r.tasks)
        if (x.templateTaskId === t.templateTaskId && x.done && !isSection(r, x) && countsAsBest(x) && (!best || x.elapsedMs < best.ms))
          best = { ms: x.elapsedMs, from: r.name, at: r.startedAt, key: '', fuzzy: false };
    }
    if (best) return best;
  }
  const key = matchKey(t.title);
  if (!key) return undefined;
  const blocked = new Set(notSame);
  let best: Best | undefined;
  for (const e of index) {
    const exact = e.key === key;
    if (!exact && (similarity(key, e.key) < SIMILAR || blocked.has(pairKey(key, e.key)))) continue;
    if (!best || e.ms < best.ms) best = { ms: e.ms, from: e.from, at: e.at, key: e.key, fuzzy: !exact };
  }
  return best;
}

/** Medal for a finished task: gold for a new best, silver under the estimate, bronze up to 10 % over. */
export function medal(t: Task, best: Best | undefined): 'gold' | 'silver' | 'bronze' | undefined {
  if (!t.done) return undefined;
  if (best && t.elapsedMs < best.ms) return 'gold';
  if (t.estimateMs === undefined) return undefined;
  if (t.elapsedMs <= t.estimateMs) return 'silver';
  if (t.elapsedMs <= t.estimateMs * 1.1) return 'bronze';
  return undefined;
}

/**
 * How you're doing against your fastest run of this template, at this point: over the tasks both
 * runs have, finished ones count their difference and the running one counts once it's past your PB's.
 */
export function pbPace(run: Run, pbTasks: Record<string, number>, now = Date.now()): number | undefined {
  let d = 0;
  let any = false;
  for (const t of run.tasks) {
    if (isSection(run, t) || !t.templateTaskId) continue;
    const pb = pbTasks[t.templateTaskId];
    if (pb === undefined) continue;
    const ms = liveElapsed(run, t, now);
    if (t.done) {
      d += ms - pb;
      any = true;
    } else if (ms > pb) {
      d += ms - pb;
      any = true;
    }
  }
  return any ? d : undefined;
}
