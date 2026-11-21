// Chase camera that follows the car through loops and keeps a steady horizon in the air.
import * as THREE from '../vendor/three.module.min.js';
import { GROUND_Y } from './config.js';

export const CAMERA_PRESETS = [
  { name: 'Chase', dist: 7.2, height: 2.4, look: 1.1, fov: 68 },
  { name: 'Far', dist: 10.5, height: 3.6, look: 1.3, fov: 64 },
  { name: 'Close', dist: 5.2, height: 1.7, look: 0.9, fov: 74 },
];

const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _v = new THREE.Vector3();
const _target = new THREE.Vector3(), _desired = new THREE.Vector3(), _look = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.preset = 0;
    this.up = new THREE.Vector3(0, 1, 0);
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.mode = 'chase';
    this.orbitAngle = 0;
    this.shake = 0;
    this.baseFov = 68;
  }

  setPreset(i) { this.preset = ((i % CAMERA_PRESETS.length) + CAMERA_PRESETS.length) % CAMERA_PRESETS.length; }

  snap(pos, quat) {
    this.fwd.set(0, 0, 1).applyQuaternion(quat);
    this.up.set(0, 1, 0);
    const p = CAMERA_PRESETS[this.preset];
    this.camera.position.copy(pos).addScaledVector(this.fwd, -p.dist).addScaledVector(this.up, p.height);
    this.camera.up.copy(this.up);
    this.camera.lookAt(_look.copy(pos).addScaledVector(this.up, p.look).addScaledVector(this.fwd, 4));
  }

  _applyFov(fov) {
    const cam = this.camera;
    // keep a sensible horizontal field of view on portrait screens
    const aspect = cam.aspect;
    let v = fov;
    if (aspect < 1.25) {
      const h = 2 * Math.atan(Math.tan((fov * Math.PI) / 360) * 1.25);
      v = (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
      v = Math.min(v, 100);
    }
    if (Math.abs(cam.fov - v) > 0.01) {
      cam.fov = v;
      cam.updateProjectionMatrix();
    }
  }

  update(dt, phys, pos, quat) {
    const p = CAMERA_PRESETS[this.preset];
    const cam = this.camera;
    if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.35;
      const r = 11;
      _desired.set(pos.x + Math.sin(this.orbitAngle) * r, pos.y + 3.2, pos.z + Math.cos(this.orbitAngle) * r);
      _desired.y = Math.max(_desired.y, GROUND_Y + 1);
      cam.position.lerp(_desired, 1 - Math.exp(-3 * dt));
      this.up.lerp(WORLD_UP, 1 - Math.exp(-3 * dt)).normalize();
      cam.up.copy(this.up);
      cam.lookAt(_look.copy(pos).add(_v.set(0, 0.8, 0)));
      this._applyFov(p.fov);
      return;
    }
    const grounded = phys.grounded >= 2 || phys.stickTimer > 0;
    _fwd.set(0, 0, 1).applyQuaternion(quat);
    _up.set(0, 1, 0).applyQuaternion(quat);
    // up vector: follow the car on the road (loops, banks), world up in the air
    const desiredUp = grounded ? _up : WORLD_UP;
    this.up.lerp(desiredUp, 1 - Math.exp(-(grounded ? 5 : 1.6) * dt)).normalize();
    // forward: car heading, or travel direction while airborne
    if (!grounded && phys.speed > 8) {
      _v.copy(phys.vel).normalize();
      _fwd.lerp(_v, 0.6);
    }
    _fwd.addScaledVector(this.up, -_fwd.dot(this.up));
    if (_fwd.lengthSq() < 1e-4) _fwd.copy(this.fwd);
    _fwd.normalize();
    this.fwd.lerp(_fwd, 1 - Math.exp(-6 * dt)).normalize();

    _target.copy(pos).addScaledVector(this.up, p.look);
    const speedPull = Math.min(1.5, phys.speed * 0.012);
    _desired.copy(_target).addScaledVector(this.fwd, -(p.dist + speedPull)).addScaledVector(this.up, p.height - p.look);
    if (_desired.y < GROUND_Y + 0.7) _desired.y = GROUND_Y + 0.7;
    cam.position.lerp(_desired, 1 - Math.exp(-18 * dt));
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
    cam.up.copy(this.up);
    cam.lookAt(_look.copy(_target).addScaledVector(this.fwd, 5));
    const boost = phys.boostTimer > 0 ? 6 : 0;
    this._fovCur = this._fovCur ?? p.fov;
    const targetFov = p.fov + Math.min(14, phys.speed * 0.17) + boost;
    this._fovCur += (targetFov - this._fovCur) * (1 - Math.exp(-3 * dt));
    this._applyFov(this._fovCur);
  }
}
