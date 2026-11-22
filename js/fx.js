// Low-poly effects: dust and tyre smoke puffs, impact sparks and finish confetti.
// Every particle is a solid flat-shaded shape that grows and shrinks instead of
// fading, so the effects match the rest of the art (no soft sprites).
import * as THREE from '../vendor/three.module.min.js';
import { SURF } from './collision.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3();
const _Z = new THREE.Vector3(0, 0, 1);
const _axis = new THREE.Vector3();

const SMOKE = new THREE.Color(0xeee4d2);
const DUST = new THREE.Color(0xf2dcb0);
const SPARK_HOT = new THREE.Color(0xfff1b0);
const CONFETTI = [0xe23b2e, 0xffc42e, 0x2a9d9a, 0xf6ead2, 0x5fd3cf].map((c) => new THREE.Color(c));

class Pool {
  constructor(scene, geometry, material, max) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.count = 0;
    this.max = max;
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.items.push({
        pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0),
        color: new THREE.Color(), age: 0, life: 1, size: 1, spin: 0, angle: 0, grav: 0, drag: 0, kind: 0,
      });
    }
    this.alive = 0;
    scene.add(this.mesh);
  }

  spawn() {
    if (this.alive < this.max) return this.items[this.alive++];
    // full: recycle a random old one
    return this.items[(Math.random() * this.max) | 0];
  }

  clear() { this.alive = 0; this.mesh.count = 0; }

  update(dt, shape) {
    let i = 0;
    while (i < this.alive) {
      const p = this.items[i];
      p.age += dt;
      if (p.age >= p.life) {
        // swap the dead one to the end so its object is reused
        this.alive--;
        this.items[i] = this.items[this.alive];
        this.items[this.alive] = p;
        continue;
      }
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.angle += p.spin * dt;
      shape(p, p.age / p.life);
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, p.color);
      i++;
    }
    this.mesh.count = this.alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// puffs swell quickly, then shrink away
function puffShape(p, t) {
  const s = p.size * (0.45 + 1.5 * t) * (1 - t * t);
  _s.set(s, s * 0.85, s);
  _q.setFromAxisAngle(p.axis, p.angle);
}

// sparks are shards stretched along their velocity
function sparkShape(p, t) {
  const len = Math.min(1.4, p.vel.length() * 0.05) + 0.15;
  const w = p.size * (1 - t);
  _s.set(w, w, len * (1 - t * 0.5));
  _v.copy(p.vel).normalize();
  if (_v.lengthSq() < 0.5) _v.set(0, 1, 0);
  _q.setFromUnitVectors(_Z, _v);
  p.color.copy(SPARK_HOT).lerp(CONFETTI[0], Math.min(1, t * 1.6));
}

// confetti flutters
function confettiShape(p, t) {
  const s = p.size * (t > 0.85 ? (1 - t) / 0.15 : 1);
  _s.set(s, s, s);
  _q.setFromAxisAngle(p.axis, p.angle);
}

export class Fx {
  constructor(scene) {
    // rounder, see-through puffs with an emissive floor so the shadow side
    // stays pale: solid dark facets read as flying rocks, not dust
    this.puffs = new Pool(scene, new THREE.IcosahedronGeometry(0.5, 1),
      new THREE.MeshLambertMaterial({ flatShading: true, emissive: 0x6e6658, transparent: true, opacity: 0.55, depthWrite: false }), 220);
    this.sparks = new Pool(scene, new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(), 90);
    const conf = new THREE.PlaneGeometry(0.42, 0.26);
    this.confetti = new Pool(scene, conf,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 180);
    for (const pool of [this.puffs, this.sparks, this.confetti]) pool.mesh.castShadow = false;
    this.rate = 1;
    this.acc = [0, 0, 0, 0];
  }

  setQuality(level) {
    this.rate = [0.4, 0.7, 1][level] ?? 1;
  }

  clear() {
    this.puffs.clear();
    this.sparks.clear();
    this.confetti.clear();
    this.acc.fill(0);
  }

