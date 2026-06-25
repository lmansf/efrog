const GemRoomPage = (function () {
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render() {
    return `
      <h1 class="page-title">Leaderboard</h1>
      <p class="gem-room-desc">
        Ranked by gem score — unique species × total observations × 10.
        Sign in and identify frogs to appear on the board.
      </p>
      <div id="gem-room-content" class="gem-room-loading">
        <div class="gem-room-spinner" aria-label="Loading leaderboard" role="status">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
  }

  let _sbClient = null;
  function _getClient() {
    if (!_sbClient) {
      _sbClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
    return _sbClient;
  }

  async function init() {
    const container = document.getElementById('gem-room-content');
    if (!container) return;

    try {
      const { data, error } = await _getClient().rpc('get_leaderboard');
      if (error) throw new Error(error.message);
      const leaderboard = (data ?? []).map(row => ({ ...row, total_observations: row.total_obs }));
      container.className = '';
      container.innerHTML = leaderboard.length > 0
        ? renderBoard(leaderboard)
        : renderEmpty();
    } catch {
      container.className = '';
      container.innerHTML = renderError();
    }
  }

  function renderBoard(rows) {
    const podium = rows.slice(0, 3);
    const rest   = rows.slice(3);
    return `
      <div class="gem-room-podium">
        ${podium.map((row, i) => renderTopCard(row, i)).join('')}
      </div>
      ${rest.length > 0 ? renderTable(rest, 4) : ''}
    `;
  }

  const MEDALS = ['🥇', '🥈', '🥉'];

  function renderTopCard(row, index) {
    return `
      <div class="gem-room-top-card gem-room-rank-${index + 1}">
        <span class="gem-room-medal" aria-label="Rank ${index + 1}">${MEDALS[index]}</span>
        <div class="gem-room-top-info">
          <div class="gem-room-top-row">
            <span class="gem-room-top-name">${esc(row.username)}</span>
            <span class="gem-room-top-score">${Number(row.gem_score).toLocaleString()} 💎</span>
          </div>
          <span class="gem-room-top-stats">
            ${row.unique_species} unique species · ${row.total_observations} observations
          </span>
        </div>
      </div>
    `;
  }

  function renderTable(rows, startRank) {
    return `
      <div class="gem-room-table-wrap">
        <table class="gem-room-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Score 💎</th>
              <th>Sp.</th>
              <th>Obs.</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row, i) => `
              <tr>
                <td class="gem-room-col-rank">${startRank + i}</td>
                <td class="gem-room-col-name">${esc(row.username)}</td>
                <td class="gem-room-col-score">${Number(row.gem_score).toLocaleString()}</td>
                <td>${row.unique_species}</td>
                <td>${row.total_observations}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderEmpty() {
    return `
      <div class="empty-state">
        <div class="empty-icon">💎</div>
        <p class="empty-title">No gem scores yet</p>
        <p class="empty-desc">
          <a href="#record">Identify some frogs</a> and sign in to appear on the leaderboard.
        </p>
      </div>
    `;
  }

  function renderError() {
    return `
      <div class="empty-state">
        <div class="empty-icon">🌿</div>
        <p class="empty-title">Leaderboard unavailable</p>
        <p class="empty-desc">Could not load leaderboard. Please try again.</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:12px"
                onclick="Router.navigate()">Retry</button>
      </div>
    `;
  }

  return { render, init };
})();
