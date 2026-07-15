// Feedback modal — the general ratings / suggestions form, opened from the
// "Feedback" button in the header (any page). Submits straight to Supabase, the
// same anonymous-friendly path the rest of the app uses. The per-card
// agree/dispute controls under a result are separate (see record.js); this is
// the open-ended "how's the site / the ID" form.
const Feedback = (function () {
  let _open = false;

  function formHtml() {
    return `
      <div class="fb-modal" id="fb-modal">
        <div class="fb-modal-backdrop" data-close="1"></div>
        <div class="fb-modal-body" role="dialog" aria-modal="true" aria-label="Send feedback">
          <button class="fb-modal-x" data-close="1" aria-label="Close">&times;</button>
          <h2 class="fb-modal-title">Give Feedback</h2>
          <p class="fb-modal-caption">Tell us how the ID and the site are working for you.</p>

          <div class="form-group">
            <label class="form-label" for="fb-name">Name <span class="form-optional">(optional)</span></label>
            <input type="text" id="fb-name" class="form-input" placeholder="Your name">
          </div>

          <div class="form-group">
            <label class="form-label">Accuracy Rating <span class="form-optional">How accurate was the ID?</span></label>
            <div class="rating-wrap">
              <span class="rating-min">0</span>
              <input type="range" min="0" max="10" value="5" id="fb-accuracy" class="rating-slider">
              <span class="rating-max">10</span>
              <span class="rating-val" id="fb-accuracy-val">5</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Site / Interface Rating <span class="form-optional">How's the experience?</span></label>
            <div class="rating-wrap">
              <span class="rating-min">0</span>
              <input type="range" min="0" max="10" value="5" id="fb-site" class="rating-slider">
              <span class="rating-max">10</span>
              <span class="rating-val" id="fb-site-val">5</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Are you a member of FrogWatch?</label>
            <div class="frogwatch-opts">
              <button type="button" class="btn frogwatch-opt" data-val="yes">Yes</button>
              <button type="button" class="btn frogwatch-opt" data-val="no">No</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="fb-note">Feedback &amp; Suggestions <span class="form-optional">(optional)</span></label>
            <textarea id="fb-note" class="feedback-note" placeholder="Tell us what you think…"></textarea>
          </div>

          <div class="form-group">
            <label class="form-label" for="fb-email">Email <span class="form-optional">(optional — only if you'd like us to follow up or feature you)</span></label>
            <input type="email" id="fb-email" class="form-input" placeholder="you@example.com" autocomplete="email">
          </div>

          <div class="form-group">
            <div class="feedback-public-row">
              <label class="feedback-public-label">
                <input type="checkbox" id="fb-make-public" class="feedback-public-check">
                Make Public
              </label>
              <span class="feedback-public-caption">You're invited to make yourself eligible for feature on our website. As feedback is implemented, some will be selected to celebrate</span>
            </div>
          </div>

          <div class="feedback-row">
            <button id="fb-submit" class="btn btn-secondary">Submit</button>
            <button class="btn btn-ghost btn-sm" data-close="1">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  function open() {
    if (_open) return;
    _open = true;
    window.Telemetry?.track('feedback_opened');
    const tpl = document.createElement('div');
    tpl.innerHTML = formHtml();
    const modal = tpl.firstElementChild;
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));

    modal.querySelector('#fb-accuracy')?.addEventListener('input', e =>
      (modal.querySelector('#fb-accuracy-val').textContent = e.target.value));
    modal.querySelector('#fb-site')?.addEventListener('input', e =>
      (modal.querySelector('#fb-site-val').textContent = e.target.value));
    modal.querySelectorAll('.frogwatch-opt').forEach(btn =>
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.frogwatch-opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      }));
    modal.querySelector('#fb-submit')?.addEventListener('click', () => submit(modal));
    modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });

    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    modal._onKey = onKey;
  }

  function close() {
    const modal = document.getElementById('fb-modal');
    if (!modal) { _open = false; return; }
    if (modal._onKey) document.removeEventListener('keydown', modal._onKey);
    modal.classList.remove('open');
    modal.classList.add('closing');
    let removed = false;
    const done = () => { if (removed) return; removed = true; modal.remove(); _open = false; };
    modal.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400);
  }

  async function submit(modal) {
    const submitBtn      = modal.querySelector('#fb-submit');
    const name           = (modal.querySelector('#fb-name')?.value || '').trim();
    const email          = (modal.querySelector('#fb-email')?.value || '').trim();
    const accuracyRating = parseInt(modal.querySelector('#fb-accuracy')?.value ?? '5', 10);
    const siteRating     = parseInt(modal.querySelector('#fb-site')?.value ?? '5', 10);
    const frogwatch      = modal.querySelector('.frogwatch-opt.selected')?.dataset.val ?? '';
    const note           = (modal.querySelector('#fb-note')?.value || '').trim();
    const makePublic     = modal.querySelector('#fb-make-public')?.checked ?? false;

    // Link to the most recent analysis if there was one this session.
    const last = window.__efrogLastObs || {};

    let userId = null;
    try { userId = (await window.Auth?.getUser())?.sub ?? null; } catch {}
    const contactId = window.DB?.getContactId() ?? '';

    window.DB?.insertFeedback({
      observationId: last.id ?? null, userId, contactId, name,
      accuracyRating, siteRating, frogwatch, note,
      species: last.species ?? null, confidence: last.confidence ?? null,
      userAgent: navigator.userAgent, makePublic,
    }).catch(() => {});

    const row = {
      id:              crypto.randomUUID(),
      observation_id:  String(last.id ?? ''),
      created_at:      new Date().toISOString(),
      user_id:         userId ?? '',
      contact_id:      contactId,
      name, email,
      accuracy_rating: accuracyRating,
      site_rating:     siteRating,
      frogwatch, note,
      species:         last.species ?? '',
      confidence:      last.confidence ?? null,
      user_agent:      navigator.userAgent,
      make_public:     makePublic,
    };

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }
    try {
      await window.DB.sendFeedback(row);
      if (email) {
        window.DB.sendContact({ id: contactId, email, username: name, updated_at: row.created_at }).catch(() => {});
      }
      window.Telemetry?.track('feedback_submitted', {
        accuracy_rating: accuracyRating, site_rating: siteRating,
        frogwatch: frogwatch || undefined,
        has_note: Boolean(note), has_email: Boolean(email), make_public: makePublic,
      });
      toast('Feedback submitted — thank you!');
      close();
    } catch (err) {
      console.error('[feedback] submit failed:', err);
      window.Telemetry?.track('feedback_failed', { message: String(err?.message || err).slice(0, 200) });
      toast('Could not submit feedback — please try again.');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
    }
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'feedback-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      t.classList.add('toast-exit');
      t.addEventListener('animationend', () => t.remove(), { once: true });
    }, 2500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('feedback-btn')?.addEventListener('click', open);
  });

  return { open, close };
})();

window.Feedback = Feedback;
