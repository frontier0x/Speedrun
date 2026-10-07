import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureEvent } from './types.js';

/** Local-only storage: one folder per day holding events.jsonl and the screenshots it references. */
export class DayStore {
  constructor(private readonly root: string) {}

  dayDir(date = new Date()): string {
    const d = date.toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time
    return join(this.root, d);
  }

  async saveScreenshot(jpeg: Buffer, date = new Date()): Promise<string> {
    const dir = join(this.dayDir(date), 'shots');
    await mkdir(dir, { recursive: true });
    const name = date.toTimeString().slice(0, 8).replaceAll(':', '') + '-' + date.getMilliseconds() + '.jpg';
    await writeFile(join(dir, name), jpeg);
    return join('shots', name);
  }

  async append(event: CaptureEvent): Promise<void> {
    const dir = this.dayDir(new Date(event.ts));
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
  }
}
