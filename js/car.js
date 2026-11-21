// Arcade raycast-vehicle physics. Local car frame: +Z forward, +Y up, +X left.
// Four suspension rays provide support and tyre grip; a handful of spheres
// handle chassis collisions against walls and the ground.
import { Vector3, Quaternion } from '../vendor/three.module.min.js';
import { SURF } from './collision.js';

export const CAR = {
  mass: 1350,
  inertia: new Vector3(2900, 3600, 1400),
  gravity: 18,
  wheelRadius: 0.4,
  restLength: 0.42,
  springK: 60000,
  damping: 4300,
  bumpStart: 0.3,
  bumpK: 540000,
  rayLift: 0.6,
  maxSteer: 0.46,
  steerFalloff: 9,        // m/s at which max steering halves
  accel: 11.5,              // m/s^2 at standstill
  topSpeed: 62,           // engine limit (m/s)
  reverseAccel: 9,
  reverseSpeed: 16,
  brake: 21,
  coast: 1.2,
  drag: 0.00055,
  downforce: 0.002,
  downforceMax: 5,
  bounceLimit: 1.5,       // m/s away from the track allowed while stuck to it
  stickMin: 10,           // m/s where adhesion starts
  stickMax: 26,           // m/s where adhesion is full
  stickPress: 15,         // extra m/s^2 pressing the car onto tilted track at speed
  gripLat: 1.5,
  gripLong: 1.3,
  slideGrip: 0.78,        // grip left once a tyre breaks into a slide
  slideStart: 2.2,        // m/s of sideways slip where a tyre lets go
  slideEnd: 0.9,          // m/s of slip where it grips again
  contactLift: 0.62,      // how far tyre forces are raised towards the centre of mass (less = more body roll)
  grassGrip: 0.75,
  grassDrag: 4.5,
  boostAccel: 18,
  boostTime: 1.1,
  airYaw: 1.6,
  loadCap: 19000,
  yawAssist: 0.8,
  antiRoll: 36000,
  airRollDamp: 2.5,
  airPitchAlign: 2.2,
  alignRate: 12,          // 1/s, how hard the body is turned onto the track surface
  alignDamp: 30,          // 1/s, how quickly pitch/roll rates follow the track
  snapRate: 18,           // 1/s, direct orientation snap at full adhesion
  stickGrace: 0.25,       // s, adhesion keeps working after the wheels lose contact
  graceProbe: 2.4,        // m, how close the track must be for the grace pull
  overspeed: 60,          // m/s above which extra drag kicks in
  overspeedDrag: 1.2,     // m/s^2 of extra drag per m/s over
};

export const WHEELS = [
  { x: 0.86, y: -0.25, z: 1.32, front: true },
  { x: -0.86, y: -0.25, z: 1.32, front: true },
  { x: 0.86, y: -0.25, z: -1.28, front: false },
  { x: -0.86, y: -0.25, z: -1.28, front: false },
];

const SPHERES = [
  { x: 0.55, y: -0.1, z: 1.45, r: 0.45 },
  { x: -0.55, y: -0.1, z: 1.45, r: 0.45 },
  { x: 0.55, y: -0.1, z: -1.5, r: 0.45 },
  { x: -0.55, y: -0.1, z: -1.5, r: 0.45 },
  { x: 0, y: 0.15, z: -0.25, r: 0.62 },
];

