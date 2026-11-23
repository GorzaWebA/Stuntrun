// Stunt arenas: fenced open-floor set pieces several tiles big. Each one is
// laid out around a racing line, and every object in it has one job that the
// player can read from where they are driving:
//   cones          line you up (funnels) or guide you to an exit; they get
//                  knocked flying if you clip them (a little speed lost)
//   ramp + wrecks  the jump, with a slower bumpy "chicken lane" round the side
//   barrier walls  force a weave; chevron boards point at the gap
//   3-2-1 boards   brake here
//   tyre wall      the apex of a turn; sand on the outside punishes running wide
//   painted target where a big jump should land
// Local space follows the other pieces: entry on the back edge of tile (0,0)
// heading +Z, +X is the driver's left, one tile is 20 m.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, DECK_T, COLORS } from './config.js';
import { SURF } from './collision.js';
import { MeshBuilder } from './geometry.js';

const T = TILE;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export const ARENA = {
  floorA: 0x8c7f72, floorB: 0x857868, seam: 0x6f6357,
  sand: [0xe0b472, 0xdcae6b, 0xe3b877, 0xdeb16f],
  fenceA: COLORS.curbA, fenceB: COLORS.curbB,
  hazardA: 0xffc42e, hazardB: 0x2a1f33,
  ink: 0x2a1f33, bone: 0xf6ead2, red: 0xe23b2e, yellow: 0xffc42e,
  cone: 0xe8552a,
};
const WRECKS = [0xa8453a, 0x5f8f8a, 0xcda24a, 0xbfb29a, 0x6d5f7a, 0x8a6a4a];

// --- small helpers ------------------------------------------------------------

// quad / triangle that faces `n` whatever order the corners come in
function faceQuad(mb, a, b, c, d, n, color, surf = -1) {
  const nn = V().subVectors(b, a).cross(V().subVectors(c, a));
  if (nn.dot(n) >= 0) mb.quad(a, b, c, d, color, surf); else mb.quad(a, d, c, b, color, surf);
}
function faceTri(mb, a, b, c, n, color, surf = -1) {
  const nn = V().subVectors(b, a).cross(V().subVectors(c, a));
  if (nn.dot(n) >= 0) mb.tri(a, b, c, color, surf); else mb.tri(a, c, b, color, surf);
}
const UP = V(0, 1, 0);

// flat paint on the floor (visual only)
function paint(mb, pts, color, y = 0.025) {
  const p = pts.map(([x, z]) => V(x, y, z));
  if (p.length === 3) faceTri(mb, p[0], p[1], p[2], UP, color);
  else faceQuad(mb, p[0], p[1], p[2], p[3], UP, color);
}

function prism(mb, cx, cz, r, n, y0, y1, color, surf = -1, topColor = color) {
  for (let i = 0; i < n; i++) {
    const a0 = ((i + 0.5) / n) * Math.PI * 2, a1 = ((i + 1.5) / n) * Math.PI * 2;
    const p0 = V(cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r), p1 = V(cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r);
    const out = V(Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2));
    faceQuad(mb, p0, p1, V(p1.x, y1, p1.z), V(p0.x, y1, p0.z), out, color, surf);
    faceTri(mb, V(cx, y1, cz), V(p0.x, y1, p0.z), V(p1.x, y1, p1.z), UP, topColor, surf);
  }
}

// Cones are knock-over props, not static track: pieces only record where they
// stand, and the track builder turns them into one instanced mesh.
export function cone(mb, x, z) {
  (mb.cones ||= []).push([x, z]);
}

