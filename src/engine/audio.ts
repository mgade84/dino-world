/**
 * Sound effects are synthesized with Web Audio — no files to download, zero latency. There is no speech.
 * iOS only lets audio start inside a user gesture, so main.ts calls unlockAudio()
 * on every tap (it is a no-op once running).
 *
 * iOS puts Web Audio on the ringer channel, so a muted iPad plays nothing. Safari 17+
 * can opt out with navigator.audioSession; older versions (an iPad Air 2 stops at
 * iPadOS 15) get a looping silent <audio>, which moves the page to the media channel.
 */
import { load, save } from './storage';

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = load('muted', false);
let silence: HTMLAudioElement | null = null;

// iPadOS Safari reports itself as a Mac, so also check for touch.
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** A quarter of a second of 8-bit mono silence, at the output rate so iOS doesn't resample. */
function silentWav(rate: number) {
  const samples = rate >> 2;
  const v = new DataView(new ArrayBuffer(44 + samples));
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true); // bytes per second
  v.setUint16(32, 1, true); // bytes per frame
  v.setUint16(34, 8, true); // bits per sample
  text(36, 'data');
  v.setUint32(40, samples, true);
  let bin = '';
  for (let i = 0; i < 44; i++) bin += String.fromCharCode(v.getUint8(i));
  return 'data:audio/wav;base64,' + btoa(bin + '\x80'.repeat(samples)); // 0x80 is silence in 8-bit PCM
}

function playSilence(rate: number) {
  if (!silence) {
    silence = document.createElement('audio');
    silence.setAttribute('x-webkit-airplay', 'deny');
    silence.loop = true;
    silence.src = silentWav(rate);
    // Don't leave lock-screen media controls behind; the next tap starts it again.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) silence?.pause();
    });
  }
  if (silence.paused && !document.hidden) silence.play()?.catch(() => {}); // only allowed in some gestures
}

export function unlockAudio() {
  if (!ac) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    // Safari 17+: play even when the device is in silent mode.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ac.destination);
  }
  if (ac.state !== 'running') ac.resume().catch(() => {});
  if (isIOS && !muted && !('audioSession' in navigator)) playSilence(ac.sampleRate);
}

/** Raw audio graph for games that build their own continuous sounds (e.g. engines). */
export function audioOut(): { ac: AudioContext; out: GainNode } | null {
  return ac && master && ac.state === 'running' ? { ac, out: master } : null;
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  save('muted', m);
  if (master) master.gain.value = m ? 0 : 0.6;
  if (m) silence?.pause(); // lets other apps' music carry on
}

function voice(
  type: OscillatorType,
  freq: number,
  vol: number,
  decay: number,
  when = 0,
  slideTo?: number,
  attack = 0.008,
) {
  if (!ac || !master || muted || ac.state !== 'running') return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + decay);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + decay + 0.05);
}

let noiseBuf: AudioBuffer | null = null;

