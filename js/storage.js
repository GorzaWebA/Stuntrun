// localStorage helpers. Everything is wrapped in try/catch so the game still
// works in private browsing modes where storage may be unavailable.
const PREFIX = 'stuntrun.';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

export const DEFAULT_SETTINGS = {
  quality: 'auto',      // auto | low | medium | high
  sound: true,
  volume: 0.7,
  music: true,
  musicVolume: 0.45,
  ghost: true,
  touch: 'auto',        // auto | on | off
  camera: 0,            // index into camera presets
  carColor: 0xff5a36,
  units: 'kmh',
};

export const storage = {
  settings() { return { ...DEFAULT_SETTINGS, ...read('settings', {}) }; },
  saveSettings(s) { write('settings', s); },

  // best: {time, splits, date}
  best(trackKey) { return read(`best.${trackKey}`, null); },
  saveBest(trackKey, rec) { write(`best.${trackKey}`, rec); },

  ghost(trackKey) { return read(`ghost.${trackKey}`, null); },
  saveGhost(trackKey, ghost) {
    if (!write(`ghost.${trackKey}`, ghost)) {
      // storage full: drop other ghosts and retry once
      try {
        Object.keys(localStorage).filter((k) => k.startsWith(PREFIX + 'ghost.')).forEach((k) => localStorage.removeItem(k));
      } catch { /* ignore */ }
      write(`ghost.${trackKey}`, ghost);
    }
  },

  // custom tracks: [{id, name, code, updated}]
  customTracks() { return read('tracks', []); },
  saveCustomTracks(list) { return write('tracks', list); },

  editorDraft() { return read('draft', null); },
  saveEditorDraft(d) { write('draft', d); },
  clearEditorDraft() { remove('draft'); },
};
