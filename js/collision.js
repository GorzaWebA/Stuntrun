// Static collision world: a triangle soup stored in a uniform spatial hash grid,
// plus an infinite ground plane. Supports short ray casts (wheels) and sphere
// contact queries (chassis).

export const SURF = { ROAD: 0, BOOST: 1, WALL: 2, GRASS: 3 };

const CELL = 6;
const INV_CELL = 1 / CELL;

function cellKey(ix, iy, iz) {
  return ((ix & 1023) << 20) | ((iy & 1023) << 10) | (iz & 1023);
}

export class CollisionWorld {
  constructor(groundY) {
    this.groundY = groundY;
    this._raw = [];
    this._rawSurf = [];
    this.tri = null;   // Float64Array, 12 per triangle: a, b, c, normal
    this.surf = null;  // Uint8Array
    this.grid = new Map();
    this.stamp = null;
    this.stampId = 1;
    this.count = 0;
    this.contacts = [];
    for (let i = 0; i < 16; i++) {
      this.contacts.push({ nx: 0, ny: 0, nz: 0, depth: 0, px: 0, py: 0, pz: 0, surf: 0 });
    }
  }

  add(ax, ay, az, bx, by, bz, cx, cy, cz, surf) {
    this._raw.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this._rawSurf.push(surf);
  }

