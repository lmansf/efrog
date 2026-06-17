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
