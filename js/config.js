// After deploying the Python API, paste its URL here (no trailing slash).
const EFROG_API_URL = 'https://efrog.onrender.com';

// Run the classifier entirely in the browser (onnxruntime-web) instead of
// calling the Python API. This removes the server from the prediction path, so
// there is no cold start and nothing to time out — the model is fetched once,
// cached, and runs locally. The API URL above is still used for optional
// sign-in/history sync; classification ignores it when this is true.
const EFROG_LOCAL_INFERENCE = true;
const EFROG_MODEL_URL  = './frog_classifier.onnx';   // static model file
const EFROG_LABELS_URL = './labels.json';            // class list (order matters)

// classifier.js is an ES module and can't see these classic-script consts, so
// expose the ones it needs on window.
window.EFROG_LOCAL_INFERENCE = EFROG_LOCAL_INFERENCE;
window.EFROG_MODEL_URL       = EFROG_MODEL_URL;
window.EFROG_LABELS_URL      = EFROG_LABELS_URL;

// Supabase — feedback & contact collection, written straight from the browser.
// These are PUBLIC client credentials: the anon key is safe to ship (that's its
// purpose), because what it can do is governed by Row-Level-Security policies in
// Supabase. Get both from your project: Settings → API → "Project URL" and the
// "anon" / public key. Until they're filled in, feedback submit shows an error.
const SUPABASE_URL      = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_PUBLIC_KEY';

// Exposed on window so ES-module scripts (db.js) can read them too.
window.SUPABASE_URL      = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;

// Auth0 — create a Single Page Application in your Auth0 dashboard.
// Allowed Callback URLs : https://efrog-seven.vercel.app, http://localhost:*
// Allowed Logout URLs   : https://efrog-seven.vercel.app, http://localhost:*
// Allowed Web Origins   : https://efrog-seven.vercel.app, http://localhost:*
const AUTH0_DOMAIN    = 'dev-rbxcy3tqjhebw7aa.us.auth0.com';
const AUTH0_CLIENT_ID = '0yQ2GazCdsQAWkcUb8LLNcqjmVlb4i2m';
const AUTH0_AUDIENCE  = EFROG_API_URL;  // must match the API Identifier in Auth0
