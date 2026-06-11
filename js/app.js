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

    // ── Slide carousel ──────────────────────────────────────
    const slides   = screen.querySelectorAll('.boot-slide');
    const dots     = screen.querySelectorAll('.boot-slide-dot');
    let slideIdx   = 0;

    function goToSlide(idx) {
      slides[slideIdx].classList.remove('boot-slide-active');
      dots[slideIdx].classList.remove('boot-slide-dot-active');
      slideIdx = (idx + slides.length) % slides.length;
      slides[slideIdx].classList.add('boot-slide-active');
      dots[slideIdx].classList.add('boot-slide-dot-active');
    }

    const slideTimer = setInterval(() => goToSlide(slideIdx + 1), 3800);

    function dismiss() {
      clearInterval(dotTimer);
      clearInterval(slideTimer);
      screen.classList.add('boot-exit');
      screen.addEventListener('animationend', () => {
        screen.remove();
      }, { once: true });
    }

    // If no API is configured yet, skip health check and just boot
    if (!API_BASE) {
      minWait.then(dismiss);
      return;
    }

    // Poll /health until model is ready, then wait out the minimum
    const REMOTE_MSGS = [
      [5,  'Server is starting up…'],
      [15, 'Loading model — first visit takes a moment…'],
      [30, 'Still warming up, almost there…'],
    ];
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
      screen.querySelector('.boot-corner').appendChild(skipBtn);
    }
    setTimeout(showSkip, 20000);

    let attempts = 0;
    async function poll() {
      attempts++;
      if (_local) {
        if (attempts === 8) { subEl.textContent = 'Run: python server.py'; showSkip(); }
      } else {
        for (const [n, msg] of REMOTE_MSGS) {
          if (attempts === n) { subEl.textContent = msg; break; }
        }
      }
      try {
        const res  = await fetch(`${API_BASE}/health`,
          { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        if (data.status === 'ok') {
          await minWait;
          dismiss();
          return;
        }
        if (data.status === 'loading') {
          subEl.textContent = 'Loading model — almost ready…';
        }
        if (data.status === 'error') {
          subEl.textContent = 'The classifier failed to load on the server — check the server logs.';
          showSkip();
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

  window._syncFeedbackToggle = syncToggle;
  syncToggle();
  Router.init();
});