// One cone at the origin, standing on y = 0.
export function coneGeometryData() {
  const mb = new MeshBuilder();
  const r = 0.5, hgt = 1.1, segs = 6;
  mb.box(-r * 1.2, 0, -r * 1.2, r * 1.2, 0.12, r * 1.2, ARENA.ink);
  const apex = V(0, hgt, 0);
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const p0 = V(Math.cos(a0) * r, 0.12, Math.sin(a0) * r), p1 = V(Math.cos(a1) * r, 0.12, Math.sin(a1) * r);
    const m0 = V().lerpVectors(p0, apex, 0.45), m1 = V().lerpVectors(p1, apex, 0.45);
    const n0 = V().lerpVectors(p0, apex, 0.62), n1 = V().lerpVectors(p1, apex, 0.62);
    mb.quad(p1, p0, m0, m1, ARENA.cone);
    mb.quad(m1, m0, n0, n1, ARENA.bone);
    mb.tri(n1, n0, apex, ARENA.cone);
  }
  return mb.toData();
}

// cones every `gap` metres along a line
function coneLine(mb, x0, z0, x1, z1, gap = 2.6) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / gap));
  for (let i = 0; i <= n; i++) cone(mb, x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n);
}

// stack of three tyres
function tyreStack(mb, x, z, band) {
  for (let k = 0; k < 3; k++) {
    const y0 = k * 0.37, col = k === 2 ? band : ARENA.ink;
    prism(mb, x, z, 0.72, 8, y0, y0 + 0.35, col, SURF.WALL, ARENA.ink);
  }
}

// low concrete barrier wall across x0..x1 at z, show stripes
function barrierWall(mb, x0, x1, z, h = 1.2, t = 1.4) {
  const n = Math.max(1, Math.round((x1 - x0) / 1.8));
  for (let i = 0; i < n; i++) {
    const a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n;
    mb.box(a, 0, z - t / 2, b, h, z + t / 2, i % 2 ? ARENA.bone : ARENA.red, SURF.WALL);
  }
}

// yellow board with ink arrows pointing along +x (dir 1) or -x (dir -1), facing -z
function chevronBoard(mb, x, y, z, w, h, dir) {
  mb.box(x - w / 2, y - h / 2, z - 0.08, x + w / 2, y + h / 2, z + 0.08, ARENA.yellow);
  const n = V(0, 0, -1), zf = z - 0.1, k = 3, cw = w / k;
  for (let i = 0; i < k; i++) {
    const cx = x - w / 2 + cw * (i + 0.5);
    const tip = V(cx + dir * cw * 0.32, y, zf), b0 = V(cx - dir * cw * 0.28, y - h * 0.34, zf), b1 = V(cx - dir * cw * 0.28, y + h * 0.34, zf);
    faceTri(mb, tip, b0, b1, n, ARENA.ink);
  }
}

// brake marker: post with a bone board carrying 1..3 diagonal red stripes, facing -z
export function brakeBoard(mb, x, z, stripes, { y0 = 0, scale = 1, solid = true } = {}) {
  mb.box(x - 0.1, y0, z - 0.1, x + 0.1, 2.4 * scale, z + 0.1, ARENA.ink, solid ? SURF.WALL : -1);
  const w = 1.2 * scale, h = 1.6 * scale, y = 2.2 * scale;
  mb.box(x - w / 2, y - h / 2, z - 0.06, x + w / 2, y + h / 2, z + 0.06, ARENA.bone);
  const n = V(0, 0, -1), zf = z - 0.08;
  for (let i = 0; i < stripes; i++) {
    const cy = y - h / 2 + h * (i + 0.5) / stripes, sh = h / stripes * 0.32;
    faceQuad(mb, V(x - w / 2 + 0.08, cy - sh - 0.18, zf), V(x + w / 2 - 0.08, cy - sh + 0.18, zf),
      V(x + w / 2 - 0.08, cy + sh + 0.18, zf), V(x - w / 2 + 0.08, cy + sh - 0.18, zf), n, ARENA.red);
  }
}

