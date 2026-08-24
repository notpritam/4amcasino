/**
 * Minimal synthesized game sounds (WebAudio, no assets).
 * Every sound is a named recipe behind one `play(name)` call, so individual
 * sounds can later be swapped for generated/recorded samples (e.g. ElevenLabs)
 * by replacing a recipe with a file-backed player. game code never changes.
 */

export type SoundName =
  | 'shuffle'
  | 'deal'
  | 'flip'
  | 'chip'
  | 'chips-slide'
  | 'pot-collect'
  | 'thwack'
  | 'boom'
  | 'knock'
  | 'muck'
  | 'turn'
  | 'urgent'
  | 'win'
  | 'end';

const VOLUME_KEY = '4am-sound-volume';
const ENABLED_KEY = '4am-sounds';

export function soundsEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) !== 'off';
}
export function setSoundsEnabled(on: boolean): void {
  localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off');
}
export function soundVolume(): number {
  const v = Number(localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 1) : 0.5;
}
export function setSoundVolume(v: number): void {
  localStorage.setItem(VOLUME_KEY, String(Math.min(Math.max(v, 0), 1)));
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    master!.gain.value = soundVolume() * 0.6; // headroom: these are UI sounds, not music
    return ctx;
  } catch {
    return null;
  }
}

// browsers unlock audio only after a user gesture. arm once, globally
if (typeof window !== 'undefined') {
  const unlock = () => {
    ensureCtx();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/** A short filtered noise burst. the basis of card/paper sounds. */
function noiseBurst(
  c: AudioContext,
  at: number,
  dur: number,
  freq: number,
  q: number,
  gain: number,
  freqEnd?: number,
): void {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, at);
  if (freqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
  filter.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(filter).connect(g).connect(master!);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** A decaying tone. */
function tone(
  c: AudioContext,
  at: number,
  dur: number,
  freq: number,
  gain: number,
  type: OscillatorType = 'sine',
  freqEnd?: number,
): void {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(master!);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

const recipes: Record<SoundName, (c: AudioContext, t: number) => void> = {
  // a quick riffle: irregular paper ticks
  shuffle: (c, t) => {
    for (let i = 0; i < 7; i++) {
      const at = t + i * 0.045 + Math.random() * 0.02;
      noiseBurst(c, at, 0.04, 2600 + Math.random() * 1200, 1.2, 0.16);
    }
  },
  // one card sliding to you
  deal: (c, t) => {
    noiseBurst(c, t, 0.09, 1800, 0.8, 0.2, 900);
  },
  // a board card flipping over: tick + snap
  flip: (c, t) => {
    noiseBurst(c, t, 0.03, 3200, 2, 0.18);
    noiseBurst(c, t + 0.05, 0.06, 1400, 1, 0.14);
  },
  // two ceramic chip clinks, slightly detuned
  chip: (c, t) => {
    tone(c, t, 0.07, 2093, 0.12, 'triangle');
    tone(c, t + 0.045, 0.09, 2637 + Math.random() * 60, 0.1, 'triangle');
  },
  // a bet pushed across the felt: low slide + chips settling in a stack
  'chips-slide': (c, t) => {
    noiseBurst(c, t, 0.14, 900, 0.8, 0.12, 420);
    tone(c, t + 0.08, 0.06, 1976, 0.1, 'triangle');
    tone(c, t + 0.13, 0.07, 2349, 0.09, 'triangle');
    tone(c, t + 0.19, 0.08, 2637 + Math.random() * 50, 0.08, 'triangle');
  },
  // street over: every bet cascades into the pot
  'pot-collect': (c, t) => {
    noiseBurst(c, t, 0.2, 1100, 0.7, 0.1, 500);
    for (let i = 0; i < 5; i++) {
      const at = t + 0.05 + i * (0.055 - i * 0.004);
      tone(c, at, 0.06, 1760 + i * 180 + Math.random() * 40, 0.09 - i * 0.008, 'triangle');
    }
  },
  // a cartoon shove landing
  thwack: (c, t) => {
    noiseBurst(c, t, 0.05, 700, 1.2, 0.28, 300);
    tone(c, t + 0.02, 0.12, 180, 0.26, 'sine', 70);
  },
  // busting out with style
  boom: (c, t) => {
    noiseBurst(c, t, 0.5, 400, 0.5, 0.32, 60);
    tone(c, t, 0.4, 90, 0.3, 'sine', 32);
    for (let i = 0; i < 4; i++) tone(c, t + 0.1 + i * 0.07, 0.1, 900 + i * 350, 0.06, 'triangle');
  },
  // the classic double knuckle-tap for a check
  knock: (c, t) => {
    tone(c, t, 0.07, 160, 0.3, 'sine', 90);
    tone(c, t + 0.11, 0.07, 150, 0.24, 'sine', 85);
  },
  // cards swished into the muck
  muck: (c, t) => {
    noiseBurst(c, t, 0.16, 1500, 0.7, 0.16, 500);
  },
  // your turn: one soft marimba-ish ping
  turn: (c, t) => {
    tone(c, t, 0.16, 880, 0.14);
    tone(c, t, 0.16, 1760, 0.05);
  },
  // clock running out: two urgent blips
  urgent: (c, t) => {
    tone(c, t, 0.06, 1245, 0.14, 'square');
    tone(c, t + 0.1, 0.06, 1245, 0.14, 'square');
  },
  // you won the pot: gentle two-note chime
  win: (c, t) => {
    tone(c, t, 0.28, 659, 0.14);
    tone(c, t + 0.12, 0.42, 988, 0.14);
    tone(c, t + 0.12, 0.42, 1976, 0.04);
  },
  // hand over (you didn't win): neutral soft tick
  end: (c, t) => {
    tone(c, t, 0.1, 440, 0.07);
  },
};

export function play(name: SoundName): void {
  if (!soundsEnabled()) return;
  const c = ensureCtx();
  if (!c || !master) return;
  try {
    recipes[name](c, c.currentTime + 0.01);
  } catch {
    /* never let a sound break the game */
  }
}
