// login.js — login.html only. style.css stays a plain root-level stylesheet
// (see vite.config.js's comment) referenced via a normal <link> tag in
// login.html, not imported here — every page, old and new, shares that one
// file rather than each Vite entry bundling its own CSS copy.
'use strict';

const {
  getAuth, getSavedServerUrl, login, loginWithGoogle, mountGoogleButton, completeGoogleSignIn,
  redeemPendingInvite,
} = window;

const serverUrlEl = document.getElementById('serverUrl');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const errorText = document.getElementById('errorText');

// An invite can arrive as ?invite=CODE as well as in localStorage — invite.html
// puts it in both, because localStorage is per-origin and doesn't survive the
// herae.app → app.herae.app hop that logging in involves.
const inviteParam = new URLSearchParams(location.search).get('invite');
if (inviteParam) window.savePendingInvite(inviteParam);

// Already logged in? Redeem anything pending BEFORE leaving, or arriving here
// with a session and a fresh invite would silently drop it on the way to the
// feed.
if (getAuth()) {
  redeemPendingInvite().then((r) => {
    window.location.href = r && r.username && !r.self
      ? `user.html?u=${encodeURIComponent(r.username)}`
      : 'memories.html';
  });
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

// Offered only when the server says Google is configured, so this resolves to
// nothing at all on a deployment without it. Awaiting it isn't necessary —
// password login is usable the whole time it's in flight.
mountGoogleButton(document.getElementById('googleMount'), {
  label: 'Continue with Google',
  onToken: async (accessToken) => {
    errorText.textContent = '';
    try {
      // A brand-new Google account has no username yet; completeGoogleSignIn
      // runs that prompt and retries, and resolves null if they back out.
      const result = await completeGoogleSignIn(accessToken, (token, username) =>
        loginWithGoogle(token, serverUrlEl.value.trim(), username));
      if (!result) return;
      // Awaited so the redirect below can't cancel it mid-flight.
      await redeemPendingInvite();
      const returnTo = sessionStorage.getItem('moments_return_to');
      sessionStorage.removeItem('moments_return_to');
      window.location.href = returnTo || 'memories.html';
    } catch (err) {
      errorText.textContent = err.message;
    }
  },
}).then((mounted) => {
  if (mounted) document.getElementById('googleDivider')?.classList.remove('hidden');
});

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
    await redeemPendingInvite();
    const returnTo = sessionStorage.getItem('moments_return_to');
    sessionStorage.removeItem('moments_return_to');
    window.location.href = returnTo || 'memories.html';
  } catch (err) {
    errorText.textContent = err.message;
    loginBtn.disabled = false;
    loginBtn.textContent = 'Log In';
  }
});
