// api.js — shared auth/session + fetch helpers for every page on this site.
// Logs into the SAME server (and the same account) as the Herae extension —
// there's no separate signup/auth system here at all.
'use strict';

const AUTH_KEY = 'moments_auth'; // { token, username, serverUrl }
const SERVER_URL_KEY = 'moments_server_url';

// ── One canonical origin for the app ──────────────────────────────────
// CloudFront serves BOTH herae.app and app.herae.app from this same backend, so
// the apex answers /login.html and /api/* perfectly well. That sounds harmless
// and isn't: every in-app link is relative, so whoever starts on the apex stays
// there for the whole session, and localStorage — which holds the session — is
// per-origin.
//
// The concrete failure: sign in on herae.app, and the shared .herae.app
// auth-hint cookie later convinces index.html to send you to
// app.herae.app/memories.html, where there is no stored session at all. You get
// bounced to the login page while apparently already signed in.
//
// So app pages move to the app subdomain before anything reads or writes
// storage. The apex keeps the landing page and the legal pages, which don't
// load this file — except index.html, which does, and is excluded by path.
(function canonicalOrigin() {
  if (location.hostname !== 'herae.app') return;
  const p = location.pathname;
  if (p === '/' || p === '/index.html') return;   // the marketing landing lives here
  location.replace(`https://app.herae.app${p}${location.search}${location.hash}`);
}());

function getSavedServerUrl() {
  // The site is normally served BY the API server itself now (see the
  // static mount in server/src/index.js) — in that case the server's
  // address is simply this page's own origin, no configuration needed.
  // config.js's defaultServerUrl remains as the fallback for anyone still
  // hosting the site separately (file://, a static host, etc.).
  return localStorage.getItem(SERVER_URL_KEY)
    || (location.protocol.startsWith('http') ? location.origin : '')
    || (window.MOMENTS_CONFIG && window.MOMENTS_CONFIG.defaultServerUrl)
    || '';
}

function getAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
}

// A cross-subdomain "someone is signed in" hint. localStorage is per-origin, so
// the apex (herae.app) can't see the auth stored on app.herae.app — but a cookie
// scoped to .herae.app is shared across both. This is NOT the auth token, just a
// flag that lets the landing page (index.html) redirect a signed-in visitor from
// herae.app to the app on app.herae.app; app.herae.app still validates the real
// JWT. Only set on herae.app hosts, so local development is unaffected.
function setAuthHintCookie(on) {
  const host = location.hostname;
  if (host !== 'herae.app' && host !== 'app.herae.app') return;
  document.cookie = on
    ? 'herae_auth_hint=1; domain=.herae.app; path=/; max-age=31536000; secure; samesite=lax'
    : 'herae_auth_hint=; domain=.herae.app; path=/; max-age=0; secure; samesite=lax';
}

function setAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  localStorage.setItem(SERVER_URL_KEY, auth.serverUrl);
  setAuthHintCookie(true);
  broadcastAuthChange(auth);
  // One hook for every route into a session — password login, signup, and Google
  // on either surface — so no individual auth path has to know invites exist.
  // Deliberately not awaited: connecting a pair must never delay or fail the
  // login itself, and redeemPendingInvite swallows its own errors.
  redeemPendingInvite();
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
  setAuthHintCookie(false);
  broadcastAuthChange(null);
}

// Let the Herae browser extension mirror this login/logout so the extension and
// the site stay in one shared session. The extension's content script listens
// for this window message on trusted memories-site pages (see content.js); a
// plain browser with no extension simply ignores it.
function broadcastAuthChange(auth) {
  try { window.postMessage({ __heraeAuth: true, auth: auth || null }, window.location.origin); } catch (e) { /* non-browser env */ }
}

