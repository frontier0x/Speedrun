// Colors for day and night mode. Every color is a Paint: a solid hex color or a linear gradient.
// Pure module shared by the overlay and the settings window; no Node or Electron imports.

export interface GradientStop {
  color: string;
  /** 0–100 */
  pos: number;
}
export type Paint = string | { angle: number; stops: GradientStop[] };

export type Mode = 'dark' | 'light';
export type ColorKey = 'background' | 'text' | 'clock' | 'ahead' | 'behind' | 'paused' | 'gold' | 'button';

export const COLOR_LABELS: Record<ColorKey, string> = {
  background: 'Background',
  text: 'Text',
  clock: 'Clock (no estimate)',
  ahead: 'Under estimate',
  behind: 'Over estimate',
  paused: 'Paused',
  gold: 'New best',
  button: 'Buttons',
};

export const DEFAULT_COLORS: Record<Mode, Record<ColorKey, Paint>> = {
  dark: {
    background: '#000000e6',
    text: '#d6d6d1',
    clock: '#f4f4f0',
    ahead: '#3fd68a',
    behind: '#ff5a4e',
    paused: '#8b8b86',
    gold: '#ffcf4a',
    button: '#f4f4f0',
  },
  light: {
    background: '#ffffffeb',
    text: '#3a3a38',
    clock: '#141413',
    ahead: '#12a35a',
    behind: '#e5372b',
    paused: '#9a9a95',
    gold: '#c98a00',
    button: '#141413',
  },
};

/** A few ready-made gradients to start from. */
export const PRESETS: { name: string; paint: Paint }[] = [
  { name: 'Mint', paint: { angle: 90, stops: [{ color: '#3fd68a', pos: 0 }, { color: '#2fc4d6', pos: 100 }] } },
  { name: 'Sunset', paint: { angle: 90, stops: [{ color: '#ff8a3d', pos: 0 }, { color: '#ff3d77', pos: 100 }] } },
  { name: 'Aurora', paint: { angle: 90, stops: [{ color: '#7c5cff', pos: 0 }, { color: '#2fd6c4', pos: 100 }] } },
  { name: 'Fire', paint: { angle: 90, stops: [{ color: '#ffcf4a', pos: 0 }, { color: '#ff5a4e', pos: 100 }] } },
  { name: 'Ocean', paint: { angle: 135, stops: [{ color: '#0b1e3a', pos: 0 }, { color: '#123f6b', pos: 100 }] } },
  { name: 'Night', paint: { angle: 160, stops: [{ color: '#0d0d12f0', pos: 0 }, { color: '#1c1830f0', pos: 100 }] } },
];

/** Accepts #rgb, #rgba, #rrggbb and #rrggbbaa (with or without #). Returns lowercase #rrggbb[aa] or undefined. */
export function normalizeHex(input: string): string | undefined {
  let h = input.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) return undefined;
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return undefined;
  if (h.endsWith('ff') && h.length === 8) h = h.slice(0, 6);
  return '#' + h;
}

export function paintToCss(p: Paint): string {
  if (typeof p === 'string') return p;
  const stops = [...p.stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${s.pos}%`);
  return `linear-gradient(${p.angle}deg, ${stops.join(', ')})`;
}

/** One solid color standing in for a paint, for small text and borders: the first gradient stop. */
export function paintSolid(p: Paint): string {
  return typeof p === 'string' ? p : ([...p.stops].sort((a, b) => a.pos - b.pos)[0]?.color ?? '#000000');
}

export function resolveMode(theme: 'system' | Mode, prefersDark: boolean): Mode {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

export function palette(mode: Mode, overrides: Partial<Record<Mode, Partial<Record<ColorKey, Paint>>>> | undefined) {
  return { ...DEFAULT_COLORS[mode], ...(overrides?.[mode] ?? {}) } as Record<ColorKey, Paint>;
}

/** CSS custom properties for a palette: --<key> is a solid color, --<key>-fill the full paint. */
export function paletteVars(p: Record<ColorKey, Paint>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    vars[`--${k}`] = paintSolid(v);
    vars[`--${k}-fill`] = paintToCss(v);
  }
  return vars;
}
