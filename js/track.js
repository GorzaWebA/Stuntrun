// Turns a list of placed pieces into meshes, collision data, checkpoints and
// a driving route. Also contains the "turtle" script builder used to author
// the campaign tracks and the share-code format.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, LEVEL, GROUND_Y, DECK_T, COLORS } from './config.js';
import { CollisionWorld, SURF } from './collision.js';
import { GeometryAccumulator, MeshBuilder, dataToGeometry } from './geometry.js';
import {
  PIECES, PIECE_ORDER, pieceData, worldConnectors, worldCells, pieceMatrix, rotOffset, openRoute, DIR_X, DIR_Z,
} from './pieces.js';
import { signTexture } from './signs.js';

let _mats = null;
export function trackMaterials() {
  if (!_mats) {
    _mats = {
      lit: new THREE.MeshLambertMaterial({ vertexColors: true }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xfff1b8 }),
      bulbs: new THREE.MeshBasicMaterial({ vertexColors: true }),
    };
  }
  return _mats;
}

const gateGeoCache = new Map();
function gateGeometries(type) {
  let g = gateGeoCache.get(type);
  if (!g) {
    const d = pieceData(type);
    g = { frame: dataToGeometry(d.gate.frame), banner: dataToGeometry(d.gate.banner), bulbs: dataToGeometry(d.gate.bulbs) };
    gateGeoCache.set(type, g);
  }
  return g;
}

let _signPlane = null;
const signPlane = () => (_signPlane ||= new THREE.PlaneGeometry(16.8, 1.3));

export const connKey = (x, z, y, d) => `${x},${z},${y},${d}`;

function buildConnectorMap(pieces) {
  const map = new Map();
  const all = pieces.map((p) => worldConnectors(p));
  all.forEach((cs, i) => cs.forEach((c, ci) => {
    if (!c.open) map.set(connKey(c.x, c.z, c.y, c.d), { piece: i, conn: ci });
  }));
  return { map, all };
}

function addPillar(mb, x, z, top) {
  const bottom = GROUND_Y - 0.1;
  if (top - bottom < 1.2) return;
  const w = 1.2;
  mb.box(x - w, bottom, z - w, x + w, top, z + w, COLORS.pillar, SURF.WALL);
  mb.box(x - 1.7, bottom, z - 1.7, x + 1.7, GROUND_Y + 0.5, z + 1.7, COLORS.pillarBase, SURF.WALL);
  mb.box(x - 1.6, top - 0.35, z - 1.6, x + 1.6, top, z + 1.6, COLORS.pillarBase, -1);
}