// ── Subscription nav tabs + current-plan pill ────────────────────────
// Adds "Upgrade" and "Billing" links to the top nav, plus a small pill showing
// the current plan, on every page that has the nav — so plans, billing and
// status are reachable from anywhere (not only the extension popup). Idempotent
// and signed-in-only. Injected here because api.js is the one script every page
// already loads, so no per-page edits are needed.
function ensureSubStyles() {
  if (document.getElementById('herae-sub-styles')) return;
  const st = document.createElement('style');
  st.id = 'herae-sub-styles';
  st.textContent =
    '.plan-pill{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;' +
    'padding:5px 12px;border-radius:999px;text-decoration:none;white-space:nowrap;' +
    'color:var(--ink-dim);background:rgba(255,255,255,.05);border:1px solid var(--border);' +
    'transition:border-color .15s ease,color .15s ease,filter .15s ease;}' +
    '.plan-pill:hover{color:var(--ink);border-color:var(--purple);}' +
    '.plan-pill-paid{color:#fff;border:none;background:linear-gradient(135deg,var(--purple),var(--purple-deep));' +
    'box-shadow:0 2px 10px rgba(139,92,246,.35);}' +
    '.plan-pill-paid:hover{color:#fff;filter:brightness(1.08);}';
  document.head.appendChild(st);
}

