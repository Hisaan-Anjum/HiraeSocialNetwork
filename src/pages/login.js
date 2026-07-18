// login.js — login.html only. style.css stays a plain root-level stylesheet
// (see vite.config.js's comment) referenced via a normal <link> tag in
// login.html, not imported here — every page, old and new, shares that one
// file rather than each Vite entry bundling its own CSS copy.
'use strict';

const { getAuth, getSavedServerUrl, login } = window;

const serverUrlEl = document.getElementById('serverUrl');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const errorText = document.getElementById('errorText');

// Already logged in? Skip straight to the feed.
if (getAuth()) {
  window.location.href = 'memories.html';
}

serverUrlEl.value = getSavedServerUrl();

// In production the site is served by the API server, so the address is simply
// this page's own origin (getSavedServerUrl resolves it) and users enter only
// username + password — hide the field. It stays visible when there's no usable
// origin (file://) or the site is served from a localhost dev server.
const serverUrlField = document.getElementById('serverUrlField');
const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
const derivesFromOrigin = location.protocol.startsWith('http') && !isLocalHost;
if (serverUrlField && derivesFromOrigin) serverUrlField.style.display = 'none';

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorText.textContent = '';
  const serverUrl = serverUrlEl.value.trim();
  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  if (!serverUrl) { errorText.textContent = 'Enter the server address.'; return; }
  if (!username || !password) { errorText.textContent = 'Enter your username and password.'; return; }

  loginBtn.disabled = true;
  loginBtn.textContent = 'Logging in…';
  try {
    await login(serverUrl, username, password);
    const returnTo = sessionStorage.getItem('moments_return_to');
    sessionStorage.removeItem('moments_return_to');
    window.location.href = returnTo || 'memories.html';
  } catch (err) {
    errorText.textContent = err.message;
    loginBtn.disabled = false;
    loginBtn.textContent = 'Log In';
  }
});
