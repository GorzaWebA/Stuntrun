// Track piece catalogue. Every piece is described in local tile space: the car
// enters through connector 0 on the back edge of tile (0,0) heading +Z.
// Local +X is to the driver's LEFT. Pieces are built from "ribbons": centre
// line curves that get swept with the road cross-section.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, LEVEL, ROAD_HALF, CURB_W, LINE_W, DECK_T, COLORS } from './config.js';
import { SURF } from './collision.js';
import { MeshBuilder } from './geometry.js';
import { ARENA_DEFS, cone, brakeBoard } from './arenas.js';

const T = TILE;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => Math.max(0, Math.min(1, u));
// jerk-free easing (smootherstep) so rolls and banks start and end gently
const ease = (u) => { const x = clamp01(u); return x * x * x * (x * (6 * x - 15) + 10); };
const plateau = (t, e) => ease(t / e) * ease((1 - t) / e);

// Directions: 0:+Z 1:+X 2:-Z 3:-X
export const DIR_X = [0, 1, 0, -1];
export const DIR_Z = [1, 0, -1, 0];

const STRAIGHT_CONNS = [{ x: 0, z: 0, y: 0, d: 2 }, { x: 0, z: 0, y: 0, d: 0 }];

function lineRibbon(x0, y0, z0, x1, y1, z1, opts = {}) {
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  return {
    segs: Math.max(2, Math.round(len / 2.5)),
    pos: (t, o) => o.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t),
    ...opts,
  };
}

const straightRibbon = (opts) => lineRibbon(0, 0, -T / 2, 0, 0, T / 2, { segs: 8, ...opts });

function turnDef(N) {
  const R = (N - 0.5) * T;
  return {
    conns: [{ x: 0, z: 0, y: 0, d: 2 }, { x: N - 1, z: N - 1, y: 0, d: 1 }],
    ribbons: () => [{
      segs: [0, 8, 18, 28][N],
      pos: (t, o) => {
        const a = t * Math.PI / 2;
        return o.set(R - R * Math.cos(a), 0, -T / 2 + R * Math.sin(a));
      },
    }],
  };
}

const HEART = 0.95; // height of the car's centre above the road

function bankDef(N, bankDeg, wall = false) {
  const R = (N - 0.5) * T;
  const bmax = bankDeg * Math.PI / 180;
  // Banked turns pivot on the inner edge and bank with a sine. Wall turns bank up
  // over the first 40% and hold, pivoting around the driver (the car's path
  // stays level), so they need to be built at least two levels up.
  const bank = wall ? (t) => bmax * plateau(t, 0.4) : (t) => bmax * Math.sin(Math.PI * t);
  return {
    conns: [{ x: 0, z: 0, y: 0, d: 2 }, { x: N - 1, z: N - 1, y: 0, d: 1 }],
    ribbons: () => [{
      segs: [0, 12, 26, 38][N],
      lanes: 6,
      curb: 1.0,
      pos: (t, o) => {
        const a = t * Math.PI / 2, b = bank(t);
        if (wall) {
          const k = HEART * Math.sin(b);
          return o.set(R - R * Math.cos(a) - Math.cos(a) * k, HEART * (1 - Math.cos(b)), -T / 2 + R * Math.sin(a) + Math.sin(a) * k);
        }
        return o.set(R - R * Math.cos(a), (ROAD_HALF + 0.2) * Math.sin(b), -T / 2 + R * Math.sin(a));
      },
      up: (t, o) => {
        const a = t * Math.PI / 2, b = bank(t);
        return o.set(Math.cos(a) * Math.sin(b), Math.cos(b), -Math.sin(a) * Math.sin(b));
      },
    }],
  };
}

// Two circular-ish arcs: constant curvature magnitude keeps crests gentle.
const easeArc = (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));

function rampDef(len, rise) {
  return {
    conns: [{ x: 0, z: 0, y: 0, d: 2 }, { x: 0, z: len - 1, y: rise, d: 0 }],
    ribbons: () => [{
      segs: 8 * len,
      pos: (t, o) => o.set(0, rise * LEVEL * easeArc(t), -T / 2 + len * T * t),
    }],
  };
}

