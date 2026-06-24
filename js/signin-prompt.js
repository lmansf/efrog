// Sign-in prompt shown on the user's first visit.
// Persists the user's choice in localStorage so it never reappears after
// being dismissed or after the user signs in.

const STORAGE_KEY = 'efrog_signin_prompt_dismissed';

(function () {
  // Do not show if already dismissed, signed-in, or Auth0 is not configured.
  function shouldShow() {
    return !localStorage.getItem(STORAGE_KEY);
  }

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1');
    const modal = document.getElementById('signin-prompt-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.classList.add('closing');
    let removed = false;
    const done = () => { if (removed) return; removed = true; modal.remove(); };
    modal.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400);
  }

  function render() {
    const tpl = document.createElement('div');
    tpl.innerHTML = `
      <div class="fb-modal signin-prompt-modal" id="signin-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="signin-prompt-title">
        <div class="fb-modal-backdrop" id="signin-prompt-backdrop"></div>
        <div class="fb-modal-body signin-prompt-body">
          <button class="fb-modal-x" id="signin-prompt-close" aria-label="Dismiss">&times;</button>
          <div class="signin-prompt-icon" aria-hidden="true">🐸</div>
          <h2 class="fb-modal-title" id="signin-prompt-title">Save your frog sightings</h2>
          <p class="fb-modal-caption signin-prompt-caption">
            Sign in to build a personal collection — every observation you record
            is saved to your account so you can browse, search, and share your
            history from any device.
          </p>
          <p class="signin-prompt-optional">Signing in is completely optional.</p>
          <div class="signin-prompt-actions">
            <button class="btn btn-primary signin-prompt-login" id="signin-prompt-login">Sign in</button>
            <button class="btn btn-ghost signin-prompt-skip" id="signin-prompt-skip">Continue without signing in</button>
          </div>
        </div>
      </div>
    `;
    const modal = tpl.firstElementChild;
    document.body.appendChild(modal);

    requestAnimationFrame(() => modal.classList.add('open'));

    modal.querySelector('#signin-prompt-close').addEventListener('click', dismiss);
    modal.querySelector('#signin-prompt-skip').addEventListener('click', dismiss);
    modal.querySelector('#signin-prompt-backdrop').addEventListener('click', dismiss);

    modal.querySelector('#signin-prompt-login').addEventListener('click', async () => {
      dismiss();
      await window.Auth?.login();
    });

    const onKey = e => { if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  }

  // Show after the boot screen is gone. We watch for the boot-screen element
  // to be removed from the DOM, then wait a short beat so the page feels settled.
  function waitForBoot(cb) {
    const boot = document.getElementById('boot-screen');
    if (!boot) { cb(); return; }
    const observer = new MutationObserver(() => {
      if (!document.getElementById('boot-screen')) {
        observer.disconnect();
        setTimeout(cb, 600);
      }
    });
    observer.observe(document.body, { childList: true });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!shouldShow()) return;

    // Skip if the user is already authenticated.
    const authed = await window.Auth?.isAuthenticated().catch(() => false);
    if (authed) {
      localStorage.setItem(STORAGE_KEY, '1');
      return;
    }

    waitForBoot(render);
  });
})();
