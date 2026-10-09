import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, Tray } from 'electron';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action, AppState } from './api.js';
import {
  addSubtask, addTasks, bestFor, bestIndex, clampScale, completeActive, endPause, formatDuration, formatEstimate, goldSplits, isSection, liveElapsed, matchKey,
  indentTask, moveTask, newRun, outdentTask, nextTask, pairKey, parseDuration, parseQuickAdd, parseTaskList, parseTimeInput, pause, pausedTotal, reopenTask, runFromTemplate, setElapsed,
  removeTask, runElapsed, startTask, summarize, templateFromRun, templateFromText, templateRecord, toggleDone, type Best, type Run, type Settings,
  type Template,
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
let templates: Template[] = [];
/** "3, 2, 1, Go": the task that starts, and when. */
let countIn: { taskId: string; until: number; timer: NodeJS.Timeout } | null = null;

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let dashboard: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let drag: { mode: 'move' | 'resize'; cursor: Electron.Point; bounds: Electron.Rectangle; scale: number } | null = null;

const activeTask = () => run?.tasks.find((t) => t.id === run?.activeTaskId);

// ---------- state ----------

function state(): AppState {
  const live = run ?? finished;
  const others = pastRuns.filter((r) => r.id !== live?.id);
  return {
    run,
    finished,
    settings,
    golds: [...goldSplits(pastRuns.filter((r) => r !== run))],
    totals: totals(),
    templates,
    bests: live && settings.race ? bests(live, others) : {},
    record: live ? record(live, others) : undefined,
    suggestions: suggestions(),
    countInUntil: countIn?.until,
  };
}

/** Your best time for each task of a session, from the sessions before it. */
function bests(r: Run, others: Run[]): Record<string, Best> {
  const index = bestIndex(others);
  const out: Record<string, Best> = {};
  for (const t of r.tasks) {
    if (isSection(r, t)) continue;
    const b = bestFor(t, r, others, index, settings.notSame);
    if (b) out[t.id] = b;
  }
  return out;
}

/** For a session from a template: its PB and records, and where this attempt ranks once finished. */
function record(r: Run, others: Run[]): AppState['record'] {
  const tpl = templates.find((t) => t.id === r.templateId);
  if (!tpl) return undefined;
  const before = templateRecord(tpl, others);
  const withThis = templateRecord(tpl, [...others, r]);
  const rank = withThis.finishedMs.findIndex((f) => f.runId === r.id);
  return { ...before, attempts: withThis.attempts, resets: withThis.resets, name: tpl.name, rank: rank >= 0 ? rank + 1 : undefined, prevPbMs: before.pb?.ms };
}

/** Task names you've used, newest first, each with its last estimate. */
function suggestions(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of pastRuns)
    for (const t of [...r.tasks].reverse()) {
      const k = t.title.toLowerCase();
      if (seen.has(k) || isSection(r, t)) continue;
      seen.add(k);
      out.push(t.title + (t.estimateMs !== undefined ? ' ' + formatEstimate(t.estimateMs).replace(' ', '') : ''));
      if (out.length >= 300) return out;
    }
  return out;
}

function persistTemplates() {
  void runStore.saveTemplates(templates).catch((err) => console.error('[speedrun] saving templates failed', err));
  buildMenu();
}

/** Starts the clock on a task, with "3, 2, 1, Go" first when it's the session's very first start. */
function go(r: Run, taskId: string, now: number) {
  if (settings.countIn && runElapsed(r, now) === 0 && r.activeSince === undefined && !countIn) {
    const until = now + 2000;
    countIn = { taskId, until, timer: setTimeout(() => void act({ type: 'skipCountIn' }), 2000) };
    return;
  }
  startTask(r, taskId, now);
}

/** Ends "3, 2, 1, Go" and starts the clock, from when Go was meant to be (or now, if you skipped it). */
function finishCountIn(now: number) {
  if (!countIn) return;
  clearTimeout(countIn.timer);
  const { taskId, until } = countIn;
  countIn = null;
  if (run?.tasks.some((t) => t.id === taskId)) startTask(run, taskId, Math.min(now, until));
}

