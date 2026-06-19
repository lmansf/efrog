// Per-species frog facts + catalog identifiers for the observation cards.
// Picked deterministically from the species name so each species always shows
// the same fact and id.
const FROG_FACTS = [
  'America’s largest frog, the American Bullfrog’s deep "jug-o-rum" call can be heard up to a mile away during breeding season.',
  'Named for its loud, short barking call during rainy nights, the Barking Tree Frog is an excellent climber with specialized toe pads.',
  'Originally introduced to control agricultural pests, the Cane Toad secretes toxic compounds from its skin as a defense mechanism.',
  'This medium-sized frog is known for its spotted pattern and prefers wetland habitats with shallow water.',
  'With adhesive toe pads and remarkable climbing ability, the invasive Cuban Tree Frog can rapidly outcompete native Florida tree frogs.',
  'Despite its name, this toad has a small, narrow mouth designed for feeding on small invertebrates and ants.',
  'Named for the sharp, spade-like structure on its hind feet, the Eastern Spadefoot uses this tool to burrow underground.',
  'The Green Frog’s call sounds like a loose banjo string and is one of the most distinctive sounds of Florida wetlands.',
  'With bright green coloring and sticky toe pads, the Green Treefrog is Florida’s most iconic tree frog and a common garden visitor.',
  'This tiny, cryptic frog is rarely seen and reproduces without a tadpole stage, laying eggs directly in soil and leaf litter.',
  'The Little Grass Frog is Florida’s smallest frog, measuring only about one inch long.',
  'The smallest native Florida toad, Oak Toads are often found in upland pine and oak forests with a distinctive high-pitched trill.',
  'Named for its pig-like grunting and squealing calls, the Pig Frog is a primarily aquatic species common in Florida swamps.',
  'This small tree frog has a distinctive whistle-like call that sounds like its name: "pine-woods."',
  'Early spring breeders, Southern Chorus Frogs create loud choruses with their metallic, high-pitched trills.',
  'Despite the name, this is not an insect but a small, active frog that makes a clicking sound similar to crickets.',
  'Known for its long jumps and distinctive spotted pattern, the Southern Leopard Frog is common throughout Florida’s wetlands.',
  'The Southern Toad’s prominent crests and bumpy skin help distinguish it from other Florida toads and protect against predators.',
  'Named for its high-pitched, squirrel-like call, the Squirrel Tree Frog is a small, agile climber common in trees.',
];

// One fact per species, in label order, so disputes still show a sensible fact.
const FROG_FACT_BY_SPECIES = {
  'American Bullfrog':            FROG_FACTS[0],
  'Barking Tree Frog':           FROG_FACTS[1],
  'Cane Toad':                   FROG_FACTS[2],
  'Coastal Plains Leopard Frog': FROG_FACTS[3],
  'Cuban Tree Frog':             FROG_FACTS[4],
  'Eastern Narrow-mouthed Toad': FROG_FACTS[5],
  'Eastern Spadefoot':           FROG_FACTS[6],
  'Green Frog':                  FROG_FACTS[7],
  'Green Treefrog':              FROG_FACTS[8],
  'Greenhouse Frog':             FROG_FACTS[9],
  'Little Grass Frog':           FROG_FACTS[10],
  'Oak Toad':                    FROG_FACTS[11],
  'Pig Frog':                    FROG_FACTS[12],
  'Pine Woods Tree Frog':        FROG_FACTS[13],
  'Southern Chorus Frog':        FROG_FACTS[14],
  'Southern Cricket Frog':       FROG_FACTS[15],
  'Southern Leopard Frog':       FROG_FACTS[16],
  'Southern Toad':               FROG_FACTS[17],
  'Squirrel Tree Frog':          FROG_FACTS[18],
};

function _frogHash(str, seed) {
  let h = seed >>> 0;
  for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
function frogFactFor(species) {
  // Exact match on the species name first; fall back to a stable hash pick so
  // any unexpected label still gets a consistent fact.
  return FROG_FACT_BY_SPECIES[species] ?? FROG_FACTS[_frogHash(species, 7) % FROG_FACTS.length];
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
    const idx = history.findIndex(e => String(e.id) === String(id));
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
