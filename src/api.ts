// The bridge between the main process and the overlay/dashboard windows.
import type { FocusKind, Nudge } from './focus.js';
import type { Run, RunSummary, Settings } from './runs.js';

export interface FocusStatus {
  /** Whatever is in front right now and how it's filed. Null while no task runs or tracking is off. */
  current: { key: string; kind: FocusKind } | null;
  /** Shown when a distraction has gone on too long. */
  nudge: Nudge | null;
  /** A browser that refused to share its tab (the Automation prompt was declined). */
  browserBlocked: string | null;
}

export interface AppState {
  run: Run | null;
  settings: Settings;
  /** Best time per task title (see taskKey), from finished runs. */
  golds: [string, number][];
  focus: FocusStatus;
}

export type Action =
  | { type: 'quickAdd'; text: string }
  | { type: 'import'; text: string }
  | { type: 'importFile' }
  | { type: 'start'; id: string }
  | { type: 'toggleDone'; id: string }
  | { type: 'split' }
  | { type: 'togglePause' }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; beforeId: string | null }
  | { type: 'setEstimate'; id: string; text: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'endRun' }
  | { type: 'nudge'; answer: 'back' | 'pause' | 'allow' }
  | { type: 'openAutomationSettings' }
  | { type: 'fitHeight'; height: number }
  | { type: 'openDashboard' }
  | { type: 'hideOverlay' };

export interface SpeedrunApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): void;
  onFocusAdd(cb: () => void): void;
  act(action: Action): Promise<void>;
  listRuns(): Promise<{ summaries: RunSummary[]; runs: Run[] }>;
}
