const Store = {
  HISTORY_KEY:  'efrog_history',
  FEEDBACK_KEY: 'efrog_feedback_mode',

  getHistory() {
    try { return JSON.parse(localStorage.getItem(this.HISTORY_KEY) || '[]'); }
    catch { return []; }
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
