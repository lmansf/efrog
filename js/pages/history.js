const HistoryPage = (function () {
  function render() {
    if (!Store.hasFeedbackEverEnabled()) {
      return renderLocked();
    }
    const entries = Store.getHistory();
    return `
      <div class="page-header">
        <h1 class="page-title" style="margin-bottom:0">History</h1>
        ${entries.length > 0
          ? '<button id="clear-history" class="btn btn-ghost btn-sm">Clear all</button>'
          : ''}
      </div>
      ${entries.length === 0 ? renderEmpty() : renderList(entries)}
    `;
  }

  function renderLocked() {
    return `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p class="empty-title">Enable Feedback Mode to unlock History</p>
        <p class="empty-desc">
          Turn on Feedback Mode once to start saving your analyses here.
          You can turn it off afterwards — your history stays.
        </p>
        <button class="btn btn-primary" id="history-enable-feedback">Enable Feedback Mode</button>
      </div>
    `;
  }

  function renderEmpty() {
    return `
      <div class="empty-state">
        <div class="empty-icon">🎙️</div>
        <p class="empty-title">No recordings yet</p>
        <p class="empty-desc">
          Head to <a href="#record">Analyze</a> to upload or record your first sound.
        </p>
      </div>
    `;
  }

  function renderList(entries) {
    return `<div class="history-list">${entries.map(renderCard).join('')}</div>`;
  }

  function renderCard(entry) {
    const icon = entry.type === 'recording' ? '🎙️' : '📂';
    const d    = new Date(entry.timestamp);
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const typeLabel = entry.type === 'recording' ? 'Recording' : 'Upload';

    const classification = entry.result?.classification ?? '—';

    let feedbackHtml = '';
    if (entry.feedback) {
      const cls   = entry.feedback.verdict === 'correct' ? 'correct' : 'incorrect';
      const label = entry.feedback.verdict === 'correct' ? '✓ Correct' : '✗ Incorrect';
      feedbackHtml = `<div class="history-feedback">
        <span class="feedback-chip ${cls}">${label}</span>
        ${entry.feedback.note
          ? `<p class="history-feedback-note">"${esc(entry.feedback.note)}"</p>`
          : ''}
      </div>`;
    }

    return `
      <div class="history-card">
        <div class="history-icon">${icon}</div>
        <div class="history-info">
          <p class="history-name" title="${esc(entry.name)}">${esc(entry.name)}</p>
          <p class="history-meta">${typeLabel} &middot; ${dateStr} &middot; ${timeStr}</p>
          <p class="history-classification">
            <span class="label">Classification: </span>${esc(String(classification))}
          </p>
          ${feedbackHtml}
        </div>
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
    const enableBtn = document.getElementById('history-enable-feedback');
    if (enableBtn) {
      enableBtn.addEventListener('click', () => {
        Store.setFeedbackMode(true);
        window._syncFeedbackToggle?.();
        Router.navigate();
      });
    }

    const clearBtn = document.getElementById('clear-history');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Clear all history? This cannot be undone.')) {
          Store.clearHistory();
          Router.navigate();
        }
      });
    }
  }

  return { render, init };
})();
