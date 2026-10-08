import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, AppState } from './api.js';
import {
  addTasks, completeActive, formatDuration, goldSplits, liveElapsed, moveTask, newRun, parseDuration, parseQuickAdd,
  parseTaskList, pause, removeTask, resume, runElapsed, startTask, summarize, toggleDone, type Run, type Settings,
} from './runs.js';
import { RunStore } from './runStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const preload = join(here, 'preload.cjs');

const runsRoot = join(app.getPath('userData'), 'runs');
const runStore = new RunStore(runsRoot, join(app.getPath('userData'), 'settings.json'));

const OVERLAY_WIDTH = 340;
let settings: Settings;
let run: Run | null = null;
let pastRuns: Run[] = [];
/** The session you just ended, kept on the timer for its recap until you start a new one. */
let lastRun: Run | null = null;

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let dashboard: BrowserWindow | null = null;

const activeTask = () => run?.tasks.find((t) => t.id === run?.activeTaskId);

// ---------- state ----------

function state(): AppState {
  return { run, lastRun: run ? null : lastRun, settings, golds: [...goldSplits(pastRuns.filter((r) => r !== run))] };
}

function broadcast() {
  const s = state();
  for (const w of [overlay, dashboard]) if (w && !w.isDestroyed()) w.webContents.send('state', s);
  refreshTray();
}

let saveTimer: NodeJS.Timeout | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (run) void runStore.save(run).catch((err) => console.error('[speedrun] save failed', err));
  }, 300);
}

let settingsTimer: NodeJS.Timeout | undefined;
function persistSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => void runStore.saveSettings(settings), 300);
}

function ensureRun(): Run {
  if (!run) {
    run = newRun('manual');
    pastRuns = [run, ...pastRuns];
    lastRun = null;
  }
  return run;
}

/** Stops the clock, saves the run as finished and clears it; the next task you add starts a fresh run. */
async function endRun(now: number) {
  if (!run) return;
  pause(run, now);
  run.endedAt ??= new Date(now).toISOString();
  await runStore.save(run);
  lastRun = run;
  run = null;
}

async function act(a: Action) {
  const now = Date.now();
  switch (a.type) {
    case 'quickAdd': {
      const q = parseQuickAdd(a.text);
      if (q) addTasks(ensureRun(), [q.task], q.urgent);
      break;
    }
    case 'import':
      addTasks(ensureRun(), parseTaskList(a.text));
      break;
    case 'importFile': {
      const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Notes', extensions: ['md', 'txt', 'markdown', 'taskpaper'] }] });
      if (!res.canceled && res.filePaths[0]) addTasks(ensureRun(), parseTaskList(await readFile(res.filePaths[0], 'utf8')));
      break;
    }
    case 'start':
      if (run) startTask(run, a.id, now);
      break;
    case 'toggleDone':
      if (run) toggleDone(run, a.id, now);
      break;
    case 'split':
      if (run) completeActive(run, now);
      break;
    case 'togglePause':
      if (run) run.activeSince !== undefined ? pause(run, now) : resume(run, now);
      break;
    case 'remove':
      if (run) removeTask(run, a.id, now);
      break;
    case 'move':
      if (run) moveTask(run, a.id, a.beforeId);
      break;
    case 'setEstimate': {
      const t = run?.tasks.find((x) => x.id === a.id);
      if (t) t.estimateMs = a.text.trim() ? parseDuration(a.text) ?? t.estimateMs : undefined;
      break;
    }
    case 'rename': {
      const t = run?.tasks.find((x) => x.id === a.id);
      if (t && a.title.trim()) t.title = a.title.trim();
      break;
    }
    case 'settings':
      settings = { ...settings, ...a.patch };
      if (a.patch.opacity !== undefined) overlay?.setOpacity(settings.opacity);
      persistSettings();
      break;
    case 'endRun':
      await endRun(now);
      break;
    case 'moveBy':
      if (overlay && !overlay.isDestroyed()) {
        const [x, y] = overlay.getPosition();
        overlay.setPosition(Math.round(x + a.dx), Math.round(y + a.dy));
        saveOverlayPosition();
      }
      return;
    case 'fitHeight':
      if (overlay && !overlay.isDestroyed()) {
        const b = overlay.getBounds();
        const height = Math.max(40, Math.min(720, Math.ceil(a.height)));
        if (b.height !== height) overlay.setBounds({ ...b, height });
      }
      return;
    case 'openDashboard':
      openDashboard();
      return;
    case 'hideOverlay':
      overlay?.hide();
      buildMenu();
      return;
  }
  persist();
  broadcast();
}

// ---------- windows ----------

