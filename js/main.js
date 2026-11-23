// Stuntrun – game bootstrap, state machine, HUD and menus.
import * as THREE from '../vendor/three.module.min.js';
import { PHYS_DT, CAR_COLORS, COLORS, PHYSICS_VERSION } from './config.js';
import { buildTrack, disposeTrack, computeRoute, encodeTrack, decodeTrack, hashString, placeCones } from './track.js';
import { CAMPAIGN } from './tracks.js';
import { Race } from './race.js';
import { Bot } from './bot.js';
import { Scenery } from './scenery.js';
import { Fx } from './fx.js';
import { CarModel } from './carModel.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { AudioFX } from './audio.js';
import { GhostRecorder, GhostPlayer } from './ghost.js';
import { storage } from './storage.js';
import { Editor } from './editor.js';
import { placeBulbs, routeMapSvg, rosetteSvg, starsSvg } from './ui.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '-:--.---';
  const ms = Math.max(0, Math.round(t * 1000));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
const formatDelta = (d) => `${d < 0 ? '−' : '+'}${(Math.abs(d)).toFixed(3)}`;
const MEDALS = ['gold', 'silver', 'bronze'];
export function medalFor(time, medals) {
  if (time == null || !medals) return null;
  for (let i = 0; i < 3; i++) if (time <= medals[i]) return MEDALS[i];
  return null;
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const _ipos = new THREE.Vector3();
const _iquat = new THREE.Quaternion();
const _gpos = new THREE.Vector3();
const _gquat = new THREE.Quaternion();
const _up = new THREE.Vector3();

class Game {
  constructor() {
    this.canvas = $('#game');
    this.settings = storage.settings();
    this.isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.quality = this.resolveQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality >= 2, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.3, 7000);
    this.scenery = new Scenery(this.scene);
    this.fx = new Fx(this.scene);
    this.chase = new ChaseCamera(this.camera);
    this.input = new Input();
    this.audio = new AudioFX();
    this.carModel = new CarModel({ color: this.settings.carColor });
    this.ghostModel = new CarModel({ ghost: true });
    this.scene.add(this.carModel.group, this.ghostModel.group);
    this.ghostModel.group.visible = false;
    this.editor = new Editor(this);

    this.mode = 'menu';
    this.track = null;
    this.session = null;
    this.acc = 0;
    this.last = performance.now();
    this.time = 0;
    this.screen = null;
    this.overlayReturn = null;
    this.flipTimer = 0;
    this.lastMissed = 0;
    this.hudCache = {};

    this.applySettings(true);
    this.bindUI();
    this.input.bindTouch($('#touch'));
    this.input.onAction((a) => this.onAction(a));
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.session && ['racing', 'countdown'].includes(this.session.phase) && this.session.kind !== 'attract') this.pause();
    });
    // first user gesture unlocks audio (required on mobile)
    const unlock = () => { this.audio.unlock(); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    this.resize();

    if (!this.openFromHash()) this.openMenu();
    window.addEventListener('hashchange', () => this.openFromHash());
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ settings
  resolveQuality() {
    const q = this.settings.quality;
    if (q === 'low') return 0;
    if (q === 'medium') return 1;
    if (q === 'high') return 2;
    return this.isTouchDevice ? 1 : 2;
  }

  applySettings(initial = false) {
    const s = this.settings;
    const prevQuality = this.quality;
    this.quality = this.resolveQuality();
    const pr = [1, 1.5, 2][this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pr));
    this.scenery.setQuality(this.quality);
    this.fx?.setQuality(this.quality);
    if (!initial && prevQuality !== this.quality && this.track) this.scenery.buildDecor(this.track);
    this.audio.setEnabled(s.sound);
    this.audio.setVolume(s.volume);
    this.audio.setMusic(s.music, s.musicVolume);
    const touch = s.touch === 'on' || (s.touch === 'auto' && this.isTouchDevice);
    document.body.classList.toggle('touch', touch);
    this.chase.setPreset(s.camera);
    this.carModel.setColor(s.carColor);
    $('#hud-unit').textContent = s.units === 'mph' ? 'mph' : 'km/h';
    this.resize();
  }

  saveSettings() {
    storage.saveSettings(this.settings);
    this.applySettings();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.updateViewOffset();
  }

  // On the main menu the 3D view is shifted right so the demo car is not hidden by the buttons.
  updateViewOffset() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.mode === 'menu' && w > h) this.camera.setViewOffset(w, h, -w * 0.22, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ screens
  show(id) {
    $$('.screen').forEach((el) => el.classList.toggle('show', el.id === id));
    this.screen = id;
    placeAllBulbs();
  }

  showOverlay(id) {
    $(`#${id}`).classList.add('show');
  }

  hideOverlay(id) {
    $(`#${id}`).classList.remove('show');
  }

  toast(msg, ms = 2200) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), ms);
  }

  raceToast(html, ms = 1800) {
    const el = $('#race-toast');
    el.innerHTML = html;
    el.classList.add('show');
    clearTimeout(this._raceToastT);
    this._raceToastT = setTimeout(() => el.classList.remove('show'), ms);
  }

  modal({ title, text = '', input = null, readOnly = false, buttons = [] }) {
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    const ta = $('#modal-input');
    ta.style.display = input === null ? 'none' : 'block';
    ta.value = input ?? '';
    ta.readOnly = readOnly;
    const row = $('#modal-buttons');
    row.innerHTML = '';
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = `btn ${b.primary ? 'primary' : ''}`;
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        const keep = b.action ? b.action(ta.value, btn) : false;
        if (!keep) this.hideOverlay('modal');
      });
      row.appendChild(btn);
    }
    this.showOverlay('modal');
    if (input !== null && !readOnly) setTimeout(() => ta.focus(), 50);
    if (readOnly) setTimeout(() => { ta.focus(); ta.select(); }, 50);
  }

  // ------------------------------------------------------------------ track loading
  loadTrack(def) {
    if (this.track && this.track.def === def) {
      for (const cp of this.track.checkpoints) cp.setDone?.(false);
      this.resetCones();
      return this.track;
    }
    this.coneAnims = [];
    if (this.track) disposeTrack(this.track);
    this.track = buildTrack(def);
    this.scene.add(this.track.group);
    this.scenery.buildDecor(this.track);
    return this.track;
  }

  // ------------------------------------------------------------------ cones
  resetCones() {
    this.coneAnims = [];
    const t = this.track;
    if (t && t.coneMesh) placeCones(t.coneMesh, t.cones);
  }

  // a clipped cone flies off, tumbles, bounces and ends up on its side
  knockCone(index, car, speed) {
    const c = this.track?.cones[index];
    if (!c) return;
    const r = () => Math.random() - 0.5;
    this.coneAnims.push({
      index, base: c.y,
      pos: c.clone(),
      vel: car.vel.clone().multiplyScalar(0.6).add(new THREE.Vector3(r() * 4, 4 + Math.random() * 3 + speed * 0.04, r() * 4)),
      axis: new THREE.Vector3(r(), r() * 0.4, r()).normalize(),
      angle: 0, spin: 8 + Math.random() * 10, done: false,
    });
    this.audio.impact(Math.min(7, 3.5 + speed * 0.05));
  }

  updateCones(dt) {
    const mesh = this.track?.coneMesh;
    if (!mesh || !this.coneAnims?.length) return;
    for (const a of this.coneAnims) {
      if (a.done) continue;
      a.vel.y -= 18 * dt;
      a.pos.addScaledVector(a.vel, dt);
      a.angle += a.spin * dt;
      const rest = a.base + 0.45;
      if (a.pos.y < rest && a.vel.y < 0) {
        a.pos.y = rest;
        a.vel.y *= -0.3;
        a.vel.x *= 0.55; a.vel.z *= 0.55;
        a.spin *= 0.5;
        if (a.vel.length() < 1.2) {
          // lie down on its side, pointing the way it was tumbling
          a.done = true;
          a.axis.y = 0;
          if (a.axis.lengthSq() < 1e-4) a.axis.set(1, 0, 0);
          a.axis.normalize();
          a.angle = Math.PI / 2;
        }
      }
      _cq.setFromAxisAngle(a.axis, a.angle);
      _cm.compose(a.done ? _cv.set(a.pos.x, a.base + 0.5, a.pos.z) : a.pos, _cq, _cs);
      mesh.setMatrixAt(a.index, _cm);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (this.coneAnims.every((a) => a.done) && this.coneAnims.length > 40) this.coneAnims = this.coneAnims.slice(-40);
  }

  unloadTrack() {
    if (this.track) disposeTrack(this.track);
    this.track = null;
    this.fx?.clear();
  }

  // ------------------------------------------------------------------ menu / attract mode
  openMenu() {
    if (this.mode === 'editor') this.editor.exit();
    this.mode = 'menu';
    this.updateViewOffset();
    this.audio.stopEngine();
    this.audio.setPaused(false);
    this.audio.setMusicMode('menu');
    this.hideOverlay('pause');
    this.hideOverlay('finish');
    this.show('menu');
    this.ghostModel.group.visible = false;
    this.carModel.group.visible = true;
    if (!this.session || this.session.kind !== 'attract') this.startAttract();
  }

  startAttract() {
    // the menu demo lap shows off the stunt finale
    const def = CAMPAIGN.find((t) => t.id === 'grand-stunt') || CAMPAIGN[0];
    const track = this.loadTrack(def);
    const route = computeRoute(def);
    const race = new Race(track);
    race.begin();
    this.session = {
      kind: 'attract', def, race, bot: new Bot(route.points), phase: 'racing',
      prevPos: race.car.pos.clone(), prevQuat: race.car.quat.clone(), idle: 0,
    };
    this.chase.mode = 'orbit';
    this.chase.orbitAngle = 0.6;
    this.chase.snap(race.car.pos, race.car.quat);
  }

  openTrackSelect(tab = this.trackTab || 'campaign') {
    this.trackTab = tab;
    if (this.mode !== 'menu') this.openMenu();
    this.show('tracks');
    $$('#tracks .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    const list = $('#track-list');
    list.innerHTML = '';
    if (tab === 'campaign') {
      CAMPAIGN.forEach((t, i) => {
        const best = storage.best(campaignKey(t));
        const medal = medalFor(best?.time, t.medals);
        const wrap = document.createElement('div');
        wrap.className = 'ticket-wrap';
        wrap.innerHTML = `
          <button class="ticket" aria-label="Act ${i + 1}: ${escapeHtml(t.name)}">
            <span class="stub"><span class="stub-label">Act</span><span class="stub-num">${i + 1}</span></span>
            <span class="tbody">
              <span class="tname">${escapeHtml(t.name)}</span>
              <span class="trosette">${rosetteSvg(medal, { title: medal ? `${medal[0].toUpperCase()}${medal.slice(1)} medal` : 'No medal yet' })}</span>
              ${routeMapSvg(t, t.id)}
              <span class="tfoot">${starsSvg(t.difficulty)}<span>${best ? `Best ${formatTime(best.time)}` : `Gold ${formatTime(t.medals[0])}`}</span></span>
            </span>
          </button>`;
        wrap.querySelector('.ticket').addEventListener('click', () => this.startRace(t, { kind: 'campaign', index: i }));
        list.appendChild(wrap);
      });
    } else {
      const tracks = storage.customTracks();
      const shelf = document.createElement('div');
      shelf.className = 'empty-shelf';
      shelf.innerHTML = `
        <p>${tracks.length ? 'Build a new act or bring one in from a friend.' : 'You haven\'t built anything yet. Tracks you save in the editor show up here, and you can share them with a link.'}</p>
        <div class="row">
          <button class="btn primary" data-c="new"><svg class="ic"><use href="#i-edit"/></svg>Build a track</button>
          <button class="btn" data-c="import"><svg class="ic"><use href="#i-share"/></svg>Import a code</button>
        </div>`;
      shelf.querySelector('[data-c="new"]').addEventListener('click', () => this.openEditor(null));
      shelf.querySelector('[data-c="import"]').addEventListener('click', () => this.importDialog());
      list.appendChild(shelf);
      tracks.slice().sort((a, b) => b.updated - a.updated).forEach((entry) => {
        let def;
        try { def = decodeTrack(entry.code); } catch { return; }
        const key = customKey(def);
        const best = storage.best(key);
        const card = document.createElement('div');
        card.className = 'ticket-wrap';
        card.innerHTML = `
          <div class="ticket custom">
            <span class="stub"><svg class="ic"><use href="#i-edit"/></svg></span>
            <span class="tbody">
              <span class="tname">${escapeHtml(entry.name || def.name)}</span>
              ${routeMapSvg(def, `u.${entry.id}.${entry.updated}`)}
              <span class="tfoot"><span>${def.pieces.length} pieces</span><span>${best ? `Best ${formatTime(best.time)}` : 'Not driven yet'}</span></span>
              <span class="ticket-actions">
                <button class="btn primary small" data-c="play"><svg class="ic"><use href="#i-play"/></svg>Play</button>
                <button class="btn small" data-c="edit">Edit</button>
                <button class="btn small" data-c="share">Share</button>
                <button class="btn small danger" data-c="delete" aria-label="Delete track" title="Delete"><svg class="ic"><use href="#i-trash"/></svg></button>
              </span>
            </span>
          </div>`;
        card.addEventListener('click', (e) => {
          const c = e.target.closest('[data-c]')?.dataset.c;
          if (!c) return;
          if (c === 'play') this.startRace({ ...def, name: entry.name || def.name }, { kind: 'custom', entry });
          else if (c === 'edit') this.openEditor({ ...def, name: entry.name || def.name }, entry.id);
          else if (c === 'share') this.shareDialog({ ...def, name: entry.name || def.name });
          else if (c === 'delete') {
            this.modal({
              title: 'Delete this track?', text: `“${entry.name}” will be removed from this device. Links you've shared keep working.`,
              buttons: [{ label: 'Cancel' }, {
                label: 'Delete', primary: true,
                action: () => { storage.saveCustomTracks(storage.customTracks().filter((t) => t.id !== entry.id)); this.openTrackSelect('custom'); },
              }],
            });
          }
        });
        list.appendChild(card);
      });
    }
  }

  importDialog() {
    this.modal({
      title: 'Import track', text: 'Paste a track code or a share link.', input: '',
      buttons: [{ label: 'Cancel' }, {
        label: 'Import', primary: true,
        action: (value) => {
          try {
            const raw = value.trim();
            const code = raw.includes('#track=') ? raw.split('#track=')[1] : raw;
            const def = decodeTrack(code);
            this.saveCustomTrack(def);
            this.toast(`Imported “${def.name}”`);
            this.openTrackSelect('custom');
            return false;
          } catch {
            this.toast('That code is not a valid track');
            return true;
          }
        },
      }],
    });
  }

  shareDialog(def) {
    const code = encodeTrack(def);
    const url = `${location.origin}${location.pathname}#track=${code}`;
    this.modal({
      title: 'Share track', text: 'Send this link to a friend, or copy the code to import it later.', input: url, readOnly: true,
      buttons: [
        {
          label: 'Copy link', primary: true,
          action: (v, btn) => { copyText(url).then((ok) => { btn.textContent = ok ? 'Copied!' : 'Select & copy'; }); return true; },
        },
        { label: 'Copy code', action: (v, btn) => { copyText(code).then((ok) => { btn.textContent = ok ? 'Copied!' : 'Select & copy'; }); return true; } },
        { label: 'Close' },
      ],
    });
  }

  // store a custom track, returns the entry
  saveCustomTrack(def, id = null) {
    const list = storage.customTracks();
    const code = encodeTrack(def);
    let entry = id ? list.find((t) => t.id === id) : list.find((t) => t.code === code);
    if (entry) {
      entry.name = def.name;
      entry.code = code;
      entry.updated = Date.now();
    } else {
      entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: def.name, code, updated: Date.now() };
      list.push(entry);
    }
    if (!storage.saveCustomTracks(list)) this.toast('Could not save – storage is full or disabled');
    return entry;
  }

  openFromHash() {
    const h = location.hash;
    if (!h.startsWith('#track=')) return false;
    try {
      const def = decodeTrack(decodeURIComponent(h.slice(7)));
      const entry = this.saveCustomTrack(def);
      history.replaceState(null, '', location.pathname + location.search);
      this.startRace(def, { kind: 'custom', entry });
      this.toast(`Loaded shared track “${def.name}”`);
      return true;
    } catch {
      this.toast('This share link is broken');
      return false;
    }
  }

  // ------------------------------------------------------------------ racing
  startRace(def, opts) {
    this.audio.unlock();
    if (!def.pieces.some((p) => p.type === 'start')) { this.toast('This track has no start piece'); return; }
    if (!def.pieces.some((p) => p.type === 'finish')) { this.toast('This track has no finish piece'); return; }
    if (this.mode === 'editor') this.editor.exit();
    this.mode = 'race';
    this.updateViewOffset();
    this.audio.setMusicMode('race', opts.kind === 'campaign' ? (opts.index ?? 0) + 1 : parseInt(hashString(encodeTrack({ name: '', pieces: def.pieces })), 36) % 1000);
    const track = this.loadTrack(def);
    const key = opts.kind === 'campaign' ? campaignKey(def) : customKey(def);
    const race = new Race(track);
    this.session = {
      kind: opts.kind, index: opts.index, entry: opts.entry, def, key, race,
      medals: opts.kind === 'campaign' ? def.medals : null,
      best: opts.kind === 'test' ? null : storage.best(key),
      ghostData: opts.kind === 'test' ? null : storage.ghost(key),
      recorder: new GhostRecorder(),
      prevPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(),
    };
    this.carModel.group.visible = true;
    $('#pause-track').textContent = def.name;
    $('#pause-exit').textContent = opts.kind === 'test' ? 'Back to editor' : 'Quit to menu';
    this.hideOverlay('finish');
    this.hideOverlay('pause');
    this.show('hud');
    this.restart();
  }

  restart() {
    const s = this.session;
    if (!s || s.kind === 'attract') return;
    this.hideOverlay('finish');
    this.hideOverlay('pause');
    if (this.screen !== 'hud') this.show('hud');
    for (const cp of this.track.checkpoints) cp.setDone?.(false);
    this.fx.clear();
    s.race.reset();
    this.resetCones();
    s.recorder.reset();
    s.ghost = s.ghostData && this.settings.ghost ? new GhostPlayer(s.ghostData) : null;
    s.phase = 'countdown';
    s.stunt = null;
    s.airFor = 0;
    s.fallSpeed = 0;
    this.audio.setPaused(false);
    s.countdown = 2.4;
    s.lastBeat = 4;
    s.prevPos.copy(s.race.car.pos);
    s.prevQuat.copy(s.race.car.quat);
    this.acc = 0;
    this.flipTimer = 0;
    this.chase.mode = 'chase';
    this.chase.snap(s.race.car.pos, s.race.car.quat);
    this.audio.startEngine();
    this.hudCache = {};
    $('#race-toast').classList.remove('show');
    this.updateHudStatic();
  }

  // R / ↺: one press puts you back at the last checkpoint, a quick double
  // press restarts the whole run from the start.
  restartPress() {
    const s = this.session;
    if (!s || s.kind === 'attract') return;
    const now = performance.now();
    const double = now - (this._lastRestartPress || 0) < 450;
    this._lastRestartPress = now;
    if (double || s.phase !== 'racing') {
      this._lastRestartPress = 0;
      this.restart();
      return;
    }
    this.respawn();
    this.raceToast(s.race.passed.size ? 'Back to checkpoint · press again to restart' : 'Back to start · press again to restart', 1200);
  }

  respawn() {
    const s = this.session;
    if (!s || s.kind === 'attract' || s.phase !== 'racing') return;
    s.race.respawn();
    s.prevPos.copy(s.race.car.pos);
    s.prevQuat.copy(s.race.car.quat);
    this.flipTimer = 0;
    this.chase.snap(s.race.car.pos, s.race.car.quat);
  }

  pause() {
    const s = this.session;
    if (!s || s.kind === 'attract' || !['racing', 'countdown'].includes(s.phase)) return;
    s.pausedFrom = s.phase;
    s.phase = 'paused';
    this.audio.stopEngine();
    this.audio.setPaused(true);
    this.showOverlay('pause');
  }

  resume() {
    const s = this.session;
    if (!s || s.phase !== 'paused') return;
    s.phase = s.pausedFrom;
    this.hideOverlay('pause');
    this.audio.setPaused(false);
    this.audio.startEngine();
    this.last = performance.now();
  }

  exitRace() {
    const s = this.session;
    this.hideOverlay('pause');
    this.hideOverlay('finish');
    this.audio.stopEngine();
    if (s && s.kind === 'test') {
      this.session = null;
      this.openEditor(this.editor.def, this.editor.entryId, true);
      return;
    }
    this.session = null;
    this.openMenu();
    this.openTrackSelect(s && s.kind === 'custom' ? 'custom' : 'campaign');
  }

  onRaceEvent(e) {
    const s = this.session;
    if (e.type === 'checkpoint') {
      this.audio.checkpoint();
      const cp = this.track.checkpoints[e.index];
      cp.setDone?.(true);
      let html = `${e.count}/${s.race.checkpointCount} &nbsp;${formatTime(e.time)}`;
      const bestSplit = s.best?.splits?.[e.count - 1];
      if (bestSplit != null) {
        const d = e.time - bestSplit;
        html += ` <span class="${d <= 0 ? 'faster' : 'slower'}">${formatDelta(d)}</span>`;
      }
      this.raceToast(html);
    } else if (e.type === 'finish') {
      this.onFinish(e.time);
    } else if (e.type === 'missed' && this.time - this.lastMissed > 2) {
      this.lastMissed = this.time;
      this.raceToast('Missed a checkpoint!');
    }
  }

  onFinish(time) {
    const s = this.session;
    s.phase = 'finished';
    const prev = s.best;
    const isBest = !prev || time < prev.time - 1e-9;
    if (s.kind !== 'test' && isBest) {
      s.best = { time, splits: s.race.splits.slice(), date: Date.now() };
      storage.saveBest(s.key, s.best);
      s.ghostData = s.recorder.data();
      storage.saveGhost(s.key, s.ghostData);
    }
    this.audio.finish(isBest);
    this.fx.confettiBurst(s.race.car.pos, s.race.car.quat, s.race.car.vel);
    setTimeout(() => { if (this.session === s && s.phase === 'finished') this.chase.mode = 'orbit'; }, 700);
    clearTimeout(this._finishT);
    this._finishT = setTimeout(() => {
      if (this.session !== s || s.phase !== 'finished') return;
      this.showFinish(time, prev, isBest);
    }, 1100);
  }

  showFinish(time, prev, isBest) {
    const s = this.session;
    $('#finish-track').textContent = s.def.name;
    $('#finish-time').textContent = formatTime(time);
    const note = $('#finish-note');
    if (s.kind === 'test') {
      note.textContent = 'Test run complete';
      note.className = 'finish-note';
    } else if (isBest) {
      note.textContent = prev ? `New best, ${formatDelta(time - prev.time)} s` : 'First finish. Your ghost will race you next time.';
      note.className = 'finish-note good';
    } else {
      note.textContent = `${formatDelta(time - prev.time)} s off your best of ${formatTime(prev.time)}`;
      note.className = 'finish-note';
    }
    const medal = medalFor(time, s.medals);
    $('#finish-medal').innerHTML = s.medals ? rosetteSvg(medal, { title: medal ? `${medal} medal` : 'No medal', outline: 'rgba(246,234,210,0.35)' }) : '';
    $('#finish-medal').style.display = s.medals ? '' : 'none';
    const targets = $('#finish-targets');
    targets.innerHTML = s.medals
      ? s.medals.map((m, i) => `<span class="target ${time <= m ? 'hit' : ''}">${rosetteSvg(MEDALS[i])}${formatTime(m)}</span>`).join('')
      : '';
    const hasNext = s.kind === 'campaign' && s.index < CAMPAIGN.length - 1;
    $('#finish-next').style.display = hasNext ? '' : 'none';
    $('#finish-exit').textContent = s.kind === 'test' ? 'Back to editor' : 'Menu';
    this.showOverlay('finish');
  }

  // ------------------------------------------------------------------ editor
  openEditor(def, entryId = null, resume = false) {
    this.audio.stopEngine();
    this.hideOverlay('pause');
    this.hideOverlay('finish');
    this.session = null;
    this.unloadTrack();
    this.mode = 'editor';
    this.updateViewOffset();
    this.audio.setPaused(false);
    this.audio.setMusicMode('menu', 2);
    this.carModel.group.visible = false;
    this.ghostModel.group.visible = false;
    this.show('editor-ui');
    this.editor.enter(def, entryId, resume);
  }

  testTrack(def) {
    this.startRace(def, { kind: 'test' });
  }

  // ------------------------------------------------------------------ input
  onAction(a) {
    if (this.mode === 'editor') return;
    if ($('#modal').classList.contains('show') || $('#settings').classList.contains('show')) return;
    const s = this.session;
    if (!s || s.kind === 'attract') return;
    if (a === 'restart') this.restartPress();
    else if (a === 'respawn') this.respawn();
    else if (a === 'pause') { if (s.phase === 'paused') this.resume(); else this.pause(); }
    else if (a === 'camera') {
      this.settings.camera = (this.settings.camera + 1) % 3;
      this.saveSettings();
    }
  }

  bindUI() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      this.audio.unlock();
      const a = el.dataset.action;
      switch (a) {
        case 'play': this.openTrackSelect(); break;
        case 'editor': this.openEditor(storage.editorDraft()?.def || null, storage.editorDraft()?.entryId || null); break;
        case 'settings': this.openSettings(); break;
        case 'close-settings': this.hideOverlay('settings'); break;
        case 'fullscreen': toggleFullscreen(); break;
        case 'back': this.openMenu(); break;
        case 'resume': this.resume(); break;
        case 'restart': case 'retry': this.restart(); break;
        case 'respawn': this.respawn(); break;
        case 'quick-restart': this.restartPress(); break;
        case 'pause': this.pause(); break;
        case 'exit': this.exitRace(); break;
        case 'next': {
          const i = (this.session?.index ?? -1) + 1;
          if (CAMPAIGN[i]) this.startRace(CAMPAIGN[i], { kind: 'campaign', index: i });
          break;
        }
        default: break;
      }
    });
    $$('#tracks .tab').forEach((t) => t.addEventListener('click', () => this.openTrackSelect(t.dataset.tab)));

    // settings controls
    $$('#settings .seg').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const key = seg.dataset.setting;
        let v = b.dataset.value;
        if (v === 'true' || v === 'false') v = v === 'true';
        else if (key === 'camera') v = Number(v);
        this.settings[key] = v;
        this.saveSettings();
        this.refreshSettingsUI();
        if (key === 'ghost' && this.session && this.session.kind !== 'attract') {
          this.session.ghost = v && this.session.ghostData ? new GhostPlayer(this.session.ghostData) : null;
        }
      });
    });
    $('#volume').addEventListener('input', (e) => {
      this.settings.volume = Number(e.target.value);
      this.saveSettings();
    });
    $('#music-volume').addEventListener('input', (e) => {
      this.settings.musicVolume = Number(e.target.value);
      this.saveSettings();
    });
    const sw = $('#swatches');
    CAR_COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = `#${c.toString(16).padStart(6, '0')}`;
      b.dataset.color = c;
      b.setAttribute('aria-label', `Car colour #${c.toString(16).padStart(6, '0')}`);
      b.addEventListener('click', () => { this.settings.carColor = c; this.saveSettings(); this.refreshSettingsUI(); });
      sw.appendChild(b);
    });
    $('#settings').addEventListener('click', (e) => { if (e.target.id === 'settings') this.hideOverlay('settings'); });
  }

  openSettings() {
    this.refreshSettingsUI();
    this.showOverlay('settings');
  }

  refreshSettingsUI() {
    $$('#settings .seg').forEach((seg) => {
      const key = seg.dataset.setting;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', String(this.settings[key]) === b.dataset.value));
    });
    $('#volume').value = this.settings.volume;
    $('#music-volume').value = this.settings.musicVolume;
    $$('.swatch').forEach((b) => b.classList.toggle('active', Number(b.dataset.color) === this.settings.carColor));
  }

  // ------------------------------------------------------------------ HUD
  updateHudStatic() {
    const s = this.session;
    const n = s.race.checkpointCount;
    $('#hud-cp .flags').innerHTML = n <= 8 ? '<svg class="ic"><use href="#i-flag"/></svg>'.repeat(n) : '';
    $('#hud-cp').style.display = n ? '' : 'none';
    const lights = $('#countdown');
    lights.classList.toggle('show', false);
    lights.classList.toggle('go', false);
    lights.querySelectorAll('.lamp').forEach((l) => l.classList.toggle('on', false));
    let sub = '';
    if (s.best) sub = `PB ${formatTime(s.best.time)}`;
    else if (s.medals) sub = `Gold ${formatTime(s.medals[0])}`;
    $('#hud-sub').textContent = sub;
  }

  setText(id, text) {
    if (this.hudCache[id] === text) return;
    this.hudCache[id] = text;
    document.getElementById(id).textContent = text;
  }

  updateHud() {
    const s = this.session;
    const race = s.race;
    this.setText('hud-time', formatTime(race.time));
    const n = race.checkpointCount;
    const cpText = `${race.passed.size}/${n}`;
    if (this.hudCache.cp !== cpText) {
      this.hudCache.cp = cpText;
      $('#hud-cp .count').textContent = cpText;
      $$('#hud-cp .flags .ic').forEach((f, i) => f.classList.toggle('on', i < race.passed.size));
    }
    const v = Math.abs(race.car.fwdSpeed) * (this.settings.units === 'mph' ? 2.23694 : 3.6);
    this.setText('hud-speed', String(Math.round(v)));
    // countdown
    const lights = $('#countdown');
    if (s.phase === 'countdown') {
      const beat = Math.ceil(s.countdown / 0.8);
      if (beat !== s.lastBeat && beat <= 3 && beat >= 1) {
        s.lastBeat = beat;
        lights.classList.toggle('show', true);
        lights.querySelectorAll('.lamp').forEach((l, i) => l.classList.toggle('on', i < 4 - beat));
        this.audio.countdown(false);
      }
    }
  }

  stuntCallout(text) {
    const el = $('#stunt');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    this.audio.stunt();
  }

  // Detects big air, wall rides and upside-down driving (uses _up of the car).
  updateStunts(s, car, dt) {
    const st = s.stunt || (s.stunt = { air: 0, inv: 0, wall: 0, invShown: false, wallShown: false });
    const onTrack = car.grounded >= 2;
    st.air = Math.max(st.air, car.airTime);
    if (onTrack && st.air > 0) {
      if (st.air > 1.1) this.stuntCallout(`Big air ${st.air.toFixed(1)} s`);
      st.air = 0;
    }
    if (onTrack && _up.y < -0.6) {
      st.inv += dt;
      if (st.inv > 0.35 && !st.invShown) { st.invShown = true; this.stuntCallout('Upside down!'); }
    } else if (_up.y > 0.3) { st.inv = 0; st.invShown = false; }
    if (onTrack && Math.abs(_up.y) < 0.35) {
      st.wall += dt;
      if (st.wall > 0.45 && !st.wallShown && !st.invShown) { st.wallShown = true; this.stuntCallout('Wall ride!'); }
    } else if (_up.y > 0.7) { st.wall = 0; st.wallShown = false; }
  }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    if (this.mode === 'editor') {
      this.editor.update(dt);
      this.scenery.update(dt, this.editor.focus, this.camera);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const s = this.session;
    if (s) this.updateSession(s, dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateSession(s, dt) {
    const race = s.race;
    const car = race.car;
    const attract = s.kind === 'attract';
    if (s.phase === 'paused') return;
    if (s.phase === 'countdown') {
      s.countdown -= dt;
      if (s.countdown <= 0) {
        s.phase = 'racing';
        race.begin();
        const lights = $('#countdown');
        lights.classList.toggle('show', true);
        lights.classList.toggle('go', true);
        this.audio.countdown(true);
        s.lightsUp = true;
      }
    }
    const input = attract ? null : this.input.state();
    this.acc += dt;
    let steps = 0;
    while (this.acc >= PHYS_DT && steps < 16) {
      s.prevPos.copy(car.pos);
      s.prevQuat.copy(car.quat);
      const inp = attract ? s.bot.update(car) : input;
      const events = race.step(inp);
      for (const e of events) if (e.type === 'cone') this.knockCone(e.index, car, e.speed);
      if (!attract) {
        for (const e of events) this.onRaceEvent(e);
        if (race.state === 'racing') s.recorder.record(race.time, car.pos, car.quat);
      } else if (events.some((e) => e.type === 'finish')) {
        s.finishedAt = this.time;
      }
      this.acc -= PHYS_DT;
      steps++;
    }
    if (steps >= 16) this.acc = 0;
    if (s.lightsUp && race.time > 0.9) {
      s.lightsUp = false;
      $('#countdown').classList.toggle('show', false);
    }
    const alpha = this.acc / PHYS_DT;
    _ipos.lerpVectors(s.prevPos, car.pos, alpha);
    _iquat.slerpQuaternions(s.prevQuat, car.quat, alpha);
    this.carModel.update(car, _ipos, _iquat, this.time);

    if (attract) {
      // restart the demo lap when finished or stuck
      if (car.speed < 1) s.idle += dt; else s.idle = 0;
      if ((s.finishedAt && this.time - s.finishedAt > 2.5) || s.idle > 3 || (s.bot.offTrack > 25 && car.grounded > 0)) {
        race.reset();
        race.begin();
        this.resetCones();
        s.bot.reset();
        s.finishedAt = null;
        s.idle = 0;
        s.prevPos.copy(car.pos);
        s.prevQuat.copy(car.quat);
      }
      this.fx.emitCar(car, dt);
      this.fx.update(dt);
      this.updateCones(dt);
      this.chase.update(dt, car, _ipos, _iquat);
      this.scenery.update(dt, _ipos, this.camera);
      return;
    }

    // ghost
    const g = s.ghost;
    if (g && g.valid && race.state !== 'ready') {
      const t = race.time + (race.state === 'racing' ? alpha * PHYS_DT : 0);
      const alive = g.sample(t, _gpos, _gquat);
      this.ghostModel.setPose(_gpos, _gquat);
      this.ghostModel.group.visible = alive || race.state === 'finished';
    } else {
      this.ghostModel.group.visible = !!(g && g.valid && race.state === 'ready');
      if (this.ghostModel.group.visible) {
        g.sample(0, _gpos, _gquat);
        this.ghostModel.setPose(_gpos, _gquat);
      }
    }

    // feedback
    if (car.impact > 4) {
      this.audio.impact(car.impact);
      this.chase.shake = Math.min(0.5, car.impact * 0.04);
      if (car.impact > 6) this.fx.sparksAt(car.impactPoint, car.impactNormal, car.vel, car.impact);
    }
    this.fx.emitCar(car, dt);
    this.fx.update(dt);
    this.updateCones(dt);
    if (car.boostTouched && !s.wasBoosting) this.audio.boost();
    s.wasBoosting = car.boostTouched;
    const inp = input || { throttle: 0, brake: 0 };
    let sliding = 0;
    for (const w of car.wheels) if (w.contact && w.sliding) sliding++;
    this.audio.updateEngine({
      speed: car.speed,
      throttle: s.phase === 'racing' || s.phase === 'countdown' ? inp.throttle : 0,
      brake: inp.brake,
      slip: car.slip,
      sliding,
      grounded: car.grounded,
      boosting: car.boostTimer > 0,
      onGrass: car.onGrass,
      airborne: car.grounded === 0,
    }, dt);
    // landing thud after a jump
    if (car.grounded === 0) {
      s.airFor = (s.airFor || 0) + dt;
      s.fallSpeed = Math.max(s.fallSpeed || 0, -car.vel.y);
    } else if (car.grounded >= 2) {
      if ((s.airFor || 0) > 0.35) {
        this.audio.land(s.fallSpeed || 0);
        if ((s.fallSpeed || 0) > 5) this.fx.landing(car, s.fallSpeed);
      }
      s.airFor = 0;
      s.fallSpeed = 0;
    }

    // stunt callouts
    _up.set(0, 1, 0).applyQuaternion(car.quat);
    if (s.phase === 'racing') this.updateStunts(s, car, dt);

    // stuck / upside down hint
    const stuck = s.phase === 'racing' && car.speed < 3 && (car.grounded < 2 || _up.y < 0.25);
    this.flipTimer = stuck ? this.flipTimer + dt : 0;
    $('#flip-hint').classList.toggle('show', this.flipTimer > 1.5);

    this.chase.update(dt, car, _ipos, _iquat);
    this.scenery.update(dt, _ipos, this.camera);
    this.updateHud();
  }
}

// Best times and ghosts belong to one layout: when a campaign track is
// rebuilt its key changes, so old ghosts never drive through thin air.
const _cq = new THREE.Quaternion(), _cm = new THREE.Matrix4(), _cv = new THREE.Vector3(), _cs = new THREE.Vector3(1, 1, 1);

function campaignKey(t) {
  return `c${PHYSICS_VERSION}.${t.id}.${hashString(t.script)}`;
}

function customKey(def) {
  return `u${PHYSICS_VERSION}.${hashString(encodeTrack({ name: '', pieces: def.pieces }))}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    return;
  }
  const el = d.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  Promise.resolve(req.call(el, { navigationUI: 'hide' }))
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => {});
}

// Marquee signs get their bulbs once they are visible (and again when fonts or
// the window size change their size).
function placeAllBulbs() {
  document.querySelectorAll('.marquee').forEach((m) => { if (m.offsetParent !== null) placeBulbs(m); });
}
let bulbTimer = 0;
window.addEventListener('resize', () => { clearTimeout(bulbTimer); bulbTimer = setTimeout(placeAllBulbs, 120); });
document.fonts?.ready.then(placeAllBulbs);

function boot() {
  placeAllBulbs();
  const test = document.createElement('canvas');
  const gl = test.getContext('webgl2') || test.getContext('webgl');
  if (!gl) {
    document.querySelector('.loading-text').textContent = 'Your browser can\'t run WebGL, which Stuntrun needs. Try an up-to-date Chrome, Firefox or Safari.';
    return;
  }
  try {
    window.game = new Game();
  } catch (err) {
    console.error(err);
    document.querySelector('.loading-text').textContent = 'Something went wrong while starting the game.';
  }
}

boot();
