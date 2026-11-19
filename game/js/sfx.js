// Sound for Sunspire Heat: everything is synthesized with WebAudio.
// No audio files ship with the game, so it plays fully offline.

/** Tiny synth engine. Call unlock() from a user gesture first. */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.4;
    this.master.connect(this.ctx.destination);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.4;
    return this.muted;
  }

  _tone(freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    gain.gain.setValueAtTime(vol || 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise(dur, vol, filterFreq) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 1200;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol || 0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
  }

  click() { this._tone(660, 0.06, 'square', 0.12); }
  pickup() { this._tone(880, 0.12, 'sine', 0.2, 1320); }
  coin() { this._tone(1240, 0.1, 'triangle', 0.18); this._tone(1860, 0.14, 'triangle', 0.12); }
  punch() { this._noise(0.09, 0.35, 700); }
  shot() { this._noise(0.14, 0.5, 2600); this._tone(160, 0.1, 'square', 0.18, 60); }
  crash() { this._noise(0.25, 0.45, 500); }
  sirenBlip() { this._tone(950, 0.18, 'sine', 0.1, 700); }
  jingle() {
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.22, 'triangle', 0.2), i * 110);
    });
  }
  fail() {
    [392, 330, 262].forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.25, 'sawtooth', 0.12), i * 140);
    });
  }

  /** Continuous engine hum; call every frame with speed 0..1. */
  engine(speed01, on) {
    if (!this.ctx || this.muted) return;
    if (!on) {
      if (this.engineGain) this.engineGain.gain.value = 0;
      return;
    }
    if (!this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
    }
    const t = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(55 + speed01 * 130, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.05 + speed01 * 0.06, t, 0.1);
  }

  /** Two-tone police siren while wanted; call every frame. */
  siren(dt, on) {
    if (!this.ctx || this.muted) return;
    if (!on) {
      if (this.sirenGain) this.sirenGain.gain.value = 0;
      return;
    }
    if (!this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.master);
      this.sirenOsc.start();
    }
    this.sirenTimer += dt;
    const hi = Math.floor(this.sirenTimer / 0.45) % 2 === 0;
    const t = this.ctx.currentTime;
    this.sirenOsc.frequency.setTargetAtTime(hi ? 720 : 540, t, 0.05);
    this.sirenGain.gain.setTargetAtTime(0.045, t, 0.1);
  }
}
