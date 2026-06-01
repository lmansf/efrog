document.addEventListener('DOMContentLoaded', () => {
  // ── Boot screen ────────────────────────────────────────
  (function () {
    const screen = document.getElementById('boot-screen');
    const dotsEl = document.getElementById('boot-dots');
    const subEl  = document.getElementById('boot-label-sub');
    if (!screen) return;

    // Animated dots: "Loading." → ".." → "..."
    const DOT_STATES = ['.', '..', '...'];
    let dotIdx = 0;
    const dotTimer = setInterval(() => {
      dotsEl.textContent = DOT_STATES[dotIdx++ % 3];
    }, 800);

    // Minimum visible time — starts counting from page load
    const minWait = new Promise(resolve => setTimeout(resolve, 2000));

    const _local   = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    const API_BASE = _local ? 'http://localhost:5000' : EFROG_API_URL;

    function dismiss() {
      clearInterval(dotTimer);
      screen.classList.add('boot-exit');
      screen.addEventListener('animationend', () => screen.remove(), { once: true });
    }

    // If no API is configured yet, skip health check and just boot
    if (!API_BASE) {
      minWait.then(dismiss);
      return;
    }

    // Poll /health until model is ready, then wait out the minimum
    let attempts = 0;
    async function poll() {
      attempts++;
      if (attempts === 8 && _local) subEl.textContent = 'Run: python server.py';
      try {
        const res  = await fetch(`${API_BASE}/health`,
          { signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        if (data.status === 'ok') {
          await minWait;
          dismiss();
          return;
        }
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

  syncToggle();
  Router.init();
});