  finalize() {
    const n = this._rawSurf.length;
    const raw = this._raw;
    const tri = new Float64Array(n * 12);
    let kept = 0;
    const surfs = [];
    for (let i = 0; i < n; i++) {
      const s = i * 9;
      const ax = raw[s], ay = raw[s + 1], az = raw[s + 2];
      const bx = raw[s + 3], by = raw[s + 4], bz = raw[s + 5];
      const cx = raw[s + 6], cy = raw[s + 7], cz = raw[s + 8];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      nx /= len; ny /= len; nz /= len;
      const d = kept * 12;
      tri[d] = ax; tri[d + 1] = ay; tri[d + 2] = az;
      tri[d + 3] = bx; tri[d + 4] = by; tri[d + 5] = bz;
      tri[d + 6] = cx; tri[d + 7] = cy; tri[d + 8] = cz;
      tri[d + 9] = nx; tri[d + 10] = ny; tri[d + 11] = nz;
      surfs.push(this._rawSurf[i]);
      const x0 = Math.floor(Math.min(ax, bx, cx) * INV_CELL), x1 = Math.floor(Math.max(ax, bx, cx) * INV_CELL);
      const y0 = Math.floor(Math.min(ay, by, cy) * INV_CELL), y1 = Math.floor(Math.max(ay, by, cy) * INV_CELL);
      const z0 = Math.floor(Math.min(az, bz, cz) * INV_CELL), z1 = Math.floor(Math.max(az, bz, cz) * INV_CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          for (let iz = z0; iz <= z1; iz++) {
            const k = cellKey(ix, iy, iz);
            let bucket = this.grid.get(k);
            if (!bucket) { bucket = []; this.grid.set(k, bucket); }
            bucket.push(kept);
          }
        }
      }
      kept++;
    }
    this.count = kept;
    this.tri = tri.subarray(0, kept * 12);
    this.surf = Uint8Array.from(surfs);
    this.stamp = new Uint32Array(kept);
    this._raw = null;
    this._rawSurf = null;
  }

  _nextStamp() {
    this.stampId++;
    if (this.stampId > 0xfffffff0) { this.stamp.fill(0); this.stampId = 1; }
    return this.stampId;
  }

  // Ray cast hitting only front faces. Returns distance or -1. Fills `hit`.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, hit) {
    let best = maxDist;
    let found = false;
    if (dy < -1e-6 && oy >= this.groundY) {
      const t = (this.groundY - oy) / dy;
      if (t >= 0 && t < best) {
        best = t; found = true;
        hit.nx = 0; hit.ny = 1; hit.nz = 0; hit.surf = SURF.GRASS;
      }
    }
    if (this.count === 0) return found ? best : -1;
    const ex = ox + dx * maxDist, ey = oy + dy * maxDist, ez = oz + dz * maxDist;
    const x0 = Math.floor(Math.min(ox, ex) * INV_CELL), x1 = Math.floor(Math.max(ox, ex) * INV_CELL);
    const y0 = Math.floor(Math.min(oy, ey) * INV_CELL), y1 = Math.floor(Math.max(oy, ey) * INV_CELL);
    const z0 = Math.floor(Math.min(oz, ez) * INV_CELL), z1 = Math.floor(Math.max(oz, ez) * INV_CELL);
    const stamp = this._nextStamp();
    const tri = this.tri;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const bucket = this.grid.get(cellKey(ix, iy, iz));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const ti = bucket[bi];
            if (this.stamp[ti] === stamp) continue;
            this.stamp[ti] = stamp;
            const o = ti * 12;
            // Möller–Trumbore with back-face culling
            const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
            const e1x = tri[o + 3] - ax, e1y = tri[o + 4] - ay, e1z = tri[o + 5] - az;
            const e2x = tri[o + 6] - ax, e2y = tri[o + 7] - ay, e2z = tri[o + 8] - az;
            const px = dy * e2z - dz * e2y;
            const py = dz * e2x - dx * e2z;
            const pz = dx * e2y - dy * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            if (det < 1e-9) continue;
            const inv = 1 / det;
            const tx = ox - ax, ty = oy - ay, tz = oz - az;
            const u = (tx * px + ty * py + tz * pz) * inv;
            if (u < 0 || u > 1) continue;
            const qx = ty * e1z - tz * e1y;
            const qy = tz * e1x - tx * e1z;
            const qz = tx * e1y - ty * e1x;
            const v = (dx * qx + dy * qy + dz * qz) * inv;
            if (v < 0 || u + v > 1) continue;
            const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
            if (t >= 0 && t < best) {
              best = t; found = true;
              hit.nx = tri[o + 9]; hit.ny = tri[o + 10]; hit.nz = tri[o + 11];
              hit.surf = this.surf[ti];
            }
          }
        }
      }
    }
    return found ? best : -1;
  }

  // Finds contacts between a sphere and the world. Returns number of contacts
  // written to this.contacts (normal points out of the surface towards the sphere).
  sphere(cx, cy, cz, r, maxContacts = 16) {
    let count = 0;
    const out = this.contacts;
    if (cy - r < this.groundY) {
      const c = out[count++];
      c.nx = 0; c.ny = 1; c.nz = 0; c.depth = this.groundY - (cy - r);
      c.px = cx; c.py = this.groundY; c.pz = cz; c.surf = SURF.GRASS;
    }
    if (this.count === 0) return count;
    const x0 = Math.floor((cx - r) * INV_CELL), x1 = Math.floor((cx + r) * INV_CELL);
    const y0 = Math.floor((cy - r) * INV_CELL), y1 = Math.floor((cy + r) * INV_CELL);
    const z0 = Math.floor((cz - r) * INV_CELL), z1 = Math.floor((cz + r) * INV_CELL);
    const stamp = this._nextStamp();
    const tri = this.tri;
    const r2 = r * r;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const bucket = this.grid.get(cellKey(ix, iy, iz));
          if (!bucket) continue;
          for (let bi = 0; bi < bucket.length; bi++) {
            const ti = bucket[bi];
            if (this.stamp[ti] === stamp) continue;
            this.stamp[ti] = stamp;
            const o = ti * 12;
            const ax = tri[o], ay = tri[o + 1], az = tri[o + 2];
            const nx = tri[o + 9], ny = tri[o + 10], nz = tri[o + 11];
            const pd = (cx - ax) * nx + (cy - ay) * ny + (cz - az) * nz;
            if (pd < 0 || pd > r) continue; // one sided
            closestPointOnTriangle(cx, cy, cz, tri, o, _cp);
            const dx = cx - _cp[0], dy = cy - _cp[1], dz = cz - _cp[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= r2) continue;
            const d = Math.sqrt(d2);
            if (count >= maxContacts) return count;
            const c = out[count++];
            if (d > 1e-6) { c.nx = dx / d; c.ny = dy / d; c.nz = dz / d; } else { c.nx = nx; c.ny = ny; c.nz = nz; }
            c.depth = r - d;
            c.px = _cp[0]; c.py = _cp[1]; c.pz = _cp[2];
            c.surf = this.surf[ti];
          }
        }
      }
    }
    return count;
  }
}

const _cp = [0, 0, 0];

// Ericson, Real-Time Collision Detection, 5.1.5
function closestPointOnTriangle(px, py, pz, t, o, out) {
  const ax = t[o], ay = t[o + 1], az = t[o + 2];
  const bx = t[o + 3], by = t[o + 4], bz = t[o + 5];
  const cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w; return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
}
