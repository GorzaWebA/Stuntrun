// Stuntrun – game bootstrap, state machine, HUD and menus.
import * as THREE from '../vendor/three.module.min.js';
import { PHYS_DT, CAR_COLORS, COLORS } from './config.js';
import { buildTrack, disposeTrack, computeRoute, encodeTrack, decodeTrack, hashString } from './track.js';
import { CAMPAIGN } from './tracks.js';
import { Race } from './race.js';
import { Bot } from './bot.js';
import { Scenery } from './scenery.js';
import { CarModel } from './carModel.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { AudioFX } from './audio.js';
import { GhostRecorder, GhostPlayer } from './ghost.js';
import { storage } from './storage.js';
import { Editor } from './editor.js';

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
    if (!initial && prevQuality !== this.quality && this.track) this.scenery.buildDecor(this.track);
    this.audio.setEnabled(s.sound);
    this.audio.setVolume(s.volume);
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
      for (const cp of this.track.checkpoints) cp.banner?.material.color.set(COLORS.checkpoint);
      return this.track;
    }
    if (this.track) disposeTrack(this.track);
    this.track = buildTrack(def);
    this.scene.add(this.track.group);
    this.scenery.buildDecor(this.track);
    return this.track;
  }

  unloadTrack() {
    if (this.track) disposeTrack(this.track);
    this.track = null;
  }

  // ------------------------------------------------------------------ menu / attract mode
  openMenu() {
    if (this.mode === 'editor') this.editor.exit();
    this.mode = 'menu';
    this.updateViewOffset();
    this.audio.stopEngine();
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
        const best = storage.best(`c.${t.id}`);
        const medal = medalFor(best?.time, t.medals) || 'none';
        const card = document.createElement('button');
        card.className = 'track-card';
        card.innerHTML = `
          <span class="num">TRACK ${String(i + 1).padStart(2, '0')}</span>
          <span class="name">${escapeHtml(t.name)}</span>
          <span class="medal ${medal}" title="${medal === 'none' ? 'No medal yet' : medal + ' medal'}"></span>
          <span class="meta">
            <span class="dots" title="Difficulty ${t.difficulty}/5">${[1, 2, 3, 4, 5].map((d) => `<i class="${d <= t.difficulty ? 'on' : ''}"></i>`).join('')}</span>
            <span>${best ? `Best <span class="best">${formatTime(best.time)}</span>` : `Gold ${formatTime(t.medals[0])}`}</span>
          </span>`;
        card.addEventListener('click', () => this.startRace(t, { kind: 'campaign', index: i }));
        list.appendChild(card);
      });
    } else {
      const tracks = storage.customTracks();
      const add = document.createElement('button');
      add.className = 'track-card add';
      add.textContent = '+ New track';
      add.addEventListener('click', () => this.openEditor(null));
      list.appendChild(add);
      const imp = document.createElement('button');
      imp.className = 'track-card add';
      imp.textContent = 'Import track code';
      imp.addEventListener('click', () => this.importDialog());
      list.appendChild(imp);
      if (!tracks.length) {
        const p = document.createElement('p');
        p.className = 'empty-note';
        p.textContent = 'Tracks you build in the editor are saved here. Share them with a link or a code.';
        list.appendChild(p);
      }
      tracks.slice().sort((a, b) => b.updated - a.updated).forEach((entry) => {
        let def;
        try { def = decodeTrack(entry.code); } catch { return; }
        const key = customKey(def);
        const best = storage.best(key);
        const card = document.createElement('div');
        card.className = 'track-card';
        card.tabIndex = 0;
        card.innerHTML = `
          <span class="num">MY TRACK</span>
          <span class="name">${escapeHtml(entry.name || def.name)}</span>
          <span class="meta"><span>${def.pieces.length} pieces</span>${best ? `<span>Best <span class="best">${formatTime(best.time)}</span></span>` : ''}</span>
          <span class="card-actions">
            <button class="btn primary compact" data-c="play">Play</button>
            <button class="btn" data-c="edit">Edit</button>
            <button class="btn" data-c="share">Share</button>
            <button class="btn ghost" data-c="delete" aria-label="Delete">✕</button>
          </span>`;
        card.addEventListener('click', (e) => {
          const c = e.target.closest('[data-c]')?.dataset.c || 'play';
          if (c === 'play') this.startRace({ ...def, name: entry.name || def.name }, { kind: 'custom', entry });
          else if (c === 'edit') this.openEditor({ ...def, name: entry.name || def.name }, entry.id);
          else if (c === 'share') this.shareDialog({ ...def, name: entry.name || def.name });
          else if (c === 'delete') {
            this.modal({
              title: 'Delete track?', text: `“${entry.name}” will be removed from this device.`,
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
    const track = this.loadTrack(def);
    const key = opts.kind === 'campaign' ? `c.${def.id}` : customKey(def);
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
    for (const cp of this.track.checkpoints) cp.banner?.material.color.set(COLORS.checkpoint);
    s.race.reset();
    s.recorder.reset();
    s.ghost = s.ghostData && this.settings.ghost ? new GhostPlayer(s.ghostData) : null;
    s.phase = 'countdown';
    s.stunt = null;
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
    this.showOverlay('pause');
  }

  resume() {
    const s = this.session;
    if (!s || s.phase !== 'paused') return;
    s.phase = s.pausedFrom;
    this.hideOverlay('pause');
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
      cp.banner?.material.color.set(COLORS.checkpointDone);
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
      note.textContent = prev ? `New personal best! ${formatDelta(time - prev.time)}` : 'First finish – ghost saved!';
      note.className = 'finish-note good';
    } else {
      note.textContent = `${formatDelta(time - prev.time)} from your best (${formatTime(prev.time)})`;
      note.className = 'finish-note';
    }
    const badge = $('#finish-medal');
    const medal = medalFor(time, s.medals);
    badge.className = `medal-badge ${medal ? `show ${medal}` : ''}`;
    badge.textContent = medal ? `${medal} medal` : '';
    const targets = $('#finish-targets');
    targets.innerHTML = s.medals
      ? s.medals.map((m, i) => `<span class="target ${time <= m ? 'hit' : ''}"><i class="medal ${MEDALS[i]}"></i>${formatTime(m)}</span>`).join('')
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
    if (a === 'restart') this.restart();
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
    $$('.swatch').forEach((b) => b.classList.toggle('active', Number(b.dataset.color) === this.settings.carColor));
  }

  // ------------------------------------------------------------------ HUD
  updateHudStatic() {
    const s = this.session;
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
      $('#hud-cp span').textContent = cpText;
      $('#hud-cp').classList.toggle('done', race.passed.size >= n);
    }
    const v = Math.abs(race.car.fwdSpeed) * (this.settings.units === 'mph' ? 2.23694 : 3.6);
    this.setText('hud-speed', String(Math.round(v)));
    // countdown
    const cd = $('#countdown');
    if (s.phase === 'countdown') {
      const beat = Math.ceil(s.countdown / 0.8);
      if (beat !== s.lastBeat && beat <= 3 && beat >= 1) {
        s.lastBeat = beat;
        cd.textContent = String(beat);
        cd.className = '';
        void cd.offsetWidth;
        cd.className = 'pop';
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
      if (st.air > 1.1) this.stuntCallout(`Big air ${st.air.toFixed(1)}s`);
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
        const cd = $('#countdown');
        cd.textContent = 'GO!';
        cd.className = 'go pop';
        this.audio.countdown(true);
        setTimeout(() => { if (cd.textContent === 'GO!') cd.textContent = ''; }, 700);
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
        s.bot.reset();
        s.finishedAt = null;
        s.idle = 0;
        s.prevPos.copy(car.pos);
        s.prevQuat.copy(car.quat);
      }
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
    }
    if (car.boostTouched && !s.wasBoosting) this.audio.boost();
    s.wasBoosting = car.boostTouched;
    const inp = input || { throttle: 0 };
    this.audio.updateEngine(car.speed, s.phase === 'racing' ? inp.throttle : 0, car.slip, car.grounded, car.boostTimer > 0);

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

function customKey(def) {
  return `u.${hashString(encodeTrack({ name: '', pieces: def.pieces }))}`;
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

function boot() {
  const test = document.createElement('canvas');
  const gl = test.getContext('webgl2') || test.getContext('webgl');
  if (!gl) {
    document.querySelector('.loading-text').textContent = 'Sorry – your browser does not support WebGL.';
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
