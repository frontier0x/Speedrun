// The bridge between the main process and the overlay/dashboard windows.
import type { Mode, Run, RunSummary, Settings } from './runs.js';

export interface Activity {
  app: string;
  title: string;
  /** Epoch ms when this activity started. */
  since: number;
}

export interface AppState {
  run: Run | null;
  settings: Settings;
  /** Best time per task title (see taskKey), from finished runs. */
  golds: [string, number][];
  /** What AutoCapture currently sees. */
  activity: Activity | null;
  idle: boolean;
  /** macOS permissions AutoCapture needs; both true elsewhere. */
  permissions: { screen: boolean; accessibility: boolean };
  /** AutoCapture is running (it can be paused). */
  capturing: boolean;
  /** Time per app today, longest first, not counting the current stretch. */
  appTimes: [string, number][];
}

export type Action =
  | { type: 'quickAdd'; text: string }
  | { type: 'import'; text: string }
  | { type: 'importFile' }
  | { type: 'start'; id: string }
  | { type: 'toggleDone'; id: string }
  | { type: 'split' }
  | { type: 'togglePause' }
  | { type: 'startRun' }
  | { type: 'toggleCapture' }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; beforeId: string | null }
  | { type: 'setEstimate'; id: string; text: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'setMode'; mode: Mode }
  | { type: 'newRun' }
  | { type: 'openDashboard' }
  | { type: 'hideOverlay' }
  | { type: 'openPermission'; which: 'screen' | 'accessibility' }
  | { type: 'relaunch' };

export interface SpeedrunApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): void;
  onFocusAdd(cb: () => void): void;
  act(action: Action): Promise<void>;
  listRuns(): Promise<{ summaries: RunSummary[]; runs: Run[] }>;
}
