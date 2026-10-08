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

Just a timer. No screenshots, no tracking, no AI, no permissions, nothing leaves your Mac.

- A small card floats above every app, every Space and full-screen windows. It shows only the current
  task and a big clock with hours, minutes, seconds and milliseconds. It turns red once you're over
  your estimate. Drag it anywhere.
- Click it to open the task list. Hover it for ▶/❚❚ and ✓.
- Add tasks one by one, or paste a whole list from your notes into the field: bullets, checkboxes,
  `#` headings and indentation become tasks and sections.
- Put your guess next to a task (`30m`, `~45m`, `(1h)`, `[1h30m]`) or click its estimate to change it.
- **▶** starts the clock, **✓** (`⌘⇧↩`) finishes the task and starts the next. Click any task to switch
  to it. **End run** saves the run to Stats and starts a fresh one.
- Gold splits: beat your best time on a task you've done before and it turns gold ★.

## Dashboard

Open it from the timer (⌄ › Stats) or the menu bar. It shows every previous run with its splits, estimates vs
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