function createOverlay() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = settings.overlayBounds;
  overlay = new BrowserWindow({
    x: saved?.x ?? area.x + area.width - OVERLAY_WIDTH - 16,
    y: saved?.y ?? area.y + 12,
    width: OVERLAY_WIDTH,
    height: 96,
    // A panel floats over every app, every Space and full-screen windows, like Spotlight.
    type: 'panel',
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setOpacity(settings.opacity);
  void overlay.loadFile(join(staticDir, 'overlay.html'));
  overlay.once('ready-to-show', () => overlay?.showInactive());

  overlay.on('moved', saveOverlayPosition);
  overlay.on('closed', () => (overlay = null));
}

let boundsTimer: NodeJS.Timeout | undefined;
function saveOverlayPosition() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!overlay || overlay.isDestroyed()) return;
    settings = { ...settings, overlayBounds: overlay.getBounds() };
    persistSettings();
  }, 400);
}

function toggleOverlay() {
  if (!overlay) createOverlay();
  else if (overlay.isVisible()) overlay.hide();
  else overlay.showInactive();
  buildMenu();
}

function openDashboard() {
  if (dashboard && !dashboard.isDestroyed()) {
    dashboard.show();
    dashboard.focus();
    return;
  }
  dashboard = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    title: 'Speedrun',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    webPreferences: { preload, contextIsolation: true, sandbox: true },
  });
  void dashboard.loadFile(join(staticDir, 'dashboard.html'));
  dashboard.on('closed', () => (dashboard = null));
  app.dock?.show();
  dashboard.on('closed', () => app.dock?.hide());
}

// ---------- tray ----------

function refreshTray() {
  if (!tray) return;
  const active = activeTask();
  if (!run || !active) return tray.setTitle(run ? `⏱ ${formatDuration(runElapsed(run))}` : '⏱');
  const icon = run.activeSince !== undefined ? '⏱' : '⏸';
  tray.setTitle(`${icon} ${active.title.slice(0, 22)} ${formatDuration(liveElapsed(run, active))}`);
}

function buildMenu() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: overlay?.isVisible() ? 'Hide timer' : 'Show timer', accelerator: 'CommandOrControl+Shift+Space', click: toggleOverlay },
      { label: 'Dashboard', click: openDashboard },
      { type: 'separator' },
      { label: 'Split (finish current task)', accelerator: 'CommandOrControl+Shift+Return', click: () => void act({ type: 'split' }) },
      { label: 'End run', click: () => void act({ type: 'endRun' }) },
      { type: 'separator' },
      {
        label: 'Open at login',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      { label: 'Quit Speedrun', role: 'quit' },
    ]),
  );
}

// ---------- boot ----------

// One Speedrun at a time: a second launch just brings the timer forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!overlay) createOverlay();
  overlay?.show();
});

app.whenReady().then(async () => {
  // No Dock icon, so the panel can float over full-screen apps; the menu bar icon is the way in.
  app.dock?.hide();
  settings = await runStore.loadSettings();
  pastRuns = await runStore.list();
  const today = new Date().toLocaleDateString('sv-SE');
  const latest = pastRuns[0];
  if (latest && !latest.endedAt && new Date(latest.startedAt).toLocaleDateString('sv-SE') === today) run = latest;

  ipcMain.handle('state:get', () => state());
  ipcMain.handle('act', (_e, a: Action) => act(a));
  ipcMain.handle('runs:list', async () => {
    const runs = await runStore.list();
    if (run && !runs.some((r) => r.id === run!.id)) runs.unshift(run);
    const merged = runs.map((r) => (run && r.id === run.id ? run : r));
    return { summaries: merged.map((r) => summarize(r)), runs: merged };
  });

  const trayIcon = nativeImage.createFromPath(join(staticDir, 'icons', 'trayTemplate.png'));
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('Speedrun');
  buildMenu();
  createOverlay();

  globalShortcut.register('CommandOrControl+Shift+Return', () => void act({ type: 'split' }));
  globalShortcut.register('CommandOrControl+Shift+Space', toggleOverlay);
  globalShortcut.register('CommandOrControl+Shift+N', () => {
    if (!overlay) createOverlay();
    overlay?.show();
    overlay?.focus();
    overlay?.webContents.send('focus-add');
  });

  setInterval(refreshTray, 1000);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // Bank the running clock so time while the app is closed doesn't count.
  if (run) {
    pause(run);
    runStore.saveSync(run);
  }
});

// Menu-bar app: keep running with no windows open.
app.on('window-all-closed', () => {});

// Opening Speedrun again from Applications or Spotlight brings the timer back.
app.on('activate', () => {
  if (!overlay) createOverlay();
  else overlay.show();
  buildMenu();
});