function noiseBuffer(a: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noise(dur: number, vol: number, type: BiquadFilterType, freq: number, when = 0) {
  if (!ac || !master || muted || ac.state !== 'running') return;
  const t = ac.currentTime + when;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  src.loop = true; // the buffer is one second long; longer sounds keep reading it
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** Train horn chord that sounds while held. Returns a stop function. */
export function hornStart(): () => void {
  const a = ac;
  if (!a || !master || muted || a.state !== 'running') return () => {};
  const t = a.currentTime;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1400;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
  f.connect(g);
  g.connect(master);
  const oscs = [277.18, 349.23, 415.3].map((fr) => {
    const o = a.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = fr;
    o.connect(f);
    o.start(t);
    return o;
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const end = Math.max(a.currentTime, t + 0.35); // always at least a short toot
    g.gain.setValueAtTime(0.16, end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.2);
    for (const o of oscs) o.stop(end + 0.25);
  };
}

export interface NoiseLoop {
  /** Fades to a volume (0 = silent) and optionally retunes the filter. */
  set(vol: number, freq?: number): void;
  stop(): void;
}

/** Continuous filtered noise, e.g. a fryer sizzle or a soda pour. Starts silent. */
export function noiseLoop(type: BiquadFilterType, freq: number, q = 1): NoiseLoop {
  const a = ac;
  if (!a || !master || a.state !== 'running') return { set() {}, stop() {} };
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = 0;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start();
  let stopped = false;
  return {
    set(vol, fr) {
      if (stopped) return;
      g.gain.setTargetAtTime(vol, a.currentTime, 0.04);
      if (fr) f.frequency.setTargetAtTime(fr, a.currentTime, 0.05);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      g.gain.setTargetAtTime(0, a.currentTime, 0.05);
      src.stop(a.currentTime + 0.4);
    },
  };
}

export type Instrument = 'piano' | 'bells' | 'robot';

export function playNote(freq: number, inst: Instrument = 'piano', vol = 0.35) {
  switch (inst) {
    case 'piano':
      voice('triangle', freq, vol, 1.3);
      voice('sine', freq * 2, vol * 0.25, 0.7);
      break;
    case 'bells':
      voice('sine', freq * 2, vol, 0.9);
      voice('sine', freq * 6, vol * 0.12, 0.12);
      break;
    case 'robot':
      voice('square', freq, vol * 0.3, 0.35);
      voice('square', freq * 1.005, vol * 0.2, 0.35);
      break;
  }
}

// ---- Dinosaur voices ----
// Big animals' calls (a lion's roar, a crocodile's bellow) are mostly breath: air pushed hard through
// loose vocal folds that flap irregularly, a long throat, and a mouth that opens on "aah" and closes to
// "ooh". So the voice is a soft, filtered tone with irregular wobble in pitch and loudness (never a
// steady rate: that sounds like an engine), plus a lot of breath noise, both through moving formants,
// with a deep rumble and a hiss, heard outdoors in a short, dark reverb.

let space: { ac: AudioContext; in: ConvolverNode } | null = null;

/** A shared reverb send: a second and a half of decaying noise, low-passed so it sounds outdoors. */
function reverbSend(a: AudioContext, out: AudioNode): AudioNode {
  if (!space || space.ac !== a) {
    const len = Math.floor(a.sampleRate * 1.5);
    const buf = a.createBuffer(2, len, a.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += (Math.random() * 2 - 1 - lp) * 0.25;
        d[i] = lp * Math.pow(1 - i / len, 2.5) * 2;
      }
    }
    const conv = a.createConvolver();
    conv.buffer = buf;
    const wet = a.createGain();
    wet.gain.value = 0.3;
    conv.connect(wet);
    wet.connect(out);
    space = { ac: a, in: conv };
  }
  return space.in;
}

let jitterBuf: AudioBuffer | null = null;
/**
 * Four seconds of smooth random wandering in -1..1: a new random level every 1/100 s, eased between.
 * Played back faster or slower, it gives irregular wobble at any rate.
 */
function jitterBuffer(a: AudioContext) {
  if (!jitterBuf || jitterBuf.sampleRate !== a.sampleRate) {
    jitterBuf = a.createBuffer(1, a.sampleRate * 4, a.sampleRate);
    const d = jitterBuf.getChannelData(0);
    const step = Math.floor(a.sampleRate / 100);
    let from = 0;
    let to = Math.random() * 2 - 1;
    for (let i = 0; i < d.length; i++) {
      const k = (i % step) / step;
      if (k === 0) {
        from = to;
        to = Math.random() * 2 - 1;
      }
      d[i] = from + (to - from) * (0.5 - Math.cos(k * Math.PI) / 2);
    }
  }
  return jitterBuf;
}

/** Irregular wobble added to `param`: `rate` is roughly how many times a second it changes, `amount` how far. */
function jitter(a: AudioContext, param: AudioParam, t: number, stop: number, rate: number, amount: number) {
  const src = a.createBufferSource();
  src.buffer = jitterBuffer(a);
  src.loop = true;
  src.playbackRate.value = rate / 100;
  const g = a.createGain();
  g.gain.value = amount;
  src.connect(g);
  g.connect(param);
  src.start(t, Math.random() * 3.5);
  src.stop(stop);
}

/** A bus for one call: straight to the speakers and into the reverb. Fade it to cut the call short. */
function callBus(a: AudioContext, out: AudioNode, vol: number) {
  const bus = a.createGain();
  bus.gain.value = vol;
  bus.connect(out);
  bus.connect(reverbSend(a, out));
  return bus;
}

/** Filtered noise into `dest`, following an envelope of [time, level] points (times from `t`). */
function breath(a: AudioContext, dest: AudioNode, t: number, env: [number, number][], type: BiquadFilterType, freq: [number, number][], q = 1) {
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq[0][1], t);
  for (const [at, v] of freq) f.frequency.linearRampToValueAtTime(v, t + at);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  for (const [at, v] of env) g.gain.linearRampToValueAtTime(v, t + at);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  const end = env[env.length - 1][0];
  // Start somewhere random in the buffer so repeated calls don't sound identical.
  src.start(t, Math.random() * 0.9);
  src.stop(t + end + 0.05);
}

/**
 * One call from a throat: a voiced tone at `f0` following `pitch` (multipliers at fractions of `dur`)
 * mixed with breath (`breathy`, 0..1), through formants (frequency, Q, level) that move with `open`,
 * at loudness `env`. `rough` is how ragged the vocal folds are.
 */
function growl(a: AudioContext, dest: AudioNode, t: number, dur: number, f0: number, o: {
  pitch: [number, number][]; open: [number, number][]; env: [number, number][]; formants: [number, number, number][]; rough: number; breathy: number;
}) {
  const stop = t + dur + 0.05;
  // Voice: a sawtooth softened by a low-pass (a pulse of air, not a buzz) and a sine for body,
  // wandering irregularly in pitch around the contour.
  const voiced = a.createGain();
  for (const [type, vol] of [['sawtooth', 0.6], ['sine', 0.5]] as [OscillatorType, number][]) {
    const osc = a.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0 * o.pitch[0][1], t);
    for (const [at, m] of o.pitch) osc.frequency.linearRampToValueAtTime(f0 * m, t + at * dur);
    jitter(a, osc.frequency, t, stop, 9, f0 * 0.05 * (0.5 + o.rough));
    const g = a.createGain();
    g.gain.value = vol;
    osc.connect(g);
    g.connect(voiced);
    osc.start(t);
    osc.stop(stop);
  }
  const soft = a.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = Math.max(f0 * 6, 420);
  soft.Q.value = 0.5;
  voiced.connect(soft);
  // Rasp: loudness shaking irregularly, fast (the folds slapping) and slow (the breath pushing).
  const rasp = a.createGain();
  rasp.gain.value = 1 - o.rough * 0.25;
  jitter(a, rasp.gain, t, stop, 70, o.rough * 0.45);
  jitter(a, rasp.gain, t, stop, 6, 0.15);
  soft.connect(rasp);
  // Breath through the same throat.
  const air = a.createBufferSource();
  air.buffer = noiseBuffer(a);
  air.loop = true;
  const airGain = a.createGain();
  airGain.gain.value = o.breathy;
  air.connect(airGain);
  air.start(t, Math.random() * 0.9);
  air.stop(stop);
  const throat = a.createGain();
  rasp.connect(throat);
  airGain.connect(throat);
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  for (const [at, v] of o.env) env.gain.linearRampToValueAtTime(v, t + at * dur);
  // The chest's weight below the formants (voice only: breath down there is just hiss).
  const chest = a.createBiquadFilter();
  chest.type = 'lowpass';
  chest.frequency.value = f0 * 2.5;
  rasp.connect(chest);
  const chestGain = a.createGain();
  chestGain.gain.value = 0.8;
  chest.connect(chestGain);
  chestGain.connect(env);
  // Mouth: formants that slide as the jaw opens and closes.
  for (const [freq, q, vol] of o.formants) {
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(freq * o.open[0][1], t);
    for (const [at, m] of o.open) bp.frequency.linearRampToValueAtTime(freq * m, t + at * dur);
    const g = a.createGain();
    g.gain.value = vol * 2.2;
    throat.connect(bp);
    bp.connect(g);
    g.connect(env);
  }
  env.connect(dest);
}

