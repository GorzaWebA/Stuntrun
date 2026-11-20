// Low poly car mesh. Local frame matches the physics: +Z forward, +X left.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from './geometry.js';
import { WHEELS, CAR } from './car.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function hexa(mb, b, t, color) {
  // b/t: {x0,x1,z0,z1,y} bottom/top rectangles (x0 < x1, z0 < z1)
  mb.hexa([
    V(b.x0, b.y, b.z0), V(b.x1, b.y, b.z0), V(b.x1, b.y, b.z1), V(b.x0, b.y, b.z1),
    V(t.x0, t.y0 ?? t.y, t.z0), V(t.x1, t.y0 ?? t.y, t.z0), V(t.x1, t.y1 ?? t.y, t.z1), V(t.x0, t.y1 ?? t.y, t.z1),
  ], color);
}

let shared = null;
function sharedGeometry() {
  if (shared) return shared;
  const paint = new MeshBuilder();
  const detail = new MeshBuilder();
  const glow = new MeshBuilder();
  // lower body with a sloped nose (top front lower than rear)
  hexa(paint,
    { x0: -0.98, x1: 0.98, z0: -2.05, z1: 2.08, y: -0.62 },
    { x0: -0.96, x1: 0.96, z0: -2.12, z1: 2.16, y0: -0.08, y1: -0.36 }, 0xffffff);
  // cabin glass
  hexa(detail,
    { x0: -0.86, x1: 0.86, z0: -1.3, z1: 0.82, y: -0.16 },
    { x0: -0.68, x1: 0.68, z0: -0.98, z1: 0.26, y: 0.34 }, 0x1d2b3f);
  // roof
  hexa(paint,
    { x0: -0.7, x1: 0.7, z0: -1.0, z1: 0.28, y: 0.33 },
    { x0: -0.66, x1: 0.66, z0: -0.94, z1: 0.22, y: 0.4 }, 0xffffff);
  // spoiler
  detail.box(0.48, -0.12, -1.92, 0.58, 0.24, -1.8, 0x23272f);
  detail.box(-0.58, -0.12, -1.92, -0.48, 0.24, -1.8, 0x23272f);
  hexa(paint,
    { x0: -1.0, x1: 1.0, z0: -2.22, z1: -1.72, y: 0.22 },
    { x0: -1.0, x1: 1.0, z0: -2.24, z1: -1.78, y: 0.32 }, 0xffffff);
  // bumpers / skirts
  detail.box(-0.92, -0.66, 2.02, 0.92, -0.5, 2.2, 0x23272f);
  detail.box(-0.92, -0.66, -2.2, 0.92, -0.48, -2.0, 0x23272f);
  detail.box(0.97, -0.64, -1.0, 1.02, -0.5, 0.95, 0x23272f);
  detail.box(-1.02, -0.64, -1.0, -0.97, -0.5, 0.95, 0x23272f);
  // stripes on the hood and roof
  hexa(detail,
    { x0: -0.18, x1: 0.18, z0: 0.8, z1: 2.14, y: -0.36 },
    { x0: -0.18, x1: 0.18, z0: 0.8, z1: 2.14, y0: -0.18, y1: -0.33 }, 0xf4f6fa);
  // lights
  glow.box(0.55, -0.44, 2.13, 0.86, -0.36, 2.19, 0xfff4cc);
  glow.box(-0.86, -0.44, 2.13, -0.55, -0.36, 2.19, 0xfff4cc);
  glow.box(0.5, -0.3, -2.17, 0.86, -0.2, -2.1, 0xff2f43);
  glow.box(-0.86, -0.3, -2.17, -0.5, -0.2, -2.1, 0xff2f43);

  const tire = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.34, 10);
  tire.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.21, 0.21, 0.36, 6);
  hub.rotateZ(Math.PI / 2);
  const flame = new THREE.ConeGeometry(0.16, 0.9, 6);
  flame.rotateX(-Math.PI / 2);
  flame.translate(0, 0, -0.45);
  shared = {
    paint: paint.toGeometry(), detail: detail.toGeometry(), glow: glow.toGeometry(), tire, hub, flame,
    detailMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    glowMat: new THREE.MeshBasicMaterial({ vertexColors: true }),
    tireMat: new THREE.MeshLambertMaterial({ color: 0x1b1e25, flatShading: true }),
    hubMat: new THREE.MeshLambertMaterial({ color: 0xc9ced6, flatShading: true }),
    flameMat: new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.85, depthWrite: false }),
  };
  return shared;
}

export class CarModel {
  constructor({ color = 0xff5a36, ghost = false } = {}) {
    const g = sharedGeometry();
    this.group = new THREE.Group();
    this.ghost = ghost;
    if (ghost) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.32, depthWrite: false });
      this.paintMat = mat;
      for (const geo of [g.paint, g.detail]) this.group.add(new THREE.Mesh(geo, mat));
    } else {
      this.paintMat = new THREE.MeshLambertMaterial({ color });
      const meshes = [
        new THREE.Mesh(g.paint, this.paintMat),
        new THREE.Mesh(g.detail, g.detailMat),
        new THREE.Mesh(g.glow, g.glowMat),
      ];
      for (const m of meshes) { m.castShadow = true; this.group.add(m); }
    }
    this.wheels = WHEELS.map((w) => {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      pivot.add(spin);
      const side = w.x > 0 ? 1 : -1;
      const tire = new THREE.Mesh(g.tire, ghost ? this.paintMat : g.tireMat);
      const hub = new THREE.Mesh(g.hub, ghost ? this.paintMat : g.hubMat);
      tire.castShadow = !ghost;
      hub.position.x = side * 0.01;
      spin.add(tire, hub);
      pivot.position.set(w.x + side * 0.1, w.y - 0.3, w.z);
      this.group.add(pivot);
      return { pivot, spin, side };
    });
    this.flames = [];
    if (!ghost) {
      for (const x of [0.45, -0.45]) {
        const f = new THREE.Mesh(g.flame, g.flameMat);
        f.position.set(x, -0.42, -2.2);
        f.visible = false;
        this.group.add(f);
        this.flames.push(f);
      }
    }
  }

  setColor(hex) {
    if (!this.ghost) this.paintMat.color.set(hex);
  }

  // phys: CarPhysics; pos/quat may be interpolated values
  update(phys, pos, quat, time = 0) {
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
    for (let i = 0; i < 4; i++) {
      const v = phys.wheelVisual(i);
      const w = this.wheels[i];
      w.pivot.position.y = v.y;
      w.pivot.rotation.y = -v.steer;
      w.spin.rotation.x = v.spin;
    }
    const boosting = phys.boostTimer > 0;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) {
        const s = 0.8 + Math.sin(time * 60 + f.position.x * 10) * 0.25 + Math.random() * 0.2;
        f.scale.set(1, 1, s * (0.6 + Math.min(1, phys.boostTimer) * 0.8));
      }
    }
  }

  // ghost playback: only pose
  setPose(pos, quat) {
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
  }

  dispose() {
    this.group.removeFromParent();
    if (this.ghost || this.paintMat) this.paintMat.dispose();
  }
}
