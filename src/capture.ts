import { powerMonitor, type Rectangle } from 'electron';
import { activeWindow } from 'get-windows';
import { ChangeTracker } from './detect.js';
import { hammingDistance, toHex } from './hash.js';
import { captureScreen } from './screen.js';
import type { DayStore } from './store.js';
import type { CaptureEvent, EventKind, WindowSnapshot } from './types.js';

const POLL_MS = 1000; // cheap window check, no screenshot
const HEARTBEAT_MS = 30_000; // fallback screenshot while you stay in one place
const SAME_SCREEN_BITS = 4; // dHash distance at or below this counts as "screen unchanged"

export const IDLE_AFTER_S = 120;

export interface CaptureCallbacks {
  /** A new app or tab became the current activity. */
  onActivity(window: WindowSnapshot, since: number): void;
  onIdle(idle: boolean): void;
  /** Something went wrong reading the window or screen (usually a missing permission); null once it works again. */
  onError(message: string | null): void;
}

/** get-windows explains missing permissions on stdout; fall back to the error message. */
function describe(err: unknown): string {
  const out = (err as { stdout?: unknown })?.stdout;
  if (typeof out === 'string' && out.trim()) return out.trim();
  return err instanceof Error ? err.message : String(err);
}

/** AutoCapture: watches window/tab switches, takes screenshots on change and every 30s if the screen moved. */
export class Capture {
  private tracker = new ChangeTracker();
  private timer: NodeJS.Timeout | undefined;
  private ticking = false;
  private idle = false;
  private lastBounds: Rectangle | undefined;
  private lastSavedHash: bigint | undefined;
  private lastScreenshotAt = 0;
  private queue = Promise.resolve();
  private lastError: string | null = null;
  events = 0;
  screenshots = 0;

  constructor(
    private readonly store: DayStore,
    private readonly cb: CaptureCallbacks,
  ) {}

  get running() {
    return this.timer !== undefined;
  }

  start() {
    if (this.timer) return;
    this.enqueue(() => this.record('session_start', undefined, { screenshot: true, force: true }));
    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.ticking = true;
      this.tick()
        .then(() => this.reportError(null))
        .catch((err) => this.reportError(describe(err)))
        .finally(() => (this.ticking = false));
    }, POLL_MS);
  }

  stop(kind: 'pause' | null = 'pause') {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.reportError(null);
    if (kind) this.enqueue(() => this.store.append({ ts: new Date().toISOString(), kind }));
  }

  /** Locking or sleeping counts as idle right away; the next tick with fresh input logs idle_end. */
  goIdle() {
    if (this.idle || !this.running) return;
    this.setIdle(true);
    this.enqueue(() => this.store.append({ ts: new Date().toISOString(), kind: 'idle_start', idleSeconds: 0 }));
  }

  /** Logs and reports an error once, not on every poll. */
  private reportError(message: string | null) {
    if (message === this.lastError) return;
    this.lastError = message;
    if (message) console.error('[speedrun] AutoCapture:', message);
    this.cb.onError(message);
  }

  private setIdle(idle: boolean) {
    this.idle = idle;
    this.cb.onIdle(idle);
  }

  /** Run captures one at a time so a slow screenshot never overlaps the next event. */
  private enqueue(job: () => Promise<void>) {
    this.queue = this.queue.then(job).catch((err) => console.error('[speedrun]', err));
  }

  private async record(kind: EventKind, window?: WindowSnapshot, opts: { screenshot?: boolean; force?: boolean } = {}) {
    const event: CaptureEvent = { ts: new Date().toISOString(), kind, window };
    if (opts.screenshot) {
      const shot = await captureScreen(this.lastBounds);
      this.lastScreenshotAt = Date.now();
      if (shot) {
        event.screenHash = toHex(shot.hash);
        const same = this.lastSavedHash !== undefined && hammingDistance(shot.hash, this.lastSavedHash) <= SAME_SCREEN_BITS;
        if (same && !opts.force) {
          event.unchanged = true;
        } else {
          event.screenshot = await this.store.saveScreenshot(shot.jpeg, new Date(event.ts));
          this.screenshots++;
          this.lastSavedHash = shot.hash;
        }
      }
    }
    await this.store.append(event);
    this.events++;
    console.log(`[speedrun] ${event.kind}${event.unchanged ? ' (unchanged)' : ''} ${window?.app ?? ''} ${window?.title ?? ''}`);
  }

  private async readWindow(): Promise<WindowSnapshot | null> {
    const w = await activeWindow();
    if (!w) return null;
    this.lastBounds = w.bounds;
    return {
      app: w.owner.name,
      bundleId: 'bundleId' in w.owner ? (w.owner.bundleId as string) : undefined,
      title: w.title,
      url: 'url' in w ? (w.url as string | undefined) : undefined,
    };
  }

  private async tick() {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (!this.idle && idleSeconds >= IDLE_AFTER_S) {
      this.setIdle(true);
      this.enqueue(() => this.store.append({ ts: new Date().toISOString(), kind: 'idle_start', idleSeconds }));
      return;
    }
    if (this.idle) {
      if (idleSeconds >= IDLE_AFTER_S) return;
      this.setIdle(false);
      this.enqueue(() => this.record('idle_end', this.tracker.current, { screenshot: true, force: true }));
    }

    const snap = await this.readWindow();
    if (snap) {
      const change = this.tracker.poll(snap, Date.now());
      if (change) {
        if (change.kind !== 'title_change') this.cb.onActivity(change.window, Date.now());
        this.enqueue(() => this.record(change.kind, change.window, { screenshot: true, force: change.kind !== 'title_change' }));
        return;
      }
    }

    if (Date.now() - this.lastScreenshotAt >= HEARTBEAT_MS) {
      this.lastScreenshotAt = Date.now();
      this.enqueue(() => this.record('heartbeat', this.tracker.current, { screenshot: true }));
    }
  }
}
