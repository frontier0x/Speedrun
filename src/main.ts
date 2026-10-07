import { app, Menu, nativeImage, powerMonitor, shell, systemPreferences, Tray } from 'electron';
import { activeWindow } from 'get-windows';
import { join } from 'node:path';
import { ChangeTracker } from './detect.js';
import { hammingDistance, toHex } from './hash.js';
import { captureScreen } from './screen.js';
import { DayStore } from './store.js';
import type { CaptureEvent, EventKind, WindowSnapshot } from './types.js';

const POLL_MS = 1000; // cheap window check, no screenshot
const HEARTBEAT_MS = 30_000; // fallback screenshot while you stay in one place
const IDLE_AFTER_S = 120;
const SAME_SCREEN_BITS = 4; // dHash distance at or below this counts as "screen unchanged"

const store = new DayStore(join(app.getPath('userData'), 'runs'));
const tracker = new ChangeTracker();

let tray: Tray | null = null;
let paused = false;
let idle = false;
let lastBounds: Electron.Rectangle | undefined;
let lastSavedHash: bigint | undefined;
let lastScreenshotAt = 0;
let splitStartedAt = Date.now();
let queue = Promise.resolve();

/** Run captures one at a time so a slow screenshot never overlaps the next event. */
function enqueue(job: () => Promise<void>) {
  queue = queue.then(job).catch((err) => console.error('[speedrun]', err));
}

async function record(kind: EventKind, window?: WindowSnapshot, opts: { screenshot?: boolean; force?: boolean } = {}) {
  const event: CaptureEvent = { ts: new Date().toISOString(), kind, window };
  if (opts.screenshot) {
    const shot = await captureScreen(lastBounds);
    lastScreenshotAt = Date.now();
    if (shot) {
      event.screenHash = toHex(shot.hash);
      const same = lastSavedHash !== undefined && hammingDistance(shot.hash, lastSavedHash) <= SAME_SCREEN_BITS;
      if (same && !opts.force) {
        event.unchanged = true;
      } else {
        event.screenshot = await store.saveScreenshot(shot.jpeg, new Date(event.ts));
        lastSavedHash = shot.hash;
      }
    }
  }
  await store.append(event);
  console.log(`[speedrun] ${event.kind}${event.unchanged ? ' (unchanged)' : ''} ${window?.app ?? ''} ${window?.title ?? ''}`);
}

async function readWindow(): Promise<WindowSnapshot | null> {
  const w = await activeWindow();
  if (!w) return null;
  lastBounds = w.bounds;
  return {
    app: w.owner.name,
    bundleId: 'bundleId' in w.owner ? (w.owner.bundleId as string) : undefined,
    title: w.title,
    url: 'url' in w ? (w.url as string | undefined) : undefined,
  };
}

async function tick() {
  if (paused) return;

  const idleSeconds = powerMonitor.getSystemIdleTime();
  if (!idle && idleSeconds >= IDLE_AFTER_S) {
    idle = true;
    enqueue(() => store.append({ ts: new Date().toISOString(), kind: 'idle_start', idleSeconds }));
    return;
  }
  if (idle) {
    if (idleSeconds >= IDLE_AFTER_S) return;
    idle = false;
    enqueue(() => record('idle_end', tracker.current, { screenshot: true, force: true }));
  }

  const snap = await readWindow();
  if (snap) {
    const change = tracker.poll(snap, Date.now());
    if (change) {
      if (change.kind !== 'title_change') splitStartedAt = Date.now();
      enqueue(() => record(change.kind, change.window, { screenshot: true, force: change.kind !== 'title_change' }));
      return;
    }
  }

  if (Date.now() - lastScreenshotAt >= HEARTBEAT_MS) {
    lastScreenshotAt = Date.now();
    enqueue(() => record('heartbeat', tracker.current, { screenshot: true }));
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function refreshTray() {
  if (!tray) return;
  if (paused) return tray.setTitle('⏸ paused');
  if (idle) return tray.setTitle('💤 idle');
  const appName = (tracker.current?.app ?? '…').slice(0, 18);
  tray.setTitle(`⏱ ${appName} ${formatElapsed(Date.now() - splitStartedAt)}`);
}

function buildMenu() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: paused ? 'Paused' : 'Capturing', enabled: false },
      {
        label: paused ? 'Resume' : 'Pause',
        click: () => {
          paused = !paused;
          enqueue(() => store.append({ ts: new Date().toISOString(), kind: paused ? 'pause' : 'resume' }));
          buildMenu();
          refreshTray();
        },
      },
      { label: "Open today's log", click: () => shell.openPath(store.dayDir()) },
      { type: 'separator' },
      { label: 'Quit Speedrun', role: 'quit' },
    ]),
  );
}

app.whenReady().then(async () => {
  app.dock?.hide();
  tray = new Tray(nativeImage.createEmpty());
  buildMenu();
  refreshTray();

  const screenAccess = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
  if (screenAccess !== 'granted') {
    console.warn(`[speedrun] Screen Recording permission is "${screenAccess}". Allow it in System Settings › Privacy & Security, then restart.`);
  }

  // Locking or sleeping counts as idle right away; the next tick with fresh input logs idle_end.
  const goIdle = () => {
    if (idle || paused) return;
    idle = true;
    enqueue(() => store.append({ ts: new Date().toISOString(), kind: 'idle_start', idleSeconds: 0 }));
  };
  powerMonitor.on('lock-screen', goIdle);
  powerMonitor.on('suspend', goIdle);

  enqueue(() => record('session_start', undefined, { screenshot: true, force: true }));
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    tick()
      .catch((err) => console.error('[speedrun]', err))
      .finally(() => (ticking = false));
  }, POLL_MS);
  setInterval(refreshTray, 1000);
});

// Menu-bar app: keep running with no windows open.
app.on('window-all-closed', () => {});