function loopDef(side) {
  const R = 15, zc = T / 2;
  return {
    conns: [{ x: 0, z: 0, y: 0, d: 2 }, { x: side, z: 1, y: 0, d: 0 }],
    ribbons: () => [
      lineRibbon(0, 0, -T / 2, 0, 0, zc, { segs: 8 }),
      {
        segs: 60,
        lanes: 4,
        curb: 1.3,
        supports: false,
        pos: (t, o) => {
          const a = 2 * Math.PI * t;
          return o.set(side * T * smooth(t), R * (1 - Math.cos(a)), zc + R * Math.sin(a));
        },
        up: (t, o) => {
          const a = 2 * Math.PI * t;
          return o.set(0, Math.cos(a), -Math.sin(a));
        },
      },
      lineRibbon(side * T, 0, zc, side * T, 0, 1.5 * T, { segs: 8 }),
    ],
  };
}


// Heartline roll: the road twists around an axis at the driver's height, so
// the car keeps going straight while the world turns around it. Used for wall
// rides (90°), corkscrews (360°) and upside-down sections (180°).
function rollDef(len, angle) {
  return {
    conns: [{ x: 0, z: 0, y: 0, d: 2 }, { x: 0, z: len - 1, y: 0, d: 0 }],
    minLevel: 2,
    ribbons: () => [{
      segs: len * 12,
      lanes: 8,
      curb: 1.1,
      supportsAt: [0.04, 0.96],
      pos: (t, o) => {
        const a = angle(t);
        return o.set(HEART * Math.sin(a), HEART - HEART * Math.cos(a), -T / 2 + len * T * t);
      },
      up: (t, o) => {
        const a = angle(t);
        return o.set(-Math.sin(a), Math.cos(a), 0);
      },
    }],
  };
}

function kickerDef(len, height, name) {
  return {
    name,
    conns: [{ x: 0, z: 0, y: 0, d: 2 }, { x: 0, z: len - 1, y: 0, d: 0, open: true }],
    ribbons: () => [{ segs: 10 * len, curb: 0.9, pos: (t, o) => o.set(0, height * t * t, -T / 2 + len * T * t) }],
  };
}

// ---------------------------------------------------------------------------
// Open areas: 20x20 floor tiles without barriers. They connect on all four
// sides, so several of them form a wide open space. Some carry obstacles.
const PLAZA_CONNS = [
  { x: 0, z: 0, y: 0, d: 2 }, { x: 0, z: 0, y: 0, d: 0 },
  { x: 0, z: 0, y: 0, d: 1 }, { x: 0, z: 0, y: 0, d: 3 },
];
const OPEN = { floorA: 0x8c7f72, floorB: 0x857868, edgeA: 0xe23b2e, edgeB: 0xf6ead2, concrete: 0xeadcc0, hazardA: 0xffc42e, hazardB: 0x2a1f33 };

