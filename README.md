# Speedrun

Speedrun your day. A local-first, open-source menu-bar app that times your work the way speedrunners
time a run: a session is a list of tasks, tasks can have subtasks that add up, and you race your own
estimates and your best times.

## Install

1. Download [Speedrun.dmg](https://github.com/frontier0x/Speedrun/releases/latest/download/Speedrun.dmg) (Apple Silicon)
   or [Speedrun-Intel.dmg](https://github.com/frontier0x/Speedrun/releases/latest/download/Speedrun-Intel.dmg) (Intel).
2. Open it and drag **Speedrun** into **Applications**.
3. The first time, macOS says "Speedrun" Not Opened because the app isn't notarized by Apple yet. Click
   **Done**, then go to System Settings › Privacy & Security, scroll down and click **Open Anyway**.
   Or run `xattr -dr com.apple.quarantine /Applications/Speedrun.app` once. After that it opens normally.

Speedrun shows a stopwatch icon in the menu bar and the floating timer bar (no Dock icon). It starts with
your Mac by default, so the icon is always there; untick **Open at login** in its menu to stop that.

## The timer

A small panel floats above every app, every Space and full-screen windows. It shows two things: the
task you're on and a big clock, `0:12:34.567`, in hours, minutes, seconds and milliseconds.

The clock's color tells you how you're doing: white while it runs, green while you're under your
estimate, red once you're over, grey while paused.

Under it sits the **session clock**: all the time you've spent on this session's tasks. It is green while
you're on or under your plan and red once you're behind, with the time saved or lost next to it. When you
finish the last task or click End session, the panel shows the total time you saved (or lost) against
your estimates. Type another task right there to keep the same session going (its clock starts at once);
Start a new session starts a fresh list.

The round button next to the clock starts (green) and pauses (red) the task, and stays there when the
timer is folded. The circle next to the task name finishes it and shows the next one.

Pausing stops both clocks and counts the pause; the summary shows how long you paused. The **Countdown**
switch in the open panel makes the task clock count down from your estimate, then into the red with a
minus. Settings has **Count pauses in the session** (off by default, so pauses don't add to the session
time).

Hover the timer for **–** (hide to the menu bar) and **×** (quit). Drag its bottom-right corner to make it
bigger or smaller.

**Settings** (in the open panel, or the menu bar icon) has day/night/auto mode, size, clock weight, whether
the clock shows milliseconds and seconds, and every color. Each color can be solid or a gradient; type any
hex like `#3fd68a` or `#00000080` (the last two digits are opacity), or start from a preset.

Click the clock to open the rest (drag it to move it):

- **Shortcuts**: `⌘⇧Space` is go/pause and `⌘⇧↩` is done, from any app.
- **Your list**: click a task to switch to it, drag to reorder, double-click to rename, click its
  estimate to change it. Finished tasks show their time and how far under or over the estimate they
  were, in gold if you beat your best time for that task. Estimates: pick 5m to 2h or type any time.
- **Subtasks**: hover a task and click **+**. A task with subtasks shows their total time, how many are
  done and the sum of their estimates (or its own estimate, if you give it one). While you work on a
  subtask, the folded timer shows its task's total time and what's left under the clock. Ticking the
  task ticks all its subtasks. Time saved counts the subtask estimates, or the task's own if its
  subtasks have none.
- **Add a task** one at a time (`Write copy 30m` sets a 30-minute estimate, a leading `!` puts it on
  top), or **Paste a list**: bullets, checkboxes, `#` headings and indentation become tasks and
  sections, and `30m`, `~30m`, `(1h)` or `[45m]` become estimates.
- **End session** saves it and shows what you saved; the next task you add starts a fresh session.

Speedrun doesn't watch your screen, read your apps or send anything anywhere. It's just a timer, and it
needs no macOS permissions.

## Templates and racing your best

**Templates** are task lists you run again and again, like a morning routine or inbox zero. Save a session
as a template from its summary ("Save as template") or from Stats, or write one in Stats under Templates
(one task per line, indent for subtasks, `15m` for an estimate). When your list is empty, your templates
show up as buttons above the add field; one click loads one. They're also in the menu bar menu.

Every session you start from a template is an **attempt**. A finished one (every task done) is a **run**,
and your fastest run is the one to beat. Ending a template session shows **Run complete** with its time,
whether it's a new best (gold) or how far off it was, and where it ranks.

**Reset** (next to End session, for template sessions) is what speedrunners do when a run starts badly:
the attempt is kept as a reset and the template starts over at 0:00. A reset counts as an attempt, not a
run, so it doesn't drag down your times or your estimate stats; the time you worked still counts as time
on tasks.

**Race your best** (Settings › Timer, off by default) adds a line under the clock with your best time for
the task you're on and how far ahead or behind you are, live. Template tasks compare exactly, even after
you rename or reorder the template. Other tasks compare by name, ignoring case, estimates, dates, numbers,
weekdays and little words, so "Emails 9.10." matches "emails". Times under a third of the estimate (ticked
off by mistake) don't count, and clicking the line tells Speedrun two tasks aren't the same. For
templates, the session line shows how far ahead of or behind your fastest run you are.

**The moments**: a short 3 · 2 · 1 · Go before a session's clock starts (Esc skips it), the result of each
task flashing under the clock when you finish it (gold with a sweep on a new best), and a small sound for
each, a new best and the end of a run. Countdown and sounds can be turned off in Settings › Timer, which
also sets the volume.

## Fixing things up

- **Pick a task back up**: click a finished task and its clock runs on from where it stopped. Click the
  current task while paused to carry on.
- **Correct a time**: forgot to start or pause? Click a task's time in the list and type the right one,
  e.g. `12:30`, `1:02:03` or `25m`. A running task keeps running from there.

## Stats

Open it from the timer (Stats) or the menu bar. It looks like the timer and shows time on tasks today
or this week, time spent in pauses, time saved or lost against your plan, tasks done and your streak,
plus each of the last 7 days with tasks and pauses stacked. Below that are your sessions: click one to
see its tasks and subtasks with times and estimates, and click its name to rename it.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘⇧Space` | Go / Pause, from any app |
| `⌘⇧↩` | Done: finish the current task, start the next |
| `⌘⇧N` | Add a task |
| `⌥⇧⌘Space` | Show or hide the timer |

## Run it

Requires Node 20+ on macOS.

```sh
npm install
npm start
```

## Your data

Everything stays on your Mac in `~/Library/Application Support/speedrun/`:

- `runs/YYYY-MM-DD/run-*.json`: your sessions
- `templates.json`: your templates
- `settings.json`: color, opacity and timer position

## Roadmap

1. ✅ Floating timer, task import, estimates, dashboard
2. ✅ Packaged Speedrun.app / .dmg
3. Daily recap

## Tests and builds

```sh
npm test       # unit tests
npm run dist   # builds release/Speedrun-*.dmg locally
```

Running the Release workflow on GitHub (Actions tab), or pushing a tag like `v0.3.0`, builds the .dmg files and publishes them as a release.

## License

MIT
