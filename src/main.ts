import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, systemPreferences, Tray } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, Activity, AppState } from './api.js';
import { Capture } from './capture.js';
import {
  addTasks, completeActive, formatDuration, goldSplits, liveElapsed, moveTask, newRun, parseDuration, parseQuickAdd,
  parseTaskList, pause, removeTask, resume, runElapsed, startTask, summarize, toggleDone, type Run, type Settings,
} from './runs.js';
import { RunStore } from './runStore.js';
import { DayStore } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const staticDir = join(here, '..', 'static');
const preload = join(here, 'preload.cjs');

const runsRoot = join(app.getPath('userData'), 'runs');
const dayStore = new DayStore(runsRoot);
const runStore = new RunStore(runsRoot, join(app.getPath('userData'), 'settings.json'));

let settings: Settings;
let run: Run | null = null;
let pastRuns: Run[] = [];
let activity: Activity | null = null;
let idle = false;

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let dashboard: BrowserWindow | null = null;

const capture = new Capture(dayStore, {
  onActivity: (w, since) => {
    activity = { app: w.app, title: w.title, since };
    broadcast();
  },
  onIdle: (v) => {
    idle = v;
    broadcast();
  },
});

// ---------- state ----------

function state(): AppState {
  return { run, settings, golds: [...goldSplits(pastRuns)], activity, idle };
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
    run = newRun(settings.mode);
    pastRuns = [run, ...pastRuns];
  }
  return run;
}

function applyMode() {
  if (settings.mode === 'auto') capture.start();
  else capture.stop();
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
    case 'setMode':
      settings = { ...settings, mode: a.mode };
      if (run) run.mode = a.mode;
      applyMode();
      persistSettings();
      break;
    case 'newRun':
      if (run) {
        pause(run, now);
        run.endedAt ??= new Date(now).toISOString();
        await runStore.save(run);
      }
      run = null;
      ensureRun();
      break;
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
  const b = settings.overlayBounds ?? { width: 320, height: 420, x: area.x + area.width - 340, y: area.y + 20 };
  overlay = new BrowserWindow({
    ...b,
    minWidth: 220,
    minHeight: 72,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    fullscreenable: false,
    show: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true },
  });
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setOpacity(settings.opacity);
  void overlay.loadFile(join(staticDir, 'overlay.html'));
  overlay.once('ready-to-show', () => overlay?.showInactive());

  let boundsTimer: NodeJS.Timeout | undefined;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!overlay || overlay.isDestroyed()) return;
      settings = { ...settings, overlayBounds: overlay.getBounds() };
      persistSettings();
    }, 400);
  };
  overlay.on('moved', saveBounds);
  overlay.on('resized', saveBounds);
  overlay.on('closed', () => (overlay = null));
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
    backgroundColor: '#0d0d12',
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
  if (idle && settings.mode === 'auto') return tray.setTitle('💤 idle');
  if (settings.mode === 'auto') {
    const name = (activity?.app ?? '…').slice(0, 18);
    return tray.setTitle(`◉ ${name} ${activity ? formatDuration(Date.now() - activity.since) : ''}`);
  }
  const active = run?.tasks.find((t) => t.id === run?.activeTaskId);
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
      { label: 'Manual (task list)', type: 'radio', checked: settings.mode === 'manual', click: () => void act({ type: 'setMode', mode: 'manual' }) },
      { label: 'AutoCapture', type: 'radio', checked: settings.mode === 'auto', click: () => void act({ type: 'setMode', mode: 'auto' }) },
      { type: 'separator' },
      { label: 'Split (finish current task)', accelerator: 'CommandOrControl+Shift+Return', click: () => void act({ type: 'split' }) },
      { label: 'Start new run', click: () => void act({ type: 'newRun' }) },
      { label: "Open today's capture log", click: () => void shell.openPath(dayStore.dayDir()) },
      { type: 'separator' },
      { label: 'Quit Speedrun', role: 'quit' },
    ]),
  );
}

// ---------- boot ----------

app.whenReady().then(async () => {
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

  tray = new Tray(nativeImage.createEmpty());
  buildMenu();
  createOverlay();
  applyMode();

  if (process.platform === 'darwin' && settings.mode === 'auto') {
    const screenAccess = systemPreferences.getMediaAccessStatus('screen');
    if (screenAccess !== 'granted') {
      console.warn(`[speedrun] Screen Recording permission is "${screenAccess}". Allow it in System Settings › Privacy & Security, then restart.`);
    }
  }

  powerMonitor.on('lock-screen', () => capture.goIdle());
  powerMonitor.on('suspend', () => capture.goIdle());

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
