// After deploying the Python API, paste its URL here (no trailing slash).
const EFROG_API_URL = 'https://efrog.onrender.com';

// Auth0 — create a Single Page Application in your Auth0 dashboard.
// Allowed Callback URLs : https://efrog-seven.vercel.app, http://localhost:*
// Allowed Logout URLs   : https://efrog-seven.vercel.app, http://localhost:*
// Allowed Web Origins   : https://efrog-seven.vercel.app, http://localhost:*
const AUTH0_DOMAIN    = 'dev-rbxcy3tqjhebw7aa.us.auth0.com';
const AUTH0_CLIENT_ID = '0yQ2GazCdsQAWkcUb8LLNcqjmVlb4i2m';
const AUTH0_AUDIENCE  = EFROG_API_URL;  // must match the API Identifier in Auth0
