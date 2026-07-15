// login.js — login.html only.
'use strict';

const serverUrlEl = document.getElementById('serverUrl');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const errorText = document.getElementById('errorText');

// Already logged in? Skip straight to the gallery.
if (getAuth()) {
  window.location.href = 'memories.html';
}

serverUrlEl.value = getSavedServerUrl();

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