async function injectSubscriptionNav() {
  if (typeof getAuth === 'function' && !getAuth()) return; // signed-in only
  ensureSubStyles();
  const page = location.pathname.replace(/^.*\//, '');
  let s = null;
  try { s = await apiRequest('/api/subscription/status'); } catch (e) { /* leave null */ }

  const nav = document.querySelector('.nav-links');
  if (nav && !nav.querySelector('[data-herae-sub-nav]')) {
    const link = (href, label) => {
      const a = document.createElement('a');
      a.href = href; a.textContent = label;
      a.className = 'nav-link' + (page === href ? ' nav-link-active' : '');
      a.setAttribute('data-herae-sub-nav', '1');
      return a;
    };
    // "Upgrade" only when there IS something to upgrade to: free users, or an
    // OWN Plus plan (→ Together). Hidden for Together owners, and for anyone
    // already covered by someone else's Together.
    const canUpgrade = !s || !s.unlimited || (s.plan === 'plus' && s.source === 'own');
    if (canUpgrade) nav.appendChild(link('upgrade.html', 'Upgrade'));
    nav.appendChild(link('billing.html', 'Billing'));
  }

  // Current-plan pill, top-right of the nav, linking to billing.
  const right = document.querySelector('.topbar-right');
  if (s && right && !right.querySelector('[data-herae-plan]')) {
    const a = document.createElement('a');
    a.href = 'billing.html';
    a.setAttribute('data-herae-plan', '1');
    a.className = 'plan-pill' + (s.unlimited ? ' plan-pill-paid' : '');
    a.title = 'Your Herae plan';
    a.textContent = s.unlimited ? (s.plan === 'together' ? '✨ Together' : '✨ Plus') : 'Free plan';
    right.insertBefore(a, right.firstChild);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectSubscriptionNav);
else injectSubscriptionNav();

// Every page except index.html (landing) and login.html needs this —
// redirects to the login form if there's no stored session, and hands back
// the auth object otherwise so the caller doesn't have to call getAuth()
// separately. Stashes the current URL (path+query) first — review.html
// arrives with a ?session= the extension needs to land back on after
// login, not just dumped at the generic feed; see login.js's
// redirect-back handling.
// ── The extension signs you in AFTER this page has decided you are out ──
// The extension writes `moments_auth` into this origin's localStorage from its
// content script, and Chrome runs content scripts at document_idle — which is
// after this file has been evaluated and after requireAuth() has run. So a
// person who was signed into the extension, opening the site cold, was
// redirected to the login page a fraction of a second before the credentials
// they already had arrived. Reported as "the extension login doesn't log the
// website in", and it is a race the page usually wins.
//
// Fixed here rather than in the extension because the extension is already
// submitted for review, and because this is the side that is wrong: nothing
// obliges a page to conclude "logged out" in its first millisecond.
//
// Cost when no extension is installed: one ping and a short wait for a reply
// that never comes. It is not a fixed delay on every logged-out visit — the
// extension announces itself, and silence is answered quickly.
const EXT_PROBE_MS = 350;    // long enough for a content script that IS there
const EXT_AUTH_WAIT_MS = 2000; // …and then for it to finish writing the token

function whenExtensionMaybeSignsIn(onAuth, onGiveUp) {
  let settled = false;
  let sawExtension = false;
  const finish = (fn) => { if (settled) return; settled = true; window.removeEventListener('message', onMsg); fn(); };

  const onMsg = (e) => {
    if (e.source !== window || !e.data) return;
    // Either the extension answering our ping, or its unsolicited hello.
    if (e.data.__heraeExtension === true) sawExtension = true;
  };
  window.addEventListener('message', onMsg);
  // The content script answers this if it is listening; if the page got here
  // first, its own announcement arrives shortly and sets the same flag.
  try { window.postMessage({ __heraePing: true }, location.origin); } catch (e) { /* origin oddity */ }

  const started = Date.now();
  const tick = () => {
    if (settled) return;
    if (getAuth()) return finish(onAuth);
    const waited = Date.now() - started;
    // No sign of an extension by the probe deadline: this is an ordinary
    // logged-out visitor and must not be made to wait for one.
    if (!sawExtension && waited >= EXT_PROBE_MS) return finish(onGiveUp);
    if (waited >= EXT_AUTH_WAIT_MS) return finish(onGiveUp);
    setTimeout(tick, 50);
  };
  tick();
}

function requireAuth() {
  const auth = getAuth();
  if (auth) return auth;
  whenExtensionMaybeSignsIn(
    // It arrived. Reload rather than continue: every page reads auth once, at
    // the top, and half of them have already given up by now.
    () => window.location.reload(),
    () => {
      sessionStorage.setItem('moments_return_to', location.pathname + location.search);
      window.location.href = 'login.html';
    },
  );
  return null;
}

function logout() {
  clearAuth();
  window.location.href = 'index.html';
}

// ── In-tab navigation breadcrumb ─────────────────────────────────────
// A Back button needs to know "did I arrive here from another page of this
// site, or was I opened cold?" — document.referrer is the obvious answer
// and is useless here: the server sends `Referrer-Policy: no-referrer`
// (helmet's default, see server/src/index.js), so it is ALWAYS empty on
// every page of this site. Rather than weaken that header, each page
// records the page being left, per-tab, and the next one reads it.
//
// Lives in api.js because it's the one script every page loads (as a plain
// classic script, before anything else), so the breadcrumb is dropped no
// matter which page you're leaving. Read via cameFromThisSite() below —
// see src/lib/util.js's initBackLinks.
const NAV_PREV_KEY = 'herae_prev_page';
let navCameFrom = null;
try {
  const prev = sessionStorage.getItem(NAV_PREV_KEY);
  // Same URL means a reload, not an arrival from somewhere else.
  navCameFrom = prev && prev !== location.href ? prev : null;
} catch (e) { /* sessionStorage unavailable — Back just uses its href */ }
window.addEventListener('pagehide', () => {
  try { sessionStorage.setItem(NAV_PREV_KEY, location.href); } catch (e) {}
});

// True when this tab has a page of this site behind it to go back to.
function cameFromThisSite() {
  return !!navCameFrom && history.length > 1;
}

// Long enough that a slow connection still loads a night's memories, short
// enough that nobody sits in front of a spinner wondering.
const REQUEST_TIMEOUT_MS = 20_000;

async function apiRequest(path, options = {}) {
  const auth = getAuth();
  const base = (auth?.serverUrl || getSavedServerUrl()).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  let resp;
  // ── A request that never answers is not an error anybody sees ─────
  // fetch() rejects when a connection FAILS. It waits indefinitely when one
  // is accepted and then goes quiet — a server mid-restart, a tunnel that
  // dropped, a laptop that slept — and every page here awaits it before
  // rendering anything. The symptom is a spinner that never stops, with no
  // error, no retry and nothing in the console.
  //
  // A deadline turns that into the failure the code already handles. Generous
  // on purpose: this is a stall guard, not a performance budget, and a slow
  // connection must still be able to load a night's memories.
  const timer = new AbortController();
  const deadline = setTimeout(() => timer.abort(), REQUEST_TIMEOUT_MS);
  try {
    resp = await fetch(`${base}${path}`, { ...options, headers, signal: timer.signal });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError'
      ? 'The server took too long to answer. It may be restarting — try again in a moment.'
      : 'Could not reach the server. Check the address and that it is running.');
  } finally {
    clearTimeout(deadline);
  }
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) {
    clearAuth();
    window.location.href = 'index.html';
    throw new Error('Session expired — please log in again.');
  }
  if (!resp.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function login(serverUrl, username, password) {
  const base = serverUrl.replace(/\/+$/, '');
  let resp;
  try {
    resp = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (e) {
    throw new Error('Could not reach the server. Check the address and that it is running.');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Login failed.');
  setAuth({ token: data.token, username: data.username, serverUrl: base });
  return data;
}

// ── Invite links ──────────────────────────────────────────────────────
// A code parked by invite.html, redeemed the moment an account exists. Stored in
// localStorage rather than sessionStorage on purpose: signing up with Google
// bounces through accounts.google.com and back, and sessionStorage does not
// reliably survive that round trip — the invite would be silently lost exactly
// on the path most new users take.
//
// setAuth() calls redeemPendingInvite(), so EVERY way of arriving at a session —
// password login, signup, Google on either surface — connects the pair without
// each of those paths knowing invites exist.
const PENDING_INVITE_KEY = 'moments_pending_invite';

function savePendingInvite(code) {
  try { localStorage.setItem(PENDING_INVITE_KEY, String(code || '').toUpperCase()); } catch (e) { /* private mode */ }
}
function getPendingInvite() {
  try { return localStorage.getItem(PENDING_INVITE_KEY) || ''; } catch (e) { return ''; }
}
function clearPendingInvite() {
  try { localStorage.removeItem(PENDING_INVITE_KEY); } catch (e) { /* ignore */ }
}

// The in-flight redemption, so setAuth() can start it and the auth page can
// await that same request before it navigates. Without this the login pages
// would redirect out from under a fire-and-forget fetch and cancel it — the
// invite would appear to work and silently connect nobody.
let redeemInFlight = null;

// Cleared whatever the outcome: a code that's invalid, already used, or a
// self-invite must not be retried on every page load forever.
function redeemPendingInvite() {
  if (redeemInFlight) return redeemInFlight;
  const code = getPendingInvite();
  if (!code || !getAuth()) return Promise.resolve(null);
  clearPendingInvite();
  redeemInFlight = apiRequest('/api/invite/redeem', { method: 'POST', body: JSON.stringify({ code }) })
    // Never block someone from using the app over a bad invite.
    .catch(() => null)
    .finally(() => { redeemInFlight = null; });
  return redeemInFlight;
}

function getMyInvite() {
  return apiRequest('/api/me/invite');
}

// Trades a Google access token for a Herae session. Lands in exactly the same
// place as login() — same setAuth, so the same extension bridge fires and the
// rest of the site can't tell which way someone signed in.
//
// The server derives the email from Google directly and never trusts anything
// this function sends beyond the token itself, so there is no account identity
// to pass here.
// `username` is supplied only on the second call of a first-time signup: the
// server refuses to invent one, so a brand-new Google account comes back as
// { needsUsername: true } and the caller asks before calling again with the same
// token. Returns that response untouched rather than throwing, since needing a
// username is a step in the flow, not a failure.
async function loginWithGoogle(accessToken, serverUrl, username) {
  const base = (serverUrl || getSavedServerUrl()).replace(/\/+$/, '');
  const body = { access_token: accessToken };
  if (username) body.username = username;
  let resp;
  try {
    resp = await fetch(`${base}/api/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error('Could not reach the server. Check the address and that it is running.');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // A rejected username is recoverable — hand it back so the caller can show
    // the message against the field instead of blowing the whole flow away.
    if (data.needsUsername) return data;
    throw new Error(data.error || 'Google sign-in failed.');
  }
  if (data.needsUsername) return data;
  setAuth({ token: data.token, username: data.username, serverUrl: base });
  return data;
}

// The main feed — yours, contacts' 'contacts'-privacy posts, and anyone's
// 'public' posts. See moments.js's isMomentVisible for the exact rule.
// cursor is the nextCursor from a previous page (see moments.js's
// cursor-pagination) — omit for the first page.
function getFeed(cursor) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest(`/api/moments/feed${qs}`);
}

// "Only theirs" — every post you actually participated in, any privacy.
function getMine(cursor) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest(`/api/moments/mine${qs}`);
}

// Single-post detail view — for post.html.
function getMomentById(id) {
  return apiRequest(`/api/moments/${id}`);
}
function getReviewById(id) {
  return apiRequest(`/api/reviews/${id}`);
}

// One contact's posts — only the ones visible to you (moments.js enforces
// this server-side too; a non-contact gets a 403 here). Cursor-paginated the
// same way as the main feed (see /by/:username's paginateVisible); omit
// cursor for the first page.
function getPostsByUser(username, cursor) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest(`/api/moments/by/${encodeURIComponent(username)}${qs}`);
}

function setMomentPrivacy(momentId, privacy) {
  return apiRequest(`/api/moments/${momentId}/privacy`, {
    method: 'PATCH',
    body: JSON.stringify({ privacy }),
  });
}

// ── Editing & deletion ───────────────────────────────────────────────
// Each of these mirrors one server route (see server/src/moments.js); the
// server re-checks permission on every one of them, so a UI that only shows
// these controls where `canEdit` is true is a convenience, not the gate.
function updateMoment(momentId, description) {
  return apiRequest(`/api/moments/${momentId}`, { method: 'PATCH', body: JSON.stringify({ description }) });
}
function deleteMoment(momentId) {
  return apiRequest(`/api/moments/${momentId}`, { method: 'DELETE' });
}
function updateReview(reviewId, text, rating) {
  return apiRequest(`/api/reviews/${reviewId}`, { method: 'PATCH', body: JSON.stringify({ text, rating }) });
}
function deleteReview(reviewId) {
  return apiRequest(`/api/reviews/${reviewId}`, { method: 'DELETE' });
}
// One pair of routes for comments on moments AND reviews — post_comments is
// polymorphic, so a comment id alone is enough (see the commentsRouter).
function updateComment(commentId, text) {
  return apiRequest(`/api/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify({ text }) });
}
function deleteComment(commentId) {
  return apiRequest(`/api/comments/${commentId}`, { method: 'DELETE' });
}

// ── Profiles & profile pictures ──────────────────────────────────────
// Any logged-in account can read any profile — that's what makes every
// username on the site clickable. What's actually IN it is still
// visibility-filtered server-side (see server/src/profiles.js).
function getUserProfile(username) {
  return apiRequest(`/api/users/${encodeURIComponent(username)}`);
}
// Username search for the search-results page — username + picture only,
// cursor-paged (see server/src/profiles.js).
function searchUsers(q, cursor) {
  const p = new URLSearchParams({ q });
  if (cursor) p.set('cursor', cursor);
  return apiRequest(`/api/users?${p}`);
}
// `imageDataUrl` is a base64 data URL — see src/lib/imageResize.js, which
// downscales the picked file in the browser first so what crosses the wire
// is tens of KB rather than a multi-megabyte phone photo.
function uploadAvatar(imageDataUrl) {
  return apiRequest('/api/me/avatar', { method: 'PUT', body: JSON.stringify({ image: imageDataUrl }) });
}
function removeAvatar() {
  return apiRequest('/api/me/avatar', { method: 'DELETE' });
}

// Permanently deletes the logged-in account (see server/src/account.js's
// DELETE /api/me and the Account Deletion Policy). `payload` re-authenticates:
// { password } for a local account, or { confirmUsername } for a Google
// account. On success the caller clears auth and redirects.
function deleteAccount(payload) {
  return apiRequest('/api/me', { method: 'DELETE', body: JSON.stringify(payload || {}) });
}

// ── Contact management ───────────────────────────────────────────────
// The same three endpoints the extension popup has always used — the site
// now just drives them too, so there's one contacts system, not two.
function requestContact(username) {
  return apiRequest('/api/contacts/requests', { method: 'POST', body: JSON.stringify({ username }) });
}
function acceptContactRequest(id) {
  return apiRequest(`/api/contacts/${id}/accept`, { method: 'POST' });
}
// Declines an incoming request, cancels an outgoing one, or removes an
// accepted contact — all one "delete the relationship row" server-side.
function removeContact(id) {
  return apiRequest(`/api/contacts/${id}`, { method: 'DELETE' });
}

// What the two of you made together, counted but not yet touched. Asked
// BEFORE the contact row is deleted, because the relationship is what the
// server uses to work out whose history this is.
function getSharedHistory(id) {
  return apiRequest(`/api/contacts/${id}/shared`);
}

// The irreversible half, and deliberately a separate call from removing the
// contact: "delete our history but stay in touch" is a real thing to want,
// and a failure here must leave the contact list untouched.
//
// Nothing involving a third person is ever deleted — the server enforces
// that, not the caller. See contacts.js's protectedSessionIds.
function deleteSharedHistory(id) {
  return apiRequest(`/api/contacts/${id}/shared`, { method: 'DELETE' });
}

// `extra` may include { rating: 1-5, content: {title,url,thumbnailUrl},
// sessionTitle } — all optional, matching /api/moments/session/:id/review's
// body shape. sessionTitle names the SESSION (not the review) and is shared
// by everyone in it; '' clears it, omitting it leaves it untouched.
function postReview(clientSessionId, text, extra = {}) {
  return apiRequest(`/api/moments/session/${encodeURIComponent(clientSessionId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ text, ...extra }),
  });
}

// Names a session without touching (or requiring) a review — see the PATCH
// route's comment. '' clears the title.
function setSessionTitle(clientSessionId, sessionTitle) {
  return apiRequest(`/api/moments/session/${encodeURIComponent(clientSessionId)}/title`, {
    method: 'PATCH',
    body: JSON.stringify({ sessionTitle }),
  });
}

// Everything about one session: participants, its moments (possibly none),
// and all reviews — the review page runs entirely off this.
function getSessionDetail(clientSessionId) {
  return apiRequest(`/api/moments/session/${encodeURIComponent(clientSessionId)}`);
}

// Sessions as first-class feed objects — see moments.js's
// GET /sessions/mine. Used by the redesigned feed to render one card per
// whole watch-session (participants, content, its moments as a carousel,
// its reviews/average rating) instead of one card per photo.
function getSessionsMine(cursor) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest(`/api/moments/sessions/mine${qs}`);
}

function toggleMomentLike(momentId) {
  return apiRequest(`/api/moments/${momentId}/like`, { method: 'POST' });
}
function commentOnMoment(momentId, text) {
  return apiRequest(`/api/moments/${momentId}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
}
function toggleReviewLike(reviewId) {
  return apiRequest(`/api/reviews/${reviewId}/like`, { method: 'POST' });
}
function commentOnReview(reviewId, text) {
  return apiRequest(`/api/reviews/${reviewId}/comments`, { method: 'POST', body: JSON.stringify({ text }) });
}

// Reuses the extension's own contacts endpoint — same account, same
// contact list, nothing new to build server-side for this. `q` is an
// optional substring filter (used by the site's search box).
function getContacts(q) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return apiRequest(`/api/contacts${qs}`);
}

// Absolute media URL — the API returns a server-relative path (e.g.
// /media/moments/xyz.jpg or /media/avatars/abc.jpg); every consumer needs it
// joined with whichever server this browser is actually logged into.
function mediaUrl(relativeUrl) {
  if (!relativeUrl) return '';
  // Idempotent: an already-absolute URL is returned untouched. Callers pass
  // whichever they happen to hold — a raw API path, or a URL some earlier
  // render already joined (e.g. the media viewer re-reads a tile's src) —
  // and blindly concatenating produced "http://host<space>http://host/…",
  // which silently 404s and shows a broken image.
  if (/^(https?:|data:|blob:)/i.test(relativeUrl)) return relativeUrl;
  const auth = getAuth();
  const base = (auth?.serverUrl || getSavedServerUrl()).replace(/\/+$/, '');
  return `${base}${relativeUrl}`;
}

// momentImageUrl is what every existing caller (media tiles, carousels, the
// movie page) already imports — kept as the same name delegating to
// mediaUrl above rather than renamed, since a moment image and an avatar
// need the identical join and there's no reason for two copies of it.
function momentImageUrl(relativeUrl) {
  return mediaUrl(relativeUrl);
}

// The shareable Herae URL for a single post — post.html opens any moment by
// id. Absolute (origin-based) so it survives being pasted into WhatsApp,
// Telegram, a Facebook share, etc. A moment set to 'public' is viewable by
// anyone with the link; a private/contacts one still opens here but the
// server enforces who may actually see it (used by the Share flow).
function momentPublicUrl(id) {
  const origin = location.protocol.startsWith('http')
    ? location.origin
    : ((getAuth()?.serverUrl || getSavedServerUrl()).replace(/\/+$/, ''));
  // /post/<id>, not /post.html?id=<id>: the server route at that path injects
  // this moment's real Open Graph tags before the HTML is sent, so a link
  // pasted into WhatsApp or Discord previews as the memory itself rather than
  // as a generic Herae card. The old query-string form still works and is
  // still given real tags — every link already shared stays valid.
  return `${origin}/post/${encodeURIComponent(id)}`;
}

// ── Relationship Memory Engine ───────────────────────────────────────
// Everything the Memories section on a contact profile renders — stats,
// milestones, the month/year matrix, available story types, Important Dates —
// aggregated server-side for the (me, :username) pair. See
// server/src/relationships.js. All of these require an accepted contact
// (the server 403s otherwise); the site only calls them on such profiles.
function getRelationshipSummary(username) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/summary`);
}

// Important Dates — the shared relationship calendar. `payload` is
// { title, emoji, date: 'YYYY-MM-DD', description?, cover? } where cover is an
// optional base64 image data URL (downscaled client-side first, like avatars).
function listImportantDates(username) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/dates`);
}
function createImportantDate(username, payload) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/dates`, { method: 'POST', body: JSON.stringify(payload) });
}
function updateImportantDate(username, id, payload) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/dates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
function deleteImportantDate(username, id) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/dates/${id}`, { method: 'DELETE' });
}

