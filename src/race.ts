// Templates and racing your best. Pure: works on saved sessions only, no Node or Electron, no network.
//
// A template is a saved task list. A session started from it is an attempt; a finished attempt is a run,
// a reset one isn't. Tasks from a template carry a fixed templateTaskId, so runs compare exactly even if
// you rename things. Sessions without a template compare task by task, by name (see taskKey and similar).

import {
  isSection, liveElapsed, newId, parseTaskList, runElapsed, taskKey, type Run, type Task,
} from './runs.js';

export interface TemplateTask {
  id: string;
  title: string;
  estimateMs?: number;
  parentId?: string;
}

export interface Template {
  id: string;
  name: string;
  tasks: TemplateTask[];
  createdAt: string;
}

// ---------- templates ----------

/** A template from a session's tasks: titles, estimates and subtasks, no times. */
export function templateFromTasks(name: string, tasks: Pick<Task, 'id' | 'title' | 'estimateMs' | 'parentId'>[], now = new Date()): Template {
  const ids = new Map(tasks.map((t) => [t.id, newId()]));
  return {
    id: newId(),
    name: name.trim() || 'Template',
    createdAt: now.toISOString(),
    tasks: tasks.map((t) => ({
      id: ids.get(t.id)!,
      title: t.title,
      estimateMs: t.estimateMs,
      parentId: t.parentId ? ids.get(t.parentId) : undefined,
    })),
  };
}

/**
 * Saves a session as a template and makes the session its first attempt, so a finished session is
 * already the run to beat.
 */
export function saveAsTemplate(run: Run, name: string, now = new Date()): Template {
  const tpl = templateFromTasks(name, run.tasks, now);
  run.templateId = tpl.id;
  run.tasks.forEach((t, i) => (t.templateTaskId = tpl.tasks[i].id));
  return tpl;
}

/** A template from text, the same way Paste a list reads it. */
export const templateFromText = (name: string, text: string, now = new Date()) => templateFromTasks(name, parseTaskList(text), now);

/** Keeps the template's task ids for tasks whose title is unchanged, so old runs still compare after an edit. */
export function retext(tpl: Template, text: string): Template {
  const fresh = parseTaskList(text);
  const byTitle = new Map(tpl.tasks.map((t) => [taskKey(t.title), t.id]));
  const ids = new Map(fresh.map((t) => [t.id, byTitle.get(taskKey(t.title)) ?? newId()]));
  return {
    ...tpl,
    tasks: fresh.map((t) => ({ id: ids.get(t.id)!, title: t.title, estimateMs: t.estimateMs, parentId: t.parentId ? ids.get(t.parentId) : undefined })),
  };
}