export function buildTrack(def, { collision = true, gates = true } = {}) {
  const world = collision ? new CollisionWorld(GROUND_Y) : null;
  const pieces = def.pieces;
  const { map, all } = buildConnectorMap(pieces);
  const neighbour = (c) => (c.open ? null : map.get(connKey(c.x + DIR_X[c.d], c.z + DIR_Z[c.d], c.y, (c.d + 2) & 3)) || null);
  const isConnected = (c) => !!neighbour(c);
  const mats = trackMaterials();
  const acc = new GeometryAccumulator();
  const glowAcc = new GeometryAccumulator();
  const group = new THREE.Group();
  group.name = 'track';
  const m = new THREE.Matrix4();
  const checkpoints = [];
  const finishes = [];
  let start = null;
  const pillars = new MeshBuilder();
  const bounds = new THREE.Box3();
  const occupied = new Set();
  const tmp = new THREE.Vector3();

  pieces.forEach((p, i) => {
    const data = pieceData(p.type);
    pieceMatrix(p, m);
    const cs = all[i];
    let mask = 0, taper = 0;
    cs.forEach((c, k) => {
      const nb = neighbour(c);
      if (!nb) mask |= 1 << k;
      else if (!data.def.build && PIECES[pieces[nb.piece].type].build) taper |= 1 << k; // road meets open floor
    });
    acc.add(data.variant(mask, taper, p.y > 0), m, world);
    if (data.glow) glowAcc.add(data.glow, m, null);
    for (const s of data.supports) {
      tmp.set(s.x, s.y, s.z).applyMatrix4(m);
      addPillar(pillars, tmp.x, tmp.z, tmp.y - DECK_T);
    }
    for (const [cx, cz, cy] of worldCells(p)) {
      occupied.add(`${cx},${cz}`);
      bounds.expandByPoint(tmp.set(cx * TILE, cy * LEVEL, cz * TILE));
    }
    const gate = data.def.gate;
    if (gate) {
      let setDone = null;
      if (gates) {
        const geos = gateGeometries(p.type);
        const frameMesh = new THREE.Mesh(geos.frame, mats.lit);
        frameMesh.castShadow = true;
        const bulbs = new THREE.Mesh(geos.bulbs, mats.bulbs);
        const gateGroup = new THREE.Group();
        gateGroup.add(frameMesh, bulbs);
        if (typeof document !== 'undefined') {
          // painted sign on both faces of the banner
          const mat = new THREE.MeshBasicMaterial({ map: signTexture(gate.kind) });
          for (const side of [1, -1]) {
            const plane = new THREE.Mesh(signPlane(), mat);
            plane.position.set(0, 8.8, gate.z + side * 0.46);
            if (side < 0) plane.rotation.y = Math.PI;
            gateGroup.add(plane);
          }
          if (gate.kind === 'checkpoint') setDone = (done) => { mat.map = signTexture(done ? 'checkpoint-done' : 'checkpoint'); mat.needsUpdate = true; };
        } else {
          const color = gate.kind === 'start' ? COLORS.start : gate.kind === 'checkpoint' ? COLORS.checkpoint : 0xffffff;
          const bannerMat = new THREE.MeshBasicMaterial({ vertexColors: true, color });
          gateGroup.add(new THREE.Mesh(geos.banner, bannerMat));
          if (gate.kind === 'checkpoint') setDone = (done) => bannerMat.color.set(done ? COLORS.checkpointDone : COLORS.checkpoint);
        }
        gateGroup.applyMatrix4(m);
        group.add(gateGroup);
      }
      if (gate.kind !== 'start') {
        const box = new THREE.Box3();
        const corners = [];
        for (const x of [-8.6, 8.6]) for (const y of [-1, 10]) for (const z of [gate.z - 3, gate.z + 3]) {
          corners.push(new THREE.Vector3(x, y, z).applyMatrix4(m));
        }
        box.setFromPoints(corners);
        const entry = { box, setDone, piece: i };
        if (gate.kind === 'checkpoint') checkpoints.push(entry); else finishes.push(entry);
      }
    }
    if (data.def.spawn && !start) {
      const pos = new THREE.Vector3(0, 0, data.def.spawn.z).applyMatrix4(m);
      const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.r * Math.PI / 2);
      start = { pos, quat, piece: i };
    }
  });

  acc.addRaw(pillars, world);
  const mesh = new THREE.Mesh(acc.toGeometry(), mats.lit);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  if (glowAcc.length) group.add(new THREE.Mesh(glowAcc.toGeometry(), mats.glow));
  if (world) world.finalize();
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 0, 20));

  return { def, group, world, start, checkpoints, finishes, bounds, occupied, triangles: acc.length / 9 };
}

export function disposeTrack(track) {
  if (!track) return;
  track.group.traverse((o) => {
    if (o.isMesh) {
      // gate geometries are shared/cached, only dispose the merged meshes
      const shared = o.geometry === _signPlane || [...gateGeoCache.values()].some((g) => g.frame === o.geometry || g.banner === o.geometry || g.bulbs === o.geometry);
      if (!shared) o.geometry.dispose();
      if (o.material && !Object.values(_mats).includes(o.material)) o.material.dispose();
    }
  });
  track.group.removeFromParent();
}

