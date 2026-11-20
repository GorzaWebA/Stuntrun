// Sky, lights, ground and low poly decoration (trees, rocks, mountains, clouds).
import * as THREE from '../vendor/three.module.min.js';
import { GROUND_Y, TILE } from './config.js';
import { MeshBuilder, rgb } from './geometry.js';

const SKY_TOP = 0x3f8fe0;
const SKY_HORIZON = 0xcfe8f7;
const FOG = 0xcde5f4;
const SUN_DIR = new THREE.Vector3(0.45, 0.75, 0.35).normalize();

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
  const geo = new THREE.SphereGeometry(3500, 24, 14);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(SKY_TOP), hor = new THREE.Color(SKY_HORIZON), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i) / 3500);
    c.copy(hor).lerp(top, Math.pow(h, 0.6));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function makeGround() {
  const mb = new MeshBuilder();
  const size = 7000, n = 70, step = size / n, h = size / 2;
  const rnd = mulberry32(7);
  const shades = [0x86c95f, 0x7fc259, 0x8ccf66, 0x79bb55, 0x83c45c];
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

function makeMountains() {
  const mb = new MeshBuilder();
  const rnd = mulberry32(42);
  const count = 34;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rnd() * 0.15;
    const dist = 2100 + rnd() * 700;
    const cx = Math.cos(ang) * dist, cz = Math.sin(ang) * dist;
    const radius = 280 + rnd() * 320;
    const height = 260 + rnd() * 460;
    const segs = 5 + Math.floor(rnd() * 3);
    const rot = rnd() * Math.PI;
    const apex = new THREE.Vector3(cx + (rnd() - 0.5) * radius * 0.3, GROUND_Y + height, cz + (rnd() - 0.5) * radius * 0.3);
    const snowT = 0.62 + rnd() * 0.12;
    const rock = [0x7f8ea6, 0x8a98ae, 0x748399][i % 3];
    for (let s = 0; s < segs; s++) {
      const a0 = rot + (s / segs) * Math.PI * 2, a1 = rot + ((s + 1) / segs) * Math.PI * 2;
      const r0 = radius * (0.8 + rnd() * 0.35);
      const p0 = new THREE.Vector3(cx + Math.cos(a0) * r0, GROUND_Y - 2, cz + Math.sin(a0) * r0);
      const p1 = new THREE.Vector3(cx + Math.cos(a1) * radius, GROUND_Y - 2, cz + Math.sin(a1) * radius);
      const m0 = p0.clone().lerp(apex, snowT), m1 = p1.clone().lerp(apex, snowT);
      mb.quad(p1, p0, m0, m1, rock);
      mb.tri(m1, m0, apex, 0xf4f7fb);
    }
  }
  const mesh = new THREE.Mesh(mb.toGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  return mesh;
}

function makeClouds() {
  const rnd = mulberry32(99);
  const group = new THREE.Group();
  const base = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa9b8, flatShading: true, fog: false });
  for (let i = 0; i < 26; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rnd() * 4);
    for (let p = 0; p < puffs; p++) {
      const m = new THREE.Mesh(base, mat);
      const s = 14 + rnd() * 18;
      m.scale.set(s * 1.3, s * 0.8, s);
      m.position.set((p - puffs / 2) * 18 + rnd() * 8, rnd() * 8, rnd() * 14 - 7);
      m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      cloud.add(m);
    }
    const ang = rnd() * Math.PI * 2, dist = 300 + rnd() * 1500;
    cloud.position.set(Math.cos(ang) * dist, 170 + rnd() * 170, Math.sin(ang) * dist);
    cloud.userData.speed = 2 + rnd() * 3;
    group.add(cloud);
  }
  return group;
}

