/**
 * Every sound is synthesized with WebAudio at runtime: there are no audio
 * files, so nothing to license and nothing to download at the event.
 */
export type SfxName = 'pop' | 'tap' | 'whoosh' | 'tick' | 'count' | 'go' | 'reveal' | 'correct' | 'wrong' | 'drumroll' | 'fanfare';
export type MusicName = 'lobby' | 'question';

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  glideTo?: number;
  cutoff?: number;
  dest?: AudioNode;
}

interface NoiseOptions {
  filter?: BiquadFilterType;
  freq?: number;
  freqTo?: number;
  q?: number;
  gain?: number;
  dest?: AudioNode;
}

/** MIDI note number → Hz */
const hz = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** the first of these on the page lets the browser start audio (touch screens count on pointerup) */
const GESTURES = ['pointerdown', 'pointerup', 'keydown'] as const;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicBus: GainNode | null = null;
  private loop: { name: MusicName; timer: ReturnType<typeof setInterval> } | null = null;
  private wantMusic: MusicName | null = null;
  private hurried = false;
  private enabled = false;
  private listeners = new Set<() => void>();
  private waitingForGesture = false;

  get isEnabled() {
    return this.enabled;
  }

  /** Sound is on, but the browser holds it back until someone clicks or presses a key. */
  isBlocked = () => this.enabled && this.ctx?.state !== 'running';

  /** For useSyncExternalStore: fires whenever isBlocked() may have changed. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.stopLoop();
    else {
      this.init();
      if (this.wantMusic) this.startLoop(this.wantMusic);
    }
    this.notify();
  }

  /** Call from a click or key press: starts audio the browser was holding back. */
  unlock() {
    if (!this.enabled) return;
    const fresh = !this.ctx;
    this.init();
    if (fresh && this.ctx && this.wantMusic) this.startLoop(this.wantMusic);
  }

  /** Background music that keeps playing until changed; null stops it. */
  music(name: MusicName | null) {
    this.wantMusic = name;
    if (!name) return this.stopLoop();
    if (this.loop?.name === name) return;
    if (this.enabled) this.startLoop(name);
  }

  /** The last seconds of a question: its music picks up speed until this is turned off (sound turned on meanwhile too). */
  hurry(on: boolean) {
    this.hurried = on;
  }

  play(name: SfxName) {
    const ctx = this.enabled ? this.init() : null;
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'pop': {
        const f = 520 + Math.random() * 260;
        return this.tone(f, t, 0.12, { gain: 0.16, glideTo: f * 1.6 });
      }
      case 'tap':
        return this.tone(700, t, 0.06, { type: 'triangle', gain: 0.14 });
      case 'whoosh':
        return this.noise(t, 0.65, { filter: 'bandpass', freq: 220, freqTo: 4200, q: 0.8, gain: 0.32 });
      case 'tick':
        return this.tone(1500, t, 0.05, { type: 'square', gain: 0.05, cutoff: 5000 });
      case 'count':
        return this.tone(880, t, 0.16, { type: 'triangle', gain: 0.18 });
      case 'go':
        this.tone(hz(76), t, 0.12, { type: 'triangle', gain: 0.2 });
        return this.tone(hz(83), t + 0.1, 0.3, { type: 'triangle', gain: 0.22 });
      case 'reveal':
        return [72, 76, 79, 84].forEach((n, i) => this.tone(hz(n), t + i * 0.07, 0.8, { type: 'triangle', gain: 0.13 }));
      case 'correct':
        return [72, 76, 79, 84].forEach((n, i) => this.tone(hz(n), t + i * 0.08, 0.35, { type: 'square', gain: 0.06, cutoff: 3000 }));
      case 'wrong':
        return this.tone(220, t, 0.45, { type: 'sawtooth', gain: 0.1, glideTo: 140, cutoff: 900 });
      case 'drumroll':
        return this.drumroll(t, 1.6);
      case 'fanfare':
        return this.fanfare(t);
    }
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }

  /** Before the first click or key press the browser refuses to start audio, so wait for one instead of failing. */
  private waitForGesture() {
    if (this.waitingForGesture) return;
    this.waitingForGesture = true;
    const go = () => {
      if (navigator.userActivation?.hasBeenActive === false) return;
      GESTURES.forEach((g) => window.removeEventListener(g, go, true));
      this.waitingForGesture = false;
      this.unlock();
      this.notify();
    };
    GESTURES.forEach((g) => window.addEventListener(g, go, true));
  }

  private init(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      if (navigator.userActivation?.hasBeenActive === false) {
        this.waitForGesture();
        return null;
      }
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      // iPhones mute web audio with the silent switch unless the page says it plays media (Safari 16.4+);
      // only reached once someone turned sound on, so taking over the speaker is what they asked for
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.7;
      // keeps stacked sounds from clipping
      master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.noiseBuf = buf;
      ctx.addEventListener('statechange', () => this.notify());
      // the browser can still suspend audio later (another tab, a lost gesture): resume on the next tap or key press
      const resume = () => void (ctx.state === 'suspended' && ctx.resume());
      GESTURES.forEach((g) => window.addEventListener(g, resume));
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, at: number, dur: number, o: ToneOptions = {}) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, at);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let node: AudioNode = osc;
    if (o.cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.cutoff;
      node = node.connect(f);
    }
    node.connect(g).connect(o.dest ?? this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  private noise(at: number, dur: number, o: NoiseOptions = {}) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 1000, at);
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, at + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, at + Math.min(0.02, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(o.dest ?? this.master!);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dur + 0.05);
  }

  private drumroll(t: number, dur: number) {
    for (let at = t; at < t + dur; ) {
      const p = (at - t) / dur;
      this.noise(at, 0.06, { filter: 'bandpass', freq: 1800, q: 0.7, gain: 0.08 + 0.22 * p });
      at += 0.085 - 0.05 * p;
    }
    this.noise(t + dur, 1.2, { filter: 'highpass', freq: 4000, gain: 0.22 });
    this.tone(130, t + dur, 0.5, { gain: 0.5, glideTo: 45 });
  }

  private fanfare(t: number) {
    const brass = { type: 'sawtooth' as const, gain: 0.09, cutoff: 2600 };
    [67, 72, 76].forEach((n, i) => this.tone(hz(n), t + i * 0.13, 0.16, brass));
    this.tone(hz(79), t + 0.39, 0.32, brass);
    this.tone(hz(76), t + 0.71, 0.14, brass);
    [72, 76, 79, 84].forEach((n) => this.tone(hz(n), t + 0.86, 1.6, { ...brass, gain: 0.07, cutoff: 2200 }));
    this.noise(t + 0.86, 1.4, { filter: 'highpass', freq: 5000, gain: 0.14 });
  }

  // ---------- music loops (scheduled slightly ahead so timing stays tight) ----------

  private startLoop(name: MusicName) {
    this.stopLoop();
    const ctx = this.init();
    if (!ctx || !this.master) return;
    const bus = ctx.createGain();
    bus.gain.value = name === 'lobby' ? 0.32 : 0.26;
    bus.connect(this.master);
    this.musicBus = bus;
    const beat = 60 / (name === 'lobby' ? 112 : 136) / 2;
    let i = 0;
    let at = ctx.currentTime + 0.08;
    const schedule = () => {
      while (at < ctx.currentTime + 0.3) {
        // hurried: from 136 to 170 beats a minute, from the next step on
        const step = name === 'question' && this.hurried ? beat * 0.8 : beat;
        if (name === 'lobby') this.lobbyStep(i, at, step, bus);
        else this.questionStep(i, at, step, bus, this.hurried);
        at += step;
        i = (i + 1) % 64;
      }
    };
    schedule();
    this.loop = { name, timer: setInterval(schedule, 80) };
  }

  private stopLoop() {
    if (!this.loop) return;
    clearInterval(this.loop.timer);
    this.loop = null;
    const bus = this.musicBus;
    if (bus && this.ctx) {
      bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      setTimeout(() => bus.disconnect(), 600);
    }
    this.musicBus = null;
  }

  /** Bouncy I–vi–IV–V loop for the lobby */
  private lobbyStep(i: number, t: number, step: number, bus: GainNode) {
    const chords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]];
    const chord = chords[Math.floor(i / 8) % 4]!;
    const pos = i % 8;
    if (pos === 0 || pos === 3 || pos === 4) this.tone(hz(chord[0]! - 24), t, step * 1.6, { type: 'triangle', gain: 0.35, dest: bus });
    const arp = [0, 1, 2, 1, 2, 1, 0, 2][pos]!;
    this.tone(hz(chord[arp]! + 12), t, step * 0.9, { type: 'square', gain: 0.05, cutoff: 2400, dest: bus });
    if (pos % 4 === 0) this.tone(140, t, 0.18, { gain: 0.4, glideTo: 50, dest: bus });
    if (pos % 2 === 1) this.noise(t, 0.04, { filter: 'highpass', freq: 7000, gain: 0.06, dest: bus });
    if (i >= 32 && (pos === 2 || pos === 6)) this.tone(hz(chord[(pos / 2) % 3]! + 24), t, step * 1.5, { gain: 0.06, dest: bus });
  }

  /** Driving minor pulse while a question is open */
  private questionStep(i: number, t: number, step: number, bus: GainNode, hurried: boolean) {
    const bar = Math.floor(i / 8) % 4;
    const pos = i % 8;
    const root = [45, 41, 48, 43][bar]!;
    this.tone(hz(root), t, step * 0.8, { type: 'sawtooth', gain: 0.07, cutoff: 600 + 400 * (pos % 2), dest: bus });
    if (pos % 2 === 0) this.tone(150, t, 0.12, { gain: 0.3, glideTo: 50, dest: bus });
    this.noise(t, 0.03, { filter: 'highpass', freq: 8000, gain: pos % 2 ? 0.05 : 0.025, dest: bus });
    if (pos === 4) this.noise(t, 0.12, { filter: 'bandpass', freq: 1800, q: 0.8, gain: 0.12, dest: bus });
    // hurried: a kick on every step and a hi-hat between them
    if (hurried) {
      if (pos % 2 === 1) this.tone(150, t, 0.1, { gain: 0.22, glideTo: 50, dest: bus });
      this.noise(t + step / 2, 0.02, { filter: 'highpass', freq: 9000, gain: 0.04, dest: bus });
    }
    if (pos === 0 || pos === 3 || pos === 6) {
      const lead = [69, 72, 76, 72][(i >> 1) % 4]!;
      this.tone(hz(lead + (bar === 1 ? -4 : 0)), t, step * 0.7, { type: 'triangle', gain: 0.05, dest: bus });
    }
  }
}

export const sfx = new SoundEngine();

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // not supported (iOS Safari): silently skip
  }
}