function buildPlazaFloor(mb, mask, rail = false) {
  const h = T / 2, D = DECK_T, n = 4, step = T / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x0 = -h + i * step, x1 = x0 + step, z0 = -h + j * step, z1 = z0 + step;
      mb.quad(V(x0, 0, z0), V(x0, 0, z1), V(x1, 0, z1), V(x1, 0, z0), ((i * 7 + j * 3) % 5) ? OPEN.floorA : OPEN.floorB, SURF.ROAD);
      // painted seam lines between slabs (visual only)
      mb.quad(V(x0 + 0.05, 0.015, z0), V(x0 + 0.05, 0.015, z1), V(x0 + 0.2, 0.015, z1), V(x0 + 0.2, 0.015, z0), 0x6f6357);
      mb.quad(V(x0, 0.015, z0 + 0.2), V(x0, 0.015, z0 + 0.05), V(x1, 0.015, z0 + 0.05), V(x1, 0.015, z0 + 0.2), 0x6f6357);
    }
  }
  mb.quad(V(-h, -D, -h), V(h, -D, -h), V(h, -D, h), V(-h, -D, h), COLORS.bottom, SURF.WALL);
  // open edges get a side face and a dashed hazard line
  const sides = [
    [V(h, -D, -h), V(-h, -D, -h), V(-h, 0, -h), V(h, 0, -h)],   // back  (-z)
    [V(-h, -D, h), V(h, -D, h), V(h, 0, h), V(-h, 0, h)],       // front (+z)
    [V(h, -D, h), V(h, -D, -h), V(h, 0, -h), V(h, 0, h)],       // left  (+x)
    [V(-h, -D, -h), V(-h, -D, h), V(-h, 0, h), V(-h, 0, -h)],   // right (-x)
  ];
  sides.forEach((q, k) => {
    if (!(mask & (1 << k))) return;
    mb.quad(q[0], q[1], q[2], q[3], COLORS.side, SURF.WALL);
    if (rail) {
      // raised platforms get a low safety rail along open edges
      const a = q[3], b = q[2];
      const inward = V(-a.x - b.x, 0, -a.z - b.z).normalize();
      const segs = 5;
      for (let i = 0; i < segs; i++) {
        const p0 = V().lerpVectors(a, b, i / segs), p1 = V().lerpVectors(a, b, (i + 1) / segs);
        const xs = [p0.x, p1.x, p0.x + inward.x * 0.6, p1.x + inward.x * 0.6];
        const zs = [p0.z, p1.z, p0.z + inward.z * 0.6, p1.z + inward.z * 0.6];
        mb.box(Math.min(...xs), 0, Math.min(...zs), Math.max(...xs), 0.8, Math.max(...zs), i % 2 ? COLORS.curbA : COLORS.curbB, SURF.WALL);
      }
      return;
    }
    // dashes along the edge, inset 0.3..0.9 m
    const a = q[3], b = q[2];                      // top edge, from a to b
    const inward = V(-a.x - b.x, 0, -a.z - b.z).normalize();
    const dashes = 8;
    for (let d = 0; d < dashes; d++) {
      const p0 = V().lerpVectors(a, b, d / dashes), p1 = V().lerpVectors(a, b, (d + 1) / dashes);
      const o0 = V().copy(p0).addScaledVector(inward, 0.3), o1 = V().copy(p1).addScaledVector(inward, 0.3);
      const i0 = V().copy(p0).addScaledVector(inward, 0.9), i1 = V().copy(p1).addScaledVector(inward, 0.9);
      for (const v of [o0, o1, i0, i1]) v.y = 0.02;
      const col = d % 2 ? OPEN.edgeA : OPEN.edgeB;
      // winding so the quad faces up
      const nrm = V().subVectors(o1, o0).cross(V().subVectors(i1, o1));
      if (nrm.y > 0) mb.quad(o0, o1, i1, i0, col); else mb.quad(o0, i0, i1, o1, col);
    }
  });
}

function hazardBlock(mb, x0, y0, z0, x1, y1, z1, color, bands = 0) {
  mb.box(x0, y0, z0, x1, y1, z1, color, SURF.WALL);
  // thin striped band near the bottom (visual)
  if (bands) {
    const e = 0.04, hb = Math.min(1.2, (y1 - y0) * 0.3);
    const cols = [OPEN.hazardA, OPEN.hazardB];
    for (let i = 0; i < bands; i++) {
      const ya = y0 + 0.2 + i * hb / bands, yb = ya + hb / bands;
      mb.box(x0 - e, ya, z0 - e, x1 + e, yb, z1 + e, cols[i % 2]);
    }
  }
}

function bump(mb, zc) {
  // speed bump across the whole tile (drivable)
  const h = T / 2, l = 1.4, ht = 0.32;
  const prof = [[zc - l, 0], [zc - l * 0.35, ht], [zc + l * 0.35, ht], [zc + l, 0]];
  for (let i = 0; i < prof.length - 1; i++) {
    const [za, ya] = prof[i], [zb, yb] = prof[i + 1];
    const n = 8;
    for (let k = 0; k < n; k++) {
      const x0 = -h + (T * k) / n, x1 = x0 + T / n;
      mb.quad(V(x0, ya, za), V(x0, yb, zb), V(x1, yb, zb), V(x1, ya, za), k % 2 ? OPEN.hazardA : OPEN.hazardB, SURF.ROAD);
    }
  }
}

function plazaDef(name, obstacle = null, extra = {}) {
  return {
    name,
    conns: PLAZA_CONNS,
    build: (mb, mask, rail) => { buildPlazaFloor(mb, mask, rail); if (obstacle) obstacle(mb); },
    cells: extra.cells || [[0, 0, 0]],
    routePath: extra.routePath || null,
    supports: [{ x: 0, z: 0, y: 0 }],
  };
}

