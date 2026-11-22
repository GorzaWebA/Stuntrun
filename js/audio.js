// Procedural audio: engine, tyres, surfaces, impacts, UI sounds and a small
// generative soundtrack. Everything is synthesised with WebAudio – no files.
//
// Signal flow:  sfx ─┐
//              music ─┼─> master ─> compressor ─> speakers
//             reverb ─┘   (sfx/music can also send into the reverb)

const IDLE = 0.13;                         // idle rpm as a fraction of redline
const REDLINE_RPM = 7800;
const GEAR_TOP = [15, 25, 35, 46, 57, 70]; // m/s at redline in each gear

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Band-limited engine timbre as a PeriodicWave: the browser renders it without
// aliasing at any pitch. A formant around the 3rd-5th harmonic gives the
// "growl"; random phases make it less buzzy.
function makeEngineWave(ctx, { count, tilt, formant, formantGain, seed, odd = 0 }) {
  const rnd = mulberry32(seed);
  const real = new Float32Array(count + 1), imag = new Float32Array(count + 1);
  for (let h = 1; h <= count; h++) {
    let a = 1 / Math.pow(h, tilt);
    a *= 1 + formantGain * Math.exp(-((h - formant) ** 2) / 5);
    if (h % 2 === 1) a *= 1 + odd;
    const ph = rnd() * Math.PI * 2;
    real[h] = a * Math.cos(ph);
    imag[h] = a * Math.sin(ph);
  }
  return ctx.createPeriodicWave(real, imag);
}

