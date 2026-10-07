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

Speedrun shows a stopwatch icon in the menu bar and the floating timer bar (no Dock icon). Tick **Open at login** in the
menu bar menu to have it start with your Mac.

## The timer

- A small bar floats above every app, every Space and full-screen windows: the current task, its time,
  how far you are over or under your estimate, ▶/❚❚ and ✓. Drag it anywhere.
- ⌄ opens the task list, quick-add, Import and settings. The window is always exactly as tall as what's
  showing.
- Click **Import** to paste your notes or open a `.md`/`.txt` file. Bullets, checkboxes, `#` headings and
  indentation become tasks and sections.
- Add a time estimate to any task (`~30m`, `(1h)`, `[45m]` or just `30m`): green while you're under,
  red once you're over.
- **▶** starts the clock, **✓** (`⌘⇧↩`) finishes the task and starts the next. Click any task to switch
  to it. **End run** saves the run so the next task starts a fresh one.
- Gold splits: beat your best time on a task you've done before and it turns gold ★.

## Focus tracking

You jump between apps and tabs all the time, and almost none of that is a task switch. So focus
tracking never decides what you're working on: the task you started is the task. It only sorts each
moment into one of three buckets:

- **Work**: editors, terminals, Figma, Notion, GitHub, Google Docs…
- **Context**: search, AI chats, docs, Slack, mail, and anything it doesn't know
- **Distraction**: YouTube, X, Instagram, Reddit, news, shopping…

Short hops never count against you. If one distraction runs past 2 minutes (or distraction takes up
about a third of the last 10), the bar asks whether you're still on your task: **Back to it**, **Pause**
or **Part of this task** (that app or site then counts as work for this task). Each task shows its
work/context/distraction split and top apps and sites, in the timer and on the dashboard.

No screenshots and no AI, just rules. It needs no Screen Recording and no Accessibility permission:

- The app in front comes from macOS, which needs no permission.
- For the open tab in Chrome, Safari, Arc, Brave, Edge, Vivaldi or Opera, Speedrun asks the browser over
  AppleScript. macOS shows a one-time "Speedrun wants to control …" prompt per browser. Decline it and
  that browser simply counts as context. Firefox can't be asked.

Turn it off under ⌄ › Focus or in the menu bar.

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
- `settings.json`: color, opacity, focus tracking and timer position

## Roadmap

1. ✅ Floating timer, task import, estimates, dashboard
2. ✅ Focus tracking without screenshots or extra permissions
3. Suggest switching tasks when you spend a while in something that clearly belongs to another one
4. ✅ Packaged Speedrun.app / .dmg
5. Daily recap

## Tests and builds

```sh
npm test       # unit tests
npm run dist   # builds release/Speedrun-*.dmg locally
```

Running the Release workflow on GitHub (Actions tab), or pushing a tag like `v0.3.0`, builds the .dmg files and publishes them as a release.

## License

MIT
