// Four small sounds, made on the spot with Web Audio: no files to ship, nothing to license.
// Countdown beeps, a dry click when you finish a task, a bright chime for a new best, a short chord at the end.

let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext());

/** One soft tone: a sine (or triangle) with a quick attack and a gentle fade. */
function tone(freq: number, startIn: number, length: number, volume: number, type: OscillatorType = 'sine') {
  const a = audio();
  const t = a.currentTime + startIn;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export type Sound = 'beep' | 'go' | 'split' | 'best' | 'finish';

export function play(sound: Sound, volume: number) {
  if (volume <= 0) return;
  const v = Math.min(1, volume) * 0.5;
  switch (sound) {
    case 'beep':
      return tone(660, 0, 0.12, v);
    case 'go':
      return tone(990, 0, 0.28, v);
    case 'split':
      return tone(1800, 0, 0.04, v * 0.6, 'triangle');
    case 'best':
      tone(1318.5, 0, 0.35, v * 0.7);
      return tone(1975.5, 0.08, 0.5, v * 0.6);
    case 'finish':
      for (const [i, f] of [523.25, 659.25, 783.99, 1046.5].entries()) tone(f, i * 0.07, 0.7, v * 0.45);
      return;
  }
}
