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
New session starts a fresh list.

The round button next to the clock starts (green) and pauses (red) the task; it shows when the timer
is open. The circle next to the task name finishes it and shows the next one.

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

## Racing

- **Templates**: at the end of a session, click **Save as template** and name it ("Morning routine"), or
  paste a list and click **Save as template**. With an empty list, your templates show as buttons above
  the add field; the menu bar icon has **Start template** too. Stats lists them with your best run, what's
  possible (your best time for every task, added up) and the tasks to edit as text.
- **Reset**: in a session from a template, the round arrow next to the play button (click twice) throws a
  bad attempt away and starts the route again from 0:00. The attempt counts in your daily totals, never
  against your best.
- **Race your best** (Settings › Timer, off by default): each task runs against your best time for it. In a
  template that's the same task of your earlier runs, even renamed. Otherwise it's a task with the same or a
  similar name, ignoring dates, numbers, weekdays and estimates ("Emails 9.10." is "emails"), worked out on
  your Mac with no AI. The clock turns green or red against that best, the open timer shows `Best 3:00 · 0:59
  left` and, in a template, how you're doing against your fastest run. Click a similar-name match to say it's
  not the same task. As you type a task, Speedrun suggests names you've used before, so they match.
- **Finishing**: ticking a task off shows its result for a moment where the task name is, in gold with a
  shine for a new best. A template run all the way through ends with your time, **★ NEW PB**, where it ranks
  among your attempts, and a medal per task: gold for a new best, silver under the estimate, bronze up to
  10 % over. **Copy** puts the result on the clipboard as a picture.
- **3, 2, 1, Go** before the first task of a session, short **sounds** (with a volume) and a bold italic
  **Speedrun** clock style (Settings › Look) round it off. Each can be switched off.

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
