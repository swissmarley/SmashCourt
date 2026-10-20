import type { ShotType } from '../config/shots';

export interface VoiceDef {
  pitch: number;
  timbre: 'bright' | 'deep' | 'squeaky' | 'robotic' | 'breathy';
}

/**
 * Procedural Web Audio: every sound is synthesised (no asset files).
 * Call `unlock()` from a user gesture before anything will play.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private crowdBus!: GainNode;
  private crowdNoise: AudioBufferSourceNode | null = null;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private noiseBuffer!: AudioBuffer;
  private musicStep = 0;
  private nextNoteTime = 0;
  private musicPlaying = false;
  private musicVariant = 0;
  volumes = { master: 0.8, sfx: 1.0, music: 0.55 };
  private crowdLevel = 0.15;
  private crowdTarget = 0.15;

  get ready(): boolean {
    return this.ctx !== null;
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);
    this.crowdBus = ctx.createGain();
    this.crowdBus.gain.value = 0.9;
    this.crowdBus.connect(this.master);

    // Shared noise buffer (2 s white noise)
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Crowd bed: filtered looping noise.
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 500;
    this.crowdFilter.Q.value = 0.6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.0;
    this.crowdFilter.connect(this.crowdGain);
    this.crowdGain.connect(this.crowdBus);
  }

  setVolumes(v: Partial<{ master: number; sfx: number; music: number }>): void {
    Object.assign(this.volumes, v);
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.musicBus.gain.value = this.volumes.music;
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------

  private env(gain: GainNode, t: number, attack: number, decay: number, peak = 1, sustain = 0): void {
    const g = gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + attack + decay);
  }

  private tone(freq: number, type: OscillatorType, t: number, attack: number, decay: number, peak: number, dest: AudioNode, sweepTo?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + attack + decay);
    const g = ctx.createGain();
    this.env(g, t, attack, decay, peak);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  private noise(t: number, attack: number, decay: number, peak: number, dest: AudioNode, filterType: BiquadFilterType = 'lowpass', freq = 2000, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, attack, decay, peak);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  // ---------------------------------------------------------------------------------------------
  // SFX
  // ---------------------------------------------------------------------------------------------

  hit(shot: ShotType, power = 0.5, isPower = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.sfxBus;
    const p = 0.5 + power * 0.6;
    switch (shot) {
      case 'topspin':
        this.noise(t, 0.003, 0.09, 0.7 * p, d, 'bandpass', 1400, 1.2);
        this.tone(320, 'triangle', t, 0.002, 0.12, 0.5 * p, d, 160);
        break;
      case 'slice':
      case 'block':
        this.noise(t, 0.004, 0.16, 0.6 * p, d, 'highpass', 2400, 0.8);
        this.tone(520, 'sine', t, 0.002, 0.1, 0.35 * p, d, 420);
        break;
      case 'flat':
      case 'serve':
        this.noise(t, 0.002, 0.07, 0.9 * p, d, 'bandpass', 1900, 1.5);
        this.tone(220, 'square', t, 0.001, 0.08, 0.35 * p, d, 110);
        break;
      case 'lob':
        this.noise(t, 0.006, 0.14, 0.45 * p, d, 'lowpass', 1200, 1);
        this.tone(280, 'sine', t, 0.004, 0.2, 0.4 * p, d, 420);
        break;
      case 'drop':
        this.noise(t, 0.006, 0.1, 0.35 * p, d, 'lowpass', 900, 1);
        this.tone(380, 'sine', t, 0.004, 0.14, 0.3 * p, d, 300);
        break;
      case 'power':
        break;
    }
    if (isPower || shot === 'power') {
      this.noise(t, 0.002, 0.35, 1.0, d, 'bandpass', 900, 0.8);
      this.tone(90, 'sawtooth', t, 0.005, 0.5, 0.6, d, 30);
      this.tone(1200, 'square', t, 0.002, 0.25, 0.25, d, 2400);
    }
  }

  bounce(brightness: number, speed: number, patch = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, speed / 25) * 0.6 + 0.15;
    const f = 500 + brightness * 1800;
    this.noise(t, 0.002, 0.05 + (1 - brightness) * 0.06, v, this.sfxBus, 'lowpass', f, 1);
    this.tone(140 + brightness * 90, 'sine', t, 0.001, 0.07, v * 0.6, this.sfxBus, 70);
    if (patch) this.tone(600, 'sine', t, 0.005, 0.25, 0.5, this.sfxBus, 1400);
  }

  net(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(180, 'sawtooth', t, 0.002, 0.25, 0.35, this.sfxBus, 90);
    this.noise(t, 0.002, 0.18, 0.4, this.sfxBus, 'bandpass', 700, 2);
  }

  swing(): void {
    if (!this.ctx) return;
    this.noise(this.ctx.currentTime, 0.03, 0.12, 0.18, this.sfxBus, 'bandpass', 1200, 0.7);
  }

  dive(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.02, 0.25, 0.4, this.sfxBus, 'lowpass', 600, 1);
    this.tone(120, 'sine', t + 0.2, 0.005, 0.15, 0.4, this.sfxBus, 60);
  }

  chargeTick(level: number): void {
    if (!this.ctx) return;
    this.tone(300 + level * 500, 'sine', this.ctx.currentTime, 0.005, 0.05, 0.12, this.sfxBus);
  }

  perfect(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(880, 'sine', t, 0.005, 0.18, 0.35, this.sfxBus);
    this.tone(1320, 'sine', t + 0.05, 0.005, 0.22, 0.3, this.sfxBus);
  }

  powerCharge(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(200, 'sawtooth', t, 0.3, 0.3, 0.3, this.sfxBus, 900);
    this.noise(t, 0.3, 0.3, 0.3, this.sfxBus, 'bandpass', 1500, 2);
  }

  meterFull(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.07, 0.005, 0.25, 0.3, this.sfxBus));
  }

  chanceAppear(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1200, 'sine', t, 0.005, 0.2, 0.25, this.sfxBus, 1800);
    this.tone(1600, 'sine', t + 0.08, 0.005, 0.25, 0.2, this.sfxBus, 2400);
  }

  stun(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(400, 'square', t, 0.002, 0.3, 0.3, this.sfxBus, 80);
    this.noise(t, 0.002, 0.2, 0.5, this.sfxBus, 'lowpass', 1200, 1);
  }

  ui(kind: 'move' | 'confirm' | 'back'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (kind === 'move') this.tone(700, 'square', t, 0.002, 0.05, 0.12, this.sfxBus);
    else if (kind === 'confirm') {
      this.tone(600, 'square', t, 0.002, 0.08, 0.15, this.sfxBus);
      this.tone(900, 'square', t + 0.06, 0.002, 0.12, 0.15, this.sfxBus);
    } else {
      this.tone(500, 'square', t, 0.002, 0.08, 0.15, this.sfxBus);
      this.tone(330, 'square', t + 0.06, 0.002, 0.12, 0.15, this.sfxBus);
    }
  }

  /** Point-won jingle / fanfare. */
  fanfare(big = false): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = big ? [523, 659, 784, 1046, 784, 1046, 1318] : [659, 784, 1046];
    notes.forEach((f, i) => {
      this.tone(f, 'triangle', t + i * 0.11, 0.005, 0.3, 0.3, this.sfxBus);
      this.tone(f / 2, 'square', t + i * 0.11, 0.005, 0.2, 0.08, this.sfxBus);
    });
  }

  fault(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(330, 'square', t, 0.005, 0.15, 0.2, this.sfxBus);
    this.tone(247, 'square', t + 0.14, 0.005, 0.25, 0.2, this.sfxBus);
  }

  /** Character grunt: a formant-ish burst with a per-character pitch and timbre. */
  grunt(voice: VoiceDef, intensity = 0.6): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.12 + intensity * 0.18;
    const o = ctx.createOscillator();
    o.type = voice.timbre === 'robotic' ? 'square' : voice.timbre === 'squeaky' ? 'triangle' : 'sawtooth';
    const base = voice.pitch * (0.9 + Math.random() * 0.2);
    o.frequency.setValueAtTime(base * 0.8, t);
    o.frequency.linearRampToValueAtTime(base * (voice.timbre === 'squeaky' ? 1.5 : 1.15), t + dur * 0.3);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(voice.timbre === 'deep' ? 400 : voice.timbre === 'breathy' ? 1400 : 900, t);
    f.frequency.linearRampToValueAtTime(voice.timbre === 'deep' ? 700 : 1800, t + dur * 0.5);
    f.Q.value = voice.timbre === 'robotic' ? 6 : 2.5;
    const g = ctx.createGain();
    this.env(g, t, 0.015, dur, 0.35 * (0.6 + intensity * 0.6));
    o.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
    if (voice.timbre === 'breathy') this.noise(t, 0.01, dur, 0.2, this.sfxBus, 'bandpass', 2000, 1);
    if (voice.timbre === 'robotic') this.tone(base * 2, 'square', t, 0.005, dur * 0.5, 0.08, this.sfxBus);
  }

  // ---------------------------------------------------------------------------------------------
  // Crowd
  // ---------------------------------------------------------------------------------------------

  startCrowd(): void {
    if (!this.ctx || this.crowdNoise) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.connect(this.crowdFilter);
    src.start();
    this.crowdNoise = src;
  }

  stopCrowd(): void {
    if (this.crowdNoise) {
      try {
        this.crowdNoise.stop();
      } catch {
        /* already stopped */
      }
      this.crowdNoise.disconnect();
      this.crowdNoise = null;
    }
  }

  /** Set the crowd murmur level (0..1). */
  setCrowdLevel(level: number): void {
    this.crowdTarget = level;
  }

  /** Cheer burst scaled by the rally length / drama. */
  cheer(amount: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const a = Math.min(1, amount);
    this.noise(t, 0.15, 0.9 + a * 0.8, 0.35 + a * 0.45, this.crowdBus, 'bandpass', 800 + a * 500, 0.7);
    // A few "voices"
    const n = 3 + Math.round(a * 5);
    for (let i = 0; i < n; i++) {
      const f = 300 + Math.random() * 500;
      this.tone(f, 'sawtooth', t + Math.random() * 0.3, 0.1, 0.5 + Math.random() * 0.4, 0.03 + a * 0.03, this.crowdBus, f * (0.8 + Math.random() * 0.5));
    }
  }

  /** Disappointed "ooh". */
  groan(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.1, 0.7, 0.3, this.crowdBus, 'bandpass', 500, 1);
    this.tone(280, 'sawtooth', t, 0.1, 0.7, 0.05, this.crowdBus, 180);
  }

  // ---------------------------------------------------------------------------------------------
  // Music: a procedural upbeat loop scheduled ahead of time.
  // ---------------------------------------------------------------------------------------------

  startMusic(variant = 0): void {
    if (!this.ctx) return;
    this.musicVariant = variant;
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    this.musicStep = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
  }

  stopMusic(): void {
    this.musicPlaying = false;
  }

  /** Call every frame. */
  update(dt: number): void {
    if (!this.ctx) return;
    // Crowd murmur easing
    this.crowdLevel += (this.crowdTarget - this.crowdLevel) * Math.min(1, dt * 2);
    if (this.crowdNoise) this.crowdGain.gain.value = this.crowdLevel * 0.25;

    if (!this.musicPlaying) return;
    const bpm = this.musicVariant === 2 ? 100 : 128;
    const stepDur = 60 / bpm / 4; // sixteenth notes
    while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
      this.scheduleStep(this.musicStep, this.nextNoteTime, stepDur);
      this.nextNoteTime += stepDur;
      this.musicStep = (this.musicStep + 1) % 64;
    }
  }

  private scheduleStep(step: number, t: number, stepDur: number): void {
    const d = this.musicBus;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    // Chord progression (I - V - vi - IV in C major), per bar.
    const roots = [261.63, 392.0, 440.0, 349.23];
    const chords = [
      [261.63, 329.63, 392.0],
      [392.0, 493.88, 587.33],
      [440.0, 523.25, 659.25],
      [349.23, 440.0, 523.25],
    ];
    const root = roots[bar];
    const chord = chords[bar];
    const menu = this.musicVariant === 1;
    const calm = this.musicVariant === 2;

    // Drums
    if (!calm) {
      if (s % 4 === 0) this.tone(150, 'sine', t, 0.002, 0.18, 0.9, d, 40); // kick
      if (s === 4 || s === 12) this.noise(t, 0.002, 0.12, 0.35, d, 'bandpass', 1800, 0.8); // snare
      if (s % 2 === 1) this.noise(t, 0.001, 0.04, 0.12, d, 'highpass', 6000, 1); // hats
      if (s === 14 && bar === 3) this.noise(t, 0.002, 0.2, 0.3, d, 'bandpass', 2500, 0.8);
    } else if (s % 8 === 0) {
      this.tone(120, 'sine', t, 0.002, 0.2, 0.5, d, 40);
    }

    // Bass: root on the beat with an octave bounce.
    if (s % 4 === 0 || s % 8 === 6) {
      const f = (s % 8 === 6 ? root : root / 2) * (menu ? 0.5 : 1);
      this.tone(f, 'square', t, 0.005, stepDur * 1.6, 0.18, d);
      this.tone(f, 'sawtooth', t, 0.005, stepDur * 1.2, 0.08, d);
    }

    // Chord stabs
    if (s === 0 || s === 8 || (!calm && s === 11)) {
      for (const f of chord) this.tone(f, 'triangle', t, 0.01, stepDur * (calm ? 6 : 2.5), 0.1, d);
    }

    // Lead arpeggio (pentatonic over the chord), every other sixteenth.
    if (!calm && s % 2 === 0) {
      const scale = [chord[0], chord[1], chord[2], chord[0] * 2, chord[1] * 2];
      const idx = ((s / 2) * 3 + bar) % scale.length;
      const f = scale[idx] * (menu ? 1 : 2);
      this.tone(f, menu ? 'sine' : 'square', t, 0.005, stepDur * 1.1, 0.07, d);
    }
    if (calm && s % 4 === 2) {
      const f = chord[(bar + s / 4) % 3] * 2;
      this.tone(f, 'sine', t, 0.02, stepDur * 3, 0.09, d);
    }
  }
}

export const audio = new AudioEngine();
