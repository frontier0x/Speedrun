import { powerMonitor, systemPreferences, type Rectangle } from 'electron';
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

export interface Permissions {
  /** Screen Recording: needed for screenshots and window titles. */
  screen: boolean;
  /** Accessibility: needed for the browser tab URL. */
  accessibility: boolean;
}

/** What macOS currently allows. Other platforms don't gate these. */
export function readPermissions(): Permissions {
  if (process.platform !== 'darwin') return { screen: true, accessibility: true };
  return {
    screen: systemPreferences.getMediaAccessStatus('screen') === 'granted',
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
  };
}

export interface CaptureCallbacks {
  /** A new app or tab became the current activity. */
  onActivity(window: WindowSnapshot, since: number): void;
  onIdle(idle: boolean): void;
  onPermissions(p: Permissions): void;
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
  private perms: Permissions = { screen: true, accessibility: true };
  private permsCheckedAt = 0;

  constructor(
    private readonly store: DayStore,
    private readonly cb: CaptureCallbacks,
  ) {}

  get permissions(): Permissions {
    return this.perms;
  }

  /** Re-read permissions every few seconds so granting one takes effect without a restart where macOS allows. */
  private refreshPermissions(force = false) {
    if (!force && Date.now() - this.permsCheckedAt < 5000) return;
    this.permsCheckedAt = Date.now();
    const next = readPermissions();
    if (next.screen !== this.perms.screen || next.accessibility !== this.perms.accessibility || force) {
      this.perms = next;
      this.cb.onPermissions(next);
    }
  }

  get running() {
    return this.timer !== undefined;
  }

  start() {
    if (this.timer) return;
    this.refreshPermissions(true);
    this.enqueue(() => this.record('session_start', undefined, { screenshot: true, force: true }));
    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.ticking = true;
      this.tick()
        .catch((err) => console.error('[speedrun]', err))
        .finally(() => (this.ticking = false));
    }, POLL_MS);
  }

  stop(kind: 'pause' | null = 'pause') {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    if (kind) this.enqueue(() => this.store.append({ ts: new Date().toISOString(), kind }));
  }

  /** Locking or sleeping counts as idle right away; the next tick with fresh input logs idle_end. */
  goIdle() {
    if (this.idle || !this.running) return;
    this.setIdle(true);
    this.enqueue(() => this.store.append({ ts: new Date().toISOString(), kind: 'idle_start', idleSeconds: 0 }));
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
    if (opts.screenshot && this.perms.screen) {
      const shot = await captureScreen(this.lastBounds).catch(() => null);
      this.lastScreenshotAt = Date.now();
      if (shot) {
        event.screenHash = toHex(shot.hash);
        const same = this.lastSavedHash !== undefined && hammingDistance(shot.hash, this.lastSavedHash) <= SAME_SCREEN_BITS;
        if (same && !opts.force) {
          event.unchanged = true;
        } else {
          event.screenshot = await this.store.saveScreenshot(shot.jpeg, new Date(event.ts));
          this.lastSavedHash = shot.hash;
        }
      }
    }
    await this.store.append(event);
    console.log(`[speedrun] ${event.kind}${event.unchanged ? ' (unchanged)' : ''} ${window?.app ?? ''} ${window?.title ?? ''}`);
  }

  private async readWindow(): Promise<WindowSnapshot | null> {
    // Without a permission, ask get-windows for less instead of failing: no title without
    // Screen Recording, no URL without Accessibility, but the app name always works.
    const w = await activeWindow({ screenRecordingPermission: this.perms.screen, accessibilityPermission: this.perms.accessibility });
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
    this.refreshPermissions();
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