const OPEN_DEFS = [
  { id: 'plaza', ...plazaDef('Open floor') },
  { id: 'plazaPillar', ...plazaDef('Pillar', (mb) => { hazardBlock(mb, -2, 0, -2, 2, 7, 2, OPEN.concrete, 0); for (const y of [1.2, 4.2]) mb.box(-2.05, y, -2.05, 2.05, y + 0.9, 2.05, 0xe23b2e); }, { cells: [[0, 0, 0], [0, 0, 1]] }) },
  {
    id: 'plazaWall',
    ...plazaDef('Barrier', (mb) => {
      for (let i = 0; i < 4; i++) {
        const x0 = -9.6 + i * 1.8;
        mb.box(x0, 0, -0.7, x0 + 1.8, 1.2, 0.7, i % 2 ? COLORS.curbB : COLORS.curbA, SURF.WALL);
      }
    }),
  },
  {
    id: 'plazaCones',
    // two cone lines marking a 14 m lane through the tile
    ...plazaDef('Cone lane', (mb) => {
      for (const x of [-7, 7]) for (let z = -8; z <= 8.1; z += 4) cone(mb, x, z);
    }),
  },
  { id: 'plazaBumps', ...plazaDef('Speed bumps', (mb) => { bump(mb, -5); bump(mb, 5); }) },
  {
    id: 'plazaJump',
    ...plazaDef('Jump wedge', (mb) => {
      const x0 = -4, x1 = 4, z0 = -7, z1 = 1, H = 1.5, n = 4;
      for (let k = 0; k < n; k++) {
        const za = z0 + (z1 - z0) * k / n, zb = z0 + (z1 - z0) * (k + 1) / n;
        const ya = H * k / n, yb = H * (k + 1) / n;
        mb.quad(V(x0, ya, za), V(x0, yb, zb), V(x1, yb, zb), V(x1, ya, za), k % 2 ? COLORS.boostA : COLORS.boostB, SURF.ROAD);
      }
      mb.quad(V(x0, 0, z1), V(x1, 0, z1), V(x1, H, z1), V(x0, H, z1), COLORS.side, SURF.WALL);
      mb.tri(V(x1, 0, z1), V(x1, 0, z0), V(x1, H, z1), COLORS.side, SURF.WALL);
      mb.tri(V(x0, 0, z0), V(x0, 0, z1), V(x0, H, z1), COLORS.side, SURF.WALL);
    }, { routePath: [[0, 0, -10], [0, 0, -7], [0, 0.75, -3], [0, 1.5, 1], [0, 0, 10]] }),
  },
];

// Order matters: indices are used in the share-code format.
const DEFS = [
  { id: 'start', name: 'Start', conns: STRAIGHT_CONNS, ribbons: () => [straightRibbon()], gate: { kind: 'start', z: 4 }, spawn: { z: -5 } },
  { id: 'finish', name: 'Finish', conns: STRAIGHT_CONNS, ribbons: () => [straightRibbon()], gate: { kind: 'finish', z: 0 } },
  { id: 'checkpoint', name: 'Checkpoint', conns: STRAIGHT_CONNS, ribbons: () => [straightRibbon()], gate: { kind: 'checkpoint', z: 0 } },
  { id: 'straight', name: 'Straight', conns: STRAIGHT_CONNS, ribbons: () => [straightRibbon()] },
  { id: 'boost', name: 'Booster', conns: STRAIGHT_CONNS, ribbons: () => [straightRibbon({ boost: true })] },
  { id: 'turn1', name: 'Tight turn', ...turnDef(1) },
  { id: 'turn2', name: 'Turn', ...turnDef(2) },
  { id: 'turn3', name: 'Wide turn', ...turnDef(3) },
  { id: 'bank2', name: 'Banked turn', ...bankDef(2, 28) },
  { id: 'bank3', name: 'Wide banked', ...bankDef(3, 32) },
  { id: 'ramp', name: 'Ramp', ...rampDef(2, 1) },
  { id: 'ramp2', name: 'Long ramp', ...rampDef(3, 2) },
  { id: 'kicker', ...kickerDef(1, 3.2, 'Jump') },
  { id: 'loopL', name: 'Loop left', ...loopDef(1) },
  { id: 'loopR', name: 'Loop right', ...loopDef(-1) },
  // stunt pieces (appended to keep old share codes valid)
  { id: 'bigkick', ...kickerDef(2, 8, 'Big jump') },
  { id: 'wall2', name: 'Wall turn', ...bankDef(2, 75, true) },
  { id: 'wall3', name: 'Wide wall turn', ...bankDef(3, 82, true) },
  { id: 'wallL', name: 'Wall ride L', ...rollDef(6, (t) => (Math.PI / 2) * plateau(t, 0.33)) },
  { id: 'wallR', name: 'Wall ride R', ...rollDef(6, (t) => (-Math.PI / 2) * plateau(t, 0.33)) },
  { id: 'corkscrew', name: 'Corkscrew', ...rollDef(7, (t) => 2 * Math.PI * ease(t)) },
  { id: 'inverted', name: 'Upside down', ...rollDef(8, (t) => Math.PI * plateau(t, 0.32)) },
  ...OPEN_DEFS,
  // fenced stunt arenas (several tiles each)
  ...ARENA_DEFS,
  // straights with 3-2-1 brake boards either side, placed before turns that need braking
  ...[3, 2, 1].map((n) => ({
    id: `brake${n}`,
    name: `Brake board ${n}`,
    conns: STRAIGHT_CONNS,
    ribbons: () => [straightRibbon()],
    extra: (mb) => {
      for (const x of [9.6, -9.6]) {
        mb.box(Math.min(x, Math.sign(x) * 8), -0.45, -0.25, Math.max(x, Math.sign(x) * 8), -0.15, 0.25, COLORS.gateFrame);
        brakeBoard(mb, x, 0, n, { y0: -0.6, scale: 1.4, solid: false });
      }
    },
  })),
];