// Follows connectors from the start piece and returns a list of route samples
// ({p, u}) in world space. Gaps after jumps are bridged by scanning ahead.
export function computeRoute(def) {
  const pieces = def.pieces;
  const { map, all } = buildConnectorMap(pieces);
  let cur = pieces.findIndex((p) => p.type === 'start');
  if (cur < 0) return null;
  let entry = 0;
  const pts = [];
  const visited = new Set();
  const m = new THREE.Matrix4();
  let finished = false;
  for (let guard = 0; guard < 5000; guard++) {
    visited.add(cur);
    const p = pieces[cur];
    const data = pieceData(p.type);
    pieceMatrix(p, m);
    // open-area tiles can be left through any side (turtle tracks store it)
    const exitIdx = p.exit ?? (entry ^ 1);
    let r = data.route;
    if (!r) r = openRoute(data.def, entry, exitIdx);
    else if (entry === 1) r = [...r].reverse();
    for (const s of r) {
      const wp = s.p.clone().applyMatrix4(m);
      const up = s.u.clone().transformDirection(m);
      if (pts.length) {
        const last = pts[pts.length - 1];
        const gap = last.p.distanceTo(wp);
        if (gap < 0.5) continue;
        // bridge jumps with interpolated points
        const n = Math.floor(gap / 3);
        for (let k = 1; k < n; k++) {
          pts.push({ p: last.p.clone().lerp(wp, k / n), u: last.u.clone(), piece: cur, air: true });
        }
      }
      pts.push({ p: wp, u: up, piece: cur });
    }
    if (p.type === 'finish') { finished = true; break; }
    const ex = all[cur][exitIdx];
    let next = null;
    for (let k = 1; k <= 5 && !next; k++) {
      for (let dy = 0; dy >= -6 && !next; dy--) {
        const hit = map.get(connKey(ex.x + DIR_X[ex.d] * k, ex.z + DIR_Z[ex.d] * k, ex.y + dy, (ex.d + 2) & 3));
        if (hit && !visited.has(hit.piece)) next = hit;
      }
    }
    if (!next) break;
    cur = next.piece;
    entry = next.conn;
  }
  return { points: pts, finished };
}

// ---------------------------------------------------------------------------
// Turtle script builder. Tokens (space separated, optional *N repeat):
//   S straight, C checkpoint, B boost, F finish
//   L1 L2 L3 / R1 R2 R3   flat turns (tight / normal / wide)
//   BL2 BR2 BL3 BR3       banked turns
//   U D (ramp up/down 1 level), U2 D2 (steep, 2 levels)
//   K jump kicker, BK big jump, G gap (skip a tile), OL OR loops (exit shifts left/right)
//   WL2 WR2 WL3 WR3 wall turns (near-vertical banking)
//   VL VR wall rides, CS corkscrew, INV upside-down section (need level >= 2)
//   Open areas: P floor, PL PR floor where the route turns left/right, PB speed
//   bumps, PJ jump wedge, PC cones, PWL PWR barrier on the left/right, PP pillar.
//   "P/5" adds open floor beside the piece (total width 5); "<PP" / ">>PC"
//   place a piece 1 / 2 tiles left / right of the last piece.
export function buildFromScript(script, opts = {}) {
  let x = opts.x ?? 0, z = opts.z ?? 0, y = opts.y ?? 0, d = opts.d ?? 0;
  const pieces = [];
  let last = null; // entry tile + heading of the last piece on the route (for side tiles)
  const place = (type, entry, exit = null) => {
    const def = PIECES[type];
    const exitIdx = exit ?? (entry ^ 1);
    const ce = def.conns[entry], cx = def.conns[exitIdx];
    const r = (((d + 2 - ce.d) % 4) + 4) % 4;
    const [ox, oz] = rotOffset(ce.x, ce.z, r);
    const px = x - ox, pz = z - oz, py = y - ce.y;
    const piece = { type, x: px, y: py, z: pz, r };
    if (exit !== null) piece.exit = exitIdx;
    pieces.push(piece);
    last = { x, z, y, d };
    const [ex, ez] = rotOffset(cx.x, cx.z, r);
    const nd = (cx.d + r) & 3;
    x = px + ex + DIR_X[nd];
    z = pz + ez + DIR_Z[nd];
    y = py + cx.y;
    d = nd;
  };
  // Places a piece next to the last route piece without moving along the route.
  const placeSide = (type, entry, offset) => {
    if (!last) throw new Error('Side pieces need a piece before them');
    const side = offset > 0 ? (last.d + 1) & 3 : (last.d + 3) & 3; // left / right of travel
    const n = Math.abs(offset);
    const def = PIECES[type];
    const ce = def.conns[entry];
    const r = (((last.d + 2 - ce.d) % 4) + 4) % 4;
    const [ox, oz] = rotOffset(ce.x, ce.z, r);
    const piece = { type, x: last.x + DIR_X[side] * n - ox, y: last.y - ce.y, z: last.z + DIR_Z[side] * n - oz, r };
    // an obstacle replaces plain floor that was already put there
    const i = pieces.findIndex((q) => q.type === 'plaza' && q.x === piece.x && q.z === piece.z && q.y === piece.y);
    if (i >= 0) pieces.splice(i, 1);
    pieces.push(piece);
  };
  const table = {
    START: ['start', 0], S: ['straight', 0], C: ['checkpoint', 0], B: ['boost', 0], F: ['finish', 0],
    L1: ['turn1', 0], L2: ['turn2', 0], L3: ['turn3', 0], R1: ['turn1', 1], R2: ['turn2', 1], R3: ['turn3', 1],
    BL2: ['bank2', 0], BR2: ['bank2', 1], BL3: ['bank3', 0], BR3: ['bank3', 1],
    U: ['ramp', 0], D: ['ramp', 1], U2: ['ramp2', 0], D2: ['ramp2', 1],
    K: ['kicker', 0], OL: ['loopL', 0], OR: ['loopR', 0],
    P: ['plaza', 0], PL: ['plaza', 0, 2], PR: ['plaza', 0, 3], PP: ['plazaPillar', 0],
    PWR: ['plazaWall', 0], PWL: ['plazaWall', 1], PC: ['plazaCones', 0], PB: ['plazaBumps', 0], PJ: ['plazaJump', 0],
    BK: ['bigkick', 0], WL2: ['wall2', 0], WR2: ['wall2', 1], WL3: ['wall3', 0], WR3: ['wall3', 1],
    VL: ['wallL', 0], VR: ['wallR', 0], CS: ['corkscrew', 0], INV: ['inverted', 0],
  };
  place('start', 0);
  for (const raw of script.trim().split(/\s+/)) {
    if (!raw) continue;
    // side tiles: "<PP" one tile left of the last piece, ">>PC" two tiles right
    const side = raw.match(/^(<+|>+)(.+)$/);
    if (side) {
      const e = table[side[2]];
      if (!e) throw new Error(`Unknown track token "${side[2]}"`);
      placeSide(e[0], e[1], side[1][0] === '<' ? side[1].length : -side[1].length);
      continue;
    }
    // "P/5": the piece plus open floor on both sides (total width 5)
    const [body, widthStr] = raw.split('/');
    const [tok, rep] = body.split('*');
    const n = rep ? parseInt(rep, 10) : 1;
    const width = widthStr ? parseInt(widthStr, 10) : 1;
    for (let i = 0; i < n; i++) {
      if (tok === 'G') { x += DIR_X[d]; z += DIR_Z[d]; continue; }
      const e = table[tok];
      if (!e) throw new Error(`Unknown track token "${tok}"`);
      place(e[0], e[1], e[2] ?? null);
      // open floor beside the piece (never on the side a turning tile exits through)
      for (let k = 1; k <= (width - 1) / 2; k++) {
        if (e[2] !== 2) placeSide('plaza', 0, k);
        if (e[2] !== 3) placeSide('plaza', 0, -k);
      }
    }
  }
  return pieces;
}