function makeNoiseBuffer(ctx, seconds, brown = false) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rnd = mulberry32(brown ? 7 : 3);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const rnd = mulberry32(11);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function softClipCurve(amount) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
    this.musicOn = true;
    this.musicVolume = 0.45;
    this.engineOn = false;
    this.music = null;
    this.musicMode = 'menu';
    this.paused = false;
  }

  // Creates the AudioContext on the first user gesture (required on mobile).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.attach(new AC());
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend().catch(() => {});
        else this.ctx.resume().catch(() => {});
      });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (this.musicOn && !this.music.running) this.music.start();
  }

  // Builds the mixing graph on a context (also used for offline rendering in tests).
  attach(ctx) {
    this.ctx = ctx;
    const c = ctx;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.comp.connect(c.destination);
    this.master = c.createGain();
    this.master.connect(this.comp);
    this.sfx = c.createGain();
    this.sfx.gain.value = this.enabled ? this.volume : 0;
    this.sfx.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.musicOn ? this.musicVolume : 0;
    this.musicFilter = c.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicBus.connect(this.musicFilter);
    this.musicFilter.connect(this.master);
    this.reverb = c.createConvolver();
    this.reverb.buffer = makeImpulse(c, 1.8, 3);
    this.reverbOut = c.createGain();
    this.reverbOut.gain.value = 0.35;
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.master);
    this.noise = makeNoiseBuffer(c, 2);
    this.brown = makeNoiseBuffer(c, 2, true);
    this.waveOn = makeEngineWave(c, { count: 40, tilt: 0.75, formant: 4, formantGain: 1.4, seed: 5, odd: 0.25 });
    this.waveOff = makeEngineWave(c, { count: 24, tilt: 1.1, formant: 2.5, formantGain: 0.8, seed: 9 });
    this.music = new Music(this);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.sfx) this.sfx.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.sfx && this.enabled) this.sfx.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusic(on, volume = this.musicVolume) {
    this.musicOn = on;
    this.musicVolume = volume;
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on ? volume : 0, this.ctx.currentTime, 0.1);
    if (on && !this.music.running && this.ctx.state !== 'suspended') this.music.start();
    if (!on && this.music.running) setTimeout(() => { if (!this.musicOn) this.music.stop(); }, 400);
  }

  // 'menu' (calm), 'race' (full drums). `seed` picks key and tempo per track.
  setMusicMode(mode, seed = 0) {
    this.musicMode = mode;
    if (this.music) this.music.setMode(mode, seed);
  }

  // Muffles the music while paused.
  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(p ? 700 : 20000, t, 0.08);
  }

  _src(buffer, loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    return s;
  }

  _filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  _gain(v = 0) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  // ------------------------------------------------------------------ engine & car loops
  startEngine() {
    if (!this.ctx || this.engineOn) return;
    const c = this.ctx;
    this.engineOn = true;
    const e = { rpm: IDLE, gear: 0, shiftT: 0, thr: 0, lastThr: 0, limiter: 0, popCooldown: 0 };
    // engine: on-load and off-load timbres at the firing frequency, a half-rate
    // "lump" for that uneven idle, random amplitude wobble for combustion grit,
    // then a soft clipper (oversampled to avoid aliasing) and a tone filter
    e.on = c.createOscillator(); e.on.setPeriodicWave(this.waveOn);
    e.off = c.createOscillator(); e.off.setPeriodicWave(this.waveOff);
    e.sub = c.createOscillator(); e.sub.type = 'sine';
    e.onG = this._gain(0);
    e.offG = this._gain(0);
    e.subG = this._gain(0);
    e.amp = this._gain(1);
    e.wobble = this._src(this.noise);
    e.wobbleF = this._filter('lowpass', 35);
    e.wobbleG = this._gain(0.25);
    e.wobble.connect(e.wobbleF); e.wobbleF.connect(e.wobbleG); e.wobbleG.connect(e.amp.gain);
    e.grit = this._src(this.noise);
    e.gritF = this._filter('bandpass', 400, 1.5);
    e.gritG = this._gain(0);
    e.grit.connect(e.gritF); e.gritF.connect(e.gritG); e.gritG.connect(e.amp);
    e.shaper = c.createWaveShaper();
    e.shaper.curve = softClipCurve(2);
    e.shaper.oversample = '4x';
    e.tone = this._filter('lowpass', 1200, 0.8);
    e.body = this._filter('peaking', 140, 1);
    e.body.gain.value = 3;
    e.out = this._gain(0);
    e.on.connect(e.onG); e.off.connect(e.offG); e.sub.connect(e.subG);
    e.onG.connect(e.amp); e.offG.connect(e.amp); e.subG.connect(e.amp);
    e.amp.connect(e.shaper); e.shaper.connect(e.body); e.body.connect(e.tone); e.tone.connect(e.out); e.out.connect(this.sfx);
    // intake roar: band-passed noise that opens with throttle
    e.intake = this._src(this.noise);
    e.intakeF = this._filter('bandpass', 600, 1.2);
    e.intakeG = this._gain(0);
    e.intake.connect(e.intakeF); e.intakeF.connect(e.intakeG); e.intakeG.connect(this.sfx);
    // turbo whistle
    e.turbo = c.createOscillator(); e.turbo.type = 'sine';
    e.turboG = this._gain(0);
    e.turbo.connect(e.turboG); e.turboG.connect(this.sfx);
    // tyre squeal: narrow noise band + a wavering tone
    e.skid = this._src(this.noise);
    e.skidF = this._filter('bandpass', 1350, 5);
    e.skidG = this._gain(0);
    e.skid.connect(e.skidF); e.skidF.connect(e.skidG); e.skidG.connect(this.sfx);
    e.squeal = c.createOscillator(); e.squeal.type = 'triangle'; e.squeal.frequency.value = 980;
    e.squealLfo = c.createOscillator(); e.squealLfo.frequency.value = 9;
    e.squealLfoG = this._gain(30);
    e.squealLfo.connect(e.squealLfoG); e.squealLfoG.connect(e.squeal.frequency);
    e.squealG = this._gain(0);
    e.squeal.connect(e.squealG); e.squealG.connect(this.sfx);
    // road rumble, grass and wind
    e.road = this._src(this.brown);
    e.roadF = this._filter('lowpass', 220);
    e.roadG = this._gain(0);
    e.road.connect(e.roadF); e.roadF.connect(e.roadG); e.roadG.connect(this.sfx);
    e.grass = this._src(this.noise);
    e.grassF = this._filter('lowpass', 700);
    e.grassG = this._gain(0);
    e.grass.connect(e.grassF); e.grassF.connect(e.grassG); e.grassG.connect(this.sfx);
    e.wind = this._src(this.noise);
    e.windF = this._filter('bandpass', 700, 0.6);
    e.windG = this._gain(0);
    e.wind.connect(e.windF); e.windF.connect(e.windG); e.windG.connect(this.sfx);
    const t = c.currentTime;
    e.out.gain.setTargetAtTime(1, t, 0.15);
    for (const n of [e.on, e.off, e.sub, e.wobble, e.grit, e.intake, e.turbo, e.skid, e.squeal, e.squealLfo, e.road, e.grass, e.wind]) n.start(t);
    this.eng = e;
  }

  stopEngine() {
    if (!this.engineOn) return;
    this.engineOn = false;
    const e = this.eng;
    const t = this.ctx.currentTime;
    for (const g of [e.out, e.intakeG, e.turboG, e.skidG, e.squealG, e.roadG, e.grassG, e.windG]) g.gain.setTargetAtTime(0, t, 0.06);
    setTimeout(() => {
      for (const n of [e.on, e.off, e.sub, e.wobble, e.grit, e.intake, e.turbo, e.skid, e.squeal, e.squealLfo, e.road, e.grass, e.wind]) { try { n.stop(); } catch { /* ignore */ } }
    }, 600);
    this.eng = null;
  }

  // s: {speed, throttle, brake, slip, sliding, grounded, boosting, onGrass, airborne}
  updateEngine(s, dt, time = this.ctx && this.ctx.currentTime) {
    if (!this.engineOn) return;
    const e = this.eng;
    dt = Math.min(0.1, Math.max(0.001, dt));
    const free = s.grounded < 2;                 // wheels not loaded: revs follow the pedal
    // throttle smoothing (and power cut while shifting)
    e.shiftT = Math.max(0, e.shiftT - dt);
    const pedal = e.shiftT > 0 ? 0 : s.throttle;
    e.thr += (pedal - e.thr) * Math.min(1, dt * 14);
    // gearbox
    let target;
    if (free) {
      target = s.throttle > 0 ? Math.min(1, e.rpm + dt * 2.2) : Math.max(IDLE, e.rpm - dt * 1.2);
    } else {
      target = Math.max(IDLE + s.throttle * 0.08, s.speed / GEAR_TOP[e.gear]);
      if (target > 0.95 && e.gear < GEAR_TOP.length - 1 && s.throttle > 0.3) {
        e.gear++;
        e.shiftT = 0.11;
        this._shiftChirp(time);
        target = s.speed / GEAR_TOP[e.gear];
      } else if (e.gear > 0 && s.speed / GEAR_TOP[e.gear - 1] < 0.72) {
        e.gear--;
        target = s.speed / GEAR_TOP[e.gear];
      }
    }
    e.rpm += (Math.min(1.02, target) - e.rpm) * Math.min(1, dt * (free ? 6 : 12));
    // rev limiter bounce
    let lim = 1;
    if (e.rpm > 0.985 && s.throttle > 0.5) {
      e.limiter += dt;
      lim = Math.sin(e.limiter * 2 * Math.PI * 16) > 0 ? 0.35 : 1;
    } else e.limiter = 0;
    const rpm = REDLINE_RPM * e.rpm;
    const firing = (rpm / 60) * 3;              // six cylinders, four-stroke
    const k = 0.05;
    e.on.frequency.setTargetAtTime(firing, time, 0.02);
    e.off.frequency.setTargetAtTime(firing, time, 0.02);
    e.sub.frequency.setTargetAtTime(firing / 2, time, 0.02);
    const load = e.thr * lim;
    // quieter at idle and off throttle, loud and bright under load
    const level = 0.3 + 0.7 * Math.min(1, e.rpm * 1.2);
    e.onG.gain.setTargetAtTime((0.08 + 0.92 * load) * 0.16 * level, time, k);
    e.offG.gain.setTargetAtTime((1 - load) * (0.05 + 0.1 * e.rpm) * level, time, k);
    e.subG.gain.setTargetAtTime(0.05 * (1 - e.rpm) + 0.02, time, k);
    e.wobbleG.gain.setTargetAtTime(0.18 + 0.25 * (1 - load), time, 0.1);
    e.gritF.frequency.setTargetAtTime(firing * 3, time, k);
    e.gritG.gain.setTargetAtTime(0.03 + 0.06 * load, time, k);
    e.tone.frequency.setTargetAtTime(380 + 2400 * load * (0.35 + 0.65 * e.rpm) + 700 * e.rpm, time, k);
    e.intakeF.frequency.setTargetAtTime(300 + 1400 * e.rpm, time, k);
    e.intakeG.gain.setTargetAtTime(load * e.rpm * 0.07, time, k);
    e.turbo.frequency.setTargetAtTime(1900 + 3600 * e.rpm, time, 0.08);
    e.turboG.gain.setTargetAtTime(load * Math.max(0, e.rpm - 0.35) * 0.018 + (s.boosting ? 0.012 : 0), time, 0.1);
    // throttle lifted at high revs: turbo blow-off and exhaust pops
    e.popCooldown = Math.max(0, e.popCooldown - dt);
    if (e.lastThr > 0.6 && s.throttle < 0.1 && e.rpm > 0.55 && e.popCooldown === 0) {
      e.popCooldown = 0.8;
      this._blowOff(time);
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this._pop(time + 0.06 + i * (0.05 + Math.random() * 0.09), 0.6 + Math.random() * 0.4);
    }
    e.lastThr = s.throttle;
    // tyres
    const slide = s.grounded > 1 ? clamp((s.slip - 1.2) / 6, 0, 1) * 0.6 + clamp(s.sliding / 4, 0, 1) * 0.6 : 0;
    const squeal = s.onGrass ? 0 : Math.min(1, slide) * clamp(s.speed / 8, 0, 1);
    e.skidG.gain.setTargetAtTime(squeal * 0.09, time, 0.04);
    e.squealG.gain.setTargetAtTime(squeal * 0.028, time, 0.04);
    e.squeal.frequency.setTargetAtTime(880 + 260 * squeal + s.speed * 2, time, 0.1);
    // surfaces and wind
    const sp = clamp(s.speed / 50, 0, 1.4);
    e.roadG.gain.setTargetAtTime(s.grounded > 1 && !s.onGrass ? 0.1 * sp : 0, time, 0.08);
    e.grassG.gain.setTargetAtTime(s.onGrass && s.grounded > 1 ? 0.09 * Math.min(1, s.speed / 15) : 0, time, 0.05);
    e.windF.frequency.setTargetAtTime(500 + s.speed * 14, time, 0.2);
    e.windG.gain.setTargetAtTime(Math.min(0.13, s.speed * s.speed * 0.000035) * (s.airborne ? 1.6 : 1), time, 0.15);
  }

  // ------------------------------------------------------------------ one-shots
  _env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _tone(freq, t, dur, { type = 'sine', gain = 0.2, slide = 0, attack = 0.008, dest = this.sfx, send = 0 } = {}) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this._gain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    this._env(g, t, gain, attack, dur);
    o.connect(g);
    g.connect(dest);
    if (send) { const sg = this._gain(send); g.connect(sg); sg.connect(this.reverb); }
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  _noiseHit(t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.2, sweep = 0, dest = this.sfx, send = 0, attack = 0.004 } = {}) {
    const s = this._src(this.noise, false);
    const f = this._filter(type, freq, q);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    const g = this._gain();
    this._env(g, t, gain, attack, dur);
    s.connect(f); f.connect(g); g.connect(dest);
    if (send) { const sg = this._gain(send); g.connect(sg); sg.connect(this.reverb); }
    s.start(t, Math.random() * 1.5);
    s.stop(t + attack + dur + 0.05);
  }

  _shiftChirp(t) {
    this._noiseHit(t, 0.06, { freq: 2400, q: 3, gain: 0.025 });
  }

  _blowOff(t) {
    this._noiseHit(t, 0.35, { type: 'highpass', freq: 2500, gain: 0.05, sweep: 2000, attack: 0.02 });
  }

  _pop(t, s) {
    this._noiseHit(t, 0.05, { freq: 500 + Math.random() * 500, q: 1.5, gain: 0.12 * s, send: 0.2 });
    this._tone(70 + Math.random() * 30, t, 0.06, { gain: 0.15 * s, slide: -25 });
  }

  countdown(final, at) {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    if (final) {
      this._tone(880, t, 0.5, { type: 'square', gain: 0.05, send: 0.3 });
      this._tone(1320, t, 0.5, { type: 'triangle', gain: 0.06, send: 0.3 });
    } else {
      this._tone(587, t, 0.22, { type: 'square', gain: 0.045, send: 0.25 });
    }
  }

  checkpoint(at) {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    [1046, 1318, 1568].forEach((f, i) => this._tone(f, t + i * 0.055, 0.35, { type: 'triangle', gain: 0.1, send: 0.45 }));
    this._noiseHit(t, 0.25, { type: 'highpass', freq: 6000, gain: 0.03, send: 0.3 });
  }

  finish(good, at) {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    const notes = good ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
    notes.forEach((n, i) => this._tone(n, t + i * 0.09, 0.6, { type: 'triangle', gain: 0.1, send: 0.5 }));
    // a sustained chord under the arpeggio
    for (const n of good ? [262, 330, 392, 523] : [262, 330, 392]) this._tone(n, t + 0.1, 1.4, { type: 'sawtooth', gain: 0.018, attack: 0.08, send: 0.5 });
    if (good) for (let i = 0; i < 6; i++) this._tone(2093 + Math.random() * 1500, t + 0.4 + i * 0.07, 0.15, { gain: 0.03, send: 0.6 });
  }

  boost(at) {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    this._noiseHit(t, 0.6, { freq: 400, q: 1.6, gain: 0.16, sweep: 2600, attack: 0.04, send: 0.2 });
    this._tone(220, t, 0.45, { type: 'sawtooth', gain: 0.035, slide: 440, attack: 0.03 });
  }

  // Chassis hit (walls, hard bottoming). strength ~ m/s into the surface.
  impact(strength, at) {
    if (!this.ctx || strength < 3) return;
    const t = at ?? this.ctx.currentTime;
    const s = Math.min(1, strength / 18);
    this._tone(110, t, 0.28, { gain: 0.25 * s, slide: -70 });
    this._noiseHit(t, 0.18, { type: 'lowpass', freq: 900, gain: 0.25 * s, send: 0.15 });
    if (strength > 6) for (const f of [431, 677, 1021, 1533]) this._tone(f * (0.95 + Math.random() * 0.1), t, 0.12 + Math.random() * 0.1, { type: 'triangle', gain: 0.03 * s, send: 0.25 });
  }

  // Touching down after a jump. strength ~ downward speed (m/s).
  land(strength, at) {
    if (!this.ctx || strength < 2) return;
    const t = at ?? this.ctx.currentTime;
    const s = Math.min(1, strength / 14);
    this._tone(85, t, 0.22, { gain: 0.3 * s, slide: -45 });
    this._noiseHit(t, 0.12, { type: 'lowpass', freq: 500, gain: 0.15 * s });
    this._noiseHit(t + 0.02, 0.08, { freq: 1800, q: 2, gain: 0.03 * s });
  }

  stunt(at) {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    [659, 784, 988, 1319].forEach((f, i) => this._tone(f, t + i * 0.045, 0.25, { type: 'square', gain: 0.025, send: 0.4 }));
    this._noiseHit(t, 0.3, { type: 'highpass', freq: 3000, gain: 0.03, sweep: 3000, send: 0.3 });
  }

  click(at) {
    if (!this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    this._tone(1200, t, 0.04, { type: 'triangle', gain: 0.05 });
    this._tone(600, t + 0.01, 0.05, { type: 'sine', gain: 0.04 });
  }
}