/** A new session from a template. A session with tasks in it ends first. */
async function startTemplate(id: string, now: number) {
  const tpl = templates.find((t) => t.id === id);
  if (!tpl) return;
  if (run?.tasks.length) await endRun(now);
  if (run) pastRuns = pastRuns.filter((r) => r !== run);
  finished = null;
  run = runFromTemplate(tpl, new Date(now));
  pastRuns = [run, ...pastRuns];
}

/** Time on tasks and in pauses today and over the last 7 days, by the day each session started. */
function totals(now = Date.now()): AppState['totals'] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const weekStart = today.getTime() - 6 * 86_400_000;
  const all = [run, finished, ...pastRuns].filter((r, i, a): r is Run => !!r && a.findIndex((x) => x?.id === r.id) === i);
  const t = { todayMs: 0, todayPausedMs: 0, weekMs: 0, weekPausedMs: 0 };
  for (const r of all) {
    const started = new Date(r.startedAt).getTime();
    if (started < weekStart) continue;
    const ms = runElapsed(r, now);
    const paused = pausedTotal(r, now);
    t.weekMs += ms;
    t.weekPausedMs += paused;
    if (started >= today.getTime()) {
      t.todayMs += ms;
      t.todayPausedMs += paused;
    }
  }
  return t;
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
  if (countIn) (clearTimeout(countIn.timer), (countIn = null));
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
      if (!q) break;
      const r = ensureRun();
      // Tabbed in: a subtask of the last task in the list.
      const parent = a.subtask ? r.tasks.filter((t) => !t.parentId).at(-1) : undefined;
      if (parent) addSubtask(r, parent.id, q.task, now);
      else addTasks(r, [q.task], q.urgent);
      break;
    }
    case 'indent':
      if (run) indentTask(run, a.id, now);
      break;
    case 'outdent':
      if (run) outdentTask(run, a.id);
      break;
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
    case 'continueWith': {
      // From the summary: the session carries on with a new task, on the clock right away.
      const q = parseQuickAdd(a.text);
      if (!q) break;
      if (finished) {
        run = finished;
        run.endedAt = undefined;
        finished = null;
      }
      addTasks(ensureRun(), [q.task]);
      startTask(run!, q.task.id, now);
      break;
    }
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
    case 'saveTemplate': {
      // From the end of a session: its tasks become a template, or update the one it came from.
      const src = finished ?? run;
      if (!src?.tasks.length) break;
      const existing = templates.find((t) => t.id === src.templateId);
      const tpl = templateFromRun(src, a.name, existing);
      templates = existing ? templates.map((t) => (t.id === tpl.id ? tpl : t)) : [...templates, tpl];
      if (!existing) {
        // This session is now the first attempt of its template.
        const ids = new Map(src.tasks.map((t, i) => [t.id, tpl.tasks[i].id]));
        src.templateId = tpl.id;
        for (const t of src.tasks) t.templateTaskId = ids.get(t.id);
        if (finished) await runStore.save(finished);
      }
      persistTemplates();
      break;
    }
    case 'importTemplate': {
      const tasks = parseTaskList(a.text);
      if (!tasks.length) break;
      const tpl = templateFromRun({ ...newRun('manual'), tasks }, a.name || 'Template');
      templates = [...templates, tpl];
      persistTemplates();
      break;
    }
    case 'startTemplate':
      await startTemplate(a.id, now);
      break;
    case 'renameTemplate': {
      const name = a.name.trim();
      if (name) templates = templates.map((t) => (t.id === a.id ? { ...t, name } : t));
      persistTemplates();
      break;
    }
    case 'editTemplate':
      templates = templates.map((t) => (t.id === a.id ? templateFromText(t, a.text) : t));
      persistTemplates();
      break;
    case 'deleteTemplate':
      // Its past sessions stay, as plain sessions.
      templates = templates.filter((t) => t.id !== a.id);
      persistTemplates();
      break;
    case 'resetRun': {
      // A bad start: this attempt is kept for your totals but never counts as a run, and the route starts over.
      if (!run?.templateId) break;
      const tpl = templates.find((t) => t.id === run!.templateId);
      if (countIn) (clearTimeout(countIn.timer), (countIn = null));
      pause(run, now);
      run.pausedSince = undefined;
      run.reset = true;
      run.endedAt = new Date(now).toISOString();
      await runStore.save(run);
      run = tpl ? runFromTemplate(tpl, new Date(now + 1)) : null;
      if (run) pastRuns = [run, ...pastRuns];
      break;
    }
    case 'notSame': {
      const t = run?.tasks.find((x) => x.id === a.taskId) ?? finished?.tasks.find((x) => x.id === a.taskId);
      const b = t && (run ?? finished) ? state().bests[t.id] : undefined;
      if (t && b?.fuzzy) settings = { ...settings, notSame: [...settings.notSame, pairKey(matchKey(t.title), b.key)] };
      persistSettings();
      break;
    }
    case 'skipCountIn':
      finishCountIn(now);
      break;
    case 'copyResult':
      // The finish screen as a picture, ready to paste anywhere.
      if (overlay && !overlay.isDestroyed()) {
        const z = settings.scale;
        const r = a.rect;
        const img = await overlay.webContents.capturePage({ x: Math.floor(r.x * z), y: Math.floor(r.y * z), width: Math.ceil(r.width * z), height: Math.ceil(r.height * z) });
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(img.toPNG())], { type: 'image/png' }) })]);
      }
      return;
    case 'importFile': {
      const res = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Notes', extensions: ['md', 'txt', 'markdown', 'taskpaper'] }] });
      if (!res.canceled && res.filePaths[0]) addTasks(ensureRun(), parseTaskList(await readFile(res.filePaths[0], 'utf8')));
      break;
    }
    case 'start':
      if (run) go(run, a.id, now);
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
      if (countIn) finishCountIn(now);
      else if (run && run.activeSince !== undefined) pause(run, now);
      else if (run) {
        const next = run.tasks.find((t) => t.id === run!.activeTaskId) ?? nextTask(run);
        if (next) go(run, next.id, now);
      }
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
    width: 480,
    height: 780,
    minWidth: 380,
    minHeight: 480,
    title: 'Speedrun Stats',
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
    height: 540,
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
      {
        label: 'Start template',
        submenu: templates.length
          ? templates.map((t) => ({ label: t.name, click: () => void act({ type: 'startTemplate', id: t.id }) }))
          : [{ label: 'No templates yet: save one at the end of a session', enabled: false }],
      },
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
  // Installed means it's in the menu bar: start at login, once, by default. The menu bar icon's
  // "Open at login" turns it off again.
  if (!settings.loginItemSet && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
    settings = { ...settings, loginItemSet: true };
    persistSettings();
  }
  settings.scale = clampScale(settings.scale);
  nativeTheme.themeSource = settings.theme;
  pastRuns = await runStore.list();
  templates = await runStore.loadTemplates();
  const today = new Date().toLocaleDateString('sv-SE');
  const latest = pastRuns[0];
  if (latest && !latest.endedAt && new Date(latest.startedAt).toLocaleDateString('sv-SE') === today) run = latest;

  ipcMain.handle('state:get', () => state());
  ipcMain.handle('act', (_e, a: Action) => act(a));
  ipcMain.handle('runs:list', async () => {
    const runs = await runStore.list();
    if (run && !runs.some((r) => r.id === run!.id)) runs.unshift(run);
    const merged = runs.map((r) => (run && r.id === run.id ? run : r));
    const records = Object.fromEntries(templates.map((t) => [t.id, templateRecord(t, merged)]));
    return { summaries: merged.map((r) => summarize(r)), runs: merged, records };
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
