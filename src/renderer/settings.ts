import type { AppState, SpeedrunApi } from '../api.js';
import type { Settings } from '../runs.js';
import {
  COLOR_LABELS, DEFAULT_COLORS, PRESETS, normalizeHex, paintSolid, paintToCss, resolveMode,
  type ColorKey, type GradientStop, type Mode, type Paint,
} from '../theme.js';
import { play } from './sounds.js';

const api = (window as unknown as { speedrun: SpeedrunApi }).speedrun;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let state: AppState;
let colorMode: Mode = resolveMode('system', matchMedia('(prefers-color-scheme: dark)').matches);
let openKey: ColorKey | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const patch = (p: Partial<Settings>) => {
  state.settings = { ...state.settings, ...p };
  void api.act({ type: 'settings', patch: p });
};

// ---------- look & timer ----------

function seg(id: string, value: string, onPick: (v: string) => void) {
  for (const b of $(id).querySelectorAll<HTMLButtonElement>('button')) {
    b.classList.toggle('on', b.dataset.v === value);
    b.onclick = () => onPick(b.dataset.v!);
  }
}

function renderBasics() {
  const s = state.settings;
  seg('theme', s.theme, (v) => {
    patch({ theme: v as Settings['theme'] });
    if (v !== 'system') colorMode = v as Mode;
    renderAll();
  });
  seg('precision', s.precision, (v) => {
    patch({ precision: v as Settings['precision'] });
    renderBasics();
  });
  seg('colorMode', colorMode, (v) => {
    colorMode = v as Mode;
    openKey = null;
    renderAll();
  });

  const scale = $<HTMLInputElement>('scale');
  if (document.activeElement !== scale) scale.value = String(Math.round(s.scale * 100));
  $('scaleVal').textContent = Math.round(s.scale * 100) + '%';
  scale.oninput = () => {
    patch({ scale: Number(scale.value) / 100 });
    $('scaleVal').textContent = scale.value + '%';
  };

  const weight = $<HTMLInputElement>('weight');
  if (document.activeElement !== weight) weight.value = String(s.clockWeight);
  $('weightVal').textContent = String(s.clockWeight);
  weight.oninput = () => {
    patch({ clockWeight: Number(weight.value) });
    $('weightVal').textContent = weight.value;
  };

  const countdown = $<HTMLInputElement>('countdown');
  countdown.checked = s.countdown;
  countdown.onchange = () => patch({ countdown: countdown.checked });
  const pauses = $<HTMLInputElement>('pausesCount');
  pauses.checked = s.pausesCount;
  pauses.onchange = () => patch({ pausesCount: pauses.checked });
  for (const key of ['race', 'startCountdown', 'sounds'] as const) {
    const box = $<HTMLInputElement>(key);
    box.checked = s[key];
    box.onchange = () => {
      patch({ [key]: box.checked });
      renderBasics();
    };
  }
  const volume = $<HTMLInputElement>('volume');
  volume.value = String(Math.round(s.soundVolume * 100));
  $('volumeVal').textContent = volume.value + '%';
  $('volumeField').hidden = !s.sounds;
  volume.oninput = () => ($('volumeVal').textContent = volume.value + '%');
  volume.onchange = () => {
    patch({ soundVolume: Number(volume.value) / 100 });
    play('split', Number(volume.value) / 100);
  };
}

// ---------- colors ----------

const custom = () => state.settings.colors[colorMode] ?? {};
const paintOf = (k: ColorKey): Paint => custom()[k] ?? DEFAULT_COLORS[colorMode][k];

function setPaint(k: ColorKey, p: Paint | undefined) {
  const forMode = { ...custom() };
  if (p === undefined) delete forMode[k];
  else forMode[k] = p;
  patch({ colors: { ...state.settings.colors, [colorMode]: forMode } });
}

/** "#rrggbbaa" → rgb part and alpha 0–1. */
function splitHex(hex: string): { rgb: string; a: number } {
  return { rgb: hex.slice(0, 7), a: hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1 };
}
function joinHex(rgb: string, a: number): string {
  return a >= 0.995 ? rgb : rgb + Math.round(a * 255).toString(16).padStart(2, '0');
}