export const PIECE_ORDER = DEFS.map((d) => d.id);
export const PIECES = Object.fromEntries(DEFS.map((d) => [d.id, d]));

// ---------------------------------------------------------------------------
// Geometry generation (cached per piece type, in local space)

function sampleRibbon(rib, segs = rib.segs) {
  const frames = [];
  let s = 0;
  let prev = null;
  const a = V(), b = V();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = rib.pos(t, V());
    const e = 1e-4;
    rib.pos(Math.max(0, t - e), a);
    rib.pos(Math.min(1, t + e), b);
    const tan = b.sub(a).normalize();
    const uh = rib.up ? rib.up(t, V()) : V(0, 1, 0);
    const lat = V().crossVectors(uh, tan).normalize();
    const up = V().crossVectors(tan, lat).normalize();
    if (prev) s += p.distanceTo(prev.p);
    const f = { p, t: tan, l: lat, u: up, s };
    frames.push(f);
    prev = f;
  }
  return frames;
}

// Cross-section edges. Curb heights are the symbol 'C' so they can taper.
function profileEdges(rib) {
  const H = ROAD_HALF, inner = H - CURB_W, roadIn = inner - LINE_W, D = DECK_T;
  const ch = 'C';
  const e = [];
  e.push([H, -D, H, ch, 'side']);
  e.push([H, ch, inner, ch, 'curbTop']);
  e.push([inner, ch, inner, 0, 'curbIn']);
  e.push([inner, 0, roadIn, 0, 'line']);
  // the road top is split into lanes so twisting surfaces stay smooth
  const strip = (s0, s1, kind, n) => {
    for (let i = 0; i < n; i++) e.push([s0 + (s1 - s0) * i / n, 0, s0 + (s1 - s0) * (i + 1) / n, 0, kind]);
  };
  const lanes = rib.lanes ?? 2;
  if (rib.boost) {
    strip(roadIn, 4, 'asphalt', 1);
    strip(4, -4, 'boost', 2);
    strip(-4, -roadIn, 'asphalt', 1);
  } else {
    strip(roadIn, -roadIn, 'asphalt', lanes);
  }
  e.push([-roadIn, 0, -inner, 0, 'line']);
  e.push([-inner, 0, -inner, ch, 'curbIn']);
  e.push([-inner, ch, -H, ch, 'curbTop']);
  e.push([-H, ch, -H, -D, 'side']);
  e.push([-H, -D, H, -D, 'bottom']);
  return e;
}

function edgeStyle(kind, stripe) {
  switch (kind) {
    case 'side': return [COLORS.side, SURF.WALL];
    case 'curbTop': return [stripe ? COLORS.curbA : COLORS.curbB, SURF.WALL];
    case 'curbIn': return [COLORS.curbWall, SURF.WALL];
    case 'line': return [COLORS.line, SURF.ROAD];
    case 'asphalt': return [COLORS.asphalt, SURF.ROAD];
    case 'boost': return [stripe ? COLORS.boostA : COLORS.boostB, SURF.BOOST];
    default: return [COLORS.bottom, SURF.WALL];
  }
}

const P = (f, s, h) => V().copy(f.p).addScaledVector(f.l, s).addScaledVector(f.u, h);

const TAPER = 4; // metres over which barriers ramp down where a road opens onto open floor

