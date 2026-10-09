# Speedrun

Speedrun your day. A local-first, open-source menu-bar app that times your work the way speedrunners
time a run: tasks are splits, sections roll up their splits, and you race your own estimates and your
best times.

## Install

1. Download [Speedrun.dmg](https://github.com/frontier0x/Speedrun/releases/latest/download/Speedrun.dmg) (Apple Silicon)
   or [Speedrun-Intel.dmg](https://github.com/frontier0x/Speedrun/releases/latest/download/Speedrun-Intel.dmg) (Intel).
2. Open it and drag **Speedrun** into **Applications**.
3. The first time, macOS says "Speedrun" Not Opened because the app isn't notarized by Apple yet. Click
   **Done**, then go to System Settings › Privacy & Security, scroll down and click **Open Anyway**.
   Or run `xattr -dr com.apple.quarantine /Applications/Speedrun.app` once. After that it opens normally.

Speedrun shows a stopwatch icon in the menu bar and the floating timer bar (no Dock icon). Tick **Open at login** in the
menu bar menu to have it start with your Mac.

## The timer

A small panel floats above every app, every Space and full-screen windows. It shows the task you're on
and a big clock, `0:12:34.567`, in hours, minutes, seconds and milliseconds. Beside the clock is a round
**play** button (green, `⌘⇧Space`) that turns into a red **pause** button while the clock runs; beside the
task's name is a **circle**: click it when the task is done and the next one starts (`⌘⇧↩`). Both stay
there when the panel is folded away.

The clock's color tells you how you're doing: white while it runs, green while you're under your
estimate, red once you're over, grey while paused.

Under it sits the **session clock**: all the time you've spent on this session's tasks. It is green while
you're on or under your plan and red once you're behind, with the time saved or lost next to it. When you
finish the last task or click End session, the panel shows the total time you saved (or lost) against
your estimates. **Continue with next task** takes you back into the same session to add more, or start a
fresh one.

Pausing stops both clocks and counts the pause; the summary shows how long you paused. **Countdown** is a
switch right under the clock when the panel is open: the task clock counts down from your estimate, then
into the red with a minus. **Count pauses in the session** in Settings is off by default, so pauses don't
add to the session time.

Hover the timer for **–** (hide to the menu bar) and **×** (quit). Drag its bottom-right corner to make it
bigger or smaller.

**Settings** (in the open panel, or the menu bar icon) has day/night/auto mode, size, clock weight, whether
the clock shows milliseconds and seconds, and every color. Each color can be solid or a gradient; type any
hex like `#3fd68a` or `#00000080` (the last two digits are opacity), or start from a preset.

Click the clock to open the rest (drag it to move it):

- How much of the estimate is **left**, or how far **over** you are, and the **Countdown** switch.
- **Your list**: click a task to switch to it, drag to reorder, double-click to rename, click its
  estimate to pick 5m, 10m, 15m, 25m, 45m, 1h, 1h30m or 2h or type any time. Finished tasks show their time and how far under or over the estimate they
  were, in gold if you beat your best time for that task.
- **Add a task** one at a time (`Write copy 30m` sets a 30-minute estimate, a leading `!` puts it on
  top), or **Paste a list**: bullets, checkboxes, `#` headings and indentation become tasks and
  sections, and `30m`, `~30m`, `(1h)` or `[45m]` become estimates.
- **End session** stops the clock and shows what you saved.

### Subtasks

Hover a task and press **+** to split it into subtasks (or indent them in a pasted list). The clock moves
through them in order, and the task above them becomes their parent:

- Its time is everything spent on it and its subtasks; its estimate is its own if you set one, or else the
  sum of the subtasks' estimates. The list shows both, and how many subtasks are done (`2/4`).
- While you're on a subtask, the panel shows the path (`Landing page › Hero`) and, under the clock, the
  parent's total against its estimate and how many subtasks are done.
- Time saved counts each subtask against its own estimate. If only the parent has an estimate, the whole
  task is measured against that once all its subtasks are done.
- Click a parent to work on its next open subtask. Removing a parent removes its subtasks.

Speedrun doesn't watch your screen, read your apps or send anything anywhere. It's just a timer, and it
needs no macOS permissions.

## Fixing things up

- **Pick a task back up**: click a finished task and its clock runs on from where it stopped. Click the
  current task while paused to carry on.
- **Correct a time**: forgot to start or pause? Click a task's time in the list and type the right one,
  e.g. `12:30`, `1:02:03` or `25m`. A running task keeps running from there.

## Dashboard

Open it from the timer (Stats) or the menu bar. It shows every previous run with its splits, estimates vs
actuals, best times and sum of best, plus tracked time over the last 14 days, estimate accuracy and
your streak.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘⇧Space` | Go / Pause, from any app |
| `⌘⇧↩` | Split: finish the current task, start the next |
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

- `runs/YYYY-MM-DD/run-*.json`: your task runs
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