// Detects overlapping cells (used by tests and the editor).
export function findOverlaps(pieces) {
  const owner = new Map();
  const clashes = [];
  pieces.forEach((p, i) => {
    for (const c of worldCells(p)) {
      const k = c.join(',');
      if (c[2] < 0) clashes.push([i, i, `${k} (below ground)`]);
      else if (owner.has(k) && owner.get(k) !== i) clashes.push([owner.get(k), i, k]);
      else owner.set(k, i);
    }
  });
  return clashes;
}

// ---------------------------------------------------------------------------
// Share codes

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  let s = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeTrack(def) {
  const obj = {
    v: 1,
    n: def.name || 'Untitled',
    p: def.pieces.map((p) => [PIECE_ORDER.indexOf(p.type), p.x, p.y, p.z, p.r]),
  };
  return toBase64Url(JSON.stringify(obj));
}

export function decodeTrack(code) {
  const obj = JSON.parse(fromBase64Url(code));
  if (!obj || !Array.isArray(obj.p)) throw new Error('Invalid track code');
  if (obj.p.length > 3000) throw new Error('Track is too large');
  const pieces = obj.p.map((a) => {
    if (!Array.isArray(a) || a.length !== 5) throw new Error('Invalid piece');
    const [t, x, y, z, r] = a.map((n) => Number(n));
    const type = PIECE_ORDER[t];
    if (!type) throw new Error('Unknown piece');
    for (const n of [x, y, z, r]) if (!Number.isInteger(n) || Math.abs(n) > 500) throw new Error('Invalid coordinate');
    if (y < 0 || y > 60) throw new Error('Invalid height');
    return { type, x, y, z, r: r & 3 };
  });
  return { name: String(obj.n || 'Shared track').slice(0, 40), pieces };
}

export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