function buildRibbon(mb, rib, frames, capStart, capEnd, taperStart = false, taperEnd = false) {
  const edges = profileEdges(rib);
  const curb = rib.curb ?? 0.9;
  const len = frames[frames.length - 1].s;
  const chAt = (f) => {
    let k = 1;
    if (taperStart) k = Math.min(k, f.s / TAPER);
    if (taperEnd) k = Math.min(k, (len - f.s) / TAPER);
    return curb * Math.max(0, Math.min(1, k));
  };
  const hv = (h, f) => (h === 'C' ? chAt(f) : h);
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i], f1 = frames[i + 1];
    const stripe = i % 2 === 0;
    for (const [s0, h0, s1, h1, kind] of edges) {
      const [color, surf] = edgeStyle(kind, stripe);
      const a = P(f0, s0, hv(h0, f0)), b = P(f0, s1, hv(h1, f0)), c = P(f1, s1, hv(h1, f1)), d = P(f1, s0, hv(h0, f1));
      if (a.distanceToSquared(b) < 1e-6 && c.distanceToSquared(d) < 1e-6) continue; // fully tapered away
      mb.quad(a, b, c, d, color, surf);
    }
  }
  if (taperStart) capStart = capStart ? true : null;
  if (taperEnd) capEnd = capEnd ? true : null;
  const H = ROAD_HALF, inner = H - CURB_W, D = DECK_T, ch = curb;
  const blocks = [
    [[H, -D], [H, ch], [inner, ch], [inner, -D]],
    [[inner, -D], [inner, 0], [-inner, 0], [-inner, -D]],
    [[-inner, -D], [-inner, ch], [-H, ch], [-H, -D]],
  ];
  // curb ends are always closed; the deck itself only where nothing connects
  const cap = (f, reverse, slab, curbs = true) => {
    blocks.forEach((b, i) => {
      if (i === 1 && !slab) return;
      if (i !== 1 && !curbs) return;
      const pts = b.map(([s, h]) => P(f, s, h));
      if (reverse) pts.reverse();
      mb.quad(pts[0], pts[1], pts[2], pts[3], COLORS.side, SURF.WALL);
    });
  };
  if (capStart !== null) cap(frames[0], true, capStart, !taperStart);
  if (capEnd !== null) cap(frames[frames.length - 1], false, capEnd, !taperEnd);
}

function buildBoostArrows(mb, frames) {
  const total = frames[frames.length - 1].s;
  for (const at of [0.2, 0.5, 0.8]) {
    // find frame at arc length
    const target = total * at;
    let f = frames[0];
    for (const fr of frames) { if (fr.s <= target) f = fr; }
    const pt = (s, a) => V().copy(f.p).addScaledVector(f.l, s).addScaledVector(f.t, a).addScaledVector(f.u, 0.05);
    mb.quad(pt(3, -1.4), pt(0, 0), pt(0, 1.1), pt(3, -0.3), 0xffffff);
    mb.quad(pt(-3, -0.3), pt(0, 1.1), pt(0, 0), pt(-3, -1.4), 0xffffff);
  }
}

