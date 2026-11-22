// Painted show signs for the gates (canvas textures, browser only).
import * as THREE from '../vendor/three.module.min.js';

const W = 1024, H = 80;
const cache = new Map();

const STYLES = {
  start: { bg: '#e23b2e', fg: '#f6ead2', text: 'START' },
  checkpoint: { bg: '#2a9d9a', fg: '#f6ead2', text: 'CHECKPOINT' },
  'checkpoint-done': { bg: '#ffc42e', fg: '#2a1f33', text: 'CHECKPOINT' },
  finish: { bg: null, fg: '#2a1f33', text: 'FINISH' },
};

function star(ctx, x, y, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function draw(kind, canvas) {
  const st = STYLES[kind];
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  if (st.bg) {
    ctx.fillStyle = st.bg;
    ctx.fillRect(0, 0, W, H);
  } else {
    // chequered flag with a bone plate in the middle
    const sq = H / 2;
    for (let x = 0; x < W / sq; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#2a1f33' : '#f6ead2';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
    ctx.fillStyle = '#f6ead2';
    ctx.fillRect(W / 2 - 190, 6, 380, H - 12);
    ctx.strokeStyle = '#2a1f33';
    ctx.lineWidth = 5;
    ctx.strokeRect(W / 2 - 190, 6, 380, H - 12);
  }
  // inner painted rule
  if (st.bg) {
    ctx.strokeStyle = st.fg;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.globalAlpha = 1;
  }
  ctx.font = '52px "Alfa Slab One", Rockwell, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  const tw = ctx.measureText(st.text).width;
  ctx.fillStyle = st.bg ? 'rgba(42,31,51,0.55)' : 'rgba(42,31,51,0)';
  ctx.fillText(st.text, W / 2 + 3, H / 2 + 5);
  ctx.fillStyle = st.fg;
  ctx.fillText(st.text, W / 2, H / 2 + 2);
  if (st.bg) {
    for (const dir of [-1, 1]) star(ctx, W / 2 + dir * (tw / 2 + 40), H / 2, 16, st.fg);
  }
}

export function signTexture(kind) {
  let entry = cache.get(kind);
  if (!entry) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    draw(kind, canvas);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    entry = { canvas, tex };
    cache.set(kind, entry);
  }
  return entry.tex;
}

// redraw once the slab font has loaded
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts.load('52px "Alfa Slab One"').then(() => {
    for (const [kind, e] of cache) { draw(kind, e.canvas); e.tex.needsUpdate = true; }
  }).catch(() => {});
}
