// Grid based track editor: place / rotate / stack / erase pieces, test drive,
// save locally and share with a code or link.
import * as THREE from '../vendor/three.module.min.js';
import { TILE, LEVEL, GROUND_Y } from './config.js';
import { PIECES, PIECE_ORDER, pieceData, worldCells, pieceMatrix } from './pieces.js';
import { buildTrack, disposeTrack } from './track.js';
import { dataToGeometry } from './geometry.js';
import { storage } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const MAX_LEVEL = 12;

function defaultPieces() {
  return [
    { type: 'start', x: 0, y: 0, z: 0, r: 0 },
    { type: 'straight', x: 0, y: 0, z: 1, r: 0 },
    { type: 'straight', x: 0, y: 0, z: 2, r: 0 },
    { type: 'finish', x: 0, y: 0, z: 3, r: 0 },
  ];
}

export class Editor {
  constructor(game) {
    this.game = game;
    this.pieces = defaultPieces();
    this.name = 'My track';
    this.entryId = null;
    this.tool = 'straight';
    this.rot = 0;
    this.level = 0;
    this.erase = false;
    this.history = [];
    this.focus = new THREE.Vector3();
    this.yaw = Math.PI * 0.75;
    this.pitch = 0.95;
    this.dist = 130;
    this.active = false;
    this.preview = null;
    this.previewGeo = new Map();
    this.hover = null;
    this.pointers = new Map();
    this.raycaster = new THREE.Raycaster();
    this.keys = new Set();
    this.okMat = new THREE.MeshBasicMaterial({ color: 0x5cff9d, transparent: true, opacity: 0.45, depthWrite: false });
    this.badMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d, transparent: true, opacity: 0.45, depthWrite: false });
    this.grid = makeGrid(50);
    this.levelPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE * 50, TILE * 50).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2b6cff, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.bindUI();
  }

  get def() {
    return { name: this.name, pieces: this.pieces.map((p) => ({ ...p })) };
  }

  // ------------------------------------------------------------------ lifecycle
  enter(def, entryId = null, resume = false) {
    const game = this.game;
    this.active = true;
    if (!resume) {
      if (def) {
        this.pieces = def.pieces.map((p) => ({ ...p }));
        this.name = def.name || 'My track';
        this.entryId = entryId;
      } else {
        this.pieces = defaultPieces();
        this.name = 'My track';
        this.entryId = null;
      }
      this.history = [];
      this.centerView();
    }
    $('#ed-name').value = this.name;
    game.scene.add(this.grid, this.levelPlane);
    if (game.scenery.decor) game.scenery.decor.visible = false;
    this.buildPalette();
    this.rebuild();
    this.updateLevelUI();
    this.saveDraft();
  }

  exit() {
    this.active = false;
    this.clearPreview();
    if (this.trackObj) { disposeTrack(this.trackObj); this.trackObj = null; }
    this.grid.removeFromParent();
    this.levelPlane.removeFromParent();
    if (this.game.scenery.decor) this.game.scenery.decor.visible = true;
    this.pointers.clear();
    this.keys.clear();
  }

  centerView() {
    const box = new THREE.Box3();
    for (const p of this.pieces) box.expandByPoint(new THREE.Vector3(p.x * TILE, 0, p.z * TILE));
    if (box.isEmpty()) this.focus.set(0, 0, 0); else box.getCenter(this.focus);
    const size = box.isEmpty() ? 0 : Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    this.dist = Math.min(420, Math.max(110, size * 1.2));
    this.level = 0;
  }

  saveDraft() {
    storage.saveEditorDraft({ def: this.def, entryId: this.entryId });
  }

  // ------------------------------------------------------------------ building
  rebuild() {
    if (this.trackObj) disposeTrack(this.trackObj);
    this.trackObj = buildTrack({ name: this.name, pieces: this.pieces }, { collision: false });
    this.game.scene.add(this.trackObj.group);
    this.cellOwner = new Map();
    this.pieces.forEach((p, i) => {
      for (const c of worldCells(p)) this.cellOwner.set(c.join(','), i);
    });
    this.refreshPreview();
  }

  snapshot() {
    this.history.push(JSON.stringify(this.pieces));
    if (this.history.length > 120) this.history.shift();
  }

  undo() {
    const s = this.history.pop();
    if (!s) { this.game.toast('Nothing to undo'); return; }
    this.pieces = JSON.parse(s);
    this.rebuild();
    this.saveDraft();
  }

  // returns null when the piece fits, otherwise a reason
  placeError(piece) {
    for (const c of worldCells(piece)) {
      if (c[2] < 0) return 'Build this piece higher – use ▲ (it needs room below)';
      const owner = this.cellOwner.get(c.join(','));
      if (owner !== undefined && !(piece.type === 'start' && this.pieces[owner].type === 'start')) return 'That spot is taken';
    }
    return null;
  }

  canPlace(piece) {
    for (const c of worldCells(piece)) {
      if (c[2] < 0) return false;
      const owner = this.cellOwner.get(c.join(','));
      if (owner !== undefined) {
        // a new start replaces the old one, so ignore it
        if (piece.type === 'start' && this.pieces[owner].type === 'start') continue;
        return false;
      }
    }
    return true;
  }

  place(tx, tz) {
    const piece = { type: this.tool, x: tx, y: this.level, z: tz, r: this.rot };
    const err = this.placeError(piece);
    if (err) { this.game.toast(err); return; }
    this.snapshot();
    if (piece.type === 'start') this.pieces = this.pieces.filter((p) => p.type !== 'start');
    this.pieces.push(piece);
    this.game.audio.click();
    this.rebuild();
    this.saveDraft();
  }

  pieceAt(tx, tz) {
    let best = -1, bestD = Infinity;
    this.pieces.forEach((p, i) => {
      for (const [x, z, y] of worldCells(p)) {
        if (x !== tx || z !== tz) continue;
        const d = Math.abs(y - this.level) + (y > this.level ? 0.5 : 0);
        if (d < bestD) { bestD = d; best = i; }
      }
    });
    return best;
  }

  removeAt(tx, tz) {
    const i = this.pieceAt(tx, tz);
    if (i < 0) return;
    this.snapshot();
    this.pieces.splice(i, 1);
    this.game.audio.click();
    this.rebuild();
    this.saveDraft();
  }

  // ------------------------------------------------------------------ preview
  clearPreview() {
    if (this.preview) { this.preview.removeFromParent(); this.preview = null; }
  }

  previewGeometry(type) {
    let g = this.previewGeo.get(type);
    if (!g) {
      { const d = pieceData(type); g = dataToGeometry(d.variant(d.fullMask)); }
      this.previewGeo.set(type, g);
    }
    return g;
  }

  refreshPreview() {
    this.clearPreview();
    if (!this.hover || !this.active) return;
    const { tx, tz } = this.hover;
    if (this.erase) {
      const i = this.pieceAt(tx, tz);
      if (i < 0) return;
      const p = this.pieces[i];
      const mesh = new THREE.Mesh(this.previewGeometry(p.type), this.badMat);
      mesh.applyMatrix4(pieceMatrix(p));
      mesh.scale.multiplyScalar(1.01);
      this.preview = mesh;
    } else {
      const p = { type: this.tool, x: tx, y: this.level, z: tz, r: this.rot };
      const mesh = new THREE.Mesh(this.previewGeometry(p.type), this.canPlace(p) ? this.okMat : this.badMat);
      mesh.applyMatrix4(pieceMatrix(p));
      mesh.position.y += 0.05;
      this.preview = mesh;
    }
    this.game.scene.add(this.preview);
  }

  // ------------------------------------------------------------------ UI
  buildPalette() {
    const pal = $('#ed-palette');
    if (pal.childElementCount) { this.refreshPalette(); return; }
    const thumbs = renderThumbnails();
    PIECE_ORDER.forEach((id) => {
      const b = document.createElement('button');
      b.className = 'piece';
      b.dataset.piece = id;
      b.title = PIECES[id].name;
      b.innerHTML = `${thumbs[id] ? `<img alt="" src="${thumbs[id]}">` : ''}<span>${PIECES[id].name}</span>`;
      b.addEventListener('click', () => {
        this.tool = id;
        this.erase = false;
        this.refreshPalette();
        this.refreshPreview();
      });
      pal.appendChild(b);
    });
    this.refreshPalette();
  }

  refreshPalette() {
    document.querySelectorAll('#ed-palette .piece').forEach((b) => b.classList.toggle('active', !this.erase && b.dataset.piece === this.tool));
    $('#ed-erase').classList.toggle('active', this.erase);
  }

  updateLevelUI() {
    $('#ed-level').textContent = `L${this.level}`;
  }

  setLevel(l) {
    this.level = Math.max(0, Math.min(MAX_LEVEL, l));
    this.updateLevelUI();
    this.refreshPreview();
  }

  rotate() {
    this.rot = (this.rot + 1) & 3;
    this.refreshPreview();
  }

  validate() {
    const starts = this.pieces.filter((p) => p.type === 'start').length;
    const finishes = this.pieces.filter((p) => p.type === 'finish').length;
    if (!starts) return 'Add a Start piece first';
    if (!finishes) return 'Add at least one Finish piece';
    return null;
  }

  bindUI() {
    const game = this.game;
    $('#editor-ui').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ed]');
      if (!b) return;
      const a = b.dataset.ed;
      if (a === 'exit') { this.saveDraft(); game.openMenu(); }
      else if (a === 'undo') this.undo();
      else if (a === 'rotate') this.rotate();
      else if (a === 'up') this.setLevel(this.level + 1);
      else if (a === 'down') this.setLevel(this.level - 1);
      else if (a === 'erase') { this.erase = !this.erase; this.refreshPalette(); this.refreshPreview(); }
      else if (a === 'save') this.save();
      else if (a === 'share') {
        const err = this.validate();
        if (err) { game.toast(err); return; }
        game.shareDialog(this.def);
      } else if (a === 'test') this.test();
      else if (a === 'clear') {
        game.modal({
          title: 'Start a new track?', text: 'Unsaved changes to the current track will be lost.',
          buttons: [{ label: 'Cancel' }, {
            label: 'New track', primary: true,
            action: () => {
              this.snapshot();
              this.pieces = defaultPieces();
              this.name = 'My track';
              this.entryId = null;
              $('#ed-name').value = this.name;
              this.centerView();
              this.updateLevelUI();
              this.rebuild();
              this.saveDraft();
            },
          }],
        });
      }
    });
    $('#ed-name').addEventListener('input', (e) => {
      this.name = e.target.value.slice(0, 40) || 'My track';
      this.saveDraft();
    });

    const canvas = game.canvas;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); });
    canvas.addEventListener('pointerleave', () => { if (this.active && !this.pointers.size) { this.hover = null; this.refreshPreview(); } });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.dist = Math.min(600, Math.max(30, this.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (document.querySelector('#modal.show')) return;
      this.keys.add(e.code);
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); this.undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); this.save(); return; }
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyR': this.rotate(); break;
        case 'KeyE': case 'PageUp': this.setLevel(this.level + 1); break;
        case 'KeyQ': case 'PageDown': this.setLevel(this.level - 1); break;
        case 'KeyX': case 'Delete': this.erase = !this.erase; this.refreshPalette(); this.refreshPreview(); break;
        case 'KeyT': this.test(); break;
        case 'Escape': if (this.erase) { this.erase = false; this.refreshPalette(); this.refreshPreview(); } break;
        default:
          if (/^Digit[1-9]$/.test(e.code)) {
            const id = PIECE_ORDER[Number(e.code.slice(5)) - 1];
            if (id) { this.tool = id; this.erase = false; this.refreshPalette(); this.refreshPreview(); }
          }
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  save() {
    const err = this.validate();
    const entry = this.game.saveCustomTrack(this.def, this.entryId);
    this.entryId = entry.id;
    this.saveDraft();
    this.game.toast(err ? `Saved (note: ${err.toLowerCase()})` : `Saved “${this.name}”`);
  }

  test() {
    const err = this.validate();
    if (err) { this.game.toast(err); return; }
    this.saveDraft();
    this.game.testTrack(this.def);
  }

  // ------------------------------------------------------------------ pointer handling
  groundHit(clientX, clientY, y = this.level * LEVEL) {
    const rect = this.game.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.game.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  tileAt(clientX, clientY) {
    const p = this.groundHit(clientX, clientY);
    if (!p) return null;
    return { tx: Math.round(p.x / TILE), tz: Math.round(p.z / TILE) };
  }

  onPointerDown(e) {
    if (!this.active) return;
    this.game.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: false, type: e.pointerType });
    if (this.pointers.size === 2) this.pinch = this.pinchState();
  }

  pinchState() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: this.dist, yaw: this.yaw };
  }

  onPointerMove(e) {
    if (!this.active) return;
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') {
        const t = this.tileAt(e.clientX, e.clientY);
        if (!t || !this.hover || t.tx !== this.hover.tx || t.tz !== this.hover.tz) {
          this.hover = t;
          this.refreshPreview();
        }
      }
      return;
    }
    const px = p.x, py = p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 7) p.moved = true;
    if (this.pointers.size >= 2) {
      const now = this.pinchState();
      const st = this.pinch;
      if (st && st.d > 10) {
        this.dist = Math.min(600, Math.max(30, st.dist * (st.d / now.d)));
        this.yaw = st.yaw - (now.ang - st.ang);
      }
      for (const q of this.pointers.values()) q.moved = true;
      return;
    }
    if (!p.moved) return;
    if (p.button === 1 || (p.button === 0 && e.shiftKey) || p.button === 2) {
      // orbit
      this.yaw -= (p.x - px) * 0.008;
      this.pitch = Math.min(1.45, Math.max(0.35, this.pitch + (p.y - py) * 0.005));
      return;
    }
    // pan: keep the ground point under the pointer
    const a = this.groundHit(px, py), b = this.groundHit(p.x, p.y);
    if (a && b) {
      this.focus.x += a.x - b.x;
      this.focus.z += a.z - b.z;
    }
  }

  onPointerUp(e) {
    if (!this.active) return;
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (!p || p.moved) return;
    if (this.pointers.size > 0) return;
    const t = this.tileAt(e.clientX, e.clientY);
    if (!t) return;
    this.hover = e.pointerType === 'mouse' ? t : null;
    if (p.button === 2 || this.erase) this.removeAt(t.tx, t.tz);
    else if (p.button === 0) this.place(t.tx, t.tz);
    this.refreshPreview();
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const k = this.keys;
    const speed = this.dist * 1.2 * dt;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = -fz, rz = fx;
    let mx = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) { mx += fx; mz += fz; }
    if (k.has('KeyS') || k.has('ArrowDown')) { mx -= fx; mz -= fz; }
    if (k.has('KeyA') || k.has('ArrowLeft')) { mx += rx; mz += rz; }
    if (k.has('KeyD') || k.has('ArrowRight')) { mx -= rx; mz -= rz; }
    if (mx || mz) { this.focus.x += mx * speed; this.focus.z += mz * speed; }
    if (k.has('KeyZ')) this.yaw += dt * 1.6;
    if (k.has('KeyC')) this.yaw -= dt * 1.6;

    const targetY = this.level * LEVEL;
    this.focus.y += (targetY - this.focus.y) * (1 - Math.exp(-10 * dt));
    const cam = this.game.camera;
    const cp = Math.cos(this.pitch);
    cam.position.set(
      this.focus.x + Math.sin(this.yaw) * cp * this.dist,
      this.focus.y + Math.sin(this.pitch) * this.dist,
      this.focus.z + Math.cos(this.yaw) * cp * this.dist,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(this.focus);
    if (Math.abs(cam.fov - 55) > 0.01) { cam.fov = 55; cam.updateProjectionMatrix(); }
    const gx = Math.round(this.focus.x / TILE) * TILE + TILE / 2;
    const gz = Math.round(this.focus.z / TILE) * TILE + TILE / 2;
    this.grid.position.set(gx, Math.max(GROUND_Y + 0.03, this.level * LEVEL - 0.2), gz);
    this.levelPlane.position.set(gx, this.level * LEVEL + 0.03, gz);
    this.levelPlane.visible = this.level > 0;
  }
}