function buildGate(kind, gz) {
  const frame = new MeshBuilder();
  const banner = new MeshBuilder();
  const c = COLORS.gateFrame;
  // pillars
  frame.box(8.4, -0.6, gz - 0.6, 9.6, 9.6, gz + 0.6, c);
  frame.box(-9.6, -0.6, gz - 0.6, -8.4, 9.6, gz + 0.6, c);
  // pillar caps
  frame.box(8.2, 9.6, gz - 0.8, 9.8, 10.1, gz + 0.8, c);
  frame.box(-9.8, 9.6, gz - 0.8, -8.2, 10.1, gz + 0.8, c);
  // crossbar
  frame.box(-8.4, 9.45, gz - 0.5, 8.4, 9.75, gz + 0.5, c);
  frame.box(-8.4, 7.85, gz - 0.5, 8.4, 8.15, gz + 0.5, c);
  // banner faces (front and back)
  const cols = 14, rows = 2;
  const x0 = -8.4, x1 = 8.4, y0 = 8.15, y1 = 9.45;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const xa = x0 + (x1 - x0) * i / cols, xb = x0 + (x1 - x0) * (i + 1) / cols;
      const ya = y0 + (y1 - y0) * j / rows, yb = y0 + (y1 - y0) * (j + 1) / rows;
      let col = 0xffffff;
      if (kind === 'finish') col = (i + j) % 2 ? COLORS.finishA : COLORS.finishB;
      const zf = gz + 0.45, zb = gz - 0.45;
      banner.quad(V(xa, ya, zf), V(xb, ya, zf), V(xb, yb, zf), V(xa, yb, zf), col);
      banner.quad(V(xb, ya, zb), V(xa, ya, zb), V(xa, yb, zb), V(xb, yb, zb), col);
    }
  }
  // bunting hanging under the lower bar
  const flagCols = [COLORS.curbA, 0xffc42e, COLORS.checkpoint, COLORS.curbB];
  const flags = 12, fw = 16.8 / flags;
  for (let i = 0; i < flags; i++) {
    const xa = -8.4 + i * fw + 0.12, xb = xa + fw - 0.24, xm = (xa + xb) / 2;
    const col = flagCols[i % flagCols.length];
    frame.tri(V(xa, 7.85, gz + 0.06), V(xm, 7.05, gz + 0.06), V(xb, 7.85, gz + 0.06), col);
    frame.tri(V(xb, 7.85, gz - 0.06), V(xm, 7.05, gz - 0.06), V(xa, 7.85, gz - 0.06), col);
  }
  // marquee bulbs along the top bar and up the inside of the pillars
  const bulbs = new MeshBuilder();
  const b = 0.13;
  for (let x = -7.8; x <= 7.81; x += 1.3) {
    for (const z of [gz + 0.56, gz - 0.56]) bulbs.box(x - b, 9.6 - b, z - b, x + b, 9.6 + b, z + b, 0xfff1c4);
  }
  for (let y = 1.2; y < 7.6; y += 1.05) {
    for (const x of [8.33, -8.33]) bulbs.box(x - b, y - b, gz - b, x + b, y + b, gz + b, 0xfff1c4);
  }
  return { frame: frame.toData(), banner: banner.toData(), bulbs: bulbs.toData() };
}

const cache = new Map();

// Returns cached local-space data for a piece type.
export function pieceData(id) {
  let d = cache.get(id);
  if (d) return d;
  const def = PIECES[id];
  const fullMask = (1 << def.conns.length) - 1;
  const variantCache = new Map();
  if (def.build) {
    // custom geometry (open areas)
    d = {
      def,
      fullMask,
      // rail: raised tiles get safety rails on open edges
      variant(mask, taper = 0, rail = false) {
        const key = mask | (rail ? 1 << 8 : 0);
        let v = variantCache.get(key);
        if (!v) { const mb = new MeshBuilder(); def.build(mb, mask, rail); v = mb.toData(); v.cones = mb.cones || []; variantCache.set(key, v); }
        return v;
      },
      glow: null,
      supports: def.supports || [],
      cells: def.cells,
      route: null,
      gate: null,
    };
    cache.set(id, d);
    return d;
  }
  const ribbons = def.ribbons();
  const frameSets = ribbons.map((r) => sampleRibbon(r));
  // mask: ends with nothing attached (deck gets capped); taper: ends that open onto open floor
  const variant = (mask, taper = 0) => {
    const key = mask | (taper << 4);
    let v = variantCache.get(key);
    if (!v) {
      const mb = new MeshBuilder();
      ribbons.forEach((rib, i) => {
        const capS = i === 0 ? (mask & 1) !== 0 : null;
        const capE = i === ribbons.length - 1 ? (mask & 2) !== 0 : null;
        buildRibbon(mb, rib, frameSets[i], capS, capE, i === 0 && (taper & 1) !== 0, i === ribbons.length - 1 && (taper & 2) !== 0);
      });
      if (def.extra) def.extra(mb);
      v = mb.toData();
      variantCache.set(key, v);
    }
    return v;
  };
  let glow = null;
  if (ribbons.some((r) => r.boost)) {
    const mb = new MeshBuilder();
    ribbons.forEach((rib, i) => { if (rib.boost) buildBoostArrows(mb, frameSets[i]); });
    glow = mb.toData();
  }
  // Support pillars (local positions + deck height)
  const supports = [];
  ribbons.forEach((rib, i) => {
    if (rib.supports === false) return;
    const fr = frameSets[i];
    if (rib.supportsAt) {
      for (const t of rib.supportsAt) {
        const f = fr[Math.round(t * (fr.length - 1))];
        if (f.u.y > 0.8) supports.push({ x: f.p.x, z: f.p.z, y: f.p.y });
      }
      return;
    }
    const len = fr[fr.length - 1].s;
    const n = Math.max(1, Math.round(len / T));
    for (let k = 0; k < n; k++) {
      const target = len * (k + 0.5) / n;
      let best = fr[0];
      for (const f of fr) if (Math.abs(f.s - target) < Math.abs(best.s - target)) best = f;
      if (best.u.y > 0.9) supports.push({ x: best.p.x, z: best.p.z, y: best.p.y });
    }
  });
  // Occupied cells
  const cellSet = new Set();
  ribbons.forEach((rib) => {
    const fine = sampleRibbon(rib, rib.segs * 3);
    for (let fi = 1; fi < fine.length - 1; fi++) {
      const f = fine[fi];
      for (let s = -ROAD_HALF + 0.5; s <= ROAD_HALF - 0.5; s += (ROAD_HALF - 0.5) / 2) {
        const p = V().copy(f.p).addScaledVector(f.l, s);
        const cx = Math.round(p.x / T), cz = Math.round(p.z / T);
        const cy = Math.floor((p.y + 0.5) / LEVEL);
        cellSet.add(`${cx},${cz},${cy}`);
      }
    }
  });
  const cells = [...cellSet].map((k) => k.split(',').map(Number));
  // Route samples for AI / camera previews
  const route = [];
  frameSets.forEach((fr, i) => {
    fr.forEach((f, j) => {
      if (i > 0 && j === 0) return;
      route.push({ p: f.p, u: f.u });
    });
  });
  d = {
    def,
    fullMask,
    variant,
    glow,
    supports,
    cells,
    route,
    gate: def.gate ? buildGate(def.gate.kind, def.gate.z) : null,
  };
  cache.set(id, d);
  return d;
}

