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
          id                VARCHAR PRIMARY KEY,
          created_at        VARCHAR,
          type              VARCHAR,
          name              VARCHAR,
          duration          DOUBLE,
          species           VARCHAR,
          confidence        DOUBLE,
          probabilities     VARCHAR,
          is_holo           BOOLEAN DEFAULT false,
          mel_spectrogram   VARCHAR,
          included_feedback BOOLEAN DEFAULT false,
          feedback          BOOLEAN,
          species_name      VARCHAR
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
// Writes go straight from the browser to Supabase (PostgREST) — no server, so
// it works for anonymous visitors and even when the Render box is asleep.
// Append-only tables (feedback, user_logins) are plain INSERTs guarded by
// Row-Level-Security insert policies. Upserted rows (observations, contacts)
// go through SECURITY DEFINER RPCs (see supabase_rebuild.sql) because Postgres
// disallows INSERT … ON CONFLICT DO UPDATE on tables anon cannot SELECT —
// the RPCs merge by id while keeping the tables unreadable with the anon key.

function _sbReady() {
  const url = window.SUPABASE_URL, key = window.SUPABASE_ANON_KEY;
  return Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_') && window.supabase);
}

let _sbClientInstance = null;
function _sbClient() {
  if (!_sbClientInstance) {
    _sbClientInstance = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      db: { schema: 'Version_1' },
    });
  }
  return _sbClientInstance;
}

function _sbGuardConfigured() {
  if (!_sbReady()) {
    throw new Error('Supabase is not configured — set SUPABASE_URL and SUPABASE_ANON_KEY in js/config.js');
  }
}

async function _sbInsert(table, row) {
  _sbGuardConfigured();
  const { error } = await _sbClient().from(table).insert(row);
  if (error) throw new Error(`Supabase ${table} insert failed: ${error.message}`);
}

async function _sbRpc(fn, args) {
  _sbGuardConfigured();
  const { error } = await _sbClient().rpc(fn, args);
  if (error) throw new Error(`Supabase ${fn} failed: ${error.message}`);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function insertObservation({ id, created_at, type, name, duration, species, confidence, probabilities, is_holo }) {
  if (!await _guard()) return;
  const stmt = await _conn.prepare(
    `INSERT INTO observations (id, created_at, type, name, duration, species, confidence, probabilities, is_holo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
  );
  await stmt.query(
    String(id),
    created_at ?? new Date().toISOString(),
    type, name,
    duration != null ? Number(duration) : null,
    species,
    Number(confidence),
    typeof probabilities === 'string' ? probabilities : JSON.stringify(probabilities),
    Boolean(is_holo),
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

  // Send one observation straight to Supabase as it happens (works anonymously).
  // Merged by id via the upsert_observation RPC so a later server sync /
  // re-send is idempotent.
  async sendObservation(row) {
    return _sbRpc('upsert_observation', {
      _id:                String(row.id),
      _user_id:           row.user_id           ?? null,
      _contact_id:        row.contact_id        ?? null,
      _username:          row.username          ?? null,
      _created_at:        row.created_at        ?? null,
      _type:              row.type              ?? null,
      _name:              row.name              ?? null,
      _duration:          row.duration          ?? null,
      _species:           row.species           ?? null,
      _confidence:        row.confidence        ?? null,
      _probabilities:     row.probabilities     ?? null,
      _is_holo:           row.is_holo           ?? null,
      _mel_spectrogram:   row.mel_spectrogram   ?? null,
      _included_feedback: row.included_feedback ?? null,
      _feedback:          row.feedback          ?? null,
      _species_name:      row.species_name      ?? null,
    });
  },

  // Append the user's verdict to an existing observation. Merged by id via the
  // upsert_observation RPC so only the feedback columns change (the row was
  // created at analysis time). Also best-effort updates the local DuckDB copy.
  // Called the moment the user picks agree / dispute / not-now under a result
  // card.
  async updateObservationFeedback({ id, included_feedback, feedback, species_name }) {
    const row = {
      id:                String(id),
      included_feedback: Boolean(included_feedback),
      feedback:          feedback == null ? null : Boolean(feedback),
      species_name:      species_name ?? null,
    };
    if (await _guard()) {
      try {
        const stmt = await _conn.prepare(
          `UPDATE observations
             SET included_feedback = ?, feedback = ?, species_name = ?
           WHERE id = ?`
        );
        await stmt.query(row.included_feedback, row.feedback, row.species_name, row.id);
        await stmt.close();
      } catch { /* local copy is best-effort */ }
    }
    return _sbRpc('upsert_observation', {
      _id:                row.id,
      _included_feedback: row.included_feedback,
      _feedback:          row.feedback,
      _species_name:      row.species_name,
    });
  },

  // Send one feedback row straight to Supabase. Throws on failure so the caller
  // can tell the user; the local copy (insertFeedback) is kept for history.
  async sendFeedback(row) {
    return _sbInsert('feedback', row);
  },

  // Upsert a contact (keyed by the stable contact id) into Supabase via the
  // upsert_contact RPC, so an email provided later attaches to an id seen
  // earlier.
  async sendContact(row) {
    return _sbRpc('upsert_contact', {
      _id:         String(row.id),
      _email:      row.email      ?? null,
      _username:   row.username   ?? null,
      _user_id:    row.user_id    ?? null,
      _updated_at: row.updated_at ?? null,
    });
  },

  async sendLoginEvent(row) {
    return _sbInsert('user_logins', row);
  },

  getContactId() {
    const { id, isNew } = _getOrCreateContactId();
    if (isNew && _sbReady()) {
      // Best-effort: register the anonymous visitor; email is filled in later
      // when they provide one (feedback form or sign-in).
      _sbRpc('upsert_contact', { _id: id, _updated_at: new Date().toISOString() })
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
      is_holo:       Boolean(r.is_holo),
    }));
  },

  // Logged-in retrieval: fetch this user's observations from the server, which
  // validates the Auth0 token and queries Supabase by user_id. Returns [] on any
  // failure (e.g. server asleep) so the Collection still shows local history.
  async fetchRemoteObservations(token) {
    if (!EFROG_API_URL || !token) return [];
    try {
      const res = await fetch(`${EFROG_API_URL}/observations`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.observations ?? [];
    } catch {
      return [];
    }
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
