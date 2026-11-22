// Small DOM/SVG helpers for the show's look: marquee bulbs, route maps on the
// tickets, rosettes for medals and difficulty stars.
import { computeRoute } from './track.js';

// Places chase-light bulbs around a .marquee sign.
export function placeBulbs(el) {
  el.querySelectorAll('.bulb').forEach((b) => b.remove());
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;
  const inset = el.classList.contains('small') ? 8 : 11;
  const pw = w - inset * 2, ph = h - inset * 2;
  const perim = 2 * (pw + ph);
  const n = Math.max(12, Math.round(perim / (el.classList.contains('small') ? 22 : 27)));
  for (let i = 0; i < n; i++) {
    const d = (i / n) * perim;
    let x, y;
    if (d < pw) { x = inset + d; y = inset; }
    else if (d < pw + ph) { x = inset + pw; y = inset + (d - pw); }
    else if (d < 2 * pw + ph) { x = inset + pw - (d - pw - ph); y = inset + ph; }
    else { x = inset; y = inset + ph - (d - 2 * pw - ph); }
    const b = document.createElement('span');
    b.className = `bulb d${i % 3}`;
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    b.setAttribute('aria-hidden', 'true');
    el.appendChild(b);
  }
}

const mapCache = new Map();
// Top-down drawing of the route a track takes (used on the tickets).
// Small three-quarter view of a route for the track tickets. A top-down trace
// hides everything that makes a stunt track (loops, ramps, drops), so the
// route is drawn from above at an angle with its shadow on the ground.
const MAP_W = 300, MAP_H = 62;
const ELEV = Math.sin(Math.PI / 6), RISE = Math.cos(Math.PI / 6);

function projectRoute(pts, angle) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  return pts.map(({ p }) => {
    const x = p.x * ca - p.z * sa, z = p.x * sa + p.z * ca;
    return [x, z * ELEV, p.y * RISE];
  });
}

export function routeMapSvg(def, key) {
  if (key && mapCache.has(key)) return mapCache.get(key);
  let svg = '<svg class="tmap" aria-hidden="true"></svg>';
  try {
    const route = computeRoute(def);
    const all = route ? route.points : [];
    // thin out the points, keeping every switch between road and air
    const pts = all.filter((q, i) => i % 2 === 0 || i === all.length - 1 || !!q.air !== !!all[i - 1]?.air);
    if (pts.length > 1) {
      const ground = Math.min(...pts.map((q) => q.p.y));
      // pick the viewing angle that fills the ticket best
      let best = null;
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k * Math.PI) / 4;
        const pr = projectRoute(pts, a);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, d, h] of pr) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, d - h, d - ground * RISE); maxY = Math.max(maxY, d - h, d - ground * RISE);
        }
        const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
        const fit = Math.min(MAP_W / w, MAP_H / h);
        if (!best || fit > best.fit) best = { pr, fit, minX, minY, w, h };
      }
      const { pr, minX, minY, w, h } = best;
      const unit = Math.max(w / (MAP_W - 16), h / (MAP_H - 12)); // viewBox units per pixel
      const pad = 7 * unit;
      const vb = `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(w + pad * 2).toFixed(1)} ${(h + pad * 2).toFixed(1)}`;
      const sxy = (i) => `${pr[i][0].toFixed(1)} ${(pr[i][1] - pr[i][2]).toFixed(1)}`;
      const shadow = pr.map(([x, d], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${(d - ground * RISE).toFixed(1)}`).join('');
      // road runs solid, jumps dotted
      let road = '', air = '';
      for (let i = 1; i < pts.length; i++) {
        const seg = `M${sxy(i - 1)}L${sxy(i)}`;
        if (pts[i].air) air += seg; else road += seg;
      }
      const r = 4.2 * unit;
      const [ex, ey] = sxy(pts.length - 1).split(' ').map(Number);
      svg = `<svg class="tmap" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path class="ground" d="${shadow}" vector-effect="non-scaling-stroke"/>
        <path class="route" d="${road}" vector-effect="non-scaling-stroke"/>
        ${air ? `<path class="air" d="${air}" vector-effect="non-scaling-stroke"/>` : ''}
        <circle class="start" cx="${pr[0][0].toFixed(1)}" cy="${(pr[0][1] - pr[0][2]).toFixed(1)}" r="${r.toFixed(2)}"/>
        <rect class="end" x="${(ex - r).toFixed(2)}" y="${(ey - r).toFixed(2)}" width="${(r * 2).toFixed(2)}" height="${(r * 2).toFixed(2)}"/>
      </svg>`;
    }
  } catch { /* keep the empty map */ }
  if (key) mapCache.set(key, svg);
  return svg;
}

const ROSETTE = {
  gold: { main: '#f4b81c', inner: '#ffd968', r1: '#e23b2e', r2: '#b8281e' },
  silver: { main: '#c9d0d8', inner: '#eef1f4', r1: '#2a9d9a', r2: '#1f7573' },
  bronze: { main: '#cf7e3f', inner: '#eca76c', r1: '#4d3f5a', r2: '#3b2e47' },
};

// A prize rosette. kind: gold | silver | bronze | null (empty outline).
export function rosetteSvg(kind, { title = '', outline = 'rgba(42,31,51,0.35)' } = {}) {
  const t = title ? `<title>${title}</title>` : '';
  if (!kind) {
    return `<svg class="rosette" viewBox="0 0 40 48" role="img">${t}<circle cx="20" cy="18" r="15" fill="none" stroke="${outline}" stroke-width="2.2" stroke-dasharray="3.4 3"/></svg>`;
  }
  const c = ROSETTE[kind];
  const pts = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 14.6 : 17.4;
    pts.push(`${(20 + Math.cos(a) * r).toFixed(2)},${(18 + Math.sin(a) * r).toFixed(2)}`);
  }
  return `<svg class="rosette" viewBox="0 0 40 48" role="img">${t}
    <path d="M12.5 25 7.5 46l6-3.6 4.3 5L20 28z" fill="${c.r1}"/>
    <path d="M27.5 25l5 21-6-3.6-4.3 5L20 28z" fill="${c.r2}"/>
    <polygon points="${pts.join(' ')}" fill="${c.main}" stroke="#2a1f33" stroke-width="1.4" stroke-linejoin="round"/>
    <circle cx="20" cy="18" r="10" fill="${c.inner}" stroke="#2a1f33" stroke-width="1.4"/>
    <path d="M20 12.2l1.8 3.7 4.1.6-3 2.9.7 4.1-3.6-1.9-3.6 1.9.7-4.1-3-2.9 4.1-.6z" fill="${c.main}" stroke="#2a1f33" stroke-width="1" stroke-linejoin="round"/>
  </svg>`;
}

const STAR = 'M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9z';
export function starsSvg(n, of = 5) {
  let s = '';
  for (let i = 1; i <= of; i++) s += `<svg viewBox="0 0 24 24" class="${i <= n ? '' : 'off'}" aria-hidden="true"><path d="${STAR}" fill="currentColor"/></svg>`;
  return `<span class="stars" title="Difficulty ${n} of ${of}">${s}</span>`;
}
