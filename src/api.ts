// The bridge between the main process and the overlay/dashboard windows.
import type { Run, RunSummary, Settings } from './runs.js';

export interface AppState {
  run: Run | null;
  settings: Settings;
  /** Best time per task title (see taskKey), from finished runs. */
  golds: [string, number][];
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
  | { type: 'fitHeight'; height: number }
  | { type: 'moveBy'; dx: number; dy: number }
  | { type: 'openDashboard' }
  | { type: 'hideOverlay' };

export interface SpeedrunApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): void;
  onFocusAdd(cb: () => void): void;
  act(action: Action): Promise<void>;
  listRuns(): Promise<{ summaries: RunSummary[]; runs: Run[] }>;
}
