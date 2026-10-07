# Speedrun

Speedrun your day. A local-first, open-source menu-bar app that watches what you're doing on your
computer and splits your time into tasks the way speedrunners split a run.

**Status: step 1 of 4, event-driven capture.** The app logs what you're working on. Nothing is sent
anywhere yet; the AI referee comes in step 3.

## What it does today

- Checks the active app, window title and browser tab URL once a second. That check is cheap and takes
  no screenshot.
- Logs an event, with a screenshot, when you **switch apps**, **switch tabs** or the **window title
  changes**. A change only counts once it has held for 1.5 s, so quickly alt-tabbing through apps
  doesn't flood the log.
- Takes a **heartbeat** screenshot every 30 s while you stay in one place. If the screen looks the same
  as last time (compared with a perceptual hash), nothing is saved, and later nothing is sent to the AI.
- Detects **idle**, after 2 minutes without input, a screen lock or sleep, and logs when you return.
- Shows the current app and how long you've been on it in the menu bar, e.g. `⏱ Code 12:04`.
- **Pause / Resume** from the menu bar.

Everything is stored on your Mac in `~/Library/Application Support/speedrun/runs/YYYY-MM-DD/`:
`events.jsonl` plus a `shots/` folder of ~1280px JPEGs.

## Run it

Requires Node 20+ on macOS.

```sh
npm install
npm start
```

macOS will ask for two permissions. Grant both, then restart with `npm start`:

- **Screen Recording**, for screenshots and window titles.
- **Accessibility**, to read the current browser tab's URL.

When you run it from a terminal, macOS gives the permission to your terminal app (Terminal, iTerm,
VS Code…), so that's the entry to switch on under System Settings › Privacy & Security.

## Tests

```sh
npm test
```

## Roadmap

1. ✅ Event-driven capture
2. Split tree and timer: run › section › split with rolled-up times and a live overlay
3. AI referee: a pluggable model (Claude Haiku, Gemini or a local Ollama model) that reads each change,
   opens and closes splits, infers tasks and nudges you when you drift
4. Daily recap: timeline, section and split times, gold splits

## License

MIT
