// DuckDB-WASM — browser-local, in-memory session storage.
// Anonymous: ephemeral (lost on close).
// Signed-in: sync() pushes unsynced rows to Databricks via Flask, then pulls remote history.
// window.DB is set synchronously; the multi-MB DuckDB-WASM bundle is only
// downloaded on first use, never on the page-load critical path. A failed
// init (e.g. offline) is retried on the next call.

let _conn        = null;
let _initPromise = null;

function _init() {
  if (!_initPromise) {
    _initPromise = (async () => {
      const duckdb = await import('https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm');
      const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());

      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
      );
      const worker = new Worker(workerUrl);
      URL.revokeObjectURL(workerUrl);

      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      _conn = await db.connect();

      // created_at stored as ISO string — avoids Arrow BigInt serialization issues
      await _conn.query(`
        CREATE TABLE IF NOT EXISTS observations (
          id            VARCHAR PRIMARY KEY,
          created_at    VARCHAR,
          type          VARCHAR,
          name          VARCHAR,
          duration      DOUBLE,
          species       VARCHAR,
          confidence    DOUBLE,
          probabilities VARCHAR
        )
      `);

      await _conn.query(`
        CREATE TABLE IF NOT EXISTS feedback (
          id              VARCHAR PRIMARY KEY,
          observation_id  VARCHAR,
          created_at      VARCHAR,
          user_id         VARCHAR,
          contact_id      VARCHAR,
          name            VARCHAR,
          accuracy_rating INTEGER,
          site_rating     INTEGER,
          frogwatch       VARCHAR,
          note            VARCHAR,
          species         VARCHAR,
          confidence      DOUBLE,
          user_agent      VARCHAR,
          make_public     BOOLEAN DEFAULT false,
          synced          BOOLEAN DEFAULT false
        )
      `);

      await _conn.query(`
        CREATE TABLE IF NOT EXISTS contacts (
          id         VARCHAR PRIMARY KEY,
          email      VARCHAR,
          username   VARCHAR,
          updated_at VARCHAR
        )
      `);
    })().catch(err => {
      console.warn('[DB] DuckDB-WASM failed to initialize:', err.message);
      _initPromise = null;   // allow a retry on the next call
      throw err;
    });
  }
  return _initPromise;
}

async function _guard() {
  try {
    await _init();
    return true;
  } catch {
    return false;
  }
}

// ── Direct Supabase writes ──────────────────────────────────────────────────
// Feedback and contacts go straight from the browser to Supabase's REST API
// (PostgREST), guarded by Row-Level-Security insert policies — no server, so it
// works for anonymous visitors and even when the Render box is asleep.

function _sbReady() {
  const url = window.SUPABASE_URL, key = window.SUPABASE_ANON_KEY;
  return Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_'));
}

