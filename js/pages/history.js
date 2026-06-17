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
        <h1 class="page-title" style="margin-bottom:0">Collection</h1>
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
        <p class="empty-title">Your collection is empty</p>
        <p class="empty-desc">
          Head to <a href="#record">Analyze</a> to identify your first frog and start your collection.
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
      <div class="frog-box" title="${name} — ${esc(when)}${conf ? ` · ${conf}` : ''}">
        ${badge}
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

  function init() {
    const clearBtn = document.getElementById('clear-history');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear your whole collection? This cannot be undone.')) {
          Store.clearHistory();
          Router.navigate();
        }
      });
    }
  }

  return { render, init };
})();