// a wrecked car parked along z (the thing you jump over)
function wreck(mb, x, z, color, k) {
  const sh = ((k * 37) % 7 - 3) * 0.06;
  mb.box(x - 1.0, 0.28, z - 2.15, x + 1.0, 0.95, z + 2.15, color, SURF.WALL);
  // crumpled bonnet sits lower on every other car
  if (k % 2) mb.box(x - 0.95, 0.95, z + 1.0, x + 0.95, 1.05, z + 2.05, color, SURF.WALL);
  mb.box(x - 0.84, 0.95, z - 1.05 + sh, x + 0.84, 1.45, z + 0.85 + sh, 0x3a3346, SURF.WALL,
    [0x3a3346, color, 0x3a3346, 0x3a3346, 0x3a3346, 0x3a3346]);
  for (const wx of [-0.98, 0.98]) for (const wz of [-1.35, 1.35]) mb.box(x + wx - 0.17, 0, z + wz - 0.36, x + wx + 0.17, 0.66, z + wz + 0.36, ARENA.ink);
}

// drivable speed bump across x0..x1 at z
function bumpStrip(mb, x0, x1, zc) {
  const l = 1.4, ht = 0.32;
  const prof = [[zc - l, 0], [zc - l * 0.35, ht], [zc + l * 0.35, ht], [zc + l, 0]];
  const n = Math.max(1, Math.round((x1 - x0) / 2.5));
  for (let i = 0; i < prof.length - 1; i++) {
    const [za, ya] = prof[i], [zb, yb] = prof[i + 1];
    for (let k = 0; k < n; k++) {
      const a = x0 + (x1 - x0) * k / n, b = x0 + (x1 - x0) * (k + 1) / n;
      faceQuad(mb, V(a, ya, za), V(a, yb, zb), V(b, yb, zb), V(b, ya, za), UP, k % 2 ? ARENA.hazardA : ARENA.hazardB, SURF.ROAD);
    }
  }
}

// launch ramp from z0 to z1 rising to H
function wedge(mb, x0, x1, z0, z1, H) {
  const n = 5;
  for (let k = 0; k < n; k++) {
    const za = z0 + (z1 - z0) * k / n, zb = z0 + (z1 - z0) * (k + 1) / n;
    const ya = H * k / n, yb = H * (k + 1) / n;
    faceQuad(mb, V(x0, ya, za), V(x0, yb, zb), V(x1, yb, zb), V(x1, ya, za), UP, k % 2 ? COLORS.boostA : COLORS.boostB, SURF.ROAD);
  }
  faceQuad(mb, V(x0, 0, z1), V(x1, 0, z1), V(x1, H, z1), V(x0, H, z1), V(0, 0, 1), COLORS.side, SURF.WALL);
  faceTri(mb, V(x1, 0, z1), V(x1, 0, z0), V(x1, H, z1), V(-1, 0, 0), COLORS.side, SURF.WALL);
  faceTri(mb, V(x0, 0, z0), V(x0, 0, z1), V(x0, H, z1), V(1, 0, 0), COLORS.side, SURF.WALL);
}

// ">" chevrons painted on the floor pointing +z
function floorChevron(mb, x, z, w, color = ARENA.yellow) {
  const t = 1.2, h = w * 0.5;
  paint(mb, [[x + w / 2, z], [x + w / 2 - t, z], [x - t / 2, z + h], [x + t / 2, z + h]], color);
  paint(mb, [[x - w / 2, z], [x - w / 2 + t, z], [x + t / 2, z + h], [x - t / 2, z + h]], color);
}

// Catmull-Rom through control points, resampled every `step` metres
function splinePath(ctrl, step = 2) {
  const P = ctrl.map(([x, y, z]) => V(x, y, z));
  const dense = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 20; k++) {
      const t = k / 20, t2 = t * t, t3 = t2 * t;
      dense.push(V(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      ));
    }
  }
  dense.push(P[P.length - 1]);
  const out = [dense[0]];
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    acc += dense[i].distanceTo(dense[i - 1]);
    if (acc >= step || i === dense.length - 1) { out.push(dense[i]); acc = 0; }
  }
  return out.map((p) => [p.x, p.y, p.z]);
}

