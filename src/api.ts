// The bridge between the main process and the overlay/dashboard windows.
import type { Best, Template } from './race.js';
import type { Run, RunSummary, Settings } from './runs.js';

export interface AppState {
  run: Run | null;
  /** The session that just ended, shown as a summary until you dismiss it or start a new one. */
  finished: Run | null;
  settings: Settings;
  /** Best time per task title (see taskKey), from finished runs. */
  golds: [string, number][];
  /** Time on tasks and in pauses across all sessions, today and over the last 7 days. */
  totals: { todayMs: number; todayPausedMs: number; weekMs: number; weekPausedMs: number };
  /** Your templates, with their record. */
  templates: TemplateInfo[];
  /** Racing your best, when it's on in Settings. */
  race: RaceInfo | null;
}

export interface TemplateInfo {
  id: string;
  name: string;
  text: string;
  tasks: number;
  attempts: number;
  resets: number;
  /** Your fastest finished run, total time. */
  bestMs?: number;
}

export interface RaceInfo {
  /** Best earlier time per task of the current session, by task id. */
  bests: Record<string, Best>;
  /** Your fastest finished run of the current session's template, to race its pace. */
  bestRun: Run | null;
  /** For the session that just ended, when it came from a template. */
  finish: FinishInfo | null;
}

export interface FinishInfo {
  /** Finished every task: it counts as a run. */
  complete: boolean;
  totalMs: number;
  /** Your fastest run before this one. */
  previousBestMs?: number;
  /** 1 = fastest, among finished runs. */
  rank: number;
  runs: number;
  attempts: number;
}

/** Shown under the clock for a moment when you finish a task. */
export interface Flash {
  elapsedMs: number;
  estimateMs?: number;
  bestMs?: number;
  newBest: boolean;
}

export type Action =
  | { type: 'quickAdd'; text: string }
  | { type: 'addSubtask'; parentId: string; text: string }
  | { type: 'resumeSession' }
  | { type: 'continueWith'; text: string }
  | { type: 'renameRun'; id: string; name: string }
  | { type: 'import'; text: string }
  | { type: 'importFile' }
  | { type: 'start'; id: string }
  | { type: 'toggleDone'; id: string }
  | { type: 'reopen'; id: string }
  | { type: 'setTime'; id: string; text: string }
  | { type: 'split' }
  | { type: 'togglePause' }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; beforeId: string | null }
  | { type: 'setEstimate'; id: string; text: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'endRun' }
  | { type: 'fitSize'; width: number; height: number }
  | { type: 'dragStart'; mode: 'move' | 'resize' }
  | { type: 'dragMove' }
  | { type: 'dragEnd' }
  | { type: 'openDashboard' }
  | { type: 'hideOverlay' }
  | { type: 'dismissSummary' }
  | { type: 'startTemplate'; id: string }
  | { type: 'saveTemplate'; runId: string; name: string }
  | { type: 'createTemplate'; name: string; text: string }
  | { type: 'updateTemplate'; id: string; name?: string; text?: string }
  | { type: 'deleteTemplate'; id: string }
  | { type: 'resetRun' }
  | { type: 'notSameTask'; a: string; b: string }
  | { type: 'skipCountdown' }
  | { type: 'openSettings' }
  | { type: 'quit' };

export interface SpeedrunApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): void;
  onFocusAdd(cb: () => void): void;
  /** The start countdown: ms until Go, or 0 when it's skipped. */
  onCountdown(cb: (ms: number) => void): void;
  onFlash(cb: (f: Flash) => void): void;
  act(action: Action): Promise<void>;
  listRuns(): Promise<{ summaries: RunSummary[]; runs: Run[] }>;
}
