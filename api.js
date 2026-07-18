// api.js — shared auth/session + fetch helpers for every page on this site.
// Logs into the SAME server (and the same account) as the Herae extension —
// there's no separate signup/auth system here at all.
'use strict';

const AUTH_KEY = 'moments_auth'; // { token, username, serverUrl }
const SERVER_URL_KEY = 'moments_server_url';

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
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
  setAuthHintCookie(false);
}

// Every page except index.html (landing) and login.html needs this —
// redirects to the login form if there's no stored session, and hands back
// the auth object otherwise so the caller doesn't have to call getAuth()
// separately. Stashes the current URL (path+query) first — review.html
// arrives with a ?session= the extension needs to land back on after
// login, not just dumped at the generic feed; see login.js's
// redirect-back handling.
function requireAuth() {
  const auth = getAuth();
  if (!auth) {
    sessionStorage.setItem('moments_return_to', location.pathname + location.search);
    window.location.href = 'login.html';
    return null;
  }
  return auth;
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

async function apiRequest(path, options = {}) {
  const auth = getAuth();
  const base = (auth?.serverUrl || getSavedServerUrl()).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  let resp;
  try {
    resp = await fetch(`${base}${path}`, { ...options, headers });
  } catch (e) {
    throw new Error('Could not reach the server. Check the address and that it is running.');
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
  return `${origin}/post.html?id=${encodeURIComponent(id)}`;
}

// ── Recommendations (admin.html + any future public "recommended" surface) ─
// Read routes work for any logged-in account; the /admin/ ones 403 for a
// non-admin JWT (see server/src/recommendations.js) — admin.js is the only
// caller of those today.
function getRecommendations(cursor) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest(`/api/recommendations${qs}`);
}
function getFeaturedRecommendation() {
  return apiRequest('/api/recommendations/featured');
}
function getRecommendationById(id) {
  return apiRequest(`/api/recommendations/${id}`);
}

function getAdminRecommendations() {
  return apiRequest('/api/admin/recommendations');
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
function reorderRecommendations(ids) {
  return apiRequest('/api/admin/recommendations/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
}
// artwork: any subset of { poster, backdrop, gallery: [...] }, each a
// base64 data URL — see admin.js's resizeImageFile for how a <input
// type=file> pick becomes one of these before it gets here.
function uploadRecommendationArtwork(id, artwork) {
  return apiRequest(`/api/admin/recommendations/${id}/artwork`, { method: 'POST', body: JSON.stringify(artwork) });
}