// --- arena shell: floor, sand, sides, fence --------------------------------------

// tiles: x from -w to +w tiles, z from 0 to len-1; openings: [{edge, at, width}]
function arenaShell(mb, { w = 1, len, sand = () => false, openings, mask, conns, openBack = false }) {
  const X0 = -w * T - T / 2, X1 = w * T + T / 2, Z0 = -T / 2, Z1 = (len - 1) * T + T / 2;
  const s = T / 4, D = DECK_T;
  for (let x = X0; x < X1 - 0.01; x += s) {
    for (let z = Z0; z < Z1 - 0.01; z += s) {
      const cx = x + s / 2, cz = z + s / 2;
      const i = Math.round((x - X0) / s), j = Math.round((z - Z0) / s);
      if (sand(cx, cz)) {
        const h = (Math.imul(i + 31, 73856093) ^ Math.imul(j + 17, 19349663)) >>> 0;
        faceQuad(mb, V(x, 0, z), V(x, 0, z + s), V(x + s, 0, z + s), V(x + s, 0, z), UP, ARENA.sand[h % 4], SURF.GRASS);
        continue;
      }
      faceQuad(mb, V(x, 0, z), V(x, 0, z + s), V(x + s, 0, z + s), V(x + s, 0, z), UP, (i * 7 + j * 3) % 5 ? ARENA.floorA : ARENA.floorB, SURF.ROAD);
      paint(mb, [[x + 0.05, z], [x + 0.05, z + s], [x + 0.2, z + s], [x + 0.2, z]], ARENA.seam, 0.015);
      paint(mb, [[x, z + 0.05], [x + s, z + 0.05], [x + s, z + 0.2], [x, z + 0.2]], ARENA.seam, 0.015);
    }
  }
  faceQuad(mb, V(X0, -D, Z0), V(X1, -D, Z0), V(X1, -D, Z1), V(X0, -D, Z1), V(0, -1, 0), COLORS.bottom, SURF.WALL);
  const edges = {
    back: [V(X0, 0, Z0), V(X1, 0, Z0), V(0, 0, -1)],
    front: [V(X0, 0, Z1), V(X1, 0, Z1), V(0, 0, 1)],
    left: [V(X1, 0, Z0), V(X1, 0, Z1), V(1, 0, 0)],
    right: [V(X0, 0, Z0), V(X0, 0, Z1), V(-1, 0, 0)],
  };
  for (const [name, [a, b, out]] of Object.entries(edges)) {
    faceQuad(mb, V(a.x, -D, a.z), V(b.x, -D, b.z), V(b.x, 0, b.z), V(a.x, 0, a.z), out, COLORS.side, SURF.WALL);
    if (name === 'back' && openBack) {
      // open approach for jumps: a hazard band instead of a fence
      const n = 24;
      for (let k = 0; k < n; k++) {
        const xa = X0 + (X1 - X0) * k / n, xb = X0 + (X1 - X0) * (k + 1) / n;
        paint(mb, [[xa, Z0 + 0.3], [xa, Z0 + 1.5], [xb, Z0 + 1.5], [xb, Z0 + 0.3]], k % 2 ? ARENA.hazardA : ARENA.hazardB);
      }
      continue;
    }
    // fence with gaps where a connected road comes in
    const len2 = a.distanceTo(b), dir = V().subVectors(b, a).normalize();
    // the gap is a little wider than the road so no fence end can stick into it
    const gaps = openings.filter((o, k) => o.edge === name && !(mask & (1 << conns[k])))
      .map((o) => [o.at - o.width / 2 - 0.6, o.at + o.width / 2 + 0.6]).sort((p, q) => p[0] - q[0]);
    const runs = [];
    let from = 0;
    for (const [g0, g1] of gaps) { if (g0 > from) runs.push([from, g0]); from = Math.max(from, g1); }
    if (from < len2) runs.push([from, len2]);
    const inward = V().copy(out).multiplyScalar(-1);
    let k = 0;
    for (const [r0, r1] of runs) {
      const n = Math.max(1, Math.round((r1 - r0) / 2.5));
      for (let i = 0; i < n; i++, k++) {
        const d = r0 + (r1 - r0) * i / n, d1 = r0 + (r1 - r0) * (i + 1) / n;
        const p0 = V().copy(a).addScaledVector(dir, d), p1 = V().copy(a).addScaledVector(dir, d1);
        const q0 = V().copy(p0).addScaledVector(inward, 0.6), q1 = V().copy(p1).addScaledVector(inward, 0.6);
        const xs = [p0.x, p1.x, q0.x, q1.x], zs = [p0.z, p1.z, q0.z, q1.z];
        mb.box(Math.min(...xs), 0, Math.min(...zs), Math.max(...xs), 1.0, Math.max(...zs), k % 2 ? ARENA.fenceB : ARENA.fenceA, SURF.WALL);
      }
    }
  }
  return { X0, X1, Z0, Z1 };
}

