// First-party telemetry — batched, privacy-respecting product analytics.
//
// Everything funnels through window.Telemetry.track(event, props) into an
// in-memory queue that is flushed as ONE call to the public.track() RPC
// (see supabase_rebuild.sql): a session upsert (device/locale context +
// engagement counters) plus the queued events. Flushes happen on an interval,
// when the queue grows, and via navigator.sendBeacon when the tab hides or
// unloads — beacons can't set headers, which is why track() lives in the
// public schema and the apikey rides as a query parameter.
//
// Auto-collected: session_start, page_view (hash router), perf_page_load,
// perf_vitals (LCP/CLS), js_error / promise_rejection (capped per session).
// Feature events are emitted by record.js / feedback.js / auth.js /
// gemroom.js / classifier.js. Catalog + query cookbook: TELEMETRY.md.
//
// Privacy: no PII — events carry the anonymous contact id and, when signed
// in, the Auth0 user id, but never email/name. Honors Do Not Track and
// Global Privacy Control; manual kill switch via
// localStorage.setItem('efrog_telemetry_optout', '1') or Telemetry.optOut().
const Telemetry = (function () {
  const FLUSH_INTERVAL_MS = 12000;
  const FLUSH_AT_QUEUE    = 25;
  const MAX_QUEUE         = 200;   // drop oldest beyond this (offline tab)
  const MAX_ERRORS        = 10;    // error events per session

  // ── Opt-out ─────────────────────────────────────────────────────────────
  function _optedOut() {
    try {
      if (localStorage.getItem('efrog_telemetry_optout') === '1') return true;
    } catch { /* storage blocked — fall through */ }
    return navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  }

  function _configured() {
    const url = window.SUPABASE_URL, key = window.SUPABASE_ANON_KEY;
    return Boolean(url && key && !url.includes('YOUR_PROJECT') && !key.includes('YOUR_'));
  }

  function _enabled() { return _configured() && !_optedOut(); }

  // ── Session ─────────────────────────────────────────────────────────────
  // Per-tab session (sessionStorage): survives reloads and in-tab navigation,
  // ends when the tab closes. Falls back to in-memory ids if storage is
  // blocked (then a reload starts a new session — acceptable).
  const _mem = {};
  function _store(key, make) {
    try {
      let v = sessionStorage.getItem(key);
      if (!v) { v = String(make()); sessionStorage.setItem(key, v); }
      return v;
    } catch {
      if (!_mem[key]) _mem[key] = String(make());
      return _mem[key];
    }
  }

  const _sid       = _store('efrog_session_id', () => crypto.randomUUID());
  const _startedAt = _store('efrog_session_t0', () => new Date().toISOString());
  const _t0        = Date.now();
  let   _userId    = null;
  let   _queue     = [];
  let   _errors    = 0;
  let   _pageViews = Number(_store('efrog_session_pv', () => 0)) || 0;

  // Engaged time: only counts while the tab is visible.
  let _engagedAcc   = 0;
  let _visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
  function _engagedMs() {
    return _engagedAcc + (_visibleSince ? Date.now() - _visibleSince : 0);
  }

  function _contactId() {
    try { return localStorage.getItem('efrog_contact_id'); } catch { return null; }
  }

  // ── Context (sent with the first flush; server keeps first non-null) ─────
  function _parseUA(ua) {
    const os =
      /iphone|ipad|ipod/i.test(ua) ? 'iOS' :
      /android/i.test(ua)          ? 'Android' :
      /windows/i.test(ua)          ? 'Windows' :
      /mac os x|macintosh/i.test(ua) ? 'macOS' :
      /linux/i.test(ua)            ? 'Linux' : 'other';
    const browser =
      /edg\//i.test(ua)            ? 'Edge' :
      /samsungbrowser/i.test(ua)   ? 'Samsung' :
      /opr\/|opera/i.test(ua)      ? 'Opera' :
      /firefox\//i.test(ua)        ? 'Firefox' :
      /chrome|crios/i.test(ua)     ? 'Chrome' :
      /safari/i.test(ua)           ? 'Safari' : 'other';
    // iPadOS 13+ reports as macOS but has touch
    const isIpad  = os === 'macOS' && navigator.maxTouchPoints > 1;
    const mobile  = /mobi|iphone|ipod|android.*mobile/i.test(ua);
    const tablet  = isIpad || /ipad|android(?!.*mobile)|tablet/i.test(ua);
    return {
      os: isIpad ? 'iOS' : os,
      browser,
      device_type: mobile ? 'mobile' : tablet ? 'tablet' : 'desktop',
    };
  }

  function _utm() {
    try {
      const p = new URLSearchParams(location.search);
      const out = {};
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref']) {
        const v = p.get(k);
        if (v) out[k] = v.slice(0, 80);
      }
      return Object.keys(out).length ? JSON.stringify(out) : null;
    } catch { return null; }
  }

  function _context() {
    const ua = navigator.userAgent || '';
    const parsed = _parseUA(ua);
    let tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch {}
    return {
      _app:            'web',
      _started_at:     _startedAt,
      _timezone:       tz,
      _language:       navigator.language || null,
      _languages:      (navigator.languages || []).slice(0, 5).join(',') || null,
      _platform:       navigator.platform || null,
      _os:             parsed.os,
      _browser:        parsed.browser,
      _device_type:    parsed.device_type,
      _user_agent:     ua,
      _screen_w:       screen?.width  ?? null,
      _screen_h:       screen?.height ?? null,
      _viewport_w:     window.innerWidth  || null,
      _viewport_h:     window.innerHeight || null,
      _pixel_ratio:    window.devicePixelRatio || null,
      _touch:          (navigator.maxTouchPoints ?? 0) > 0,
      _connection:     navigator.connection?.effectiveType ?? null,
      _referrer:       document.referrer || null,
      _landing_page:   _page(),
      _utm:            _utm(),
      _standalone:     window.matchMedia?.('(display-mode: standalone)').matches
                         || window.navigator.standalone === true,
      _prefers_dark:   window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? null,
      _reduced_motion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? null,
      _hw_concurrency: navigator.hardwareConcurrency ?? null,
      _device_memory:  navigator.deviceMemory ?? null,
    };
  }
  let _ctxPending = true;   // include full context in the next flush

  // ── Transport ───────────────────────────────────────────────────────────
  function _rpcUrl() { return `${window.SUPABASE_URL}/rest/v1/rpc/track`; }

  function _body(events) {
    const base = {
      _sid:          _sid,
      _contact_id:   _contactId(),
      _user_id:      _userId,
      _last_seen_at: new Date().toISOString(),
      _duration_ms:  Date.now() - _t0 + (_pageLoadOffset || 0),
      _engaged_ms:   Math.round(_engagedMs()),
      _page_views:   _pageViews,
      _events:       events,
    };
    return _ctxPending ? { ..._context(), ...base } : base;
  }

  // Session duration should span reloads too: recover the offset from the
  // session's original start time when it parses.
  let _pageLoadOffset = 0;
  try {
    const t = Date.parse(_startedAt);
    if (Number.isFinite(t) && t > 0 && Date.now() - t > 0) _pageLoadOffset = _t0 - t;
  } catch {}

  let _inFlight = false;
  async function flush() {
    if (!_enabled() || _inFlight) return;
    if (!_queue.length && !_ctxPending) return;
    const events = _queue.splice(0, 100);
    const body   = _body(events);
    _inFlight = true;
    try {
      const res = await fetch(_rpcUrl(), {
        method:    'POST',
        keepalive: true,
        headers: {
          'content-type':  'application/json',
          'apikey':        window.SUPABASE_ANON_KEY,
          'authorization': `Bearer ${window.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`track ${res.status}`);
      _ctxPending = false;
    } catch {
      // Requeue and retry on a later flush; event ids make retries dedupe-safe.
      _queue = events.concat(_queue).slice(0, MAX_QUEUE);
    } finally {
      _inFlight = false;
    }
  }

  // Fire-and-forget flush for tab-hide/unload, where fetch may be killed.
  // Always sends (even with an empty queue) so the session row gets its final
  // duration / engaged-time / page-view counters.
  function _beaconFlush() {
    if (!_enabled()) return;
    const events = _queue.splice(0, 100);
    const body   = _body(events);
    const url    = `${_rpcUrl()}?apikey=${encodeURIComponent(window.SUPABASE_ANON_KEY)}`;
    let sent = false;
    try {
      sent = navigator.sendBeacon?.(url, new Blob([JSON.stringify(body)], { type: 'application/json' }));
    } catch {}
    if (sent) {
      _ctxPending = false;
    } else {
      // Beacon rejected (rare) — requeue in case the tab comes back.
      _queue = events.concat(_queue).slice(0, MAX_QUEUE);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────
  function _page() {
    return location.hash.slice(1) || 'record';
  }

  function track(event, props) {
    if (!_enabled() || !event) return;
    _queue.push({
      id:         crypto.randomUUID(),
      event:      String(event).slice(0, 64),
      page:       _page(),
      props:      props && typeof props === 'object' ? props : undefined,
      created_at: new Date().toISOString(),
    });
    if (_queue.length >= FLUSH_AT_QUEUE) flush();
  }

  // Attach the Auth0 user id to this session + subsequent events. No PII.
  function identify(userId) {
    if (userId && userId !== _userId) {
      _userId = String(userId).slice(0, 128);
      _ctxPending = true;   // push the id onto the session row promptly
    }
  }

  function optOut() {
    try { localStorage.setItem('efrog_telemetry_optout', '1'); } catch {}
    _queue = [];
  }
  function optIn() {
    try { localStorage.removeItem('efrog_telemetry_optout'); } catch {}
  }

  // ── Auto-instrumentation ────────────────────────────────────────────────
  let _reportVitals = () => {};
  if (_enabled()) {
    // Session start — once per session id, not per reload.
    if (_store('efrog_session_started', () => 'pending') === 'pending') {
      try { sessionStorage.setItem('efrog_session_started', 'yes'); } catch {}
      track('session_start');
    }

    // Page views (hash router). The initial view counts too.
    let _prevPage = _page();
    _pageViews += 1;
    try { sessionStorage.setItem('efrog_session_pv', String(_pageViews)); } catch {}
    track('page_view', { referrer: document.referrer || undefined });
    window.addEventListener('hashchange', () => {
      const to = _page();
      if (to === _prevPage) return;
      _pageViews += 1;
      try { sessionStorage.setItem('efrog_session_pv', String(_pageViews)); } catch {}
      track('page_view', { from: _prevPage });
      _prevPage = to;
    });

    // Engaged-time bookkeeping + flush when the tab hides.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (_visibleSince) { _engagedAcc += Date.now() - _visibleSince; _visibleSince = null; }
        _reportVitals();
        _beaconFlush();
      } else if (!_visibleSince) {
        _visibleSince = Date.now();
      }
    });
    window.addEventListener('pagehide', () => { _reportVitals(); _beaconFlush(); });

    // JS errors — the "what's breaking for real users" feed.
    window.addEventListener('error', e => {
      if (_errors++ >= MAX_ERRORS) return;
      track('js_error', {
        message: String(e.message || '').slice(0, 300),
        source:  String(e.filename || '').split('/').pop().slice(0, 80),
        line:    e.lineno || undefined,
      });
    });
    window.addEventListener('unhandledrejection', e => {
      if (_errors++ >= MAX_ERRORS) return;
      const r = e.reason;
      track('promise_rejection', {
        message: String((r && (r.message || r)) || 'unknown').slice(0, 300),
      });
    });

    // Page-load performance (navigation timing).
    const _reportLoad = () => {
      try {
        const nav = performance.getEntriesByType('navigation')[0];
        if (!nav) return;
        track('perf_page_load', {
          ttfb_ms:     Math.round(nav.responseStart),
          dcl_ms:      Math.round(nav.domContentLoadedEventEnd),
          load_ms:     Math.round(nav.loadEventEnd || nav.domContentLoadedEventEnd),
          transfer_kb: Math.round((nav.transferSize || 0) / 1024),
          cached:      nav.transferSize === 0 || undefined,
        });
      } catch {}
    };
    if (document.readyState === 'complete') _reportLoad();
    else window.addEventListener('load', () => setTimeout(_reportLoad, 0));

    // Web vitals: LCP + CLS, reported once when the tab first hides.
    let _lcp = null, _cls = 0, _vitalsSent = false;
    try {
      new PerformanceObserver(list => {
        const entries = list.getEntries();
        if (entries.length) _lcp = entries[entries.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => {
        for (const en of list.getEntries()) if (!en.hadRecentInput) _cls += en.value;
      }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* observer types unsupported — fine */ }
    _reportVitals = () => {
      if (_vitalsSent || (_lcp == null && _cls === 0)) return;
      _vitalsSent = true;
      track('perf_vitals', {
        lcp_ms: _lcp != null ? Math.round(_lcp) : undefined,
        cls:    Math.round(_cls * 1000) / 1000,
      });
    };

    setInterval(flush, FLUSH_INTERVAL_MS);
    // Early flush so short bounce visits still land.
    setTimeout(flush, 3000);
  }

  return { track, identify, flush, optOut, optIn };
})();

window.Telemetry = Telemetry;
