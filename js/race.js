// Race rules: timer, checkpoints, finish, respawning. Shared by the game and
// the headless simulator so results are identical.
import { Vector3, Quaternion } from '../vendor/three.module.min.js';
import { CarPhysics } from './car.js';
import { PHYS_DT } from './config.js';

export class Race {
  constructor(track) {
    this.track = track;
    this.car = new CarPhysics(track.world);
    this.reset();
  }

  startState() {
    const s = this.track.start;
    const pos = s ? s.pos.clone() : new Vector3();
    pos.y += 0.95;
    return { pos, quat: s ? s.quat.clone() : new Quaternion(), vel: new Vector3(), angVel: new Vector3(), boostTimer: 0 };
  }

  reset() {
    this.car.setState(this.startState());
    this.steps = 0;
    this.time = 0;
    this.state = 'ready';
    this.passed = new Set();
    this.splits = [];
    this.respawnState = this.startState();
    this.finishTime = null;
  }

  get checkpointCount() { return this.track.checkpoints.length; }

  begin() { this.state = 'racing'; }

  respawn() {
    if (this.state === 'finished') return;
    this.car.setState(this.respawnState);
  }

  // Advances one fixed step. Returns an array of events.
  step(input) {
    const events = [];
    const frozen = this.state === 'ready';
    if (frozen) {
      // hold the car in place during the countdown but let suspension settle
      const st = this.respawnState;
      this.car.step(PHYS_DT, { steer: input.steer, throttle: 0, brake: 0 });
      this.car.pos.x = st.pos.x;
      this.car.pos.z = st.pos.z;
      this.car.vel.set(0, Math.min(0, this.car.vel.y), 0);
      this.car.angVel.set(0, 0, 0);
      this.car.quat.copy(st.quat);
      return events;
    }
    // after the finish the car brakes to a stop (without reversing)
    const coast = { steer: 0, throttle: 0, brake: this.car.fwdSpeed > 1 ? 1 : 0 };
    this.car.step(PHYS_DT, this.state === 'finished' ? coast : input);
    if (this.state !== 'racing') return events;
    this.steps++;
    this.time = this.steps * PHYS_DT;
    const p = this.car.pos;
    const cps = this.track.checkpoints;
    for (let i = 0; i < cps.length; i++) {
      if (this.passed.has(i)) continue;
      if (cps[i].box.containsPoint(p)) {
        this.passed.add(i);
        this.splits.push(this.time);
        this.respawnState = this.car.getState();
        events.push({ type: 'checkpoint', index: i, count: this.passed.size, time: this.time });
      }
    }
    if (this.passed.size >= cps.length) {
      for (const f of this.track.finishes) {
        if (f.box.containsPoint(p)) {
          this.state = 'finished';
          this.finishTime = this.time;
          events.push({ type: 'finish', time: this.time });
          break;
        }
      }
    } else {
      for (const f of this.track.finishes) {
        if (f.box.containsPoint(p)) { events.push({ type: 'missed' }); break; }
      }
    }
    return events;
  }
}
