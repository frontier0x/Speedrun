import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type Run, type Settings } from './runs.js';

/** Runs live in runs/YYYY-MM-DD/run-<id>.json. Settings in settings.json. */
export class RunStore {
  constructor(
    private readonly runsRoot: string,
    private readonly settingsPath: string,
  ) {}

  private pathFor(run: Run): string {
    const day = new Date(run.startedAt).toLocaleDateString('sv-SE');
    return join(this.runsRoot, day, `run-${run.id}.json`);
  }

  async save(run: Run): Promise<void> {
    const p = this.pathFor(run);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, JSON.stringify(run, null, 2));
  }

  /** Used on quit, when there's no time to wait for an async write. */
  saveSync(run: Run): void {
    const p = this.pathFor(run);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, JSON.stringify(run, null, 2));
  }

  /** Every saved run, newest first. */
  async list(): Promise<Run[]> {
    const runs: Run[] = [];
    let days: string[] = [];
    try {
      days = await readdir(this.runsRoot);
    } catch {
      return runs;
    }
    for (const day of days) {
      let files: string[] = [];
      try {
        files = (await readdir(join(this.runsRoot, day))).filter((f) => f.startsWith('run-') && f.endsWith('.json'));
      } catch {
        continue;
      }
      for (const f of files) {
        try {
          runs.push(JSON.parse(await readFile(join(this.runsRoot, day, f), 'utf8')));
        } catch (err) {
          console.error('[speedrun] skipping unreadable run', f, err);
        }
      }
    }
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async loadSettings(): Promise<Settings> {
    try {
      // `mode` is from the old AutoCapture mode, replaced by focusTracking.
      const { mode: _mode, ...saved } = JSON.parse(await readFile(this.settingsPath, 'utf8'));
      return { ...DEFAULT_SETTINGS, ...saved };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(settings: Settings): Promise<void> {
    await writeFile(this.settingsPath, JSON.stringify(settings, null, 2));
  }
}
