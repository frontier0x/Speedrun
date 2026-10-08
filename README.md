# Speedrun

Speedrun your day. A local-first, open-source menu-bar app that times your work the way speedrunners
time a run: tasks are splits, sections roll up their splits, and you race your own estimates and your
best times.

## Install

1. Download the latest `Speedrun-…-arm64.dmg` (Apple Silicon) or `Speedrun-….dmg` (Intel) from
   [Releases](https://github.com/frontier0x/speedrun/releases/latest).
2. Open it and drag **Speedrun** into **Applications**.
3. The first time, macOS says "Speedrun" Not Opened because the app isn't notarized by Apple yet. Click
   **Done**, then go to System Settings › Privacy & Security, scroll down and click **Open Anyway**.
   Or run `xattr -dr com.apple.quarantine /Applications/Speedrun.app` once. After that it opens normally.

Speedrun shows a stopwatch icon in the menu bar and the floating timer bar (no Dock icon). Tick **Open at login** in the
menu bar menu to have it start with your Mac.

## The timer

A small panel floats above every app, every Space and full-screen windows. It shows two things: the
task you're on and a big clock, `0:12:34.567`, in hours, minutes, seconds and milliseconds.

The clock's color tells you how you're doing: white while it runs, green while you're under your
estimate, red once you're over, grey while paused.

Click the clock to open the rest (drag it to move it):

- **Estimate**: pick 5m, 10m, 15m, 25m, 45m, 1h, 1h30m or 2h, or type any time. The panel shows how much
  is left or how far over you are.
- **Start / Pause** and **Done**. Done (`⌘⇧↩`) finishes the task and starts the next one.
- **Your list**: click a task to switch to it, drag to reorder, double-click to rename, click its
  estimate to change it. Finished tasks show their time and how far under or over the estimate they
  were, in gold if you beat your best time for that task.
- **Add a task** one at a time (`Write copy 30m` sets a 30-minute estimate, a leading `!` puts it on
  top), or **Paste a list**: bullets, checkboxes, `#` headings and indentation become tasks and
  sections, and `30m`, `~30m`, `(1h)` or `[45m]` become estimates.
- **End run** saves the run, so the next task starts a fresh one.

Speedrun doesn't watch your screen, read your apps or send anything anywhere. It's just a timer, and it
needs no macOS permissions.

## Dashboard

Open it from the timer (Stats) or the menu bar. It shows every previous run with its splits, estimates vs
actuals, best times and sum of best, plus tracked time over the last 14 days, estimate accuracy and
your streak.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘⇧↩` | Split: finish the current task, start the next |
| `⌘⇧N` | Add a task |
| `⌘⇧Space` | Show or hide the timer |

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
