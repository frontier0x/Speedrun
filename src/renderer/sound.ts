// Speedrun's few sounds, made on the spot with Web Audio: no files, nothing to license.

export type Sound = 'count' | 'go' | 'done' | 'best' | 'finish';

let ctx: AudioContext | undefined;

/** One soft note: a frequency, when it starts (seconds from now), how long it rings. */
function note(freq: number, at: number, dur: number, volume: number, type: OscillatorType = 'sine') {
  ctx ??= new AudioContext();
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function play(sound: Sound, volume: number) {
  const v = Math.max(0, Math.min(1, volume)) * 0.5;
  if (!v) return;
  switch (sound) {
    case 'count': // a short beep for 3, 2 and 1
      return note(660, 0, 0.12, v);
    case 'go': // a higher one for Go
      return note(1320, 0, 0.28, v);
    case 'done': // a dry click
      return note(1800, 0, 0.05, v * 0.8, 'triangle');
    case 'best': // a bright ding
      note(1320, 0, 0.35, v);
      return note(1760, 0.08, 0.5, v);
    case 'finish': // a little chord, rising
      [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.07, 0.7, v * 0.8));
      return;
  }
}
