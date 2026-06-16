document.addEventListener('DOMContentLoaded', () => {
  // ── Boot screen ────────────────────────────────────────
  (function () {
    const screen = document.getElementById('boot-screen');
    if (!screen) return;

    // Minimum visible time — starts counting from page load
    const minWait = new Promise(resolve => setTimeout(resolve, 1800));

    const _local   = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    const API_BASE = _local ? 'http://localhost:5000' : EFROG_API_URL;

    function dismiss() {
      screen.classList.add('boot-exit');
      screen.addEventListener('animationend', () => {
        screen.remove();
      }, { once: true });
    }

    // Local inference: wait for the in-browser model to load (a one-time fetch),
    // not a server. No /health polling, no cold start.
    if (window.EFROG_LOCAL_INFERENCE) {
      // Skip button after 20 s so a slow model download never traps the user
      setTimeout(() => {
        if (!document.getElementById('boot-screen')) return;
        const skipBtn = document.createElement('button');
        skipBtn.textContent = 'Continue anyway';
        skipBtn.className = 'boot-skip-btn';
        skipBtn.onclick = () => { minWait.then(dismiss); };
        screen.appendChild(skipBtn);
      }, 20000);

      Promise.resolve(window.Classifier?.ready)
        .finally(() => minWait.then(dismiss));
      return;
    }

    // If no API is configured yet, skip health check and just boot
    if (!API_BASE) {
      minWait.then(dismiss);
      return;
    }

    // Skip button so users are never permanently stuck — shown after 20 s,
    // or immediately when the server reports an error
    let skipShown = false;
    function showSkip() {
      if (skipShown || !document.getElementById('boot-screen')) return;
      skipShown = true;
      const skipBtn = document.createElement('button');
      skipBtn.textContent = 'Continue anyway';
      skipBtn.className = 'boot-skip-btn';
      skipBtn.onclick = () => { minWait.then(dismiss); };
      screen.appendChild(skipBtn);
    }
    setTimeout(showSkip, 20000);

    let attempts = 0;
    async function poll() {
      attempts++;
      if (_local && attempts === 8) { showSkip(); }
      try {
        const res  = await fetch(`${API_BASE}/health`,
          { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        if (data.status === 'ok') {
          await minWait;
          dismiss();
          return;
        }
        if (data.status === 'error') { showSkip(); }
      } catch {}
      setTimeout(poll, 1500);
    }

    poll();
  })();

  // ── Feedback toggle ────────────────────────────────────
  const toggle = document.getElementById('feedback-toggle');

  function syncToggle() {
    const on = Store.getFeedbackMode();
    toggle.classList.toggle('active', on);
    toggle.setAttribute('aria-checked', String(on));
  }

  toggle.addEventListener('click', () => {
    Store.setFeedbackMode(!Store.getFeedbackMode());
    syncToggle();
  });

  window._syncFeedbackToggle = syncToggle;
  syncToggle();
  Router.init();

  window.DB?.getContactId();
});
