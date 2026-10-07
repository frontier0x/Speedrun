import type { EventKind, WindowSnapshot } from './types.js';

/** Compare two window snapshots and name the kind of change, if any. */
export function classifyChange(prev: WindowSnapshot | undefined, cur: WindowSnapshot): EventKind | null {
  if (!prev) return 'app_switch';
  if ((prev.bundleId ?? prev.app) !== (cur.bundleId ?? cur.app)) return 'app_switch';
  if (normalizeUrl(prev.url) !== normalizeUrl(cur.url)) return 'tab_switch';
  if (normalizeTitle(prev.title) !== normalizeTitle(cur.title)) return 'title_change';
  return null;
}

/** Ignore #fragments so in-page anchors and SPA hash routing don't count as tab switches. */
export function normalizeUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** Strip noise like unread counters "(3) Inbox" and ticking clocks so they don't look like new tasks. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turns a stream of polled snapshots into change events. A change only fires once the new
 * window has been stable for `settleMs`, so alt-tabbing through apps doesn't emit a burst.
 */
export class ChangeTracker {
  private committed: WindowSnapshot | undefined;
  private pending: { snap: WindowSnapshot; kind: EventKind; since: number } | undefined;

  constructor(private readonly settleMs = 1500) {}

  get current(): WindowSnapshot | undefined {
    return this.committed;
  }

  poll(snap: WindowSnapshot, now: number): { kind: EventKind; window: WindowSnapshot } | null {
    const kind = classifyChange(this.committed, snap);
    if (!kind) {
      this.pending = undefined;
      // Keep the freshest raw title/url even when the change is only noise.
      if (this.committed) this.committed = snap;
      return null;
    }
    if (!this.pending || classifyChange(this.pending.snap, snap) !== null) {
      this.pending = { snap, kind, since: now };
    }
    if (now - this.pending.since >= this.settleMs) {
      const fired = { kind: this.pending.kind, window: snap };
      this.committed = snap;
      this.pending = undefined;
      return fired;
    }
    return null;
  }
}
