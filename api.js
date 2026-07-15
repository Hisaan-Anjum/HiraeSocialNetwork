// api.js — shared auth/session + fetch helpers for every page on this site.
// Logs into the SAME server (and the same account) as the Hirae extension —
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

function setAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  localStorage.setItem(SERVER_URL_KEY, auth.serverUrl);
}

function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
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
function getFeed() {
  return apiRequest('/api/moments/feed');
}

// "Only theirs" — every post you actually participated in, any privacy.
function getMine() {
  return apiRequest('/api/moments/mine');
}

// Single-post detail view — for post.html.
function getMomentById(id) {
  return apiRequest(`/api/moments/${id}`);
}
function getReviewById(id) {
  return apiRequest(`/api/reviews/${id}`);
}

// One contact's posts — only the ones visible to you (moments.js enforces
// this server-side too; a non-contact gets a 403 here).
function getPostsByUser(username) {
  return apiRequest(`/api/moments/by/${encodeURIComponent(username)}`);
}

function setMomentPrivacy(momentId, privacy) {
  return apiRequest(`/api/moments/${momentId}/privacy`, {
    method: 'PATCH',
    body: JSON.stringify({ privacy }),
  });
}

function postReview(clientSessionId, text) {
  return apiRequest(`/api/moments/session/${encodeURIComponent(clientSessionId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// Everything about one session: participants, its moments (possibly none),
// and all reviews — the review page runs entirely off this.
function getSessionDetail(clientSessionId) {
  return apiRequest(`/api/moments/session/${encodeURIComponent(clientSessionId)}`);
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
// contact list, nothing new to build server-side for this.
function getContacts() {
  return apiRequest('/api/contacts');
}

// Absolute image URL — the API returns a server-relative path (e.g.
// /media/moments/xyz.jpg); every consumer needs it joined with whichever
// server this browser is actually logged into.
function momentImageUrl(relativeUrl) {
  const auth = getAuth();
  const base = (auth?.serverUrl || getSavedServerUrl()).replace(/\/+$/, '');
  return `${base}${relativeUrl}`;
}