  puff(pos, vel, color, size, life) {
    const p = this.puffs.spawn();
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.color.copy(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
    p.size = size * (0.8 + Math.random() * 0.4);
    p.life = life * (0.8 + Math.random() * 0.4);
    p.age = 0;
    p.grav = -1.2; // smoke rises a touch
    p.drag = 2.2;
    p.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    p.angle = Math.random() * 6.28;
    p.spin = (Math.random() - 0.5) * 3;
  }

  // per-frame emission from the car's wheels
  emitCar(car, dt) {
    if (this.rate <= 0) return;
    _up.set(0, 1, 0).applyQuaternion(car.quat);
    for (let i = 0; i < car.wheels.length; i++) {
      const w = car.wheels[i];
      let rate = 0, color = SMOKE, size = 0.65;
      if (w.contact && car.speed > 3) {
        const sand = w.surf === SURF.GRASS;
        if (w.sliding || w.slip > 6) rate = 18 + Math.min(26, w.slip * 2.5);
        if (sand) {
          color = DUST;
          size = 0.8;
          if (car.speed > 7) rate = Math.max(rate, 4 + car.speed * 0.2);
        }
      }
      this.acc[i] += rate * this.rate * dt;
      while (this.acc[i] >= 1) {
        this.acc[i] -= 1;
        _v.copy(w.mount).applyQuaternion(car.quat).add(car.pos).addScaledVector(_up, -w.dist + 0.25);
        const vel = _s.copy(car.vel).multiplyScalar(0.18)
          .add(_axis.set((Math.random() - 0.5) * 2.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5));
        this.puff(_v, vel, color, size, 0.75);
      }
    }
  }

  // ring of dust when the car slams back down
  landing(car, fallSpeed) {
    const n = Math.round(Math.min(18, 6 + fallSpeed * 0.8) * this.rate);
    const sand = car.onGrass;
    _up.set(0, 1, 0).applyQuaternion(car.quat);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const pos = _v.set(Math.cos(a) * 1.6, 0, Math.sin(a) * 2.2).applyQuaternion(car.quat).add(car.pos).addScaledVector(_up, -0.55);
      const vel = _s.set(Math.cos(a) * 6, 1.2 + Math.random(), Math.sin(a) * 6).applyQuaternion(car.quat).addScaledVector(car.vel, 0.25);
      this.puff(pos, vel, sand ? DUST : SMOKE, 1.0, 0.9);
    }
  }

  sparksAt(point, normal, carVel, strength) {
    const n = Math.round(Math.min(26, strength * 2) * this.rate);
    for (let i = 0; i < n; i++) {
      const p = this.sparks.spawn();
      p.pos.copy(point);
      p.vel.copy(normal).multiplyScalar(3 + Math.random() * 6)
        .add(_v.set((Math.random() - 0.5) * 9, Math.random() * 6, (Math.random() - 0.5) * 9))
        .addScaledVector(carVel, 0.4);
      p.size = 0.07 + Math.random() * 0.05;
      p.life = 0.3 + Math.random() * 0.35;
      p.age = 0;
      p.grav = 22;
      p.drag = 0.8;
      p.color.copy(SPARK_HOT);
    }
  }

  // show confetti cannons either side of the car
  confettiBurst(pos, quat, carVel) {
    const n = Math.round(120 * Math.max(0.5, this.rate));
    _up.set(1, 0, 0).applyQuaternion(quat);
    for (let i = 0; i < n; i++) {
      const p = this.confetti.spawn();
      const side = i % 2 ? 1 : -1;
      p.pos.copy(pos).addScaledVector(_up, side * 4).y += 1;
      p.vel.copy(_up).multiplyScalar(-side * (2 + Math.random() * 5))
        .add(_v.set((Math.random() - 0.5) * 10, 8 + Math.random() * 8, (Math.random() - 0.5) * 10));
      if (carVel) p.vel.addScaledVector(carVel, 0.75);
      p.color.copy(CONFETTI[i % CONFETTI.length]);
      p.size = 0.5 + Math.random() * 0.3;
      p.life = 2.6 + Math.random() * 1.4;
      p.age = 0;
      p.grav = 7;
      p.drag = 0.9;
      p.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      p.angle = Math.random() * 6.28;
      p.spin = (Math.random() - 0.5) * 14;
    }
  }

  update(dt) {
    this.puffs.update(dt, puffShape);
    this.sparks.update(dt, sparkShape);
    this.confetti.update(dt, confettiShape);
  }
}