// temporaries
const _up = new Vector3(), _fwd = new Vector3(), _left = new Vector3();
const _m = new Vector3(), _r = new Vector3(), _v = new Vector3(), _t = new Vector3();
const _wf = new Vector3(), _ws = new Vector3(), _n = new Vector3(), _pc = new Vector3(), _j = new Vector3();
const _na = new Vector3();
const _qi = new Quaternion(), _dq = new Quaternion(), _sq = new Quaternion(), _sq2 = new Quaternion();
const _hit = { nx: 0, ny: 0, nz: 0, surf: 0 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class CarPhysics {
  constructor(world, params = CAR) {
    this.world = world;
    this.p = params;
    this.pos = new Vector3();
    this.vel = new Vector3();
    this.quat = new Quaternion();
    this.angVel = new Vector3();
    this.steer = 0;
    this.wheels = WHEELS.map((w) => ({
      mount: new Vector3(w.x, w.y, w.z), front: w.front,
      contact: false, comp: 0, load: 0, surf: -1, slip: 0, spin: 0, sliding: false,
      n: new Vector3(0, 1, 0), dist: 0,
    }));
    this.grounded = 0;
    this.boostTimer = 0;
    this.speed = 0;
    this.fwdSpeed = 0;
    this.slip = 0;
    this.onGrass = false;
    this.boostTouched = false;
    this.impact = 0;
    this.airTime = 0;
    this.adhesion = 0;
    this.surfaceNormal = new Vector3(0, 1, 0);
    this.prevNormal = new Vector3(0, 1, 0);
    this.surfaceRate = new Vector3();
    this.hadNormal = false;
    this.stickTimer = 0;
    this.tilt = 0;
  }

  reset(pos, quat, vel = null, angVel = null) {
    this.pos.copy(pos);
    this.quat.copy(quat);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    if (vel) this.vel.copy(vel);
    if (angVel) this.angVel.copy(angVel);
    this.steer = 0;
    this.boostTimer = 0;
    this.airTime = 0;
    this.hadNormal = false;
    this.stickTimer = 0;
    this.surfaceRate.set(0, 0, 0);
    for (const w of this.wheels) { w.contact = false; w.comp = 0; w.load = 0; }
  }

  getState() {
    return {
      pos: this.pos.clone(), quat: this.quat.clone(), vel: this.vel.clone(), angVel: this.angVel.clone(),
      boostTimer: this.boostTimer,
    };
  }

  setState(s) {
    this.reset(s.pos, s.quat, s.vel, s.angVel);
    this.boostTimer = s.boostTimer || 0;
  }

  // world-space inverse inertia applied to vector v (in place)
  _invI(v) {
    _qi.copy(this.quat).invert();
    v.applyQuaternion(_qi);
    v.x /= this.p.inertia.x; v.y /= this.p.inertia.y; v.z /= this.p.inertia.z;
    return v.applyQuaternion(this.quat);
  }

  // inverse effective mass along direction d at offset r
  _k(r, d) {
    _t.crossVectors(r, d);
    this._invI(_t);
    _t.cross(r);
    return 1 / this.p.mass + _t.dot(d);
  }

  _impulse(j, r, angScale = 1) {
    this.vel.addScaledVector(j, 1 / this.p.mass);
    _t.crossVectors(r, j);
    this._invI(_t);
    this.angVel.addScaledVector(_t, angScale);
  }

  step(dt, input) {
    const p = this.p;
    const q = this.quat;
    _up.set(0, 1, 0).applyQuaternion(q);
    _fwd.set(0, 0, 1).applyQuaternion(q);
    _left.set(1, 0, 0).applyQuaternion(q);
    this.speed = this.vel.length();
    this.fwdSpeed = this.vel.dot(_fwd);
    const fs = this.fwdSpeed;

    // --- steering (input.steer: +1 = right)
    const target = clamp(input.steer || 0, -1, 1);
    const rate = target === 0 ? 5 : (Math.sign(target) !== Math.sign(this.steer) ? 6.5 : 3.4);
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    const steerAngle = this.steer * p.maxSteer / (1 + Math.abs(fs) / p.steerFalloff);

    // --- gravity
    this.vel.y -= p.gravity * dt;

    // --- suspension rays
    let grounded = 0;
    let grass = 0;
    this.boostTouched = false;
    const rayLen = p.rayLift + p.restLength + p.wheelRadius;
    for (const w of this.wheels) {
      _m.copy(w.mount).applyQuaternion(q).add(this.pos).addScaledVector(_up, p.rayLift);
      const d = this.world.raycast(_m.x, _m.y, _m.z, -_up.x, -_up.y, -_up.z, rayLen, _hit);
      if (d >= 0) {
        w.contact = true;
        w.dist = d - p.rayLift;
        w.comp = p.restLength + p.wheelRadius - w.dist;
        w.n.set(_hit.nx, _hit.ny, _hit.nz);
        w.surf = _hit.surf;
        grounded++;
        if (w.surf === SURF.GRASS) grass++;
        if (w.surf === SURF.BOOST) this.boostTouched = true;
      } else {
        w.contact = false;
        w.comp = 0;
        w.load = 0;
        w.surf = -1;
      }
    }
    this.grounded = grounded;
    this.onGrass = grass > 0 && grass >= grounded / 2;

    // compute all spring forces from the same state, then apply them together
    for (const w of this.wheels) {
      if (!w.contact) continue;
      _r.copy(w.mount).applyQuaternion(q);
      _v.crossVectors(this.angVel, _r).add(this.vel);
      const compVel = -_v.dot(_up);
      let F = p.springK * w.comp + p.damping * compVel;
      if (w.comp > p.bumpStart) {
        // progressive bump stop with heavy damping so hard landings don't bounce
        const ex = w.comp - p.bumpStart;
        F += p.bumpK * ex * ex * 4 + p.springK * ex * 2;
        if (compVel > 0) F += p.damping * 3 * compVel * Math.min(1, ex * 10);
      }
      const align = w.n.dot(_up);
      F *= clamp(align * 1.6, 0, 1);
      w.load = F;
    }
    // anti-roll bars (front pair 0/1, rear pair 2/3)
    for (let a = 0; a < 4; a += 2) {
      const wl = this.wheels[a], wr = this.wheels[a + 1];
      const diff = (wl.contact ? wl.comp : 0) - (wr.contact ? wr.comp : 0);
      const f = p.antiRoll * diff;
      if (wl.contact) wl.load += f;
      if (wr.contact) wr.load -= f;
    }
    for (const w of this.wheels) if (w.contact) w.load = Math.max(0, w.load);
    for (const w of this.wheels) {
      if (!w.contact || w.load === 0) continue;
      _r.copy(w.mount).applyQuaternion(q);
      _j.copy(_up).multiplyScalar(w.load * dt);
      this._impulse(_j, _r);
    }

    // --- adhesion: at speed the tyres stick to the track, so the car can ride
    // walls and drive upside down. It cancels the part of gravity that pulls the
    // car off the surface and adds some extra press (plus aero downforce).
    this.adhesion = 0;
    const u = clamp((this.speed - p.stickMin) / (p.stickMax - p.stickMin), 0, 1);
    const fSpeed = u * u * (3 - 2 * u);
    let graceOk = false;
    if (grounded < 2 && this.stickTimer > 0 && this.hadNormal) {
      this.stickTimer -= dt;
      // only if track is still right below us (twisting road, bump) – not after a jump lip
      const d = this.world.raycast(this.pos.x, this.pos.y, this.pos.z, -this.surfaceNormal.x, -this.surfaceNormal.y, -this.surfaceNormal.z, p.graceProbe, _hit);
      graceOk = d >= 0 && _hit.surf !== SURF.GRASS;
    }
    if (graceOk) {
      // grace period: the wheels just lost the track, keep pulling the car back onto it
      _na.copy(this.surfaceNormal);
      const gAway = Math.max(0, -p.gravity * _na.y);
      this.vel.addScaledVector(_na, -fSpeed * (gAway + p.stickPress * 2) * dt);
      this.adhesion = fSpeed;
    } else if (grounded >= 2) {
      _na.set(0, 0, 0);
      for (const w of this.wheels) if (w.contact) _na.add(w.n);
      _na.normalize();
      this.surfaceNormal.copy(_na);
      const f = fSpeed;
      // how far the track is tilted away from "normal ground": the stunt aids
      // only work on walls, ceilings, loops and rolls; flat roads stay realistic
      const tilt = clamp((0.95 - _na.y) / 0.45, 0, 1);
      this.tilt = tilt;
      this.stickTimer = f > 0.3 ? p.stickGrace : 0;
      const gAway = Math.max(0, -p.gravity * _na.y);
      const a = f * (gAway + p.stickPress * tilt) + Math.min(p.downforceMax, p.downforce * this.speed * this.speed);
      this.adhesion = f;
      this.vel.addScaledVector(_na, -a * dt);
      // magnetic: at speed the car can't bounce away from tilted track
      const vn = this.vel.dot(_na);
      if (vn > p.bounceLimit) this.vel.addScaledVector(_na, -(vn - p.bounceLimit) * f * tilt);

      // surface alignment: turn the body (pitch/roll only) to match the track,
      // including how fast the track itself is rotating (loops, rolls, walls)
      if (this.hadNormal) {
        _t.crossVectors(this.prevNormal, _na).multiplyScalar(1 / dt);
        this.surfaceRate.lerp(_t, 1 - Math.exp(-dt / 0.035));
      } else {
        this.surfaceRate.set(0, 0, 0);
      }
      this.prevNormal.copy(_na);
      this.hadNormal = true;
      const strength = 0.15 + 0.85 * f * tilt;
      _v.copy(this.surfaceRate).addScaledVector(_up, -this.surfaceRate.dot(_up));   // desired = track rate
      _t.crossVectors(_up, _na);                                                      // orientation error
      _v.addScaledVector(_t, p.alignRate);
      const wUp = this.angVel.dot(_up);
      _t.copy(this.angVel).addScaledVector(_up, -wUp);                                // current pitch/roll rate
      this.angVel.addScaledVector(_v.sub(_t), Math.min(1, p.alignDamp * dt) * strength);
    } else if (this.stickTimer <= 0) {
      this.hadNormal = false;
      this.stickTimer = 0;
    }

    // --- drive / brake forces
    const throttle = clamp(input.throttle || 0, 0, 1);
    const brake = clamp(input.brake || 0, 0, 1);
    let driveA = 0;      // signed acceleration along forward
    let brakeA = 0;      // deceleration magnitude
    if (throttle > 0 && fs > -1) {
      const r = clamp(fs / p.topSpeed, 0, 1.2);
      driveA += throttle * p.accel * Math.max(0, 1 - r * r);
    }
    if (throttle > 0 && fs <= -1) brakeA += throttle * p.brake;
    if (brake > 0) {
      if (fs > 1) brakeA += brake * p.brake;
      else {
        const r = clamp(-fs / p.reverseSpeed, 0, 1.2);
        driveA -= brake * p.reverseAccel * Math.max(0, 1 - r * r);
      }
    }
    const coasting = throttle === 0 && brake === 0;

    let slipSum = 0;
    if (grounded > 0) {
      const share = 1 / grounded;
      const cosS = Math.cos(steerAngle), sinS = Math.sin(steerAngle);
      for (const w of this.wheels) {
        if (!w.contact) continue;
        _n.copy(w.n);
        // wheel heading (positive steer turns right = towards -left)
        if (w.front) _wf.copy(_fwd).multiplyScalar(cosS).addScaledVector(_left, -sinS);
        else _wf.copy(_fwd);
        _wf.addScaledVector(_n, -_wf.dot(_n));
        if (_wf.lengthSq() < 1e-6) continue;
        _wf.normalize();
        _ws.crossVectors(_n, _wf);
        // contact point, raised towards the centre of mass to reduce body roll
        _r.copy(w.mount).applyQuaternion(q);
        _pc.copy(_r).addScaledVector(_up, -w.dist);
        const h = -_pc.dot(_up);
        _pc.addScaledVector(_up, h * p.contactLift);
        _v.crossVectors(this.angVel, _pc).add(this.vel);
        const vS = _v.dot(_ws);
        const vF = _v.dot(_wf);
        const onGrass = w.surf === SURF.GRASS;
        const mu = onGrass ? p.grassGrip : 1;
        const load = Math.min(w.load, p.loadCap);
        // tyre breakaway: once sliding, grip drops until the slip is small again
        const absSlip = Math.abs(_v.dot(_ws));
        if (w.sliding) { if (absSlip < p.slideEnd) w.sliding = false; } else if (absSlip > p.slideStart) w.sliding = true;
        const slideMu = w.sliding ? p.slideGrip : 1;
        const maxJ = p.gripLat * mu * slideMu * load * dt;

        // lateral: cancel sideways velocity (clamped by grip)
        let jS = -vS / this._k(_pc, _ws);
        // longitudinal
        let jF = p.mass * driveA * share * dt;
        const kF = this._k(_pc, _wf);
        if (brakeA > 0) {
          const want = p.mass * brakeA * share * dt;
          jF -= Math.sign(vF) * Math.min(want, Math.abs(vF) / kF);
        }
        if (coasting) {
          const roll = p.mass * (p.coast + (onGrass ? p.grassDrag + Math.abs(vF) * 0.06 : 0)) * share * dt;
          if (Math.abs(vF) < 1.0) jF -= vF / kF * 0.5;
          else jF -= Math.sign(vF) * Math.min(roll, Math.abs(vF) / kF);
        } else if (onGrass) {
          const roll = p.mass * (p.grassDrag + Math.abs(vF) * 0.06) * share * dt;
          jF -= Math.sign(vF) * Math.min(roll, Math.abs(vF) / kF);
        }
        const maxLong = p.gripLong * mu * slideMu * load * dt;
        if (Math.abs(jF) > maxLong) jF = Math.sign(jF) * maxLong;
        const tot = Math.hypot(jS, jF);
        if (tot > maxJ && tot > 0) {
          const s = maxJ / tot;
          jS *= s;
          jF *= s;
        }
        w.slip = Math.abs(vS);
        slipSum += Math.abs(vS);
        _j.copy(_ws).multiplyScalar(jS).addScaledVector(_wf, jF);
        this._impulse(_j, _pc);
        w.spin += (vF / p.wheelRadius) * dt;
      }
    } else {
      for (const w of this.wheels) {
        // free spinning wheels follow the throttle a little
        w.spin += (fs / p.wheelRadius + throttle * 20) * dt;
      }
    }
    this.slip = slipSum / 4;

    // --- boost pads
    if (this.boostTouched) this.boostTimer = p.boostTime;
    if (this.boostTimer > 0) {
      this.vel.addScaledVector(_fwd, p.boostAccel * dt);
      this.boostTimer -= dt;
    }

    // --- aerodynamic drag (stronger above the top speed so boosts/descents stay sane)
    const over = Math.max(0, this.speed - p.overspeed);
    this.vel.addScaledVector(this.vel, -(p.drag * this.speed + over * p.overspeedDrag / Math.max(1, this.speed)) * dt);

    // --- air control / damping
    if (grounded === 0) {
      this.airTime += dt;
      this.angVel.addScaledVector(_up, -target * p.airYaw * dt);
      this.angVel.multiplyScalar(1 - 0.5 * dt);
      // gently point the nose along the flight path so landings are cleaner
      if (this.airTime > 0.15 && this.speed > 10) {
        _v.copy(this.vel).multiplyScalar(1 / this.speed);
        const e = _t.crossVectors(_fwd, _v).dot(_left);
        if (_fwd.dot(_v) > 0.3) this.angVel.addScaledVector(_left, e * p.airPitchAlign * dt);
      }
      // damp roll in the air so jumps stay readable
      const roll = this.angVel.dot(_fwd);
      this.angVel.addScaledVector(_fwd, -roll * Math.min(1, p.airRollDamp * dt));
    } else {
      this.airTime = 0;
      this.angVel.multiplyScalar(1 - 0.4 * dt);
      // stability assist: nudge yaw rate towards what the steering asks for
      if (grounded >= 3 && Math.abs(fs) > 3) {
        const yaw = this.angVel.dot(_up);
        const desired = -fs * Math.tan(steerAngle) / 2.6;
        this.angVel.addScaledVector(_up, (desired - yaw) * Math.min(1, p.yawAssist * dt));
      }
    }

    // --- integrate
    this.pos.addScaledVector(this.vel, dt);
    const wx = this.angVel.x * dt * 0.5, wy = this.angVel.y * dt * 0.5, wz = this.angVel.z * dt * 0.5;
    _dq.set(wx, wy, wz, 0).multiply(q);
    q.set(q.x + _dq.x, q.y + _dq.y, q.z + _dq.z, q.w + _dq.w).normalize();

    // at speed the body snaps onto the track surface (pitch/roll), which keeps
    // fast rolls, walls and loops stable
    if (this.hadNormal && this.adhesion > 0.2 && this.tilt > 0 && (grounded >= 2 || this.stickTimer > 0)) {
      _up.set(0, 1, 0).applyQuaternion(q);
      _sq.setFromUnitVectors(_up, this.surfaceNormal);
      _sq2.identity().slerp(_sq, Math.min(1, p.snapRate * this.adhesion * this.tilt * dt));
      q.premultiply(_sq2).normalize();
    }

    this.impact = 0;
    this._collide();
  }

  _collide() {
    const world = this.world;
    const q = this.quat;
    for (const s of SPHERES) {
      for (let iter = 0; iter < 3; iter++) {
        _m.set(s.x, s.y, s.z).applyQuaternion(q).add(this.pos);
        const n = world.sphere(_m.x, _m.y, _m.z, s.r);
        if (n === 0) break;
        let best = world.contacts[0];
        for (let i = 1; i < n; i++) if (world.contacts[i].depth > best.depth) best = world.contacts[i];
        _n.set(best.nx, best.ny, best.nz);
        this.pos.addScaledVector(_n, best.depth);
        _r.copy(_m).addScaledVector(_n, -s.r).sub(this.pos);
        _v.crossVectors(this.angVel, _r).add(this.vel);
        const vn = _v.dot(_n);
        if (vn < 0) {
          const wall = best.surf === SURF.WALL;
          const e = wall ? 0.12 : 0.02;
          const mu = wall ? 0.12 : 0.45;
          const angScale = wall ? 0.35 : 1;
          const jn = -(1 + e) * vn / this._k(_r, _n);
          _j.copy(_n).multiplyScalar(jn);
          _t.copy(_v).addScaledVector(_n, -vn);
          const vt = _t.length();
          if (vt > 1e-4) {
            _wf.copy(_t).multiplyScalar(1 / vt);
            const jt = Math.min(vt / this._k(_r, _wf), mu * jn);
            _j.addScaledVector(_wf, -jt);
          }
          this._impulse(_j, _r, angScale);
          this.impact = Math.max(this.impact, -vn);
        }
      }
    }
  }

  // Data for rendering the wheels
  wheelVisual(i) {
    const w = this.wheels[i];
    const ext = w.contact ? Math.max(0, this.p.restLength - w.comp) : this.p.restLength;
    return { x: w.mount.x, y: w.mount.y - ext, z: w.mount.z, steer: w.front ? this.steer * this.p.maxSteer / (1 + Math.abs(this.fwdSpeed) / this.p.steerFalloff) : 0, spin: w.spin };
  }
}
