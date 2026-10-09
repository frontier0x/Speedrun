// The bridge between the main process and the overlay/dashboard windows.
import type { Best, Run, RunSummary, Settings, Template, TemplateRecord } from './runs.js';

export interface AppState {
  run: Run | null;
  /** The session that just ended, shown as a summary until you dismiss it or start a new one. */
  finished: Run | null;
  settings: Settings;
  /** Best time per task title (see taskKey), from finished runs. */
  golds: [string, number][];
  /** Time on tasks and in pauses across all sessions, today and over the last 7 days. */
  totals: { todayMs: number; todayPausedMs: number; weekMs: number; weekPausedMs: number };
  templates: Template[];
  /** Your best per task of the live (or just finished) session, from earlier sessions. Empty unless you race. */
  bests: Record<string, Best>;
  /** The template of the live (or just finished) session: your PB and how this attempt ranks. */
  record?: TemplateRecord & { name: string; rank?: number; prevPbMs?: number };
  /** Task names you've used, newest first, with their last estimate: suggestions while you type. */
  suggestions: string[];
  /** "3, 2, 1, Go" running: the clock starts at this epoch ms. */
  countInUntil?: number;
}

export type Action =
  | { type: 'quickAdd'; text: string; subtask?: boolean }
  | { type: 'indent'; id: string }
  | { type: 'outdent'; id: string }
  | { type: 'shift'; id: string; dir: -1 | 1 }
  | { type: 'addSubtask'; parentId: string; text: string }
  | { type: 'resumeSession' }
  | { type: 'continueWith'; text: string }
  | { type: 'renameRun'; id: string; name: string }
  | { type: 'saveTemplate'; name: string }
  | { type: 'startTemplate'; id: string }
  | { type: 'renameTemplate'; id: string; name: string }
  | { type: 'editTemplate'; id: string; text: string }
  | { type: 'importTemplate'; name: string; text: string }
  | { type: 'deleteTemplate'; id: string }
  | { type: 'resetRun' }
  | { type: 'notSame'; taskId: string }
  | { type: 'skipCountIn' }
  | { type: 'copyResult'; rect: { x: number; y: number; width: number; height: number } }
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
  | { type: 'openSettings' }
  | { type: 'quit' };

export interface SpeedrunApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): void;
  onFocusAdd(cb: () => void): void;
  act(action: Action): Promise<void>;
  listRuns(): Promise<{ summaries: RunSummary[]; runs: Run[]; records: Record<string, TemplateRecord> }>;
}
