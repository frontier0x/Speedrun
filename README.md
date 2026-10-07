# Speedrun

Speedrun your day. A local-first, open-source menu-bar app that times your work the way speedrunners
time a run: tasks are splits, sections roll up their splits, and you race your own estimates and your
best times.

## Two modes

**Manual:** your own task list.

- A floating timer stays on top of every app and every desktop. Drag it anywhere, resize it, and it
  shrinks down to just the clock when you make it small.
- Click **Import** to paste your notes or open a `.md`/`.txt` file. Bullets, checkboxes, `#` headings and indentation
  become tasks and sections.
- Add a time estimate to any task (`~30m`, `(1h)`, `[45m]` or just `30m`) and watch the delta while
  you work: green while you're under, red once you're over.
- **▶ Start** starts the clock on the current task, **❚❚ Pause** stops it, and **End run** saves the run so
  the next task starts a fresh one.
- Click the mode badge (MANUAL ▾) to see what each mode does and switch.
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

## Run it

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

## Tests

```sh
npm test
```

## Roadmap

1. ✅ Event-driven capture
2. ✅ Manual mode, floating timer, dashboard
3. AI referee: a pluggable model (Claude Haiku, Gemini or a local Ollama model) that reads each change,
   opens and closes splits, infers tasks and nudges you when you drift
4. Daily recap

## License

MIT