// Grid of thin quads (lines would be 1px thin on high-DPI phones).
function makeGrid(n) {
  const half = (n * TILE) / 2, w = 0.35;
  const pos = [];
  const quad = (x0, z0, x1, z1) => pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0);
  for (let i = 0; i <= n; i++) {
    const c = -half + i * TILE;
    quad(c - w, -half, c + w, half);
    quad(-half, c - w, half, c + w);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

// Renders a small picture of every piece for the palette.
function renderThumbnails() {
  const out = {};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  const W = 148, H = 112;
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(0.6, 1, 0.4);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(30, W / H, 1, 2000);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const id of PIECE_ORDER) {
    const data = pieceData(id);
    const geo = dataToGeometry(data.variant(data.fullMask));
    const mesh = new THREE.Mesh(geo, mat);
    const group = new THREE.Group();
    group.add(mesh);
    if (data.gate) {
      const gate = dataToGeometry(data.gate.frame);
      group.add(new THREE.Mesh(gate, mat));
      const banner = dataToGeometry(data.gate.banner);
      const color = id === 'start' ? 0x2ad37a : id === 'checkpoint' ? 0x22c3f0 : 0xffffff;
      group.add(new THREE.Mesh(banner, new THREE.MeshBasicMaterial({ vertexColors: true, color })));
    }
    if (data.glow) group.add(new THREE.Mesh(dataToGeometry(data.glow), new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xfff1b8 })));
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = new THREE.Vector3(-0.9, 0.85, -0.75).normalize();
    cam.position.copy(center).addScaledVector(dir, size * 1.75);
    cam.lookAt(center);
    renderer.render(scene, cam);
    out[id] = renderer.domElement.toDataURL('image/png');
    scene.remove(group);
    group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); if (o.material !== mat) o.material.dispose(); } });
  }
  mat.dispose();
  renderer.dispose();
  renderer.forceContextLoss?.();
  return out;
}