/** The template as editable text: one line per task, subtasks indented, estimates after the name. */
export function templateText(tpl: Template): string {
  const depth = (t: TemplateTask) => {
    let d = 0;
    for (let p = t.parentId; p; p = tpl.tasks.find((x) => x.id === p)?.parentId) d++;
    return d;
  };
  const fmt = (ms: number) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}h${Math.round((ms % 3_600_000) / 60_000)}m` : `${Math.round(ms / 60_000)}m`);
  return tpl.tasks.map((t) => `${'  '.repeat(depth(t))}- ${t.title}${t.estimateMs ? ' ' + fmt(t.estimateMs) : ''}`).join('\n');
}

/** A fresh session from a template: every task open at 0:00, linked back to the template. */
export function runFromTemplate(tpl: Template, now = new Date()): Run {
  const ids = new Map(tpl.tasks.map((t) => [t.id, newId()]));
  return {
    id: now.toISOString().replace(/[:.]/g, '-'),
    name: tpl.name,
    mode: 'manual',
    startedAt: now.toISOString(),
    templateId: tpl.id,
    tasks: tpl.tasks.map((t) => ({
      id: ids.get(t.id)!,
      title: t.title,
      estimateMs: t.estimateMs,
      elapsedMs: 0,
      done: false,
      parentId: t.parentId ? ids.get(t.parentId) : undefined,
      templateTaskId: t.id,
    })),
  };
}

// ---------- runs of a template ----------

const leaves = (run: Run) => run.tasks.filter((t) => !isSection(run, t));

/** A finished attempt: ended, not reset, every task done. Only these count as runs to beat. */
export const isCompleteRun = (run: Run) => Boolean(run.endedAt) && !run.resetAt && leaves(run).every((t) => t.done);

export interface TemplateRecord {
  attempts: number;
  resets: number;
  runs: Run[]; // finished runs, fastest first
  best?: Run;
}

export function templateRecord(templateId: string, sessions: Run[]): TemplateRecord {
  const mine = sessions.filter((r) => r.templateId === templateId);
  const runs = mine.filter(isCompleteRun).sort((a, b) => runElapsed(a) - runElapsed(b));
  return { attempts: mine.length, resets: mine.filter((r) => r.resetAt).length, runs, best: runs[0] };
}

/** 1 = fastest. Counts finished runs only. */
export const rankOf = (run: Run, record: TemplateRecord) => record.runs.findIndex((r) => r.id === run.id) + 1;

/**
 * How far ahead (negative) or behind (positive) your fastest run you are right now, over the tasks both
 * runs share. Finished tasks count fully; the task you're on counts once it's slower than the best run's.
 */
export function paceVsBest(run: Run, best: Run, now = Date.now()): number | undefined {
  const theirs = new Map(leaves(best).filter((t) => t.templateTaskId).map((t) => [t.templateTaskId!, t.elapsedMs]));
  let delta: number | undefined;
  for (const t of leaves(run)) {
    const b = t.templateTaskId ? theirs.get(t.templateTaskId) : undefined;
    if (b === undefined) continue;
    const mine = liveElapsed(run, t, now);
    if (t.done) delta = (delta ?? 0) + mine - b;
    else if (mine > b) delta = (delta ?? 0) + mine - b;
  }
  return delta;
}

// ---------- best time for a task ----------

/** Little words that don't make two tasks different. */
const FILLER = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'and', 'on', 'in', 'with', 'my', 'der', 'die', 'das', 'den', 'und', 'für', 'mit', 'an', 'zu', 'am', 'im', 'auf']);

/** Same task, by name: the same key, or most of the same words ("reply emails" and "reply to emails"). */
export function similar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const words = (k: string) => new Set(k.split(' ').filter((w) => !FILLER.has(w)));
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / (wa.size + wb.size - shared) >= 0.7;
}

export const pairKey = (a: string, b: string) => [a, b].sort().join('|');

export interface Best {
  ms: number;
  /** Where it's from, e.g. "Morning routine, 4 Oct". */
  from: string;
  /** The matched task's key, to say "not the same task". */
  key: string;
}

/**
 * Your best time for a task, from earlier sessions. Tasks from a template compare with the same
 * template task; others by name. Times under a third of the estimate (ticked off by mistake) and
 * matches you've ruled out don't count.
 */
export function bestFor(task: Task, run: Run, sessions: Run[], notSame: string[] = []): Best | undefined {
  const key = taskKey(task.title);
  const ruledOut = new Set(notSame);
  let best: Best | undefined;
  for (const other of sessions) {
    if (other.id === run.id) continue;
    for (const t of other.tasks) {
      if (!t.done || t.elapsedMs < 1000 || isSection(other, t)) continue;
      if (t.estimateMs && t.elapsedMs < t.estimateMs / 3) continue;
      const otherKey = taskKey(t.title);
      const same =
        task.templateTaskId && run.templateId && other.templateId === run.templateId
          ? t.templateTaskId === task.templateTaskId
          : similar(key, otherKey) && !ruledOut.has(pairKey(key, otherKey));
      if (!same || (best && t.elapsedMs >= best.ms)) continue;
      const day = new Date(other.startedAt).toLocaleDateString([], { day: 'numeric', month: 'short' });
      best = { ms: t.elapsedMs, from: `${other.name}, ${day}`, key: otherKey };
    }
  }
  return best;
}
