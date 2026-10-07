export interface WindowSnapshot {
  app: string;
  bundleId?: string;
  title: string;
  url?: string;
}

export type EventKind =
  | 'session_start'
  | 'app_switch'
  | 'tab_switch'
  | 'title_change'
  | 'heartbeat'
  | 'idle_start'
  | 'idle_end'
  | 'pause'
  | 'resume';

export interface CaptureEvent {
  ts: string;
  kind: EventKind;
  window?: WindowSnapshot;
  /** Path of the saved screenshot, relative to the day's folder. */
  screenshot?: string;
  /** Perceptual hash of the screen at this moment (hex). */
  screenHash?: string;
  /** True when a heartbeat found the screen unchanged, so nothing was saved or analysed. */
  unchanged?: boolean;
  /** Seconds idle, on idle_start. */
  idleSeconds?: number;
}
