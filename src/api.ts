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
  /** AutoCapture: whether it's currently watching, and what it has logged since launch. */
  capture: CaptureStatus;
}

export interface CaptureStatus {
  running: boolean;
  events: number;
  screenshots: number;
  /** macOS permissions AutoCapture needs. */
  screenAccess: boolean;
  accessibility: boolean;
  /** Last error from reading the active window, if the most recent check failed. */
  error: string | null;
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
  | { type: 'setMode'; mode: Mode }
  | { type: 'endRun' }
  | { type: 'toggleCapture' }
  | { type: 'openPermission'; pane: 'screen' | 'accessibility' }
  | { type: 'openCaptureLog' }
  | { type: 'relaunch' }
  | { type: 'openDashboard' }
  | { type: 'hideOverlay' };

export interface SpeedrunApi {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): void;
  onFocusAdd(cb: () => void): void;
  act(action: Action): Promise<void>;
  listRuns(): Promise<{ summaries: RunSummary[]; runs: Run[] }>;
}