function describe(p: Paint): string {
  return typeof p === 'string' ? p : `Gradient · ${p.stops.length} colors`;
}

/** One color: picker, hex field and opacity, plus position and remove for a gradient stop. */
function colorEditor(
  get: () => string,
  set: (hex: string) => void,
  extra?: { pos: () => number; setPos: (n: number) => void; remove?: () => void },
): HTMLElement {
  const row = el('div', 'stop' + (extra ? '' : ' solid'));
  const picker = el('input');
  picker.type = 'color';
  const hex = el('input', 'hex');
  hex.spellcheck = false;
  const sliders = el('div', 'sliders');
  const alphaLabel = el('label', '', 'Opacity');
  const alpha = el('input');
  alpha.type = 'range';
  alpha.min = '0';
  alpha.max = '100';
  alphaLabel.append(alpha);
  sliders.append(alphaLabel);

  const sync = () => {
    const { rgb, a } = splitHex(get());
    picker.value = rgb;
    if (document.activeElement !== hex) hex.value = get();
    alpha.value = String(Math.round(a * 100));
  };
  picker.oninput = () => {
    set(joinHex(picker.value, splitHex(get()).a));
    sync();
  };
  hex.oninput = () => {
    const h = normalizeHex(hex.value);
    hex.classList.toggle('bad', !h);
    if (h) {
      set(h);
      sync();
    }
  };
  hex.onblur = () => {
    hex.classList.remove('bad');
    sync();
  };
  alpha.oninput = () => {
    set(joinHex(splitHex(get()).rgb, Number(alpha.value) / 100));
    sync();
  };
  row.append(picker, hex, sliders);

  if (extra) {
    const posLabel = el('label', '', 'Position');
    const pos = el('input');
    pos.type = 'range';
    pos.min = '0';
    pos.max = '100';
    pos.value = String(extra.pos());
    pos.oninput = () => extra.setPos(Number(pos.value));
    posLabel.append(pos);
    sliders.append(posLabel);
    const rm = el('button', 'rm', '×');
    rm.type = 'button';
    rm.title = 'Remove this color';
    rm.disabled = !extra.remove;
    rm.onclick = () => extra.remove?.();
    row.append(rm);
  }
  sync();
  return row;
}

function editor(k: ColorKey, refresh: () => void): HTMLElement {
  const box = el('div', 'editor');
  box.onclick = (e) => e.stopPropagation();
  // Work on a copy; every change is applied right away so the timer previews it live.
  let draft: Paint = structuredClone(paintOf(k));
  const commit = () => {
    setPaint(k, structuredClone(draft));
    refresh();
  };
  const rebuild = () => box.replaceWith(editor(k, refresh));

  const mode = el('div', 'seg small');
  for (const [v, label] of [['solid', 'Solid'], ['gradient', 'Gradient']] as const) {
    const b = el('button', (typeof draft === 'string') === (v === 'solid') ? 'on' : '', label);
    b.type = 'button';
    b.onclick = () => {
      if (v === 'solid' && typeof draft !== 'string') draft = paintSolid(draft);
      if (v === 'gradient' && typeof draft === 'string') {
        const { rgb, a } = splitHex(draft);
        draft = { angle: 90, stops: [{ color: draft, pos: 0 }, { color: joinHex(shift(rgb), a), pos: 100 }] };
      }
      commit();
      rebuild();
    };
    mode.append(b);
  }
  const top = el('div', 'row');
  const reset = el('button', 'link', 'Reset');
  reset.type = 'button';
  reset.onclick = () => {
    setPaint(k, undefined);
    refresh();
    rebuild();
  };
  top.append(mode, el('span', 'spacer'), reset);
  box.append(top);

  if (typeof draft === 'string') {
    box.append(colorEditor(() => draft as string, (h) => ((draft = h), commit())));
  } else {
    const g = draft;
    const bar = el('div', 'bar');
    const paintBar = () => (bar.style.background = paintToCss({ ...g, angle: 90 }));
    paintBar();
    box.append(bar);
    const angle = el('label', 'angle', 'Angle');
    const range = el('input');
    range.type = 'range';
    range.min = '0';
    range.max = '360';
    range.value = String(g.angle);
    const deg = el('span', '', g.angle + '°');
    range.oninput = () => {
      g.angle = Number(range.value);
      deg.textContent = g.angle + '°';
      commit();
    };
    angle.append(range, deg);
    box.append(angle);
    g.stops.forEach((stop: GradientStop, i: number) => {
      box.append(
        colorEditor(
          () => stop.color,
          (h) => ((stop.color = h), paintBar(), commit()),
          {
            pos: () => stop.pos,
            setPos: (n) => ((stop.pos = n), paintBar(), commit()),
            remove: g.stops.length > 2 ? () => (g.stops.splice(i, 1), commit(), rebuild()) : undefined,
          },
        ),
      );
    });
    const add = el('button', 'link', '+ Add a color');
    add.type = 'button';
    add.onclick = () => {
      const last = g.stops.at(-1)!;
      g.stops.push({ color: last.color, pos: Math.min(100, last.pos) });
      g.stops.sort((a, b) => a.pos - b.pos);
      commit();
      rebuild();
    };
    box.append(add);
  }

  const presets = el('div', 'presets');
  for (const p of PRESETS) {
    const b = el('button');
    b.type = 'button';
    const dot = el('i');
    dot.style.background = paintToCss(p.paint);
    b.append(dot, p.name);
    b.onclick = () => {
      draft = structuredClone(p.paint);
      commit();
      rebuild();
    };
    presets.append(b);
  }
  box.append(presets);
  return box;
}

