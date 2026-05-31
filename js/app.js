document.addEventListener('DOMContentLoaded', () => {
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
