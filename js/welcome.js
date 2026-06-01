// Welcome / disclaimer modal shown to new visitors.
// Guests: shown every session (no persistent identity to track with).
// Signed-in users: shown once (recorded in localStorage).
// After the user dismisses (either path), a tooltip hint appears near the Feedback toggle.

(function () {
  const STORAGE_KEY = 'efrog_welcomed';

  async function maybeShow() {
    const authed = await Auth?.isAuthenticated?.().catch(() => false) ?? false;

    if (authed && localStorage.getItem(STORAGE_KEY)) {
      return; // signed-in user has already seen it
    }

    if (authed) {
      localStorage.setItem(STORAGE_KEY, '1');
    }
    // Guests: never set the key, so they always see it

    _show();
  }

  function _show() {
    const overlay = document.createElement('div');
    overlay.className = 'welcome-overlay';
    overlay.innerHTML = `
      <div class="welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div class="welcome-frog" aria-hidden="true">🐸</div>
        <h2 class="welcome-title" id="welcome-title">Welcome to efrog</h2>
        <p class="welcome-body">
          efrog uses AI to identify frog species from audio recordings.
          Audio is processed on our servers and not retained after classification.
        </p>
        <p class="welcome-body">
          Enable <strong>Feedback Mode</strong> to save your analyses and
          access the <strong>History</strong> page.
        </p>
        <div class="welcome-actions">
          <button id="welcome-enable-btn" class="btn btn-primary">Enable Feedback Mode</button>
          <button id="welcome-skip-btn"   class="btn btn-ghost btn-sm">Continue without</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    function dismiss() {
      overlay.classList.add('welcome-exit');
      overlay.addEventListener('animationend', () => {
        overlay.remove();
        _showToggleHint();
      }, { once: true });
    }

    document.getElementById('welcome-enable-btn').addEventListener('click', () => {
      Store.setFeedbackMode(true);
      window._syncFeedbackToggle?.();
      dismiss();
    });

    document.getElementById('welcome-skip-btn').addEventListener('click', dismiss);
  }

  function _showToggleHint() {
    const toggle = document.getElementById('feedback-toggle');
    if (!toggle || document.getElementById('toggle-hint')) return;

    const rect  = toggle.getBoundingClientRect();
    const hint  = document.createElement('div');
    hint.id = 'toggle-hint';
    hint.className = 'toggle-hint';
    hint.textContent = 'you can always turn feedback mode on or off here';
    hint.style.top   = `${rect.bottom + 8}px`;
    hint.style.right = `${window.innerWidth - rect.right}px`;
    hint.addEventListener('click', () => hint.remove());
    document.body.appendChild(hint);
  }

  window.Welcome = { maybeShow };
})();
