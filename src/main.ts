import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, Tray } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, AppState } from './api.js';
import {
  addSubtask, addTasks, clampScale, completeActive, endPause, formatDuration, goldSplits, liveElapsed, moveTask, newRun, parseDuration, parseQuickAdd,
  parseTaskList, parseTimeInput, pause, reopenTask, setElapsed, removeTask, resume, runElapsed, startTask, summarize, toggleDone, type Run, type Settings,
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
let finished: Run | null = null;
let pastRuns: Run[] = [];

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let dashboard: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let drag: { mode: 'move' | 'resize'; cursor: Electron.Point; bounds: Electron.Rectangle; scale: number } | null = null;

const activeTask = () => run?.tasks.find((t) => t.id === run?.activeTaskId);

// ---------- state ----------

function state(): AppState {
  return { run, finished, settings, golds: [...goldSplits(pastRuns.filter((r) => r !== run))] };
}

function broadcast() {
  const s = state();
  for (const w of [overlay, dashboard, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send('state', s);
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
    finished = null;
    run = newRun('manual');
    pastRuns = [run, ...pastRuns];
  }
  return run;
}

/** Stops the clock, saves the run as finished and clears it; the next task you add starts a fresh run. */
async function endRun(now: number) {
  if (!run) return;
  pause(run, now);
  // A pause still going when you end the session is the time after it, not a break in it.
  run.pausedSince = undefined;
  run.endedAt ??= new Date(now).toISOString();
  await runStore.save(run);
  finished = run.tasks.length ? run : null;
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
    case 'addSubtask': {
      const q = parseQuickAdd(a.text);
      if (run && q) addSubtask(run, a.parentId, q.task, now);
      break;
    }
    case 'resumeSession':
      // Ended too soon: the same session carries on, with its clock paused until you pick a task.
      if (finished) {
        run = finished;
        run.endedAt = undefined;
        finished = null;
      }
      break;
    case 'renameRun': {
      // The live session renames in place; a past one is renamed on disk.
      const name = a.name.trim();
      if (!name) break;
      if (run?.id === a.id) run.name = name;
      else {
        const past = (await runStore.list()).find((r) => r.id === a.id);
        if (!past) break;
        past.name = name;
        await runStore.save(past);
        pastRuns = pastRuns.map((r) => (r.id === a.id ? past : r));
        if (finished?.id === a.id) finished.name = name;
      }
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
    case 'reopen':
      if (run) reopenTask(run, a.id, now);
      break;
    case 'setTime': {
      const ms = parseTimeInput(a.text);
      if (run && ms !== undefined) setElapsed(run, a.id, ms, now);
      break;
    }
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
      if (a.patch.scale !== undefined) settings.scale = clampScale(a.patch.scale);
      if (a.patch.scale !== undefined) overlay?.webContents.setZoomFactor(settings.scale);
      if (a.patch.theme !== undefined) nativeTheme.themeSource = settings.theme;
      persistSettings();
      break;
    case 'endRun':
      await endRun(now);
      break;
    case 'dismissSummary':
      finished = null;
      break;
    // Dragging reads the cursor here, in screen pixels, so it works at any zoom.
    case 'dragStart':
      if (overlay && !overlay.isDestroyed())
        drag = { mode: a.mode, cursor: screen.getCursorScreenPoint(), bounds: overlay.getBounds(), scale: settings.scale };
      return;
    case 'dragMove': {
      if (!drag || !overlay || overlay.isDestroyed()) return;
      const p = screen.getCursorScreenPoint();
      const dx = p.x - drag.cursor.x;
      const dy = p.y - drag.cursor.y;
      if (drag.mode === 'move') overlay.setPosition(Math.round(drag.bounds.x + dx), Math.round(drag.bounds.y + dy));
      else {
        const scale = clampScale((drag.scale * (drag.bounds.width + dx)) / drag.bounds.width);
        if (scale !== settings.scale) {
          settings = { ...settings, scale };
          overlay.webContents.setZoomFactor(scale);
        }
      }
      return;
    }
    case 'dragEnd':
      if (drag?.mode === 'resize') persistSettings();
      else saveOverlayPosition();
      drag = null;
      break;
    case 'fitSize':
      // The overlay reports its size in CSS pixels; the window is that times the zoom.
      if (overlay && !overlay.isDestroyed()) {
        const b = overlay.getBounds();
        const width = Math.max(80, Math.min(1200, Math.ceil(a.width * settings.scale)));
        const height = Math.max(40, Math.min(1400, Math.ceil(a.height * settings.scale)));
        // Grow toward the middle of the screen, so a timer parked on the right edge stays on screen.
        const area = screen.getDisplayMatching(b).workArea;
        const x = drag?.mode !== 'resize' && b.x + b.width / 2 > area.x + area.width / 2 ? b.x + b.width - width : b.x;
        if (b.width !== width || b.height !== height) overlay.setBounds({ x, y: b.y, width, height });
      }
      return;
    case 'openSettings':
      openSettings();
      return;
    case 'quit':
      app.quit();
      return;
    case 'openDashboard':
      openDashboard();
      return;
    case 'hideOverlay':
      overlay?.hide();
      buildMenu();
      return;
  }
  // Finishing the last task ends the session and shows what you saved.
  if (run?.endedAt) await endRun(now);
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
  overlay.webContents.on('did-finish-load', () => overlay?.webContents.setZoomFactor(settings.scale));
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#fbfbf8',
    webPreferences: { preload, contextIsolation: true, sandbox: true },
  });
  void dashboard.loadFile(join(staticDir, 'dashboard.html'));
  dashboard.on('closed', () => (dashboard = null));
  app.dock?.show();
  dashboard.on('closed', hideDockIfNoWindows);
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 340,
    height: 470,
    minWidth: 320,
    minHeight: 360,
    maximizable: false,
    fullscreenable: false,
    title: 'Speedrun Settings',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#f6f6f4',
    webPreferences: { preload, contextIsolation: true, sandbox: true },
  });
  void settingsWin.loadFile(join(staticDir, 'settings.html'));
  settingsWin.on('closed', () => (settingsWin = null));
  app.dock?.show();
  settingsWin.on('closed', hideDockIfNoWindows);
}

/** The Dock icon shows only while a regular window (Stats, Settings) is open. */
function hideDockIfNoWindows() {
  setTimeout(() => {
    const open = [dashboard, settingsWin].some((w) => w && !w.isDestroyed());
    if (!open) app.dock?.hide();
  }, 0);
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
      { label: overlay?.isVisible() ? 'Hide timer' : 'Show timer', accelerator: 'CommandOrControl+Alt+Shift+Space', click: toggleOverlay },
      { label: 'Stats', click: openDashboard },
      { label: 'Settings…', click: openSettings },
      { type: 'separator' },
      { label: 'Done (finish task, start the next)', accelerator: 'CommandOrControl+Shift+Return', click: () => void act({ type: 'split' }) },
      { label: 'End session', click: () => void act({ type: 'endRun' }) },
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
  settings.scale = clampScale(settings.scale);
  nativeTheme.themeSource = settings.theme;
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
  // Space is play/pause everywhere; with ⌘⇧ it works from any app. Starts the next task if none is running.
  globalShortcut.register('CommandOrControl+Shift+Space', () => void act({ type: 'togglePause' }));
  globalShortcut.register('CommandOrControl+Alt+Shift+Space', toggleOverlay);
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
    // Count a pause up to now, but not the time the app is closed (e.g. overnight).
    endPause(run);
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
