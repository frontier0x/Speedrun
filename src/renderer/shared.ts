// What the timer's parts share: the bridge to the app, small DOM helpers, and the state they all read.
// The clock and wiring live in overlay.ts, the task list in list.ts, the end-of-session summary in summary.ts.

import type { AppState, SpeedrunApi } from '../api.js';
import { isSection, type Task } from '../runs.js';

export const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** State the parts share. One object, so every module sees the same values. */
export const ui = {
  state: undefined as unknown as AppState,
  /** Best time per task title, from finished runs. */
  golds: new Map<string, number>(),
  /** Hold list re-renders while an inline editor is open. */
  editing: false,
  /** Task whose estimate picker is open in the list. */
  pickerFor: null as string | null,
  /** Task whose "add a subtask" field is open in the list. */
  subFor: null as string | null,
  /** The finished session you just saved as a template. */
  savedTemplateFor: null as string | null,
  /** The add field is tabbed in: new tasks become subtasks of the last task. */
  addIndent: false,
  /** Redraws everything; set by overlay.ts. */
  render: () => {},
};

/**
 * The clock's two parts, e.g. 1:02:03 and .456. Hours always show, so the width never jumps.
 * With less precision the small part is empty: 1:02:03 for seconds, 1:02 for minutes.
 */
export function clockParts(ms: number, precision: 'ms' | 's' | 'm' = ui.state?.settings.precision ?? 'ms'): [string, string] {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (precision === 'm') return [`${h}:${pad(m)}`, ''];
  if (precision === 's') return [`${h}:${pad(m)}:${pad(s)}`, ''];
  return [`${h}:${pad(m)}:${pad(s)}`, '.' + String(total % 1000).padStart(3, '0')];
}

/** The task on the clock: the running one, or the next one up. */
export function currentTask(): Task | undefined {
  const run = ui.state.run;
  if (!run) return undefined;
  return run.tasks.find((t) => t.id === run.activeTaskId) ?? run.tasks.find((t) => !t.done && !isSection(run, t));
}

export const isRunning = () => Boolean(ui.state.run?.activeTaskId && ui.state.run.activeSince !== undefined);
export const isOpen = () => !$('more').hidden;

const ORD = ['th', 'st', 'nd', 'rd'];
export const ordinal = (n: number) => n + (ORD[(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10] ?? 'th');

/** Racing your best: your best earlier time for a task, when that's switched on. */
export const bestOf = (t: Task | undefined) => (t && ui.state.settings.race ? ui.state.bests[t.id] : undefined);

/** Tabs the add field in or out. In only works under a task. */
export function setIndent(on: boolean) {
  const last = ui.state.run?.tasks.filter((t) => !t.parentId).at(-1);
  ui.addIndent = on && Boolean(last);
  $('addForm').classList.toggle('indent', ui.addIndent);
  $<HTMLInputElement>('addInput').placeholder = ui.addIndent && last ? `Subtask of ${last.title}, e.g. Hero 20m` : 'Add a task, e.g. Write copy 30m';
}
