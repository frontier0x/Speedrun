// Colors: every color the timer uses is a role, and every role is a solid color or a gradient.
// Day and night each get their own palette. Pure data and CSS strings, no DOM.

export type Paint = { kind: 'solid'; color: string } | { kind: 'gradient'; angle: number; stops: string[] };

export const ROLES = [
  ['background', 'Background'],
  ['text', 'Text'],
  ['muted', 'Secondary text'],
  ['running', 'Clock while running'],
  ['ahead', 'Under your estimate'],
  ['behind', 'Over your estimate'],
  ['paused', 'Paused'],
  ['gold', 'Best time'],
  ['button', 'Start button'],
] as const;

export type Role = (typeof ROLES)[number][0];
export type Palette = Record<Role, Paint>;
export type Appearance = 'dark' | 'light' | 'system';

export interface Theme {
  appearance: Appearance;
  dark: Palette;
  light: Palette;
}

const solid = (color: string): Paint => ({ kind: 'solid', color });
const gradient = (angle: number, ...stops: string[]): Paint => ({ kind: 'gradient', angle, stops });

export const NIGHT: Palette = {
  background: solid('#000000e6'),
  text: solid('#d6d6d1'),
  muted: solid('#8b8b86'),
  running: solid('#f4f4f0'),
  ahead: solid('#3fd68a'),
  behind: solid('#ff5a4e'),
  paused: solid('#8b8b86'),
  gold: solid('#ffcf4a'),
  button: solid('#f4f4f0'),
};

export const DAY: Palette = {
  background: solid('#fbfbf8eb'),
  text: solid('#2b2b28'),
  muted: solid('#7a7a74'),
  running: solid('#141412'),
  ahead: solid('#0f9d58'),
  behind: solid('#e0362c'),
  paused: solid('#9a9a94'),
  gold: solid('#c98a00'),
  button: solid('#141412'),
};

export const DEFAULT_THEME: Theme = { appearance: 'dark', dark: NIGHT, light: DAY };

/** Starting points; each fills the palette you're editing. */
export const PRESETS: { name: string; appearance: 'dark' | 'light'; palette: Palette }[] = [
  { name: 'Night', appearance: 'dark', palette: NIGHT },
  {
    name: 'Neon',
    appearance: 'dark',
    palette: {
      ...NIGHT,
      background: gradient(160, '#0b0221f0', '#1d0b3af0'),
      running: gradient(90, '#a78bfa', '#22d3ee'),
      ahead: gradient(90, '#4ade80', '#2dd4bf'),
      behind: gradient(90, '#fb7185', '#fb923c'),
      gold: gradient(90, '#fde047', '#f59e0b'),
      button: gradient(90, '#a78bfa', '#22d3ee'),
    },
  },
  {
    name: 'Sunset',
    appearance: 'dark',
    palette: {
      ...NIGHT,
      background: gradient(170, '#1c0f1ef0', '#2a1210f0'),
      running: gradient(90, '#fed7aa', '#fb923c'),
      ahead: gradient(90, '#fde68a', '#facc15'),
      behind: gradient(90, '#f43f5e', '#be123c'),
      button: gradient(90, '#fdba74', '#f472b6'),
    },
  },
  {
    name: 'Mono',
    appearance: 'dark',
    palette: { ...NIGHT, ahead: solid('#f4f4f0'), behind: solid('#8b8b86'), gold: solid('#f4f4f0') },
  },
  { name: 'Day', appearance: 'light', palette: DAY },
  {
    name: 'Mint',
    appearance: 'light',
    palette: {
      ...DAY,
      background: gradient(160, '#f0fdf4f0', '#ecfefff0'),
      running: gradient(90, '#0f766e', '#0369a1'),
      ahead: gradient(90, '#059669', '#0d9488'),
      button: gradient(90, '#0f766e', '#0369a1'),
    },
  },
];

/** Accepts #rgb, #rgba, #rrggbb or #rrggbbaa, with or without #. Returns #rrggbbaa lowercase, or null. */
export function parseHex(input: string): string | null {
  let h = input.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  return h.length === 8 ? '#' + h : null;
}

/** #rrggbb for <input type=color>, and alpha as 0–100. */
export function splitHex(hex: string): { rgb: string; alpha: number } {
  const h = parseHex(hex) ?? '#000000ff';
  return { rgb: h.slice(0, 7), alpha: Math.round((parseInt(h.slice(7, 9), 16) / 255) * 100) };
}

export function joinHex(rgb: string, alpha: number): string {
  const a = Math.round((Math.max(0, Math.min(100, alpha)) / 100) * 255);
  return (parseHex(rgb) ?? '#000000ff').slice(0, 7) + a.toString(16).padStart(2, '0');
}

/** Shown in the editor: #RRGGBB, plus AA only when it isn't fully opaque. Like Figma. */
export function displayHex(hex: string): string {
  const h = parseHex(hex) ?? hex;
  return (h.endsWith('ff') ? h.slice(0, 7) : h).toUpperCase();
}

/** A paint as a CSS image. Solids become a flat gradient so text and backgrounds paint the same way. */
export function paintCss(p: Paint): string {
  if (p.kind === 'solid') return `linear-gradient(${p.color}, ${p.color})`;
  const stops = p.stops.length > 1 ? p.stops : [p.stops[0] ?? '#000000', p.stops[0] ?? '#000000'];
  return `linear-gradient(${p.angle}deg, ${stops.join(', ')})`;
}

/** One plain color for places a gradient can't go (borders, outlines): the first stop. */
export const paintColor = (p: Paint): string => (p.kind === 'solid' ? p.color : p.stops[0] ?? '#000000');

const isPaint = (p: unknown): p is Paint =>
  typeof p === 'object' && p !== null &&
  (((p as Paint).kind === 'solid' && typeof (p as { color: unknown }).color === 'string') ||
    ((p as Paint).kind === 'gradient' && Array.isArray((p as { stops: unknown }).stops)));

/** Fills in anything missing from a saved theme, so older settings and new roles always work. */
export function normalizeTheme(t: unknown): Theme {
  const saved = (typeof t === 'object' && t ? t : {}) as Partial<Theme>;
  const fill = (p: unknown, base: Palette): Palette => {
    const out = { ...base };
    if (typeof p === 'object' && p) for (const [role] of ROLES) if (isPaint((p as Palette)[role])) out[role] = (p as Palette)[role];
    return out;
  };
  return {
    appearance: saved.appearance === 'light' || saved.appearance === 'system' ? saved.appearance : 'dark',
    dark: fill(saved.dark, NIGHT),
    light: fill(saved.light, DAY),
  };
}