/** The roar that is sounding, so a new one can cut it off instead of piling on top. */
let lastRoar: GainNode | null = null;

export const sfx = {
  pop(pitch = 1) {
    voice('sine', 520 * pitch, 0.4, 0.13, 0, 1300 * pitch, 0.003);
  },
  tap() {
    voice('triangle', 880, 0.18, 0.07);
  },
  flip() {
    voice('triangle', 480, 0.15, 0.08, 0, 760);
  },
  good() {
    [523.25, 659.25, 783.99].forEach((f, i) => voice('triangle', f, 0.28, 0.25, i * 0.07));
  },
  win() {
    [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5].forEach((f, i) =>
      voice('triangle', f, 0.3, i === 5 ? 0.7 : 0.22, i * 0.11),
    );
  },
  /** Mission failed: a low falling tone. */
  oops() {
    voice('sawtooth', 220, 0.12, 0.9, 0, 110, 0.02);
    voice('sine', 110, 0.2, 1.1, 0.05, 55);
  },
  /** Walkie-talkie: a burst of static, a squelch and a click. */
  radio() {
    noise(0.22, 0.12, 'bandpass', 1800);
    voice('square', 1200, 0.05, 0.08, 0.2);
    noise(0.04, 0.12, 'highpass', 3000, 0.28);
  },
  /** A tranquilliser rifle: a compressed-air pop. */
  dartShot() {
    noise(0.08, 0.22, 'bandpass', 1800);
    voice('sine', 300, 0.08, 0.06, 0, 120);
  },
  /** A dart striking hide: a sharp thwack. */
  dartHit() {
    noise(0.05, 0.35, 'highpass', 2200);
    voice('triangle', 520, 0.15, 0.12, 0, 260);
  },
  /** An electric fence: a crackling buzz. */
  zap() {
    voice('sawtooth', 120, 0.18, 0.5, 0, 90);
    voice('square', 240, 0.08, 0.45, 0, 180);
    for (let i = 0; i < 5; i++) noise(0.04, 0.3, 'highpass', 3000, i * 0.08 + Math.random() * 0.04);
  },
  /** A building coming down: a deep rumble under cascading crunches. */
  collapse() {
    noise(2.2, 0.45, 'lowpass', 260);
    voice('sine', 48, 0.3, 1.6, 0, 30);
    for (let i = 0; i < 7; i++) noise(0.18, 0.25, 'bandpass', 800 + Math.random() * 1400, 0.1 + i * 0.22);
  },
  /** A park alarm: a siren wailing up and down twice, a little distant. */
  siren() {
    for (let k = 0; k < 4; k++) voice('sawtooth', k % 2 ? 880 : 480, 0.05, 0.62, k * 0.6, k % 2 ? 480 : 880, 0.05);
    for (let k = 0; k < 4; k++) voice('triangle', k % 2 ? 1320 : 720, 0.04, 0.62, k * 0.6, k % 2 ? 720 : 1320, 0.05);
  },
  /** The power failing: machinery winding down, then a heavy clunk. */
  powerDown() {
    voice('sawtooth', 420, 0.12, 2.2, 0, 40, 0.02);
    voice('sine', 210, 0.12, 2.4, 0, 25, 0.02);
    noise(0.4, 0.4, 'lowpass', 180, 2.1);
    voice('sine', 60, 0.3, 0.5, 2.1, 30);
  },
  /** Distant thunder: a crack, then a long low rumble. */
  thunder() {
    noise(0.25, 0.35, 'lowpass', 1400);
    noise(2.6, 0.4, 'lowpass', 180, 0.1);
    noise(1.8, 0.25, 'lowpass', 90, 0.5);
  },
  boing() {
    voice('sine', 180, 0.3, 0.35, 0, 420);
  },
  whoosh() {
    voice('sine', 900, 0.15, 0.35, 0, 140);
  },
  /**
   * Dinosaur roar, like a lion's roar or a crocodile's bellow made huge: a breathy "aah" that bursts out
   * with a ragged rasp and slides down to "ooh" as the jaws close, over a deep, shuddering rumble, and
   * ends in a hiss of breath. `size` > 1 is deeper and bigger. `short` is a sharp roar on the run.
   */
  roar(size = 1, short = false) {
    if (!ac || !master || muted || ac.state !== 'running') return;
    const t = ac.currentTime + 0.01;
    // Cut off the previous roar.
    lastRoar?.gain.setTargetAtTime(0, t, 0.06);
    const dur = (short ? 1 : 2) * (0.92 + Math.random() * 0.16);
    const bus = callBus(ac, master, 0.55);
    lastRoar = bus;
    const f0 = (40 / size) * (0.94 + Math.random() * 0.12);
    // "Aah" formants of a long, wide throat (lower for bigger animals); `open` slides them towards "ooh".
    const fs = 1 / Math.sqrt(size);
    const swell: [number, number][] = short
      ? [[0.07, 1], [0.4, 0.8], [0.8, 0.35], [1, 0.0001]]
      : [[0.1, 0.75], [0.25, 1], [0.55, 0.8], [0.85, 0.3], [1, 0.0001]];
    growl(ac, bus, t, dur, f0, {
      pitch: [[0, 0.8], [0.15, 1.15], [0.4, 1], [0.75, 0.75], [1, 0.55]],
      open: [[0, 0.75], [0.2, 1.05], [0.5, 0.9], [1, 0.55]],
      env: swell,
      formants: [[340 * fs, 4, 1], [660 * fs, 5, 0.45], [1600 * fs, 6, 0.1]],
      rough: 0.8,
      breathy: 0.5,
    });
    // The crocodile in it: a sub-bass rumble that shudders irregularly under the roar.
    const rumble = ac.createGain();
    rumble.gain.value = 0.8;
    jitter(ac, rumble.gain, t, t + dur + 0.1, 14, 0.5);
    rumble.connect(bus);
    breath(ac, rumble, t, swell.map(([at, v]) => [at * dur, v * 1.4]), 'lowpass', [[0, 65 * fs], [dur, 40 * fs]], 1.5);
    // The breath left over, hissed out through the teeth.
    breath(ac, bus, t, [[dur * 0.6, 0.0001], [dur * 0.85, 0.12], [dur * 1.25, 0.0001]], 'bandpass', [[0, 2000], [dur * 1.25, 1400]], 0.8);
  },
  /** One beat of big leathery wings. */
  flap() {
    noise(0.22, 0.12, 'lowpass', 500);
  },
  /**
   * Big jaws snapping shut: a snarl and a rush of breath as they lunge, then teeth clacking together
   * with a heavy thunk of bone at 0.22 s (when the bite lands).
   */
  chomp() {
    if (!ac || !master || muted || ac.state !== 'running') return;
    const t = ac.currentTime + 0.01;
    const bus = callBus(ac, master, 0.55);
    const shut = 0.21;
    growl(ac, bus, t, 0.42, 70 * (0.94 + Math.random() * 0.12), {
      pitch: [[0, 0.9], [0.4, 1.1], [1, 0.75]],
      open: [[0, 0.7], [0.45, 1.1], [0.55, 0.6], [1, 0.5]],
      env: [[0.15, 0.55], [0.45, 0.7], [0.55, 0.3], [1, 0.0001]],
      formants: [[450, 4, 1], [950, 5, 0.6], [2200, 6, 0.2]],
      rough: 1,
      breathy: 0.7,
    });
    breath(ac, bus, t, [[0.05, 0.25], [shut, 0.5], [shut + 0.02, 0.05], [0.3, 0.0001]], 'bandpass', [[0, 500], [shut, 1500]], 0.8);
    // Teeth: a hard, bright clack, a smaller rattle just after, and the jaw's weight behind it.
    breath(ac, bus, t, [[shut, 0.0001], [shut + 0.003, 1.1], [shut + 0.035, 0.0001]], 'highpass', [[0, 2400]], 0.7);
    breath(ac, bus, t, [[shut + 0.03, 0.0001], [shut + 0.033, 0.4], [shut + 0.06, 0.0001]], 'bandpass', [[0, 3200]], 2);
    voice('sine', 150, 0.45, 0.16, shut, 50, 0.003);
    voice('triangle', 420, 0.15, 0.05, shut, 180, 0.002);
  },
  /** Metal bars taking a hit. */
  clang() {
    voice('square', 520, 0.08, 0.5, 0, 470);
    voice('triangle', 1240, 0.08, 0.6, 0, 1180);
    noise(0.12, 0.25, 'highpass', 2500);
  },
  /** A car getting smashed: a bang, crunching metal and tinkling glass. */
  crash() {
    noise(0.5, 0.45, 'lowpass', 700);
    voice('sine', 80, 0.35, 0.4, 0, 40);
    for (let i = 0; i < 4; i++) voice('triangle', 1800 + Math.random() * 1500, 0.05, 0.15, 0.1 + i * 0.07);
  },
  /** A tree trunk giving way: a creak, then splintering cracks. */
  crack() {
    voice('sawtooth', 95, 0.12, 0.5, 0, 60, 0.15);
    for (let i = 0; i < 6; i++) noise(0.05 + Math.random() * 0.04, 0.35, 'bandpass', 1800 + Math.random() * 2400, 0.25 + i * 0.05 + Math.random() * 0.03);
    noise(0.25, 0.25, 'lowpass', 600, 0.28);
  },
  /** A tree coming down: a rush of leaves and branches, and the trunk's thump. */
  timber(size = 1) {
    noise(0.9, 0.3, 'bandpass', 1500);
    noise(0.6, 0.4 * size, 'lowpass', 180);
    voice('sine', 46, 0.35 * size, 0.6, 0, 28);
    for (let i = 0; i < 5; i++) noise(0.06, 0.2, 'bandpass', 900 + Math.random() * 1600, 0.05 + i * 0.09);
  },
  /** A boulder grinding along the ground. */
  scrape(size = 1) {
    noise(0.35, 0.18 * size, 'lowpass', 260 / size);
    noise(0.25, 0.06, 'bandpass', 1200 + Math.random() * 600);
  },
  /** A startled "eek!" */
  scream() {
    const f = 700 + Math.random() * 300;
    voice('sine', f, 0.12, 0.45, 0, f * 1.6, 0.02);
    voice('triangle', f * 1.5, 0.05, 0.4, 0.02, f * 2.2, 0.02);
  },
  /** A heavy footfall: a low thump you feel more than hear. */
  step(size = 1) {
    noise(0.3, 0.2 * size, 'lowpass', 120);
    voice('sine', 52, 0.22 * size, 0.32, 0, 30);
  },
  /** Engine revving: two short blips, then a long rising growl. */
  vroom() {
    voice('sawtooth', 70, 0.1, 0.22, 0, 150);
    voice('sawtooth', 75, 0.1, 0.22, 0.26, 170);
    voice('sawtooth', 80, 0.12, 1.1, 0.55, 330);
    voice('square', 40, 0.06, 1.1, 0.55, 165);
    noise(1, 0.07, 'lowpass', 600, 0.55);
  },
  thud() {
    noise(0.35, 0.35, 'lowpass', 220);
    voice('sine', 90, 0.3, 0.25, 0, 50);
  },
  beep(high = false) {
    voice('square', high ? 880 : 440, 0.12, high ? 0.6 : 0.25);
  },
  chuff() {
    noise(0.12, 0.1, 'bandpass', 700);
  },
  hiss() {
    noise(0.7, 0.1, 'highpass', 3000);
  },
  snap() {
    voice('triangle', 660, 0.25, 0.1);
    voice('triangle', 990, 0.2, 0.15, 0.05);
  },
  /** Knife through a potato onto a wooden board. */
  chop() {
    noise(0.06, 0.3, 'highpass', 2500);
    noise(0.12, 0.4, 'lowpass', 500, 0.03);
    voice('sine', 150, 0.25, 0.1, 0.03, 80);
  },
  splat() {
    noise(0.14, 0.28, 'lowpass', 700);
    voice('sine', 200, 0.2, 0.14, 0, 110);
  },
  clink(pitch = 1) {
    voice('sine', 2300 * pitch, 0.16, 0.3);
    voice('sine', 3450 * pitch, 0.08, 0.18, 0.015);
  },
  /** Cash register: drawer rattle and two bells. */
  chaching() {
    noise(0.25, 0.25, 'bandpass', 1400);
    voice('sine', 1568, 0.25, 0.7, 0.08);
    voice('sine', 2093, 0.25, 0.9, 0.18);
  },
  crunch() {
    for (let i = 0; i < 3; i++) noise(0.05, 0.3, 'bandpass', 1500 + Math.random() * 1500, i * 0.06);
    noise(0.1, 0.3, 'lowpass', 400);
  },
  slurp(long = false) {
    noise(long ? 0.8 : 0.35, 0.22, 'bandpass', 900);
    voice('sine', 280, 0.08, long ? 0.8 : 0.32, 0, 640);
  },
};

