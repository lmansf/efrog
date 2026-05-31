const Router = {
  pages: {
    record:  RecordPage,
    history: HistoryPage,
    about:   AboutPage,
  },
  default: 'record',

  init() {
    window.addEventListener('hashchange', () => this.navigate());
    this.navigate();
  },

  navigate() {
    const hash     = window.location.hash.slice(1);
    const pageName = this.pages[hash] ? hash : this.default;
    const page     = this.pages[pageName];

    document.getElementById('app').innerHTML = page.render();
    page.init();
    this.setActive(pageName);
  },

  setActive(name) {
    document.querySelectorAll('.nav-link, .bottom-nav-link').forEach(link =>
      link.classList.toggle('active', link.dataset.page === name)
    );
  },
};
