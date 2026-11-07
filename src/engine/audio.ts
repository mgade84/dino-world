/**
 * Sound effects are synthesized with Web Audio — no files to download, zero latency.
 * Speech uses the device voice on iOS. Elsewhere it uses recorded clips where scripts/voice
 * made them, else the device voice.
 * iOS only lets audio start inside a user gesture, so main.ts calls unlockAudio()
 * on every tap (it is a no-op once running).
 *
 * iOS puts Web Audio on the ringer channel, so a muted iPad plays nothing. Safari 17+
 * can opt out with navigator.audioSession; older versions (an iPad Air 2 stops at
 * iPadOS 15) get a looping silent <audio>, which moves the page to the media channel.
 */
import { load, save } from './storage';
import { getLang, type Lang, speechLang } from '../i18n';
import { clipKey } from './clipkey';

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let muted = load('muted', false);
let silence: HTMLAudioElement | null = null;
let speechUnlocked = false;

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

/** iOS only speaks from timers once a page has spoken inside a tap, so say nothing in the first one. */
function unlockSpeech(e?: Event) {
  if (speechUnlocked || !isIOS || (e?.type !== 'touchend' && e?.type !== 'click')) return;
  speechUnlocked = true;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

export function unlockAudio(e?: Event) {
  unlockSpeech(e);
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
  if (m) {
    stopSpeech();
    silence?.pause(); // lets other apps' music carry on
  }
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
  /** Dinosaur roar: a deep growl that swells and falls, with breath. `size` > 1 is deeper. */
  roar(size = 1) {
    voice('sawtooth', 120 / size, 0.2, 1.3, 0, 58 / size, 0.18);
    voice('square', 90 / size, 0.1, 1.2, 0.03, 46 / size, 0.15);
    voice('sawtooth', 240 / size, 0.06, 0.9, 0.05, 110 / size, 0.2);
    noise(1.2, 0.22, 'lowpass', 800);
  },
  /** One beat of big leathery wings. */
  flap() {
    noise(0.22, 0.12, 'lowpass', 500);
  },
  /** Big jaws snapping shut. */
  chomp() {
    noise(0.12, 0.3, 'bandpass', 900);
    voice('square', 140, 0.12, 0.12, 0.16, 70);
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
  /** A startled "eek!" */
  scream() {
    const f = 700 + Math.random() * 300;
    voice('sine', f, 0.12, 0.45, 0, f * 1.6, 0.02);
    voice('triangle', f * 1.5, 0.05, 0.4, 0.02, f * 2.2, 0.02);
  },
  /** A soft footstep, for big animals. */
  step(size = 1) {
    noise(0.18, 0.12 * size, 'lowpass', 160);
    voice('sine', 70, 0.12 * size, 0.16, 0, 45);
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

const voiceCache = new Map<string, SpeechSynthesisVoice | null>();

/** Best local voice for a BCP-47 tag like 'da-DK'. iPads ship 'Sara' (da) and 'Samantha' (en). */
function voiceFor(tag: string) {
  if (voiceCache.has(tag)) return voiceCache.get(tag)!;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // not loaded yet; try again next time
  const base = tag.slice(0, 2);
  const v =
    voices.find((x) => x.lang.replace('_', '-') === tag && x.localService) ??
    voices.find((x) => x.lang.replace('_', '-') === tag) ??
    voices.find((x) => x.lang.startsWith(base)) ??
    null;
  voiceCache.set(tag, v);
  return v;
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  const tag = speechLang();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tag;
  u.rate = 0.95;
  u.pitch = 1.15;
  const v = voiceFor(tag);
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

// Recorded clips (scripts/voice) for languages that many devices can't speak well:
// Chrome on Linux, for one, has no Danish voice and reads Danish with an American accent.
// iPads and iPhones ship good voices for both languages, so they always speak live.
const CLIP_LANGS: Lang[] = isIOS ? [] : ['da'];
const clipSets = new Map<Lang, Set<string>>();
const clipBuffers = new Map<string, Promise<AudioBuffer>>(); // most recently used last
let clipSrc: AudioBufferSourceNode | null = null;
let sayId = 0;

function loadClipList(lang: Lang) {
  if (!CLIP_LANGS.includes(lang) || clipSets.has(lang)) return;
  clipSets.set(lang, new Set()); // fall back to the device voice until the list arrives
  fetch(`voice/${lang}/phrases.json`)
    .then((r) => r.json())
    .then((t: Record<string, string>) => clipSets.set(lang, new Set(Object.keys(t))))
    .catch(() => {});
}
loadClipList(getLang());

function clipBuffer(ctx: AudioContext, url: string) {
  let p = clipBuffers.get(url);
  if (p) clipBuffers.delete(url);
  else
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      // Callback form: older Safari has no promise-returning decodeAudioData.
      .then((data) => new Promise<AudioBuffer>((res, rej) => ctx.decodeAudioData(data, res, rej)));
  clipBuffers.set(url, p);
  if (clipBuffers.size > 40) clipBuffers.delete(clipBuffers.keys().next().value!);
  p.catch(() => clipBuffers.delete(url));
  return p;
}

/** Speaks a short phrase in the selected language — helps kids who can't read yet. */
export function say(text: string) {
  if (muted) return;
  const interrupting = 'speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending);
  stopSpeech();
  const id = sayId;
  const lang = getLang();
  loadClipList(lang);
  const key = clipKey(text);
  const known = clipSets.get(lang)?.has(key);
  if (known && ac && master && ac.state === 'running') {
    const [ctx, out] = [ac, master];
    clipBuffer(ctx, `voice/${lang}/${key}.mp3`).then(
      (buf) => {
        if (id !== sayId) return; // something newer was said meanwhile
        const g = ctx.createGain();
        g.gain.value = 1.6; // master is 0.6 for effects; speech should be near full volume
        g.connect(out);
        clipSrc = ctx.createBufferSource();
        clipSrc.buffer = buf;
        clipSrc.connect(g);
        clipSrc.start();
      },
      () => id === sayId && speak(text),
    );
    return;
  }
  if (import.meta.env.DEV && !known && clipSets.get(lang)?.size) {
    console.warn(`No recorded ${lang} clip for "${text}". Add it in scripts/voice/phrases.ts and run scripts/voice/build.sh.`);
  }
  // Safari drops an utterance that follows cancel() too closely.
  if (interrupting) setTimeout(() => id === sayId && speak(text), 80);
  else speak(text);
}

export function stopSpeech() {
  sayId++;
  clipSrc?.stop();
  clipSrc = null;
  if ('speechSynthesis' in window && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
}