export interface ToneLoop {
  /** Fades to a volume (0 = silent). */
  set(vol: number): void;
  stop(): void;
}

/** A continuous tone, e.g. a generator's hum. Starts silent. */
export function toneLoop(type: OscillatorType, freq: number): ToneLoop {
  const a = ac;
  if (!a || !master || a.state !== 'running') return { set() {}, stop() {} };
  const o = a.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = 0;
  o.connect(g);
  g.connect(master);
  o.start();
  let stopped = false;
  return {
    set(vol) {
      if (!stopped) g.gain.setTargetAtTime(vol, a.currentTime, 0.1);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      g.gain.setTargetAtTime(0, a.currentTime, 0.1);
      o.stop(a.currentTime + 0.6);
    },
  };
}

export interface Ambience {
  /** 0 calm … 1 tense: louder, brighter and more restless. */
  set(intensity: number): void;
  stop(): void;
}

/**
 * The score: a low, dark drone of detuned saws under a slowly breathing filter, a fifth above for
 * unease. Intensity opens the filter and lifts the volume when the hunt is on.
 */
export function ambience(): Ambience {
  const a = ac;
  if (!a || !master || a.state !== 'running') return { set() {}, stop() {} };
  const out = a.createGain();
  out.gain.value = 0;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 220;
  filter.Q.value = 4;
  filter.connect(out);
  out.connect(master);
  const oscs = [55, 55.35, 82.4, 41.2].map((f, i) => {
    const o = a.createOscillator();
    o.type = i === 2 ? 'triangle' : 'sawtooth';
    o.frequency.value = f;
    const g = a.createGain();
    g.gain.value = i === 2 ? 0.25 : i === 3 ? 0.6 : 0.5;
    o.connect(g);
    g.connect(filter);
    o.start();
    return o;
  });
  // A slow breath on the filter.
  const lfo = a.createOscillator();
  lfo.frequency.value = 0.07;
  const depth = a.createGain();
  depth.gain.value = 90;
  lfo.connect(depth);
  depth.connect(filter.frequency);
  lfo.start();
  let stopped = false;
  return {
    set(k) {
      if (stopped) return;
      out.gain.setTargetAtTime(0.05 + k * 0.07, a.currentTime, 0.8);
      filter.frequency.setTargetAtTime(200 + k * 500, a.currentTime, 0.8);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      out.gain.setTargetAtTime(0, a.currentTime, 0.3);
      for (const o of [...oscs, lfo]) o.stop(a.currentTime + 1.5);
    },
  };
}