/** A second color for a new gradient: the same hue, a little lighter or darker. */
function shift(rgb: string): string {
  const n = parseInt(rgb.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const light = 0.299 * ch[0] + 0.587 * ch[1] + 0.114 * ch[2] > 128;
  return '#' + ch.map((c) => Math.round(light ? c * 0.6 : c + (255 - c) * 0.45).toString(16).padStart(2, '0')).join('');
}

function renderColors() {
  const list = $('colors');
  list.replaceChildren();
  for (const k of Object.keys(COLOR_LABELS) as ColorKey[]) {
    const row = el('div', 'crow');
    const swatch = el('span', 'swatch');
    const code = el('span', 'code');
    const refresh = () => {
      const p = paintOf(k);
      swatch.style.setProperty('--paint', paintToCss(p).startsWith('#') ? `linear-gradient(${p}, ${p})` : paintToCss(p));
      code.textContent = describe(p);
    };
    refresh();
    row.append(swatch, el('span', 'name', COLOR_LABELS[k]));
    if (custom()[k] !== undefined) row.append(el('span', 'custom', 'custom'));
    row.append(code);
    row.onclick = () => {
      openKey = openKey === k ? null : k;
      renderColors();
    };
    list.append(row);
    if (openKey === k) list.append(editor(k, refresh));
  }
}

function renderAll() {
  renderBasics();
  renderColors();
}

$('resetColors').onclick = () => {
  const { [colorMode]: _drop, ...rest } = state.settings.colors;
  patch({ colors: rest });
  openKey = null;
  renderColors();
};

state = await api.getState();
if (state.settings.theme !== 'system') colorMode = state.settings.theme;
renderAll();
// Changes made elsewhere (the timer's resize corner, the menu) show up here, without disturbing an open editor.
api.onState((s) => {
  state = s;
  renderBasics();
});

// ---------- tabs ----------

/** One tab at a time, so the window stays small. Remembers the last one you looked at. */
function showTab(tab: string) {
  for (const b of document.querySelectorAll<HTMLElement>('#tabs [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const sec of document.querySelectorAll<HTMLElement>('main section[data-tab]')) sec.hidden = sec.dataset.tab !== tab;
  try {
    localStorage.setItem('speedrun.settingsTab', tab);
  } catch {
    // remembering the tab is a nicety
  }
}
for (const b of document.querySelectorAll<HTMLElement>('#tabs [data-tab]')) b.onclick = () => showTab(b.dataset.tab!);
let firstTab = 'timer';
try {
  firstTab = localStorage.getItem('speedrun.settingsTab') ?? 'timer';
} catch {
  // first visit
}
showTab(firstTab);