// Route samples through an open-area tile, from connector `entry` to `exit`.
// Connector order: 0 back (-z), 1 front (+z), 2 left (+x), 3 right (-x).
const EDGE_MID = [V(0, 0, -T / 2), V(0, 0, T / 2), V(T / 2, 0, 0), V(-T / 2, 0, 0)];
export function openRoute(def, entry, exit) {
  const pts = [];
  if (def.routePath && entry === 0 && exit === 1) {
    for (const [x, y, z] of def.routePath) pts.push(V(x, y, z));
  } else if (def.routePath && entry === 1 && exit === 0) {
    for (const [x, y, z] of [...def.routePath].reverse()) pts.push(V(x, y, z));
  } else if ((entry ^ 1) === exit) {
    const a = EDGE_MID[entry], b = EDGE_MID[exit];
    for (let i = 0; i <= 8; i++) pts.push(V().lerpVectors(a, b, i / 8));
  } else {
    // quarter circle around the shared corner
    const a = EDGE_MID[entry], b = EDGE_MID[exit];
    const corner = V(a.x + b.x, 0, a.z + b.z);
    const ra = V().subVectors(a, corner), rb = V().subVectors(b, corner);
    for (let i = 0; i <= 10; i++) {
      const t = (i / 10) * Math.PI / 2;
      pts.push(V().copy(corner).addScaledVector(ra, Math.cos(t)).addScaledVector(rb, Math.sin(t)));
    }
  }
  return pts.map((p) => ({ p, u: V(0, 1, 0) }));
}

// Rotate a local tile offset by r quarter turns (matches Matrix4.makeRotationY(r*PI/2)).
export function rotOffset(a, b, r) {
  switch (r & 3) {
    case 0: return [a, b];
    case 1: return [b, -a];
    case 2: return [-a, -b];
    default: return [-b, a];
  }
}

// World connectors for a placed piece {type, x, y, z, r}
export function worldConnectors(piece) {
  const def = PIECES[piece.type];
  return def.conns.map((c) => {
    const [ox, oz] = rotOffset(c.x, c.z, piece.r);
    return { x: piece.x + ox, z: piece.z + oz, y: piece.y + c.y, d: (c.d + piece.r) & 3, open: !!c.open };
  });
}

export function worldCells(piece) {
  const data = pieceData(piece.type);
  return data.cells.map(([a, b, l]) => {
    const [ox, oz] = rotOffset(a, b, piece.r);
    return [piece.x + ox, piece.z + oz, piece.y + l];
  });
}

export function pieceMatrix(piece, out = new THREE.Matrix4()) {
  out.makeRotationY(piece.r * Math.PI / 2);
  out.setPosition(piece.x * T, piece.y * LEVEL, piece.z * T);
  return out;
}
