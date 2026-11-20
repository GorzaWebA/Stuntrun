// Small helpers to build flat shaded, vertex coloured low poly geometry.
import * as THREE from '../vendor/three.module.min.js';

const colorCache = new Map();
export function rgb(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    const col = new THREE.Color(hex);
    c = [col.r, col.g, col.b];
    colorCache.set(hex, c);
  }
  return c;
}

// Accumulates triangles. Each triangle gets a flat normal, a colour and an
// optional collision surface id (-1 = visual only).
export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.col = [];
    this.surf = [];
  }

  tri(a, b, c, color, surf = -1) {
    const [r, g, bl] = rgb(color);
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.col.push(r, g, bl, r, g, bl, r, g, bl);
    this.surf.push(surf);
  }

  quad(a, b, c, d, color, surf = -1) {
    this.tri(a, b, c, color, surf);
    this.tri(a, c, d, color, surf);
  }

  // Eight-corner hexahedron. Corner order: bottom (-x-z, +x-z, +x+z, -x+z), then top in the same order.
  hexa(v, color, surf = -1, faceColors = null) {
    const fc = (i) => (faceColors && faceColors[i] !== undefined ? faceColors[i] : color);
    this.quad(v[0], v[1], v[2], v[3], fc(0), surf); // bottom
    this.quad(v[4], v[7], v[6], v[5], fc(1), surf); // top
    this.quad(v[3], v[2], v[6], v[7], fc(2), surf); // +z
    this.quad(v[0], v[4], v[5], v[1], fc(3), surf); // -z
    this.quad(v[1], v[5], v[6], v[2], fc(4), surf); // +x
    this.quad(v[0], v[3], v[7], v[4], fc(5), surf); // -x
  }

  box(x0, y0, z0, x1, y1, z1, color, surf = -1, faceColors = null) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    this.hexa([
      V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1),
      V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1),
    ], color, surf, faceColors);
  }

  get triangleCount() { return this.surf.length; }

  // Returns plain arrays (local space) so they can be cached and transformed later.
  toData() {
    return {
      pos: Float32Array.from(this.pos),
      col: Float32Array.from(this.col),
      surf: Int8Array.from(this.surf),
    };
  }

  toGeometry() {
    return dataToGeometry(this.toData());
  }
}

export function dataToGeometry(data) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(data.col, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(computeFlatNormals(data.pos), 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function computeFlatNormals(pos) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const ux = pos[i + 3] - ax, uy = pos[i + 4] - ay, uz = pos[i + 5] - az;
    const vx = pos[i + 6] - ax, vy = pos[i + 7] - ay, vz = pos[i + 8] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 9; k += 3) { n[i + k] = nx; n[i + k + 1] = ny; n[i + k + 2] = nz; }
  }
  return n;
}

// Collects many transformed copies of cached triangle data into one geometry.
export class GeometryAccumulator {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  // data: {pos, col, surf}; matrix: THREE.Matrix4 (rotation about Y + translation only)
  add(data, matrix, collision = null) {
    const e = matrix.elements;
    const src = data.pos;
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i], y = src[i + 1], z = src[i + 2];
      out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
      out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    this.chunks.push({ pos: out, col: data.col });
    this.length += out.length;
    if (collision) {
      const s = data.surf;
      for (let t = 0; t < s.length; t++) {
        if (s[t] < 0) continue;
        const o = t * 9;
        collision.add(out[o], out[o + 1], out[o + 2], out[o + 3], out[o + 4], out[o + 5], out[o + 6], out[o + 7], out[o + 8], s[t]);
      }
    }
  }

  addRaw(builder, collision = null) {
    const data = builder.toData();
    this.chunks.push({ pos: data.pos, col: data.col });
    this.length += data.pos.length;
    if (collision) {
      const s = data.surf, out = data.pos;
      for (let t = 0; t < s.length; t++) {
        if (s[t] < 0) continue;
        const o = t * 9;
        collision.add(out[o], out[o + 1], out[o + 2], out[o + 3], out[o + 4], out[o + 5], out[o + 6], out[o + 7], out[o + 8], s[t]);
      }
    }
  }

  toGeometry() {
    const pos = new Float32Array(this.length);
    const col = new Float32Array(this.length);
    let o = 0;
    for (const c of this.chunks) {
      pos.set(c.pos, o);
      col.set(c.col, o);
      o += c.pos.length;
    }
    return dataToGeometry({ pos, col });
  }
}
