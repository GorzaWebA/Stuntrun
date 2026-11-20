// Keyboard, touch and gamepad input merged into one driving state.
const KEYMAP = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  gas: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS', 'Space'],
};

const ACTION_KEYS = {
  KeyR: 'restart',
  Enter: 'respawn',
  Backspace: 'respawn',
  Escape: 'pause',
  KeyP: 'pause',
  KeyC: 'camera',
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, gas: false, brake: false };
    this.pointers = new Map();
    this.listeners = [];
    this.enabled = true;
    this.padPrev = [];
    this.padState = { steer: 0, throttle: 0, brake: 0 };
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this._clearTouch(); });
  }

  onAction(fn) { this.listeners.push(fn); }
  _emit(a) { for (const fn of this.listeners) fn(a); }

  _key(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (down) {
      if (!e.repeat && ACTION_KEYS[e.code]) this._emit(ACTION_KEYS[e.code]);
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace'].includes(e.code)) e.preventDefault();
  }

  _clearTouch() {
    this.pointers.clear();
    for (const k of Object.keys(this.touch)) this.touch[k] = false;
    this._refreshTouchVisual();
  }

  // Touch controls: every [data-control] element inside `root` acts as a held
  // button. Fingers can slide between buttons.
  bindTouch(root) {
    this.touchRoot = root;
    const hit = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const c = el && el.closest && el.closest('[data-control]');
      return c && root.contains(c) ? c.dataset.control : null;
    };
    const update = () => {
      for (const k of Object.keys(this.touch)) this.touch[k] = false;
      for (const c of this.pointers.values()) if (c) this.touch[c] = true;
      this._refreshTouchVisual();
    };
    root.addEventListener('pointerdown', (e) => {
      const c = hit(e.clientX, e.clientY);
      if (!c) return;
      e.preventDefault();
      try { root.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.pointers.set(e.pointerId, c);
      update();
    });
    root.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      e.preventDefault();
      this.pointers.set(e.pointerId, hit(e.clientX, e.clientY));
      update();
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      update();
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('lostpointercapture', end);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _refreshTouchVisual() {
    if (!this.touchRoot) return;
    this.touchRoot.querySelectorAll('[data-control]').forEach((el) => {
      el.classList.toggle('held', !!this.touch[el.dataset.control]);
    });
  }

  _pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    const st = this.padState;
    st.steer = 0; st.throttle = 0; st.brake = 0;
    if (!pad) return;
    const b = (i) => (pad.buttons[i] ? pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0) : 0);
    let ax = pad.axes[0] || 0;
    if (Math.abs(ax) < 0.15) ax = 0;
    st.steer = ax + (b(15) - b(14));
    st.throttle = Math.max(b(7), b(0));
    st.brake = Math.max(b(6), b(1), b(2));
    const pressed = pad.buttons.map((x) => x.pressed);
    const edge = (i) => pressed[i] && !this.padPrev[i];
    if (edge(3)) this._emit('respawn');
    if (edge(8)) this._emit('restart');
    if (edge(9)) this._emit('pause');
    if (edge(4) || edge(5)) this._emit('camera');
    this.padPrev = pressed;
  }

  state() {
    this._pollGamepad();
    const k = (name) => KEYMAP[name].some((c) => this.keys.has(c));
    const t = this.touch;
    const left = k('left') || t.left;
    const right = k('right') || t.right;
    let steer = (right ? 1 : 0) - (left ? 1 : 0);
    if (this.padState.steer !== 0) steer = this.padState.steer;
    const throttle = Math.max(k('gas') || t.gas ? 1 : 0, this.padState.throttle);
    const brake = Math.max(k('brake') || t.brake ? 1 : 0, this.padState.brake);
    if (!this.enabled) return { steer: 0, throttle: 0, brake: 0 };
    return { steer: Math.max(-1, Math.min(1, steer)), throttle, brake };
  }

  anyDriveInput() {
    const s = this.state();
    return s.throttle > 0 || s.brake > 0 || s.steer !== 0;
  }
}