function arenaDef(name, { w = 1, len, conns, openings, line, build, sand, openBack = false }) {
  const cells = [];
  for (let a = -w; a <= w; a++) for (let b = 0; b < len; b++) cells.push([a, b, 0]);
  const supports = cells.map(([a, b]) => ({ x: a * T, z: b * T, y: 0 }));
  return {
    name,
    fenced: true,
    conns,
    cells,
    supports,
    routePath: splinePath(line),
    build: (mb, mask) => {
      arenaShell(mb, { w, len, sand, openings, mask, conns: openings.map((_, k) => k), openBack });
      build(mb);
    },
  };
}

const BACK = { x: 0, z: 0, y: 0, d: 2 };

// --- the arenas ---------------------------------------------------------------

export const ARENA_DEFS = [
  {
    // Cones funnel you onto the ramp, the ramp throws you over a row of wrecks.
    // Scared? The chicken lane on the right goes round, over four speed bumps.
    id: 'arenaJump',
    ...arenaDef('Jump arena', {
      len: 3,
      conns: [BACK, { x: 0, z: 2, y: 0, d: 0 }],
      openings: [{ edge: 'back', at: 30, width: 16 }, { edge: 'front', at: 30, width: 16 }],
      line: [[0, 0, -10], [0, 0, 6], [0, 0, 9], [0, 2, 19], [0, 0, 40], [0, 0, 50]],
      build: (mb) => {
        for (const z of [-6, -1]) floorChevron(mb, 0, z, 7);
        coneLine(mb, 9.5, -3, 5.6, 8.5);
        coneLine(mb, -9.5, -3, -5.6, 8.5);
        wedge(mb, -4.5, 4.5, 9, 19, 2.0);
        let k = 0;
        for (let x = 28.6; x > -20; x -= 2.45, k++) wreck(mb, x, 24.8, WRECKS[(k * 5) % WRECKS.length], k);
        // chicken lane: bumps, and cones that mark it off from the jump
        for (const z of [15, 22, 29, 36]) bumpStrip(mb, -29.4, -19.3, z);
        coneLine(mb, -18.8, 4, -18.8, 12, 4);
      },
    }),
  },
  {
    // Two walls block two thirds of the arena each, gaps on opposite sides.
    // 3-2-1 boards tell you where to brake; cutting close to the wall tips is
    // the fast (and risky) line.
    id: 'arenaChicane',
    ...arenaDef('Chicane arena', {
      len: 5,
      conns: [BACK, { x: 0, z: 4, y: 0, d: 0 }],
      openings: [{ edge: 'back', at: 30, width: 16 }, { edge: 'front', at: 30, width: 16 }],
      line: [[0, 0, -10], [0, 0, 6], [5, 0, 20], [9, 0, 30], [6, 0, 40], [-6, 0, 56], [-9, 0, 66], [-5, 0, 76], [0, 0, 86], [0, 0, 90]],
      build: (mb) => {
        barrierWall(mb, -29.4, 4, 30);
        barrierWall(mb, -4, 29.4, 66);
        for (const x of [-22, -13, -4]) chevronBoard(mb, x, 1.8, 30, 3.6, 1.2, 1);
        for (const x of [4, 13, 22]) chevronBoard(mb, x, 1.8, 66, 3.6, 1.2, -1);
        for (const [z, n] of [[-2, 3], [8, 2], [18, 1]]) { brakeBoard(mb, 27, z, n); brakeBoard(mb, -27, z, n); }
      },
    }),
  },
  {
    // A wide corner round a tyre-wall infield. The tyre wall is the apex; run
    // wide and you are in the sand trap on the outside.
    id: 'arenaTurn',
    ...arenaDef('Turn arena', {
      len: 3,
      conns: [BACK, { x: 1, z: 1, y: 0, d: 1 }],
      openings: [{ edge: 'back', at: 30, width: 16 }, { edge: 'left', at: 30, width: 16 }],
      line: (() => {
        const pts = [];
        for (let i = 0; i <= 12; i++) {
          const a = (i / 12) * Math.PI / 2;
          pts.push([30 - 30 * Math.cos(a), 0, -10 + 30 * Math.sin(a)]);
        }
        return pts;
      })(),
      sand: (x, z) => Math.hypot(x - 30, z + 10) > 46 || Math.hypot(x - 30, z + 10) < 15,
      build: (mb) => {
        // tyre wall around the infield, chevrons at the apex
        const R = 16.5, n = 18;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI / 2;
          tyreStack(mb, 30 - R * Math.cos(a), -10 + R * Math.sin(a), i % 2 ? ARENA.bone : ARENA.red);
        }
        const ax = 30 - (R + 0.2) * Math.cos(Math.PI / 4), az = -10 + (R + 0.2) * Math.sin(Math.PI / 4);
        mb.box(ax - 0.1, 0, az - 0.1, ax + 0.1, 1.6, az + 0.1, ARENA.ink);
        chevronBoard(mb, ax, 2.2, az - 0.3, 3.0, 1.1, 1);
        // the sand trap starts where the cones are
        const r = 45, m = 16;
        for (let i = 1; i < m; i++) {
          const a = (i / m) * Math.PI / 2;
          cone(mb, 30 - r * Math.cos(a), -10 + r * Math.sin(a));
        }
      },
    }),
  },
  {
    // Where a big jump comes down: an open approach, a painted landing zone,
    // then cones funnel you into the exit road.
    id: 'arenaLanding',
    ...arenaDef('Landing arena', {
      len: 4,
      conns: [BACK, { x: 0, z: 3, y: 0, d: 0 }],
      openings: [{ edge: 'back', at: 30, width: 16 }, { edge: 'front', at: 30, width: 16 }],
      openBack: true,
      line: [[0, 0, -10], [0, 0, 70]],
      build: (mb) => {
        // landing zone: hazard border with chevrons inside
        const x0 = -15, x1 = 15, z0 = 2, z1 = 44, b = 1.2;
        const n = 14;
        for (let k = 0; k < n; k++) {
          const za = z0 + (z1 - z0) * k / n, zb = z0 + (z1 - z0) * (k + 1) / n, c = k % 2 ? ARENA.hazardA : ARENA.hazardB;
          paint(mb, [[x0, za], [x0, zb], [x0 + b, zb], [x0 + b, za]], c);
          paint(mb, [[x1 - b, za], [x1 - b, zb], [x1, zb], [x1, za]], c);
        }
        for (const z of [10, 22, 34]) floorChevron(mb, 0, z, 10);
        coneLine(mb, 27, 46, 9.5, 66);
        coneLine(mb, -27, 46, -9.5, 66);
      },
    }),
  },
];
