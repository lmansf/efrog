const HistoryPage = (function () {
  // ── Placeholder pixel-art frog ──────────────────────────
  // Stand-in until real per-species art lands. Each species gets a stable hue
  // derived from its name, so the same frog always looks the same and different
  // frogs look distinct. Swap frogSprite() for real artwork later.
  const FROG_MAP = [
    '............',
    '...gg..gg...',
    '..gwwggwwg..',
    '..gbbggbbg..',
    '.gggggggggg.',
    '.gggggggggg.',
    '.gggmmmmggg.',
    '.gggggggggg.',
    '..gg....gg..',
    '............',
  ];
  const FROG_COLORS = { g: '#6aa84f', b: '#1c1916', w: '#ffffff', m: '#3f6b32' };

  function hueOf(str) {
    let h = 0;
    for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }

  function frogSprite(species) {
    const cell = 6;
    const w = FROG_MAP[0].length * cell;
    const h = FROG_MAP.length * cell;
    let rects = '';
    FROG_MAP.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = FROG_COLORS[row[x]];
        if (c) rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="${c}"/>`;
      }
    });
    return `<svg class="frog-sprite" viewBox="0 0 ${w} ${h}" width="100%" height="100%"
      shape-rendering="crispEdges" style="filter:hue-rotate(${hueOf(species)}deg)">${rects}</svg>`;
  }

  // ── Render ──────────────────────────────────────────────
  function render() {
    const entries = Store.getHistory();
    return `
      <div class="page-header">
        <h1 class="page-title" style="margin-bottom:0">Gem Room</h1>
        ${entries.length > 0
          ? '<button id="clear-history" class="btn btn-ghost btn-sm">Clear all</button>'
          : ''}
      </div>
      ${entries.length === 0 ? renderEmpty() : renderCollection(entries)}
    `;
  }

  function renderEmpty() {
    return `
      <div class="empty-state">
        <div class="empty-icon">🎙️</div>
        <p class="empty-title">Your Gem Room is empty</p>
        <p class="empty-desc">
          Head to <a href="#record">Analyze</a> to identify your first frog and start your Gem Room.
        </p>
      </div>
    `;
  }

  function renderCollection(entries) {
    const sessionStart = Store.getSessionStart();
    const current = entries.filter(e => e.timestamp >= sessionStart);

    return `
      <section class="collection-section">
        <h2 class="collection-section-title">Current Session</h2>
        ${current.length
          ? renderBox(current, 4)
          : `<div class="frog-box-grid">${emptySlots(4)}</div>
             <p class="collection-hint">Nothing caught yet this session — go identify a call.</p>`}
      </section>

      <section class="collection-section">
        <h2 class="collection-section-title">All Observations <span class="collection-count">${entries.length}</span></h2>
        ${renderBox(entries, 8)}
      </section>
    `;
  }

  // Render a storage box: real frogs first, padded with empty slots up to a full
  // grid so it reads like a Pokémon PC box.
  function renderBox(entries, minSlots) {
    const filled = entries.map(renderFrog).join('');
    const total  = Math.max(minSlots, Math.ceil(entries.length / 4) * 4);
    return `<div class="frog-box-grid">${filled}${emptySlots(total - entries.length)}</div>`;
  }

  function emptySlots(n) {
    let html = '';
    for (let i = 0; i < Math.max(0, n); i++) html += '<div class="frog-box frog-box-empty"></div>';
    return html;
  }

  function renderFrog(entry) {
    const species = entry.result?.species ?? entry.result?.classification ?? 'Unknown';
    const name    = esc(String(entry.result?.classification ?? 'Unknown'));
    const d       = new Date(entry.timestamp);
    const when    = `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const conf    = typeof entry.result?.confidence === 'number'
      ? `${(entry.result.confidence * 100).toFixed(0)}%` : '';

    let badge = '';
    if (entry.feedback) {
      const ok = entry.feedback.verdict === 'correct';
      badge = `<span class="frog-box-badge ${ok ? 'correct' : 'incorrect'}">${ok ? '✓' : '✗'}</span>`;
    }

    return `
      <div class="frog-box" data-id="${esc(String(entry.id))}" role="button" tabindex="0"
           title="${name} — ${esc(when)}${conf ? ` · ${conf}` : ''}">
        ${badge}
        <button class="frog-box-remove" aria-label="Remove this observation" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
        <div class="frog-sprite-wrap">${frogSprite(species)}</div>
        <p class="frog-box-name">${name}</p>
        ${conf ? `<span class="frog-box-conf">${conf}</span>` : ''}
      </div>
    `;
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatSpecies(raw) {
    return String(raw ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Map a server observation row into the local history entry shape.
  function remoteToEntry(o) {
    return {
      id:        o.id,
      timestamp: o.created_at || new Date().toISOString(),
      type:      o.type || 'upload',
      name:      o.name || 'Observation',
      is_holo:   Boolean(o.is_holo),
      result: {
        classification: formatSpecies(o.species),
        species:        o.species,
        confidence:     o.confidence,
        probabilities:  o.probabilities || {},
      },
    };
  }

  // Signed-in users: pull their observations from the server (which validates the
  // Auth0 token) and merge any missing ones into the local collection.
  async function syncRemote() {
    try {
      if (!(await window.Auth?.isAuthenticated())) return;
      const token  = await window.Auth.getToken();
      const remote = await window.DB?.fetchRemoteObservations(token) ?? [];
      if (!remote.length) return;
      const added = Store.importEntries(remote.map(remoteToEntry));
      if (added) Router.navigate();   // re-render with the newly retrieved frogs
    } catch { /* offline / server asleep — keep showing local history */ }
  }

  // ── Observation card (centered modal) ───────────────────
  function cardModalHtml(entry) {
    const species = entry.result?.species ?? entry.result?.classification ?? 'Unknown';
    const name    = esc(String(entry.result?.classification ?? 'Unknown'));
    const hue     = hueOf(species);
    const d       = new Date(entry.timestamp);
    const when    = `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const typeLabel = entry.type === 'recording' ? 'Recording' : 'Upload';
    const conf    = typeof entry.result?.confidence === 'number'
      ? `${(entry.result.confidence * 100).toFixed(0)}%` : '';

    return `
      <div class="card-modal" id="card-modal">
        <div class="card-modal-backdrop" data-close="1"></div>
        <div class="card-modal-body">
          <div class="tcg-card" style="--i:0; --card-hue:${hue};">
            <div class="tcg-card-shine"></div>
            <div class="tcg-card-frame">
              <div class="tcg-card-header">
                <span class="tcg-card-title">${name}</span>
                ${conf ? `<span class="tcg-card-conf">${conf}</span>` : ''}
              </div>
              <div class="tcg-card-art"><div class="tcg-card-sprite">${frogSprite(species)}</div></div>
              <div class="tcg-card-info">
                <div class="tcg-card-field">
                  <span class="tcg-card-label">Identifier</span>
                  <span class="tcg-card-value">${esc(window.frogCatalogId?.(species) ?? '')}</span>
                </div>
                <div class="tcg-card-field">
                  <span class="tcg-card-label">Frog Fact</span>
                  <span class="tcg-card-value tcg-card-fact">${esc(window.frogFactFor?.(species) ?? '')}</span>
                </div>
              </div>
              <div class="tcg-card-footer">
                <span>eFrog · Florida</span>
              </div>
            </div>
          </div>
          <p class="card-modal-meta">${typeLabel} · ${esc(when)}</p>
          <button class="card-modal-close" data-close="1">Close</button>
        </div>
      </div>
    `;
  }

  function openCardModal(entry) {
    if (!entry) return;
    closeCardModal();
    const tpl = document.createElement('div');
    tpl.innerHTML = cardModalHtml(entry);
    const modal = tpl.firstElementChild;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));

    modal.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) closeCardModal();
    });
    const onKey = e => { if (e.key === 'Escape') closeCardModal(); };
    document.addEventListener('keydown', onKey);
    modal._onKey = onKey;
  }

  function closeCardModal() {
    const modal = document.getElementById('card-modal');
    if (!modal) return;
    if (modal._onKey) document.removeEventListener('keydown', modal._onKey);
    modal.classList.remove('open');
    modal.classList.add('closing');
    let removed = false;
    const done = () => { if (removed) return; removed = true; modal.remove(); };
    modal.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400);
  }

  function jump(box) {
    const wrap = box.querySelector('.frog-sprite-wrap');
    if (!wrap) return;
    wrap.classList.remove('frog-jump');
    void wrap.offsetWidth;                 // reflow so the animation can restart
    wrap.classList.add('frog-jump');
    wrap.addEventListener('animationend', () => wrap.classList.remove('frog-jump'), { once: true });
  }

  function removeObservation(id) {
    if (!confirm('Remove this observation? This cannot be undone.')) return;
    document.querySelectorAll(`.frog-box[data-id="${CSS.escape(id)}"]`)
      .forEach(b => b.classList.add('frog-box-removing'));
    Store.removeEntry(id);
    closeCardModal();
    setTimeout(() => Router.navigate(), 300);
  }

  function init() {
    const clearBtn = document.getElementById('clear-history');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear your whole Gem Room? This cannot be undone.')) {
          Store.clearHistory();
          Router.navigate();
        }
      });
    }

    const byId = new Map(Store.getHistory().map(e => [String(e.id), e]));
    let selectedId = null;

    function selectBoxesFor(id) {
      document.querySelectorAll('.frog-box.selected').forEach(b => b.classList.remove('selected'));
      document.querySelectorAll(`.frog-box[data-id="${CSS.escape(id)}"]`).forEach(b => {
        b.classList.add('selected');
        jump(b);
      });
    }

    function handleActivate(box) {
      const id = box.dataset.id;
      if (!id) return;
      if (selectedId === id) {
        openCardModal(byId.get(id));   // second tap → show the card
      } else {
        selectedId = id;               // first tap → select + jump
        selectBoxesFor(id);
      }
    }

    document.querySelectorAll('.frog-box[data-id]').forEach(box => {
      box.addEventListener('click', () => handleActivate(box));
      box.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleActivate(box); }
      });
    });

    document.querySelectorAll('.frog-box-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();              // don't trigger select / open-card
        const id = btn.closest('.frog-box')?.dataset.id;
        if (id) removeObservation(id);
      });
    });

    syncRemote();   // best-effort: surface a signed-in user's remote observations
  }

  return { render, init };
})();
