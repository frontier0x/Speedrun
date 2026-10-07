# Speedrun

Speedrun your day. A local-first, open-source menu-bar app that times your work the way speedrunners
time a run: tasks are splits, sections roll up their splits, and you race your own estimates and your
best times.

## Install

1. Download the latest `Speedrun-…-arm64.dmg` (Apple Silicon) or `Speedrun-….dmg` (Intel) from
   [Releases](https://github.com/frontier0x/speedrun/releases/latest).
2. Open it and drag **Speedrun** into **Applications**.
3. The first time, macOS says it can't verify the developer because the app isn't signed with a paid
   Apple account yet. Right-click Speedrun › **Open**, or go to System Settings › Privacy & Security ›
   **Open Anyway**. After that it opens normally.

Speedrun shows a ⏱ in the menu bar, a Dock icon and the floating timer. Tick **Open at login** in the
menu bar menu to have it start with your Mac.

## Two modes

**Manual:** your own task list.

- A floating timer stays on top of every app and every desktop. Drag it anywhere, resize it, and it
  shrinks down to just the clock when you make it small.
- Paste your notes or open a `.md`/`.txt` file. Bullets, checkboxes, `#` headings and indentation
  become tasks and sections.
- Add a time estimate to any task (`~30m`, `(1h)`, `[45m]` or just `30m`) and watch the delta while
  you work: green while you're under, red once you're over.
- **Split** (`⌘⇧↩`) finishes the current task and starts the next one. Click any task to switch to it.
- Quick-add from the bottom of the timer or with `⌘⇧N`. Start the line with `!` to put it on top.
  Drag tasks to reprioritize.
- Pick any accent color and adjust the opacity.
- Gold splits: beat your best time on a task you've done before and it turns gold ★.
- The header shows total run time and when you'll be done at your estimated pace.

**AutoCapture:** it watches what you do.

- Checks the active app, window title and browser tab URL once a second, which is cheap and takes no
  screenshot.
- Logs an event with a screenshot when you switch apps or tabs or the window title changes, once the
  change has held for 1.5 s.
- Takes a heartbeat screenshot every 30 s and skips it if the screen hasn't changed (perceptual hash).
- Detects idle (2 minutes without input, screen lock or sleep).
- Coming next: an AI referee that turns these events into named splits and nudges you when you drift.

## Dashboard

Open it from the timer (▦) or the menu bar. It shows every previous run with its splits, estimates vs
actuals, best times and sum of best, plus tracked time over the last 14 days, estimate accuracy and
your streak.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘⇧↩` | Split: finish the current task, start the next |
| `⌘⇧N` | Add a task |
| `⌘⇧Space` | Show or hide the timer |

## Run from source

Requires Node 20+ on macOS.

```sh
npm install
npm start
```

AutoCapture needs two macOS permissions. Grant both, then restart with `npm start`:

- **Screen Recording**, for screenshots and window titles.
- **Accessibility**, to read the current browser tab's URL.

When you run from a terminal, macOS gives the permission to your terminal app (Terminal, iTerm,
VS Code…), so that's the entry to switch on under System Settings › Privacy & Security.

## Your data

Everything stays on your Mac in `~/Library/Application Support/speedrun/`:

- `runs/YYYY-MM-DD/run-*.json`: your task runs
- `runs/YYYY-MM-DD/events.jsonl` and `shots/`: AutoCapture's log and screenshots
- `settings.json`: color, opacity, mode and timer position

## Tests and builds

```sh
npm test       # unit tests
npm run dist   # builds release/Speedrun-*.dmg locally
```

Pushing a tag like `v0.2.0` makes GitHub Actions build the .dmg and publish it as a release.

## Roadmap

1. ✅ Event-driven capture
2. ✅ Manual mode, floating timer, dashboard
3. AI referee: a pluggable model (Claude Haiku, Gemini or a local Ollama model) that reads each change,
   opens and closes splits, infers tasks and nudges you when you drift
4. Daily recap

## License

MIT
