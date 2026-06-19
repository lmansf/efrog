// Placeholder frog facts + catalog identifiers for the observation cards.
// Picked deterministically from the species name so each species always shows
// the same fact and id. Swap for per-species data when real content lands.
const FROG_FACTS = [
  'Frogs absorb water through their skin — they never drink with their mouths.',
  'A frog’s call is unique to its species; no two sound alike.',
  'Many frogs can leap over 20 times their own body length.',
  'Frogs were among the first land animals to evolve vocal cords.',
  'Tree frogs have sticky toe pads that grip almost any surface.',
  'A group of frogs is called an army.',
  'Some frogs can survive being partially frozen through winter.',
  'Frogs often shed their skin weekly — and then eat it.',
  'A frog’s eyes help it swallow by pushing food down its throat.',
  'Florida is home to dozens of native frog and toad species.',
  'Choruses of frogs are loudest near water at dusk and after rain.',
  'Frogs breathe through both their lungs and their skin.',
];

function _frogHash(str, seed) {
  let h = seed >>> 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
function frogFactFor(species) {
  return FROG_FACTS[_frogHash(species, 7) % FROG_FACTS.length];
}
function frogCatalogId(species) {
  const n = (_frogHash(species, 131) % 199) + 1;
  return 'EF-' + String(n).padStart(3, '0');
}
window.frogFactFor   = frogFactFor;
window.frogCatalogId = frogCatalogId;

const Store = {
  HISTORY_KEY:  'efrog_history',
  FEEDBACK_KEY: 'efrog_feedback_mode',
  SESSION_KEY:  'efrog_session_start',

  getHistory() {
    try { return JSON.parse(localStorage.getItem(this.HISTORY_KEY) || '[]'); }
    catch { return []; }
  },

  // Marks the start of this browsing session. sessionStorage is per-tab and is
  // cleared when the tab/app is closed, so "current session" means everything
  // observed since the app was last opened.
  getSessionStart() {
    let v = sessionStorage.getItem(this.SESSION_KEY);
    if (!v) { v = new Date().toISOString(); sessionStorage.setItem(this.SESSION_KEY, v); }
    return v;
  },

  addEntry(entry) {
    const history = this.getHistory();
    const record = { id: Date.now(), timestamp: new Date().toISOString(), ...entry };
    history.unshift(record);
    localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
    return record;
  },

  updateEntry(id, updates) {
    const history = this.getHistory();
    const idx = history.findIndex(e => e.id === id);
    if (idx !== -1) {
      history[idx] = { ...history[idx], ...updates };
      localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
    }
  },

  removeEntry(id) {
    const history = this.getHistory().filter(e => String(e.id) !== String(id));
    localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
  },

  // Merge in entries that aren't already present (by id), then sort newest-first.
  // Used to surface a signed-in user's remote observations. Returns how many were
  // added so callers can decide whether to re-render.
  importEntries(entries) {
    const history = this.getHistory();
    const have = new Set(history.map(e => String(e.id)));
    let added = 0;
    for (const e of entries) {
      if (!e || e.id == null || have.has(String(e.id))) continue;
      history.push(e);
      have.add(String(e.id));
      added++;
    }
    if (added) {
      history.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      localStorage.setItem(this.HISTORY_KEY, JSON.stringify(history));
    }
    return added;
  },

  clearHistory() {
    localStorage.removeItem(this.HISTORY_KEY);
  },

  getFeedbackMode() {
    const val = localStorage.getItem(this.FEEDBACK_KEY);
    return val === null ? true : val === 'true';
  },

  setFeedbackMode(val) {
    localStorage.setItem(this.FEEDBACK_KEY, String(val));
  },
};
