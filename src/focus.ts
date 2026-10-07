// Focus tracking: sorts whatever is in front (an app or a browser tab) into work, context or distraction,
// and decides when a distraction has gone on long enough to nudge. Rules only, no AI. No Node or Electron imports.

export type FocusKind = 'work' | 'context' | 'distraction';

export interface Frontmost {
  app: string;
  bundleId?: string;
  /** Active tab of a supported browser, when the browser lets us read it. */
  url?: string;
  title?: string;
}

export type FocusTotals = Record<FocusKind, number>;

const WORK_APPS = [
  'code', 'cursor', 'xcode', 'terminal', 'iterm', 'warp', 'ghostty', 'zed', 'sublime', 'intellij', 'webstorm', 'pycharm',
  'android studio', 'figma', 'sketch', 'framer', 'notion', 'linear', 'obsidian', 'bear', 'craft', 'pages', 'keynote',
  'numbers', 'microsoft word', 'microsoft excel', 'microsoft powerpoint', 'affinity', 'photoshop', 'illustrator',
  'premiere', 'final cut', 'davinci', 'logic pro', 'ableton', 'blender', 'tableplus', 'postman', 'docker',
];
const DISTRACTION_APPS = ['steam', 'netflix', 'tv', 'photo booth', 'chess', 'solitaire'];

const WORK_DOMAINS = [
  'github.com', 'gitlab.com', 'figma.com', 'docs.google.com', 'sheets.google.com', 'slides.google.com', 'notion.so',
  'linear.app', 'vercel.com', 'netlify.com', 'supabase.com', 'localhost', '127.0.0.1', 'framer.com', 'webflow.com',
  'canva.com', 'miro.com', 'airtable.com', 'console.aws.amazon.com', 'console.cloud.google.com', 'replit.com',
];
const DISTRACTION_DOMAINS = [
  'youtube.com', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'reddit.com', 'netflix.com',
  'twitch.tv', 'primevideo.com', 'disneyplus.com', '9gag.com', 'pinterest.com', 'tumblr.com', 'threads.net',
  'bsky.app', 'news.ycombinator.com', 'spiegel.de', 'bild.de', 'zeit.de', 'faz.net', 'sueddeutsche.de', 'tagesschau.de',
  'n-tv.de', 'welt.de', 'cnn.com', 'bbc.com', 'nytimes.com', 'theguardian.com', 'amazon.com', 'amazon.de', 'ebay.com',
  'ebay.de', 'kleinanzeigen.de', 'zalando.de',
];

export function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

const matchesDomain = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith('.' + d));
const matchesApp = (app: string, list: string[]) => list.some((a) => app === a || app.startsWith(a + ' ') || app.includes(a));

/** What a stretch of time gets filed under: the site for browser tabs, the app otherwise. */
export function sourceKey(f: Frontmost): string {
  return (f.url && hostOf(f.url)) || f.app;
}

/** Work, context or distraction. Anything unknown is context, so it never nags you by mistake. */
export function classify(f: Frontmost, allowed: string[] = []): FocusKind {
  const key = sourceKey(f);
  if (allowed.includes(key)) return 'work';
  const host = f.url ? hostOf(f.url) : undefined;
  if (host) {
    if (matchesDomain(host, DISTRACTION_DOMAINS)) return 'distraction';
    if (matchesDomain(host, WORK_DOMAINS)) return 'work';
    return 'context';
  }
  const app = f.app.toLowerCase();
  if (matchesApp(app, DISTRACTION_APPS)) return 'distraction';
  if (matchesApp(app, WORK_APPS)) return 'work';
  return 'context';
}

export const emptyTotals = (): FocusTotals => ({ work: 0, context: 0, distraction: 0 });

/** One unbroken distraction this long gets a nudge. Short hops (checking something) never do. */
export const STREAK_MS = 2 * 60_000;
/** ...or this share of distraction across the last WINDOW_MS. */
export const WINDOW_MS = 10 * 60_000;
export const WINDOW_SHARE = 0.3;
/** Quiet time after a nudge. */
export const COOLDOWN_MS = 5 * 60_000;

export interface Nudge {
  key: string;
  /** How long the current distraction has lasted. */
  ms: number;
}

/** Watches the stream of focus samples for one task and says when to nudge. */
export class Nudger {
  private recent: { at: number; ms: number; distraction: boolean }[] = [];
  private streakKey: string | null = null;
  private streakMs = 0;
  private quietUntil = 0;
  current: Nudge | null = null;

  /** Feed one sample; returns the nudge to show, or null. */
  observe(kind: FocusKind, key: string, ms: number, now: number): Nudge | null {
    const distraction = kind === 'distraction';
    this.recent.push({ at: now, ms, distraction });
    while (this.recent.length && this.recent[0].at < now - WINDOW_MS) this.recent.shift();

    if (!distraction) {
      this.streakKey = null;
      this.streakMs = 0;
      this.current = null;
      return null;
    }
    if (this.streakKey === key) this.streakMs += ms;
    else {
      this.streakKey = key;
      this.streakMs = ms;
    }

    if (this.current) {
      this.current = { key, ms: this.streakMs };
      return this.current;
    }
    if (now < this.quietUntil) return null;
    const total = this.recent.reduce((a, s) => a + s.ms, 0);
    const lost = this.recent.reduce((a, s) => a + (s.distraction ? s.ms : 0), 0);
    const windowFull = now - this.recent[0].at >= WINDOW_MS * 0.5;
    if (this.streakMs >= STREAK_MS || (windowFull && total > 0 && lost / total >= WINDOW_SHARE && this.streakMs >= 30_000)) {
      this.current = { key, ms: this.streakMs };
      return this.current;
    }
    return null;
  }

  /** You answered the nudge; stay quiet for a while. */
  dismiss(now: number) {
    this.current = null;
    this.quietUntil = now + COOLDOWN_MS;
  }

  reset() {
    this.recent = [];
    this.streakKey = null;
    this.streakMs = 0;
    this.current = null;
  }
}
