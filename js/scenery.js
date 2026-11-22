// The show's location: a sun-baked desert canyon. Sky, light, sand, mesas on
// the horizon, cacti, scrub, rocks and a few flat clouds. Palette in DESIGN.md.
import * as THREE from '../vendor/three.module.min.js';
import { GROUND_Y, TILE } from './config.js';
import { MeshBuilder, rgb } from './geometry.js';

const SKY_TOP = 0x3f7cc6;
const SKY_HORIZON = 0xf7d6a4;
const FOG = 0xf0cf9c;
const SUN_DIR = new THREE.Vector3(0.42, 0.5, 0.76).normalize();

// deterministic random so every track gets the same scenery each time
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

function makeSky() {
  const geo = new THREE.SphereGeometry(3500, 24, 40);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  // warm haze at the horizon, then straight into clear blue: a direct
  // sand-to-blue blend passes through grey, so the middle stops stay blue
  const stops = [
    [0, new THREE.Color(SKY_HORIZON)],
    [0.05, new THREE.Color(0xf3e3c4)],
    [0.16, new THREE.Color(0xa9cfee)],
    [0.42, new THREE.Color(0x6aa6dd)],
    [1, new THREE.Color(SKY_TOP)],
  ];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) / 3500);
    let k = 1;
    while (k < stops.length - 1 && h > stops[k][0]) k++;
    const [h0, c0] = stops[k - 1], [h1, c1] = stops[k];
    c.copy(c0).lerp(c1, Math.min(1, Math.max(0, (h - h0) / (h1 - h0))));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function makeGround() {
  const mb = new MeshBuilder();
  const size = 7000, n = 70, step = size / n, h = size / 2;
  const rnd = mulberry32(7);
  const shades = [0xe2b674, 0xdcae6b, 0xe6bd7e, 0xd9aa66, 0xdfb371, 0xe4ba79];
  const V = (x, z) => new THREE.Vector3(x, GROUND_Y, z);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = -h + i * step, z0 = -h + j * step;
      const a = V(x0, z0), b = V(x0 + step, z0), c = V(x0 + step, z0 + step), d = V(x0, z0 + step);
      mb.tri(a, c, b, shades[Math.floor(rnd() * shades.length)]);
      mb.tri(a, d, c, shades[Math.floor(rnd() * shades.length)]);
    }
  }
  const mesh = new THREE.Mesh(mb.toGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

// Layered red-rock mesas and buttes ringing the arena.
function makeMesas() {
  const mb = new MeshBuilder();
  const rnd = mulberry32(42);
  const bands = [0xb9613a, 0xcf7d4c, 0xa9542f, 0xd88f5a];
  const count = 30;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rnd() * 0.18;
    const dist = 1700 + rnd() * 900;
    const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
    const butte = rnd() < 0.3;
    const R = butte ? 90 + rnd() * 90 : 220 + rnd() * 320;
    const H = butte ? 200 + rnd() * 220 : 110 + rnd() * 200;
    const sides = 7 + Math.floor(rnd() * 4);
    const rot = rnd() * Math.PI;
    const jag = Array.from({ length: sides }, () => 0.82 + rnd() * 0.3);
    const ring = (r, y) => jag.map((j, k) => {
      const a = rot + (k / sides) * Math.PI * 2;
      return new THREE.Vector3(cx + Math.cos(a) * r * j, y, cz + Math.sin(a) * r * j);
    });
    // talus slope, three cliff bands, flat cap
    const levels = [
      [ring(R, GROUND_Y - 2), ring(R * 0.74, GROUND_Y + H * 0.28), 0xc9784a],
      [ring(R * 0.74, GROUND_Y + H * 0.28), ring(R * 0.7, GROUND_Y + H * 0.52), bands[i % 4]],
      [ring(R * 0.7, GROUND_Y + H * 0.52), ring(R * 0.68, GROUND_Y + H * 0.78), bands[(i + 1) % 4]],
      [ring(R * 0.68, GROUND_Y + H * 0.78), ring(R * 0.66, GROUND_Y + H), bands[(i + 2) % 4]],
    ];
    for (const [lo, hi, col] of levels) {
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        mb.quad(lo[k1], lo[k], hi[k], hi[k1], col);
      }
    }
    const top = levels[3][1];
    const c = new THREE.Vector3(cx, GROUND_Y + H, cz);
    for (let k = 0; k < sides; k++) mb.tri(c, top[(k + 1) % sides], top[k], 0xdc9a63);
  }
  return new THREE.Mesh(mb.toGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
}

