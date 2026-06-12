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
          name            VARCHAR,
          accuracy_rating INTEGER,
          site_rating     INTEGER,
          frogwatch       VARCHAR,
          note            VARCHAR,
          species         VARCHAR,
          confidence      DOUBLE,
          user_agent      VARCHAR,
          synced          BOOLEAN DEFAULT false
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

// ── Public API ────────────────────────────────────────────────────────────────

window.DB = {
  async insertObservation(data) {
    return insertObservation(data);
  },

  async insertFeedback({ observationId, userId, name, accuracyRating, siteRating, frogwatch, note, species, confidence, userAgent }) {
    if (!await _guard()) return;
    const stmt = await _conn.prepare(
      `INSERT INTO feedback
         (id, observation_id, created_at, user_id, name, accuracy_rating, site_rating, frogwatch, note, species, confidence, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    await stmt.query(
      crypto.randomUUID(),
      String(observationId ?? ''),
      new Date().toISOString(),
      userId     ?? '',
      name       ?? '',
      accuracyRating != null ? Number(accuracyRating) : null,
      siteRating     != null ? Number(siteRating)     : null,
      frogwatch  ?? '',
      note       ?? '',
      species    ?? '',
      confidence != null ? Number(confidence) : null,
      userAgent  ?? '',
    );
    await stmt.close();
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

  // Push unsynced local rows to Databricks, then pull remote history back.
  // Called automatically on sign-in by auth.js.
  async sync(token, username = '') {
    if (!await _guard()) return;
    if (!EFROG_API_URL) return;

    const [observations, feedbackRows] = await Promise.all([
      this.getObservations(),
      getUnsyncedFeedback(),
    ]);

    const stampedObservations = observations.map(o => ({ ...o, username }));

    const res = await fetch(`${EFROG_API_URL}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ observations: stampedObservations, feedback: feedbackRows }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? `Sync failed ${res.status}`);
    }

    if (feedbackRows.length) {
      await markFeedbackSynced(feedbackRows.map(f => f.id));
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
