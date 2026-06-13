// Auth0 SPA integration.
// Depends on: auth0-spa-js UMD loaded via <script> before this module (sets window.createAuth0Client).
// Exposes window.Auth = { login, logout, isAuthenticated, getUser, getToken, toggle }.

let _client    = null;
let _initError = null;

const _ready = (async () => {
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID) return; // not configured — silent no-op

  _client = await auth0.createAuth0Client({
    domain:   AUTH0_DOMAIN,
    clientId: AUTH0_CLIENT_ID,
    authorizationParams: {
      audience:     AUTH0_AUDIENCE,
      redirect_uri: window.location.origin,
    },
  });

  // Handle the redirect back from Auth0 after login
  if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
    try {
      const result  = await _client.handleRedirectCallback();
      const returnTo = result.appState?.returnTo ?? '#record';
      window.history.replaceState({}, '', window.location.pathname + returnTo);
    } catch {
      window.history.replaceState({}, '', window.location.pathname + '#record');
    }
  }

  await _renderNav();

  // On authenticated page load: sync local DuckDB → Supabase.
  // DuckDB-WASM is lazy-loaded — poll until window.DB is ready before syncing.
  if (await _client.isAuthenticated()) {
    (async () => {
      const deadline = Date.now() + 15000;
      while (!window.DB && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100));
      }
      try {
        const [token, user] = await Promise.all([
          _client.getTokenSilently(),
          _client.getUser(),
        ]);
        const username   = user?.name ?? user?.email ?? '';
        const contactId  = window.DB?.getContactId();
        await window.DB?.upsertContact({
          id:       contactId,
          email:    user?.email ?? '',
          username,
        });
        await window.DB?.sync(token, username);
      } catch (e) {
        console.warn('[Auth] post-login sync failed:', e.message);
      }
    })();
  }
})().catch(err => {
  _initError = err;
  console.warn('[Auth] init failed:', err.message);
});

async function _renderNav() {
  const btn = document.getElementById('auth-btn');
  if (!btn) return;
  const authed = _client ? await _client.isAuthenticated() : false;
  const user   = authed  ? await _client.getUser()          : null;
  btn.textContent = authed ? (user?.name ?? user?.email ?? 'Account') : 'Sign in';
  btn.classList.toggle('auth-signed-in', authed);
}

window.Auth = {
  async login() {
    await _ready;
    if (!_client) {
      console.error('[Auth] client not initialised — check AUTH0_DOMAIN / AUTH0_CLIENT_ID in config.js');
      return;
    }
    try {
      await _client.loginWithRedirect({
        appState: { returnTo: window.location.hash || '#record' },
      });
    } catch (err) {
      console.error('[Auth] loginWithRedirect failed:', err.message);
    }
  },

  async logout() {
    await _ready;
    if (!_client) return;
    await _client.logout({ logoutParams: { returnTo: window.location.origin + '/#record' } });
  },

  async isAuthenticated() {
    await _ready;
    return _client ? _client.isAuthenticated() : false;
  },

  async getUser() {
    await _ready;
    return _client ? _client.getUser() : null;
  },

  async getToken() {
    await _ready;
    if (!_client) throw new Error('Auth not configured');
    return _client.getTokenSilently();
  },

  async toggle() {
    if (await this.isAuthenticated()) {
      await this.logout();
    } else {
      await this.login();
    }
    await _renderNav();
  },
};