async function _sbInsert(table, row, { merge = false } = {}) {
  if (!_sbReady()) {
    throw new Error('Supabase is not configured — set SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js');
  }
  const prefer = merge
    ? 'resolution=merge-duplicates,return=minimal'
    : 'return=minimal';
  const res = await fetch(`${window.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey':        window.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        prefer,
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Supabase ${table} insert failed (${res.status}) ${detail.slice(0, 200)}`);
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function insertObservation({ id, created_at, type, name, duration, species, confidence, probabilities }) {
  if (!await _guard()) return;
  const stmt = await _conn.prepare(
    `INSERT INTO observations (id, created_at, type, name, duration, species, confidence, probabilities)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
  );
  await stmt.query(
    String(id),
    created_at ?? new Date().toISOString(),
    type, name,
    duration != null ? Number(duration) : null,
    species,
    Number(confidence),
    typeof probabilities === 'string' ? probabilities : JSON.stringify(probabilities),
  );
  await stmt.close();
}

async function getUnsyncedFeedback() {
  if (!await _guard()) return [];
  const tbl = await _conn.query('SELECT * FROM feedback WHERE synced = false ORDER BY created_at');
  return tbl.toArray().map(r => ({
    id:             r.id,
    observation_id: r.observation_id,
    created_at:     r.created_at,
    user_id:        r.user_id,
    name:           r.name,
    accuracy_rating: r.accuracy_rating,
    site_rating:    r.site_rating,
    frogwatch:      r.frogwatch,
    note:           r.note,
    species:        r.species,
    confidence:     r.confidence,
    user_agent:     r.user_agent,
    contact_id:     r.contact_id,
    make_public:    r.make_public,
  }));
}

async function markFeedbackSynced(ids) {
  if (!await _guard()) return;
  for (const id of ids) {
    const stmt = await _conn.prepare('UPDATE feedback SET synced = true WHERE id = ?');
    await stmt.query(id);
    await stmt.close();
  }
}

async function getAllContacts() {
  if (!await _guard()) return [];
  const tbl = await _conn.query('SELECT * FROM contacts');
  return tbl.toArray().map(r => ({
    id:         r.id,
    email:      r.email,
    username:   r.username,
    updated_at: r.updated_at,
  }));
}

async function upsertContact({ id, email, username }) {
  if (!await _guard()) return;
  const stmt = await _conn.prepare(
    `INSERT INTO contacts (id, email, username, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       email = excluded.email,
       username = excluded.username,
       updated_at = excluded.updated_at`
  );
  await stmt.query(
    String(id),
    email    ?? '',
    username ?? '',
    new Date().toISOString(),
  );
  await stmt.close();
}

// ── Contact ID ───────────────────────────────────────────────────────────────
// A stable UUID generated on first visit and persisted in localStorage.
// Anonymous users get one automatically; logged-in users have their email/
// username attached to it via upsertContact on sign-in.

function _getOrCreateContactId() {
  const key = 'efrog_contact_id';
  let id = localStorage.getItem(key);
  const isNew = !id;
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return { id, isNew };
}

// ── Public API ────────────────────────────────────────────────────────────────

window.DB = {
  async insertObservation(data) {
    return insertObservation(data);
  },

  async insertFeedback({ observationId, userId, contactId, name, accuracyRating, siteRating, frogwatch, note, species, confidence, userAgent, makePublic }) {
    if (!await _guard()) return;
    const stmt = await _conn.prepare(
      `INSERT INTO feedback
         (id, observation_id, created_at, user_id, contact_id, name, accuracy_rating, site_rating, frogwatch, note, species, confidence, user_agent, make_public)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    await stmt.query(
      crypto.randomUUID(),
      String(observationId ?? ''),
      new Date().toISOString(),
      userId     ?? '',
      contactId  ?? '',
      name       ?? '',
      accuracyRating != null ? Number(accuracyRating) : null,
      siteRating     != null ? Number(siteRating)     : null,
      frogwatch  ?? '',
      note       ?? '',
      species    ?? '',
      confidence != null ? Number(confidence) : null,
      userAgent  ?? '',
      makePublic ?? false,
    );
    await stmt.close();
  },

  async upsertContact(data) {
    return upsertContact(data);
  },

  // Send one feedback row straight to Supabase. Throws on failure so the caller
  // can tell the user; the local copy (insertFeedback) is kept for history.
  async sendFeedback(row) {
    return _sbInsert('feedback', row);
  },

  // Upsert a contact (keyed by the stable contact id) into Supabase. merge=true
  // so an email provided later attaches to an id seen earlier.
  async sendContact(row) {
    return _sbInsert('contacts', row, { merge: true });
  },

  getContactId() {
    const { id, isNew } = _getOrCreateContactId();
    if (isNew && _sbReady()) {
      // Best-effort: register the anonymous visitor; email is filled in later
      // when they provide one (feedback form or sign-in).
      _sbInsert('contacts', { id, updated_at: new Date().toISOString() }, { merge: true })
        .catch(() => {});
    }
    return id;
  },


  async getObservations() {
    if (!await _guard()) return [];
    const tbl = await _conn.query('SELECT * FROM observations ORDER BY created_at DESC');
    return tbl.toArray().map(r => ({
      id:            r.id,
      created_at:    r.created_at,
      type:          r.type,
      name:          r.name,
      duration:      r.duration,
      species:       r.species,
      confidence:    r.confidence,
      probabilities: typeof r.probabilities === 'string'
        ? JSON.parse(r.probabilities)
        : r.probabilities,
    }));
  },

  async getFeedback(observationId) {
    if (!await _guard()) return [];
    const stmt = await _conn.prepare(
      'SELECT * FROM feedback WHERE observation_id = ? ORDER BY created_at DESC'
    );
    const tbl = await stmt.query(String(observationId));
    await stmt.close();
    return tbl.toArray().map(r => ({
      id:             r.id,
      observation_id: r.observation_id,
      created_at:     r.created_at,
      verdict:        r.verdict,
      note:           r.note,
    }));
  },

  // Optional, signed-in only: sync this device's observation HISTORY through the
  // Flask API for cross-device continuity. Feedback and contacts no longer go
  // through here — they're written straight to Supabase (see sendFeedback /
  // sendContact), so they're collected from everyone without a server.
  async sync(token, username = '') {
    if (!await _guard()) return;
    if (!EFROG_API_URL) return;

    const observations        = await this.getObservations();
    const stampedObservations = observations.map(o => ({ ...o, username }));

    const res = await fetch(`${EFROG_API_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ observations: stampedObservations }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `Sync failed ${res.status}`);
    }

    // Populate local DB with remote history (ON CONFLICT DO NOTHING keeps local data)
    const histRes = await fetch(`${EFROG_API_URL}/observations`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (histRes.ok) {
      const { observations: remote } = await histRes.json();
      for (const obs of remote) {
        await insertObservation(obs);
      }
    }
  },
};