// A Memory Story's cached manifest. getStory returns { story: null } when one
// hasn't been generated yet (or is stale — the caller compares contentVersion).
// saveStory upserts the manifest the client just built; uploadStoryVideo is the
// optional rendered .mp4, sent only when a story is shared/downloaded.
function getStory(username, type, key) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/stories/${encodeURIComponent(type)}/${encodeURIComponent(key)}`);
}
function saveStory(username, type, key, payload) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/stories/${encodeURIComponent(type)}/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(payload) });
}
function uploadStoryVideo(username, type, key, videoDataUrl) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/stories/${encodeURIComponent(type)}/${encodeURIComponent(key)}/video`, { method: 'POST', body: JSON.stringify({ video: videoDataUrl }) });
}

// ── Shared Watchlist ─────────────────────────────────────────────────
// The relationship's shared "what should we watch next" list. Each entry points
// at a `recommendations` title, so the movie data is the same one the
// recommendations surfaces use. Every mutation returns the FULL updated list,
// so the caller re-renders from one authoritative response instead of patching
// local state and hoping it matches the server.
function getWatchlist(username) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/watchlist`);
}
function addToWatchlist(username, recommendationId) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/watchlist`, {
    method: 'POST', body: JSON.stringify({ recommendationId }),
  });
}
// `patch` is any subset of { watched, rating (1-5 or null), comment }.
function updateWatchlistItem(username, itemId, patch) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/watchlist/${itemId}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  });
}
function removeFromWatchlist(username, itemId) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/watchlist/${itemId}`, { method: 'DELETE' });
}
// Files a watch night under a watchlist entry (and marks it watched), so the
// entry can show the rating everyone actually gave it that night.
function attachSessionToWatchlistItem(username, itemId, clientSessionId) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/watchlist/${itemId}/session`, {
    method: 'POST', body: JSON.stringify({ clientSessionId }),
  });
}
function detachSessionFromWatchlist(username, clientSessionId) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/watchlist/session/${encodeURIComponent(clientSessionId)}`, { method: 'DELETE' });
}

// `ids` is the full list in its new order — see the reorder route's comment.
function reorderWatchlist(username, ids) {
  return apiRequest(`/api/relationships/${encodeURIComponent(username)}/watchlist/reorder`, {
    method: 'POST', body: JSON.stringify({ ids }),
  });
}

// ── Recommendations (admin.html + any future public "recommended" surface) ─
// Read routes work for any logged-in account; the /admin/ ones 403 for a
// non-admin JWT (see server/src/recommendations.js) — admin.js is the only
// caller of those today.
// `q` is an optional title search — the SAME movie database and paging, used by
// the watchlist's "add a movie" overlay so there's one movie index, not two.
// Ordered by what the viewer actually likes unless `q` is set, in which case it's
// a plain title search. `withUser` blends that contact's taste in too — used when
// picking for a shared watchlist, which is a decision about the pair.
// `filters` is the object components/movieFilters.js produces — any of
// { providers, genres, yearMin, yearMax, ratingMin }. They narrow both the
// taste-ranked list and a title search, so the same call covers either.
function getRecommendations(cursor, q, withUser, filters) {
  const p = new URLSearchParams();
  if (cursor) p.set('cursor', cursor);
  if (q) p.set('q', q);
  if (withUser) p.set('with', withUser);
  for (const [k, v] of Object.entries(filters || {})) if (v) p.set(k, v);
  const qs = p.toString();
  return apiRequest(`/api/recommendations${qs ? `?${qs}` : ''}`);
}
function getFeaturedRecommendation() {
  return apiRequest('/api/recommendations/featured');
}
function getRecommendationById(id) {
  return apiRequest(`/api/recommendations/${id}`);
}

// The full analytics rollup for the admin dashboard (analytics.html). 403s for
// a non-admin token (server/src/account.js gates it on is_admin).
function getAnalytics() {
  return apiRequest('/api/admin/analytics');
}

// Reports a client-only event (a share hand-off, a recap render) to the
// first-party analytics log. Fire-and-forget: analytics must never affect the
// action it measures, so this swallows every error and returns nothing.
function trackEvent(name, props = {}) {
  try {
    apiRequest('/api/analytics/event', {
      method: 'POST',
      body: JSON.stringify({ name, props }),
    }).catch(() => {});
  } catch (e) { /* never throws into the caller */ }
}

// { q, sort, cursor, limit } — all optional. `cursor` is a row offset; the
// response carries { recommendations, total, offset, pageSize, sort, nextCursor }.
function getAdminRecommendations({ q = '', sort = '', cursor = 0, limit = 0 } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (sort) params.set('sort', sort);
  if (cursor) params.set('cursor', String(cursor));
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  return apiRequest('/api/admin/recommendations' + (qs ? `?${qs}` : ''));
}
function createRecommendation(payload) {
  return apiRequest('/api/admin/recommendations', { method: 'POST', body: JSON.stringify(payload) });
}
function updateRecommendation(id, payload) {
  return apiRequest(`/api/admin/recommendations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}
function deleteRecommendation(id) {
  return apiRequest(`/api/admin/recommendations/${id}`, { method: 'DELETE' });
}
// `startIndex` is the offset of the page being reordered, so dragging on page 5
// doesn't renumber its rows over the top of page 1's.
function reorderRecommendations(ids, startIndex = 0) {
  return apiRequest('/api/admin/recommendations/reorder', { method: 'POST', body: JSON.stringify({ ids, startIndex }) });
}
// artwork: any subset of { poster, backdrop, gallery: [...] }, each a
// base64 data URL — see admin.js's resizeImageFile for how a <input
// type=file> pick becomes one of these before it gets here.
function uploadRecommendationArtwork(id, artwork) {
  return apiRequest(`/api/admin/recommendations/${id}/artwork`, { method: 'POST', body: JSON.stringify(artwork) });
}
