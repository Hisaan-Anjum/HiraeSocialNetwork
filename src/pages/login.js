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
// …and go back to where they were headed. This used to send everyone to the
// feed, which is how a review page that lost the sign-in race (api.js
// requireAuth) turned into "the review never opened": the extension's login
// arrived a moment later, this branch ran, and the night they were sent to
// review was replaced by the feed.
function leaveLoggedIn() {
  redeemPendingInvite().then((r) => {
    const returnTo = sessionStorage.getItem('moments_return_to');
    sessionStorage.removeItem('moments_return_to');
    window.location.href = r && r.username && !r.self
      ? `user.html?u=${encodeURIComponent(r.username)}`
      : (returnTo || 'memories.html');
  });
}
if (getAuth()) {
  leaveLoggedIn();
} else if (window.whenExtensionMaybeSignsIn) {
  // The extension may still be about to sign this page in (same race, seen
  // from here): if it does, nobody should be left looking at a login form.
  window.whenExtensionMaybeSignsIn(leaveLoggedIn, () => {
    // Still nothing — but somebody sent here from a page the extension opened
    // (a saved return address) may simply have a slow machine. Keep looking for
    // a while; typing a password meanwhile works exactly as before.
    if (!sessionStorage.getItem('moments_return_to')) return;
    let tries = 0;
    const t = setInterval(() => {
      if (getAuth()) { clearInterval(t); leaveLoggedIn(); }
      else if (++tries > 180) clearInterval(t);
    }, 500);
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

// ── If the extension signs in while this page is open, follow it through ──
// The extension writes the token into this origin's localStorage from its
// content script. Somebody who reached this page a moment before that
// happened — or who was already looking at it when they signed into the
// extension — would otherwise sit in front of a login form they no longer
// need, with the credentials already on the machine.
//
// Polling rather than a `storage` event, deliberately: that event fires in
// OTHER tabs, never the one whose localStorage was written, and this is the
// tab it gets written into.
(() => {
  const started = Date.now();
  const LIMIT_MS = 20_000;
  const tick = () => {
    let auth = null;
    try { auth = JSON.parse(localStorage.getItem('moments_auth') || 'null'); } catch (e) { /* corrupt */ }
    if (auth && auth.token) {
      const returnTo = sessionStorage.getItem('moments_return_to');
      sessionStorage.removeItem('moments_return_to');
      window.location.href = returnTo || 'memories.html';
      return;
    }
    if (Date.now() - started < LIMIT_MS) setTimeout(tick, 250);
  };
  // A beat after load, so a person typing their password is never interrupted
  // by a redirect they did not ask for on the very first frame.
  setTimeout(tick, 300);
})();