// ---------------------------------------------------------------------------
// Generative soundtrack: four-chord progression with drums, bass, pads and an
// arpeggio. Menus get a calm version without drums.
const PROGRESSIONS = [
  [[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']],   // i VI III VII
  [[0, 'm'], [5, 'm'], [8, 'M'], [10, 'M']],   // i iv VI VII
  [[0, 'm'], [10, 'M'], [8, 'M'], [10, 'M']],  // i VII VI VII
];
const KEYS = [45, 43, 40, 41, 47];             // A, G, E, F, B (bass octave)

class Music {
  constructor(fx) {
    this.fx = fx;
    this.ctx = fx.ctx;
    const c = this.ctx;
    this.out = c.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(fx.musicBus);
    // pad bus ducks on every kick (side-chain style pumping)
    this.padBus = c.createGain();
    this.padBus.connect(this.out);
    this.drumBus = c.createGain();
    this.drumBus.gain.value = 0;
    this.drumBus.connect(this.out);
    // echo for the arpeggio
    this.delay = c.createDelay(1);
    this.delayFb = c.createGain();
    this.delayFb.gain.value = 0.32;
    this.delayOut = c.createGain();
    this.delayOut.gain.value = 0.35;
    this.delay.connect(this.delayFb); this.delayFb.connect(this.delay);
    this.delay.connect(this.delayOut); this.delayOut.connect(this.out);
    this.running = false;
    this.step = 0;
    this.mode = 'menu';
    this.setMode('menu', 0);
  }

  setMode(mode, seed) {
    this.mode = mode;
    const rnd = mulberry32(seed * 977 + 13);
    this.key = KEYS[Math.floor(rnd() * KEYS.length)];
    this.prog = PROGRESSIONS[Math.floor(rnd() * PROGRESSIONS.length)];
    this.bpm = mode === 'race' ? 122 + Math.floor(rnd() * 10) : 104;
    this.stepDur = 60 / this.bpm / 4;
    this.delay.delayTime.value = this.stepDur * 3;
    if (this.ctx) this.drumBus.gain.setTargetAtTime(mode === 'race' ? 1 : 0, this.ctx.currentTime, 0.4);
    this.step = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(this.ctx.currentTime + 0.15), 30);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
  }

  // Schedules every step that starts before `until` (also used for offline renders).
  schedule(until) {
    while (this.nextTime < until) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step++;
    }
  }

  chordNotes(bar) {
    const [root, q] = this.prog[bar % 4];
    const r = this.key + root;
    return [r, r + (q === 'm' ? 3 : 4), r + 7];
  }

  playStep(step, t) {
    const s = step % 16, bar = Math.floor(step / 16) % 8;
    const chord = this.chordNotes(bar);
    const race = this.mode === 'race';
    // drums (silent in the menu through drumBus)
    if (s % 4 === 0) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 1) this.hat(t, s === 15 && bar % 2 === 1);
    if (bar === 7 && s >= 12) this.snare(t, 0.5);
    // bass: pumping eighths on the root, an octave jump on the off-beat
    if (s % 2 === 0) {
      const note = chord[0] + (s % 4 === 2 ? 12 : 0);
      this.bass(t, note, this.stepDur * (race ? 1.6 : 3));
    }
    // pad chord once per bar
    if (s === 0) this.pad(t, chord.map((n) => n + 24), this.stepDur * 16);
    // arpeggio in the second half of the loop (always in the menu, softly)
    if ((bar >= 4 || !race) && (race || s % 2 === 0)) {
      const seq = [0, 1, 2, 1, 0, 2, 1, 2];
      const n = chord[seq[(step >> (race ? 0 : 1)) % seq.length]] + 36 + (s >= 8 && race ? 12 : 0);
      this.arp(t, n, race ? 0.045 : 0.03);
    }
    // ducking of the pads on each kick
    if (race && s % 4 === 0) {
      this.padBus.gain.setValueAtTime(0.35, t);
      this.padBus.gain.linearRampToValueAtTime(1, t + this.stepDur * 3);
    }
  }

  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g); g.connect(this.drumBus);
    o.start(t); o.stop(t + 0.4);
  }

  snare(t, level = 1) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.fx.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * level, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    s.connect(f); f.connect(g); g.connect(this.drumBus);
    const rs = c.createGain(); rs.gain.value = 0.25; g.connect(rs); rs.connect(this.fx.reverb);
    s.start(t, Math.random()); s.stop(t + 0.22);
    const o = c.createOscillator(), og = c.createGain();
    o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.22 * level, t + 0.003); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og); og.connect(this.drumBus); o.start(t); o.stop(t + 0.12);
  }

  hat(t, open) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.fx.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = c.createGain();
    const d = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(open ? 0.09 : 0.11, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f); f.connect(g); g.connect(this.drumBus);
    s.start(t, Math.random()); s.stop(t + d + 0.02);
  }

  bass(t, note, dur) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.value = midiHz(note);
    f.type = 'lowpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(1300, t);
    f.frequency.exponentialRampToValueAtTime(260, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  pad(t, notes, dur) {
    const c = this.ctx;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.35);
    g.gain.setValueAtTime(0.05, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    f.connect(g); g.connect(this.padBus);
    const rs = c.createGain(); rs.gain.value = 0.4; g.connect(rs); rs.connect(this.fx.reverb);
    for (const n of notes) {
      for (const det of [-8, 8]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t); o.stop(t + dur + 0.3);
      }
    }
  }

  arp(t, note, level) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'square';
    o.frequency.value = midiHz(note);
    f.type = 'lowpass'; f.frequency.value = 2600;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(f); f.connect(g); g.connect(this.out); g.connect(this.delay);
    o.start(t); o.stop(t + 0.25);
  }
}
