// Tiny WebAudio synthesiser: engine, tyre noise, wind and UI blips. No audio files needed.
const GEARS = [0, 13, 24, 35, 47, 60, 90];

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
    this.engineOn = false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  startEngine() {
    if (!this.ctx || this.engineOn) return;
    const c = this.ctx;
    this.engineOn = true;
    const e = {};
    e.osc1 = c.createOscillator(); e.osc1.type = 'sawtooth';
    e.osc2 = c.createOscillator(); e.osc2.type = 'square';
    e.filter = c.createBiquadFilter(); e.filter.type = 'lowpass'; e.filter.Q.value = 3;
    e.gain = c.createGain(); e.gain.gain.value = 0;
    e.osc1.connect(e.filter); e.osc2.connect(e.filter);
    e.filter.connect(e.gain); e.gain.connect(this.master);
    // tyres
    e.skid = this._noiseSource();
    e.skidFilter = c.createBiquadFilter(); e.skidFilter.type = 'bandpass'; e.skidFilter.frequency.value = 1400; e.skidFilter.Q.value = 1.4;
    e.skidGain = c.createGain(); e.skidGain.gain.value = 0;
    e.skid.connect(e.skidFilter); e.skidFilter.connect(e.skidGain); e.skidGain.connect(this.master);
    // wind
    e.wind = this._noiseSource();
    e.windFilter = c.createBiquadFilter(); e.windFilter.type = 'lowpass'; e.windFilter.frequency.value = 500;
    e.windGain = c.createGain(); e.windGain.gain.value = 0;
    e.wind.connect(e.windFilter); e.windFilter.connect(e.windGain); e.windGain.connect(this.master);
    for (const n of [e.osc1, e.osc2, e.skid, e.wind]) n.start();
    this.eng = e;
  }

  stopEngine() {
    if (!this.engineOn) return;
    this.engineOn = false;
    const e = this.eng;
    const t = this.ctx.currentTime;
    for (const g of [e.gain, e.skidGain, e.windGain]) g.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(() => { for (const n of [e.osc1, e.osc2, e.skid, e.wind]) { try { n.stop(); } catch { /* ignore */ } } }, 400);
    this.eng = null;
  }

  // speed m/s, throttle 0..1, slip m/s, grounded wheels, boosting bool
  updateEngine(speed, throttle, slip, grounded, boosting) {
    if (!this.engineOn) return;
    const e = this.eng, t = this.ctx.currentTime;
    let g = 0;
    while (g < GEARS.length - 2 && speed > GEARS[g + 1]) g++;
    const lo = GEARS[g], hi = GEARS[g + 1];
    const rpm = 0.3 + 0.7 * Math.min(1, (speed - lo) / (hi - lo)) + (grounded ? 0 : throttle * 0.25);
    const f = 48 + rpm * 120 + g * 6;
    e.osc1.frequency.setTargetAtTime(f, t, 0.04);
    e.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    e.filter.frequency.setTargetAtTime(380 + throttle * 1100 + rpm * 500 + (boosting ? 700 : 0), t, 0.05);
    e.gain.gain.setTargetAtTime(0.06 + throttle * 0.07 + (boosting ? 0.04 : 0), t, 0.06);
    const skid = grounded > 1 ? Math.min(1, Math.max(0, (slip - 2.5) / 7)) : 0;
    e.skidGain.gain.setTargetAtTime(skid * 0.12, t, 0.05);
    e.windGain.gain.setTargetAtTime(Math.min(0.12, speed * speed * 0.00003), t, 0.1);
  }

  _tone(freq, start, dur, { type = 'sine', gain = 0.2, slide = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  countdown(final) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(final ? 880 : 440, t, final ? 0.45 : 0.18, { type: 'square', gain: 0.08 });
  }

  checkpoint() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(988, t, 0.12, { type: 'triangle', gain: 0.18 });
    this._tone(1480, t + 0.08, 0.22, { type: 'triangle', gain: 0.16 });
  }

  finish(good) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = good ? [523, 659, 784, 1047] : [523, 659, 784];
    notes.forEach((n, i) => this._tone(n, t + i * 0.11, 0.35, { type: 'triangle', gain: 0.17 }));
  }

  boost() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = this._noiseSource();
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.6);
  }

  impact(strength) {
    if (!this.ctx || strength < 3) return;
    const c = this.ctx, t = c.currentTime;
    const src = this._noiseSource();
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = c.createGain(); g.gain.setValueAtTime(Math.min(0.35, strength * 0.03), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.3);
  }

  stunt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(523, t, 0.12, { type: 'triangle', gain: 0.12, slide: 260 });
    this._tone(784, t + 0.07, 0.2, { type: 'triangle', gain: 0.11, slide: 400 });
  }

  click() {
    if (!this.ctx) return;
    this._tone(660, this.ctx.currentTime, 0.06, { type: 'triangle', gain: 0.08 });
  }
}
