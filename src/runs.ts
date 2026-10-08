// Pure run/task model shared by the main process, overlay and dashboard. No Node or Electron imports.

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
}

export interface Settings {
  accent: string;
  opacity: number;
  overlayBounds?: { x: number; y: number; width: number; height: number };
}

export const DEFAULT_SETTINGS: Settings = { accent: '#e8e8e8', opacity: 0.96 };

export const ACCENTS = ['#e8e8e8', '#7c5cff', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#e5e7eb'];

export const newId = () => Math.random().toString(36).slice(2, 10);

// ---------- durations ----------

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

// ---------- mutations (return the same run, mutated) ----------

function stopClock(run: Run, now: number) {
  const active = run.tasks.find((t) => t.id === run.activeTaskId);
  if (active && run.activeSince !== undefined) active.elapsedMs += now - run.activeSince;
  run.activeSince = undefined;
}

export function startTask(run: Run, id: string, now = Date.now()): Run {
  stopClock(run, now);
  run.activeTaskId = id;
  run.activeSince = now;
  return run;
}

export function pause(run: Run, now = Date.now()): Run {
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

/** Moves a task (with its subtasks) to sit before `beforeId`, or to the end. Keeps its parent. */
export function moveTask(run: Run, id: string, beforeId: string | null): Run {
  const block = new Set([id]);
  for (const t of run.tasks) if (t.parentId && block.has(t.parentId)) block.add(t.id);
  const moving = run.tasks.filter((t) => block.has(t.id));
  const rest = run.tasks.filter((t) => !block.has(t.id));
  const at = beforeId ? rest.findIndex((t) => t.id === beforeId) : -1;
  run.tasks = at < 0 ? [...rest, ...moving] : [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  return run;
}

export function newRun(mode: Mode, now = new Date()): Run {
  const name = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' run';
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
  mode: Mode;
  startedAt: string;
  endedAt?: string;
  elapsedMs: number;
  estimateMs?: number;
  tasksDone: number;
  tasksTotal: number;
  /** Share of finished, estimated tasks that came in at or under estimate. */
  onEstimateRate?: number;
}

export function summarize(run: Run, now = Date.now()): RunSummary {
  const leaves = run.tasks.filter((t) => !isSection(run, t));
  const estimated = leaves.filter((t) => t.done && t.estimateMs);
  return {
    id: run.id,
    name: run.name,
    mode: run.mode,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    elapsedMs: runElapsed(run, now),
    estimateMs: runEstimate(run),
    tasksDone: leaves.filter((t) => t.done).length,
    tasksTotal: leaves.length,
    onEstimateRate: estimated.length ? estimated.filter((t) => t.elapsedMs <= t.estimateMs!).length / estimated.length : undefined,
  };
}
