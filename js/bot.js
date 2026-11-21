// Simple autopilot that follows a route (used for the menu attract mode and
// for the automated track tests in tools/simulate.mjs).
import { Vector3 } from '../vendor/three.module.min.js';

const _fwd = new Vector3(), _left = new Vector3(), _up = new Vector3(), _d = new Vector3();

export class Bot {
  constructor(points, opts = {}) {
    this.pts = points;
    this.latAccel = opts.latAccel ?? 17;
    this.brakeDecel = opts.brakeDecel ?? 12;
    this.slipComp = opts.slipComp ?? 0;
    this.gain = opts.gain ?? 1.6;
    this.idx = 0;
    // arc length + lateral curvature
    const n = points.length;
    this.s = new Float64Array(n);
    this.kappa = new Float64Array(n);
    for (let i = 1; i < n; i++) this.s[i] = this.s[i - 1] + points[i].p.distanceTo(points[i - 1].p);
    const t0 = new Vector3(), t1 = new Vector3(), lat = new Vector3();
    for (let i = 1; i < n - 1; i++) {
      t0.subVectors(points[i].p, points[i - 1].p).normalize();
      t1.subVectors(points[i + 1].p, points[i].p).normalize();
      lat.crossVectors(points[i].u, t0).normalize();
      const ds = 0.5 * (this.s[i + 1] - this.s[i - 1]);
      this.kappa[i] = ds > 0 ? Math.abs(t1.sub(t0).dot(lat)) / ds : 0;
    }
    // smooth curvature a little
    const k2 = Float64Array.from(this.kappa);
    for (let i = 2; i < n - 2; i++) this.kappa[i] = (k2[i - 2] + k2[i - 1] + k2[i] + k2[i + 1] + k2[i + 2]) / 5;
  }

  reset() { this.idx = 0; }

  _pointAt(s, out) {
    const S = this.s;
    let i = this.idx;
    while (i < S.length - 2 && S[i + 1] < s) i++;
    const a = this.pts[i].p, b = this.pts[Math.min(i + 1, this.pts.length - 1)].p;
    const seg = S[Math.min(i + 1, S.length - 1)] - S[i];
    const t = seg > 0 ? Math.min(1, Math.max(0, (s - S[i]) / seg)) : 0;
    return out.lerpVectors(a, b, t);
  }

  update(car) {
    const pts = this.pts;
    // advance nearest index
    let best = this.idx, bestD = Infinity;
    const end = Math.min(pts.length - 1, this.idx + 30);
    for (let i = Math.max(0, this.idx - 5); i <= end; i++) {
      const d = pts[i].p.distanceToSquared(car.pos);
      if (d < bestD) { bestD = d; best = i; }
    }
    this.idx = best;
    this.offTrack = Math.sqrt(bestD);
    const speed = Math.max(0, car.fwdSpeed);
    const look = 6 + speed * 0.2;
    const target = this._pointAt(this.s[best] + look, _d);
    _fwd.set(0, 0, 1).applyQuaternion(car.quat);
    _left.set(1, 0, 0).applyQuaternion(car.quat);
    _up.set(0, 1, 0).applyQuaternion(car.quat);
    target.sub(car.pos);
    const x = target.dot(_left), z = target.dot(_fwd);
    // aim the direction of travel (not the nose) at the target: steadier when sliding
    const vx = car.vel.dot(_left), vz = car.vel.dot(_fwd);
    const slip = speed > 4 ? Math.atan2(-vx, Math.max(0.1, vz)) : 0;
    const angle = Math.atan2(-x, Math.max(0.1, z)) - slip * this.slipComp;
    const maxSteer = car.p.maxSteer / (1 + speed / car.p.steerFalloff);
    const steer = car.grounded === 0 ? 0 : Math.max(-1, Math.min(1, (angle * this.gain) / maxSteer));

    // speed planning
    let allowed = Infinity;
    const s0 = this.s[best];
    for (let i = best; i < pts.length && this.s[i] - s0 < 140; i++) {
      const k = this.kappa[i];
      if (k < 1e-4) continue;
      const vmax = Math.sqrt(this.latAccel / k);
      const dist = Math.max(0, this.s[i] - s0 - 4);
      allowed = Math.min(allowed, Math.sqrt(vmax * vmax + 2 * this.brakeDecel * dist));
    }
    let throttle = 1, brake = 0;
    if (speed > allowed + 1.5) { throttle = 0; brake = Math.abs(steer) > 0.95 ? 0.7 : 1; } else if (speed > allowed) { throttle = 0; }
    return { steer, throttle, brake, progress: this.s[best] / this.s[this.s.length - 1] };
  }
}
