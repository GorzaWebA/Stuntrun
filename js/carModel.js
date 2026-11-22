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

// flat disk / star decals facing +Y (roof)
function disk(mb, cx, y, cz, r, n, color) {
  const c = V(cx, y, cz);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    mb.tri(c, V(cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r), V(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r), color);
  }
}
function star(mb, cx, y, cz, R, r, color) {
  const c = V(cx, y, cz);
  const pt = (i) => {
    const a = Math.PI / 2 + (i * Math.PI) / 5; // first point faces forward (+Z)
    const rr = i % 2 ? r : R;
    return V(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
  };
  for (let i = 0; i < 10; i++) mb.tri(c, pt(i + 1), pt(i), color);
}

const INK = 0x2a1f33, BONE = 0xf6ead2, RED = 0xe23b2e;

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
    { x0: -0.68, x1: 0.68, z0: -0.98, z1: 0.26, y: 0.34 }, 0x24324a);
  // roof
  hexa(paint,
    { x0: -0.7, x1: 0.7, z0: -1.0, z1: 0.28, y: 0.33 },
    { x0: -0.66, x1: 0.66, z0: -0.94, z1: 0.22, y: 0.4 }, 0xffffff);
  // spoiler
  detail.box(0.48, -0.12, -1.92, 0.58, 0.24, -1.8, INK);
  detail.box(-0.58, -0.12, -1.92, -0.48, 0.24, -1.8, INK);
  hexa(paint,
    { x0: -1.0, x1: 1.0, z0: -2.22, z1: -1.72, y: 0.22 },
    { x0: -1.0, x1: 1.0, z0: -2.24, z1: -1.78, y: 0.32 }, 0xffffff);
  // bumpers / skirts
  detail.box(-0.92, -0.66, 2.02, 0.92, -0.5, 2.2, INK);
  detail.box(-0.92, -0.66, -2.2, 0.92, -0.48, -2.0, INK);
  detail.box(0.97, -0.64, -1.0, 1.02, -0.5, 0.95, INK);
  detail.box(-1.02, -0.64, -1.0, -0.97, -0.5, 0.95, INK);
  // show livery: twin bone stripes nose to tail, side stripes, star roundel on the roof
  for (const [x0, x1] of [[0.09, 0.25], [-0.25, -0.09]]) {
    hexa(detail,
      { x0, x1, z0: 0.8, z1: 2.14, y: -0.36 },
      { x0, x1, z0: 0.8, z1: 2.14, y0: -0.18, y1: -0.33 }, BONE);
    hexa(detail,
      { x0, x1, z0: -2.1, z1: -1.32, y: -0.2 },
      { x0, x1, z0: -2.1, z1: -1.32, y0: -0.066, y1: -0.116 }, BONE);
    detail.box(x0, 0.32, -2.235, x1, 0.335, -1.785, BONE);
  }
  for (const side of [1, -1]) {
    const xa = side > 0 ? 0.955 : -0.995, xb = side > 0 ? 0.995 : -0.955;
    detail.box(xa, -0.45, -1.9, xb, -0.37, 1.5, BONE);
    detail.box(xa, -0.36, -1.9, xb, -0.33, 1.5, RED);
  }
  disk(detail, 0, 0.405, -0.36, 0.34, 10, INK);
  disk(detail, 0, 0.41, -0.36, 0.28, 10, BONE);
  star(detail, 0, 0.415, -0.36, 0.24, 0.1, RED);
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
    tireMat: new THREE.MeshLambertMaterial({ color: 0x231a2b, flatShading: true }),
    hubMat: new THREE.MeshLambertMaterial({ color: 0xe8dcc4, flatShading: true }),
    flameMat: new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.85, depthWrite: false }),
  };
  return shared;
}

export class CarModel {
  constructor({ color = 0xe23b2e, ghost = false } = {}) {
    const g = sharedGeometry();
    this.group = new THREE.Group();
    this.ghost = ghost;
    if (ghost) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x5fd3cf, transparent: true, opacity: 0.36, depthWrite: false });
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
