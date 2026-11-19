// audio.js — a tiny WebAudio synth: no audio files, every sound is built
// from oscillators and filtered noise at play time. Engine hum and sirens
// are looping nodes whose pitch follows the game; the rest are one-shots.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.engineGain = null;
    this.siren = null;
    this.sirenGain = null;
    this.muted = false;
  }

  /** Create the context on the first user gesture (browser policy). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  /** A short oscillator blip with an exponential decay. */
  blip(freqA, freqB, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqB), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain); gain.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  /** A burst of white noise through a bandpass: shots, crashes, splashes. */
  noise(dur, freq, vol, q = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start(t);
  }

  click() { this.blip(660, 520, 0.07, 'square', 0.12); }
  pickup() { this.blip(880, 1320, 0.14, 'sine', 0.22); this.blip(1320, 1760, 0.18, 'sine', 0.12); }
  cash() { this.blip(1180, 1180, 0.06, 'triangle', 0.2); setTimeout(() => this.blip(1560, 1560, 0.1, 'triangle', 0.2), 55); }
  /** Engine turning over when Marisol gets in a car. */
  engineOn() { this.blip(90, 190, 0.28, 'sawtooth', 0.14); this.noise(0.12, 500, 0.12, 0.8); }
  /** Tyre screech for handbrake drifts. */
  screech() { this.noise(0.28, 2400, 0.14, 3); }
  /** A neon tag collected: a bright two-note chime. */
  tag() { this.blip(1568, 1568, 0.1, 'sine', 0.2); setTimeout(() => this.blip(2093, 2093, 0.16, 'sine', 0.18), 70); }
  /** Reputation level up: a rising four-note fanfare. */
  levelUp() {
    if (!this.ctx || this.muted) return;
    [392, 523, 659, 784].forEach((n, i) => setTimeout(() => this.blip(n, n, 0.2, 'triangle', 0.2), i * 85));
  }
  /** A street event starting: a low-high alert call. */
  eventStart() { this.blip(330, 330, 0.12, 'square', 0.16); setTimeout(() => this.blip(660, 660, 0.16, 'square', 0.16), 120); }
  /** A race checkpoint passed: a quick rising tick. */
  raceCheckpoint() { this.blip(980, 1470, 0.12, 'sine', 0.2); }
  door() { this.noise(0.09, 500, 0.25, 0.8); this.blip(180, 120, 0.1, 'square', 0.1); }
  horn() { this.blip(370, 360, 0.22, 'sawtooth', 0.14); this.blip(466, 452, 0.22, 'sawtooth', 0.1); }
  crash(big) { this.noise(big ? 0.4 : 0.18, big ? 300 : 700, big ? 0.5 : 0.3, 0.6); this.blip(120, 40, 0.25, 'square', 0.2); }
  shot() { this.noise(0.11, 1800, 0.4, 0.5); this.blip(220, 60, 0.09, 'square', 0.22); }
  punch() { this.noise(0.07, 400, 0.3, 1.2); }
  hurt() { this.blip(300, 140, 0.16, 'sawtooth', 0.2); }
  star() { this.blip(520, 780, 0.12, 'square', 0.16); }
  missionDone() {
    if (!this.ctx || this.muted) return;
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => setTimeout(() => this.blip(n, n, 0.22, 'triangle', 0.2), i * 95));
  }
  busted() { this.blip(392, 392, 0.2, 'square', 0.18); setTimeout(() => this.blip(311, 311, 0.2, 'square', 0.18), 200); setTimeout(() => this.blip(233, 220, 0.4, 'square', 0.18), 400); }
  splash() { this.noise(0.5, 900, 0.3, 0.4); }

  /** Start/stop the looping engine hum; pitch follows speed each frame. */
  setEngine(on, speedRatio) {
    if (!this.ctx) return;
    if (on && !this.engine) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 55;
      gain.gain.value = 0.0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 420;
      osc.connect(filter); filter.connect(gain); gain.connect(this.master);
      osc.start();
      this.engine = osc; this.engineGain = gain;
    }
    if (!on && this.engine) {
      try { this.engine.stop(); } catch { /* already stopped */ }
      this.engine = null; this.engineGain = null;
    }
    if (this.engine && this.engineGain) {
      const t = this.ctx.currentTime;
      this.engine.frequency.setTargetAtTime(50 + speedRatio * 130, t, 0.08);
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : 0.05 + speedRatio * 0.05, t, 0.1);
    }
  }

  /** Start/stop the looping police siren wail while heat is near. */
  setSiren(on) {
    if (!this.ctx) return;
    if (on && !this.siren) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 760;
      lfo.frequency.value = 0.65;
      lfoGain.gain.value = 190;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      gain.gain.value = 0.0;
      osc.connect(gain); gain.connect(this.master);
      osc.start(); lfo.start();
      this.siren = { osc, lfo }; this.sirenGain = gain;
    }
    if (!on && this.siren) {
      try { this.siren.osc.stop(); this.siren.lfo.stop(); } catch { /* already stopped */ }
      this.siren = null; this.sirenGain = null;
    }
    if (this.sirenGain) {
      this.sirenGain.gain.setTargetAtTime(this.muted ? 0 : 0.028, this.ctx.currentTime, 0.2);
    }
  }
}