export class Scenery {
  constructor(scene) {
    this.scene = scene;
    scene.background = new THREE.Color(FOG);
    scene.fog = new THREE.Fog(FOG, 400, 2600);
    this.sky = makeSky();
    scene.add(this.sky);

    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(110, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false, depthWrite: false }),
    );
    sunDisc.renderOrder = -9;
    this.sunDisc = sunDisc;
    scene.add(sunDisc);

    this.hemi = new THREE.HemisphereLight(0xe6f4ff, 0x5f8a45, 1.35);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.ground = makeGround();
    scene.add(this.ground);
    this.mountains = makeMountains();
    scene.add(this.mountains);
    this.clouds = makeClouds();
    scene.add(this.clouds);
    this.decor = null;
    this.treeCount = 450;
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
    this.treeCount = [160, 380, 650][level];
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
    const margin = 320;
    const minX = b.min.x - margin, maxX = b.max.x + margin, minZ = b.min.z - margin, maxZ = b.max.z + margin;
    const occ = track.occupied;
    const free = (x, z, pad) => {
      const tx = Math.round(x / TILE), tz = Math.round(z / TILE);
      for (let i = -pad; i <= pad; i++) for (let j = -pad; j <= pad; j++) if (occ.has(`${tx + i},${tz + j}`)) return false;
      return true;
    };

    const pines = [], rounds = [], rocks = [];
    let attempts = 0;
    while (pines.length + rounds.length < this.treeCount && attempts < this.treeCount * 8) {
      attempts++;
      // cluster trees a little for a nicer look
      const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
      if (!free(x, z, 1)) continue;
      const n = 1 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const px = x + (rnd() - 0.5) * 26, pz = z + (rnd() - 0.5) * 26;
        if (!free(px, pz, 1)) continue;
        const s = 0.8 + rnd() * 0.9;
        (rnd() < 0.62 ? pines : rounds).push({ x: px, z: pz, s, r: rnd() * Math.PI * 2, c: rnd() });
      }
    }
    for (let i = 0; i < this.treeCount / 4; i++) {
      const x = minX + rnd() * (maxX - minX), z = minZ + rnd() * (maxZ - minZ);
      if (!free(x, z, 1)) continue;
      rocks.push({ x, z, s: 1 + rnd() * 3.5, r: rnd() * Math.PI * 2, c: rnd() });
    }

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const inst = (geo, mat, list, place, tint) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        place(t, dummy);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (tint) mesh.setColorAt(i, tint(t, color));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    };

    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 2.2, 5);
    trunkGeo.translate(0, 1.1, 0);
    const pineGeo = new THREE.ConeGeometry(2.6, 6.5, 6);
    pineGeo.translate(0, 5.2, 0);
    const pineTop = new THREE.ConeGeometry(1.8, 4.2, 6);
    pineTop.translate(0, 8.2, 0);
    const roundGeo = new THREE.IcosahedronGeometry(2.8, 0);
    roundGeo.translate(0, 4.4, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);

    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a5a33, flatShading: true });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });

    const all = pines.concat(rounds);
    inst(trunkGeo, trunkMat, all, (t, d) => { d.position.set(t.x, GROUND_Y, t.z); d.scale.setScalar(t.s); d.rotation.set(0, t.r, 0); });
    const pineTint = (t, c) => c.set(0x2f9e5a).lerp(new THREE.Color(0x1f7a4c), t.c);
    inst(pineGeo, leafMat, pines, (t, d) => { d.position.set(t.x, GROUND_Y, t.z); d.scale.setScalar(t.s); d.rotation.set(0, t.r, 0); }, pineTint);
    inst(pineTop, leafMat, pines, (t, d) => { d.position.set(t.x, GROUND_Y, t.z); d.scale.setScalar(t.s); d.rotation.set(0, t.r + 0.5, 0); }, pineTint);
    inst(roundGeo, leafMat, rounds, (t, d) => { d.position.set(t.x, GROUND_Y, t.z); d.scale.setScalar(t.s); d.rotation.set(0.2, t.r, 0.1); },
      (t, c) => c.set(0x5dbb4a).lerp(new THREE.Color(0xa6d453), t.c * 0.7));
    inst(rockGeo, rockMat, rocks, (t, d) => { d.position.set(t.x, GROUND_Y + t.s * 0.2, t.z); d.scale.set(t.s * 1.3, t.s * 0.8, t.s); d.rotation.set(t.r, t.r * 2, 0); },
      (t, c) => c.set(0x9aa3ad).lerp(new THREE.Color(0xc4c9cf), t.c));

    this.decor = group;
    this.scene.add(group);
  }

  update(dt, focus, camera) {
    this.sky.position.copy(camera.position);
    this.sunDisc.position.copy(camera.position).addScaledVector(SUN_DIR, 3000);
    this.sunDisc.lookAt(camera.position);
    // keep the shadow camera around the focus point, snapped to texels to avoid shimmering
    const texel = 140 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(SUN_DIR, 350);
    for (const c of this.clouds.children) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 1800) c.position.x = -1800;
    }
  }
}

export { SUN_DIR, rgb };