// Flat, soft cumulus: unlit so they read as soft shapes rather than rocks.
function makeClouds() {
  const rnd = mulberry32(99);
  const group = new THREE.Group();
  const base = new THREE.IcosahedronGeometry(1, 1);
  const mats = [0xfff7e8, 0xfdf0dc, 0xfbebd2].map((c) => new THREE.MeshBasicMaterial({ color: c, fog: false }));
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(rnd() * 4);
    for (let p = 0; p < puffs; p++) {
      const m = new THREE.Mesh(base, mats[p % mats.length]);
      const s = 16 + rnd() * 16;
      m.scale.set(s * 1.4, s * 0.42, s);
      m.position.set((p - puffs / 2) * 22 + rnd() * 10, rnd() * 4, rnd() * 18 - 9);
      cloud.add(m);
    }
    const ang = rnd() * Math.PI * 2, dist = 500 + rnd() * 1500;
    cloud.position.set(Math.cos(ang) * dist, 230 + rnd() * 160, Math.sin(ang) * dist);
    cloud.userData.speed = 1.5 + rnd() * 2.5;
    group.add(cloud);
  }
  return group;
}

// Low poly saguaro (trunk + arms), barrel cactus, scrub bush and rock.
function saguaroGeometry(arms) {
  const mb = new MeshBuilder();
  const green = 0x5e8f4b, dark = 0x4c7a3d;
  const prism = (x, y0, z, r, y1, col, cap = true) => {
    const n = 6;
    const lo = [], hi = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      lo.push(new THREE.Vector3(x + Math.cos(a) * r, y0, z + Math.sin(a) * r));
      hi.push(new THREE.Vector3(x + Math.cos(a) * r, y1, z + Math.sin(a) * r));
    }
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      mb.quad(lo[k1], lo[k], hi[k], hi[k1], k % 2 ? green : dark);
    }
    if (cap) {
      const tip = new THREE.Vector3(x, y1 + r * 0.8, z);
      for (let k = 0; k < n; k++) mb.tri(tip, hi[(k + 1) % n], hi[k], green);
    }
  };
  prism(0, 0, 0, 0.55, 6.2, green);
  const arm = (side, y, len, up) => {
    const x = side * (0.55 + len / 2);
    mb.box(Math.min(0, side) * (0.55 + len) + Math.max(0, side) * 0.4, y - 0.38, -0.38, Math.max(0, side) * (0.55 + len) + Math.min(0, side) * 0.4, y + 0.38, 0.38, dark);
    prism(side * (0.55 + len - 0.38), y - 0.2, 0, 0.4, y + up, green);
    return x;
  };
  arm(1, 2.6, 1.1, 2.2);
  if (arms > 1) arm(-1, 3.4, 0.9, 1.6);
  return mb.toGeometry();
}

function barrelGeometry() {
  const mb = new MeshBuilder();
  const n = 8, r = 0.75, h = 1.1;
  const lo = [], hi = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    lo.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    hi.push(new THREE.Vector3(Math.cos(a) * r * 0.85, h, Math.sin(a) * r * 0.85));
  }
  for (let k = 0; k < n; k++) mb.quad(lo[(k + 1) % n], lo[k], hi[k], hi[(k + 1) % n], k % 2 ? 0x6e9a50 : 0x5d8743);
  const top = new THREE.Vector3(0, h + 0.25, 0);
  for (let k = 0; k < n; k++) mb.tri(top, hi[(k + 1) % n], hi[k], k % 2 ? 0xe2507a : 0xf07a98);
  return mb.toGeometry();
}

