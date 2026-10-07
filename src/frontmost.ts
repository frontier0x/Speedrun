import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Frontmost } from './focus.js';

/**
 * Reads the frontmost app once a second without Screen Recording or Accessibility: NSWorkspace needs no
 * permission. For supported browsers it also asks the browser for its active tab over AppleScript, which
 * macOS gates behind a one-time "Speedrun wants to control Chrome" prompt instead of a trip to Settings.
 * One long-lived osascript process does the polling, so we don't spawn a process per second.
 */
const SCRIPT = String.raw`
ObjC.import('AppKit');
const ws = $.NSWorkspace.sharedWorkspace;
const out = $.NSFileHandle.fileHandleWithStandardOutput;
const CHROMIUM = ['com.google.Chrome', 'com.brave.Browser', 'com.microsoft.edgemac', 'company.thebrowser.Browser', 'com.vivaldi.Vivaldi', 'com.operasoftware.Opera'];
function tab(id) {
  try {
    const w = Application(id).windows[0];
    if (id === 'com.apple.Safari') { const t = w.currentTab(); return { url: t.url(), title: t.name() }; }
    if (CHROMIUM.includes(id)) { const t = w.activeTab(); return { url: t.url(), title: t.title() }; }
  } catch (e) {
    return { browserError: String(e) };
  }
  return {};
}
while (true) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(1));
  const a = ws.frontmostApplication;
  if (!a || !a.localizedName) continue;
  const id = ObjC.unwrap(a.bundleIdentifier) || '';
  const sample = Object.assign({ app: ObjC.unwrap(a.localizedName), bundleId: id }, tab(id));
  out.writeData($(JSON.stringify(sample) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
`;

export interface Sample extends Frontmost {
  /** The browser refused (usually the Automation prompt was declined). */
  browserError?: string;
}

export class FrontmostWatcher {
  private proc: ChildProcess | null = null;
  private stopped = true;

  constructor(private readonly onSample: (s: Sample) => void) {}

  get running() {
    return !this.stopped;
  }

  start() {
    if (!this.stopped || process.platform !== 'darwin') return;
    this.stopped = false;
    this.spawn();
  }

  stop() {
    this.stopped = true;
    this.proc?.kill();
    this.proc = null;
  }

  private spawn() {
    const proc = spawn('osascript', ['-l', 'JavaScript', '-e', SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    createInterface({ input: proc.stdout! }).on('line', (line) => {
      try {
        const s = JSON.parse(line) as Sample;
        // Some apps pad their name with invisible direction marks (WhatsApp does).
        s.app = s.app.replace(/[‎‏]/g, '').trim();
        this.onSample(s);
      } catch {
        // ignore partial lines
      }
    });
    proc.stderr!.on('data', (d) => console.error('[speedrun] focus watcher:', String(d).trim()));
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      if (!this.stopped) setTimeout(() => !this.stopped && !this.proc && this.spawn(), 3000);
    });
  }
}
