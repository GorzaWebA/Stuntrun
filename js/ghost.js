// Ghost recording and playback (30 samples per second, interpolated).
import { Quaternion } from '../vendor/three.module.min.js';

export const GHOST_HZ = 30;

export class GhostRecorder {
  constructor() { this.frames = []; }
  reset() { this.frames = []; }
  // called with race time; records when a new sample slot is reached
  record(time, pos, quat) {
    const slot = Math.floor(time * GHOST_HZ + 1e-6);
    while (this.frames.length / 7 <= slot) {
      this.frames.push(
        Math.round(pos.x * 100) / 100, Math.round(pos.y * 100) / 100, Math.round(pos.z * 100) / 100,
        Math.round(quat.x * 1000) / 1000, Math.round(quat.y * 1000) / 1000, Math.round(quat.z * 1000) / 1000, Math.round(quat.w * 1000) / 1000,
      );
    }
  }
  data() { return { hz: GHOST_HZ, f: this.frames.slice() }; }
}

const _q0 = new Quaternion(), _q1 = new Quaternion();

export class GhostPlayer {
  constructor(data) {
    this.f = data && Array.isArray(data.f) ? data.f : [];
    this.hz = (data && data.hz) || GHOST_HZ;
    this.count = Math.floor(this.f.length / 7);
  }
  get valid() { return this.count > 1; }
  // returns false once the ghost has finished
  sample(time, pos, quat) {
    if (!this.valid) return false;
    const x = time * this.hz;
    let i = Math.floor(x);
    if (i >= this.count - 1) { i = this.count - 2; }
    const t = Math.min(1, Math.max(0, x - i));
    const f = this.f, a = i * 7, b = (i + 1) * 7;
    pos.set(f[a] + (f[b] - f[a]) * t, f[a + 1] + (f[b + 1] - f[a + 1]) * t, f[a + 2] + (f[b + 2] - f[a + 2]) * t);
    _q0.set(f[a + 3], f[a + 4], f[a + 5], f[a + 6]).normalize();
    _q1.set(f[b + 3], f[b + 4], f[b + 5], f[b + 6]).normalize();
    quat.slerpQuaternions(_q0, _q1, t);
    return x < this.count;
  }
}