export class Scenery {
  constructor(scene) {
    this.scene = scene;
    scene.background = new THREE.Color(FOG);
    scene.fog = new THREE.Fog(FOG, 450, 2900);
    this.sky = makeSky();
    scene.add(this.sky);

    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(150, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false, depthWrite: false }),
    );
    sunDisc.renderOrder = -9;
    this.sunDisc = sunDisc;
    scene.add(sunDisc);

    this.hemi = new THREE.HemisphereLight(0xfff0d8, 0xc48a55, 1.25);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffe2b3, 2.5);
    this.sun.shadow.camera.left = -75;
    this.sun.shadow.camera.right = 75;
    this.sun.shadow.camera.top = 75;
    this.sun.shadow.camera.bottom = -75;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 800;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.ground = makeGround();
    scene.add(this.ground);
    this.mountains = makeMesas();
    scene.add(this.mountains);
    this.clouds = makeClouds();
    scene.add(this.clouds);
    this.decor = null;
    this.density = 1;
  }

  setQuality(level) {
    // level: 0 low, 1 medium, 2 high
    this.sun.castShadow = level > 0;
    const size = level >= 2 ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.clouds.visible = level > 0;
    this.density = [0.45, 0.8, 1.2][level];
  }

  buildDecor(track) {
    if (this.decor) {
      this.decor.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      this.decor.removeFromParent();
    }
    const group = new THREE.Group();
    const b = track.bounds;
    const seed = Math.floor(Math.abs(b.min.x * 13 + b.max.z * 7 + track.def.pieces.length * 31)) + 1;
    const rnd = mulberry32(seed);
    const margin = 340;
    const minX = b.min.x - margin, maxX = b.max.x + margin, minZ = b.min.z - margin, maxZ = b.max.z + margin;
    const occ = track.occupied;
    const free = (x, z, pad) => {
      const tx = Math.round(x / TILE), tz = Math.round(z / TILE);
      for (let i = -pad; i <= pad; i++) for (let j = -pad; j <= pad; j++) if (occ.has(`${tx + i},${tz + j}`)) return false;
      return true;
    };
    const scatter = (count, pad, make) => {
      const out = [];
      let tries = 0;
      while (out.length < count && tries < count * 10) {
        tries++;
        const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
        if (!free(x, z, pad)) continue;
        out.push(make(x, z));
      }
      return out;
    };
    const d = this.density;
    const sag1 = scatter(Math.round(90 * d), 1, (x, z) => ({ x, z, s: 0.8 + rnd() * 0.7, r: rnd() * 6.3, c: rnd() }));
    const sag2 = scatter(Math.round(60 * d), 1, (x, z) => ({ x, z, s: 0.9 + rnd() * 0.6, r: rnd() * 6.3, c: rnd() }));
    const barrels = scatter(Math.round(90 * d), 1, (x, z) => ({ x, z, s: 0.7 + rnd() * 0.8, r: rnd() * 6.3, c: rnd() }));
    const shrubs = scatter(Math.round(260 * d), 1, (x, z) => ({ x, z, s: 0.9 + rnd() * 1.6, r: rnd() * 6.3, c: rnd() }));
    const rocks = scatter(Math.round(130 * d), 1, (x, z) => ({ x, z, s: 0.8 + rnd() * 4, r: rnd() * 6.3, c: rnd() }));

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const inst = (geo, mat, list, place, tint, shadow = true) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        place(t, dummy);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (tint) mesh.setColorAt(i, tint(t, color));
      });
      mesh.castShadow = shadow;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    };
    const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
    const plain = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const upright = (t, o) => { o.position.set(t.x, GROUND_Y, t.z); o.scale.setScalar(t.s); o.rotation.set(0, t.r, 0); };
    const shade = (t, c) => c.setScalar(0.88 + t.c * 0.18);
    inst(saguaroGeometry(1), vc, sag1, upright, shade);
    inst(saguaroGeometry(2), vc, sag2, upright, shade);
    inst(barrelGeometry(), vc, barrels, upright, shade);
    const shrubGeo = new THREE.IcosahedronGeometry(1, 0);
    inst(shrubGeo, plain, shrubs, (t, o) => { o.position.set(t.x, GROUND_Y + 0.25 * t.s, t.z); o.scale.set(t.s * 1.3, t.s * 0.6, t.s * 1.1); o.rotation.set(0, t.r, 0); },
      (t, c) => c.set(0x9a9a56).lerp(new THREE.Color(0xb7a466), t.c), false);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    inst(rockGeo, plain, rocks, (t, o) => { o.position.set(t.x, GROUND_Y + t.s * 0.25, t.z); o.scale.set(t.s * 1.3, t.s * 0.75, t.s); o.rotation.set(t.r, t.r * 2, 0); },
      (t, c) => c.set(0xb96a40).lerp(new THREE.Color(0xd9a273), t.c));

    this.decor = group;
    this.scene.add(group);
  }

  update(dt, focus, camera) {
    this.sky.position.copy(camera.position);
    this.sunDisc.position.copy(camera.position).addScaledVector(SUN_DIR, 3000);
    this.sunDisc.lookAt(camera.position);
    // keep the shadow camera around the focus point, snapped to texels to avoid shimmering
    const texel = 150 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIR, 400);
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 2000) c.position.x = -2000;
    }
  }
}

export { SUN_DIR, rgb };
