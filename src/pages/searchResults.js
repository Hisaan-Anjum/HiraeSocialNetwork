// searchResults.js — search.html only. The full results page behind the
// overlay's Enter key: everything matching the query, grouped by type.
//
// Sources, all existing endpoints — no new search infrastructure:
//   People    GET /api/users?q=            (cursor-paged, "show more")
//   Movies    GET /api/recommendations?q=  (searched in SQL, whole catalogue)
//   Sessions/Reviews/Moments — the same two cursor-paged feeds the main
//   page merges (GET /sessions/mine + GET /feed), pulled page by page as
//   you scroll and filtered as they stream in. That IS the pagination:
//   the sentinel keeps drawing more pages until both feeds are exhausted,
//   so a match on page 9 shows up when you get there, exactly like the
//   feed itself. Cards are the feed's own components, not copies.
'use strict';

import { escapeHtml, formatDate, sessionDisplayTitle } from '../lib/util.js';
import { renderEmptyState, renderErrorState } from '../components/skeleton.js';
import { renderSessionCard, attachSessionShareHandlers } from '../components/sessionCard.js';
import { renderRecommendationCard } from '../components/recommendationCard.js';
import { renderContactRow } from '../components/contactRow.js';
import { renderMediaTile, attachMediaTileHandlers } from '../components/mediaTile.js';
import { attachReactionHandlers } from '../components/reactions.js';
import { attachMomentCardHandlers } from '../components/momentCard.js';
import { attachCarouselHandlers } from '../components/carousel.js';
import { attachPostActionHandlers } from '../components/postActions.js';
import { renderStars } from '../components/starRating.js';
import { renderUserLink } from '../components/userLink.js';
import { groupMomentsBySession } from '../lib/feedGrouping.js';
import { registerSessionForPanel, momentViewerOpts } from '../components/momentPanel.js';
import { createMovieFilters } from '../components/movieFilters.js';

const {
  requireAuth, logout, searchUsers, getSessionsMine, getFeed, getRecommendations, getContacts,
} = window;

const auth = requireAuth();
const q = (new URLSearchParams(window.location.search).get('q') || '').trim();
const lower = q.toLowerCase();

const resultsEl = document.getElementById('results');
const sentinelEl = document.getElementById('scrollSentinel');
const emptyEl = document.getElementById('searchEmpty');

const groups = {};
for (const name of ['users', 'sessions', 'reviews', 'moments', 'movies']) {
  const el = document.getElementById(`group-${name}`);
  groups[name] = { el, items: el.querySelector('[data-items]'), count: el.querySelector('[data-count]'), n: 0 };
}

const state = {
  usersCursor: null,
  moviesCursor: null, moviesDone: false, moviesLoading: false,
  ownCursor: undefined, ownDone: false,
  feedCursor: undefined, feedDone: false,
  seenSessions: new Set(), seenReviews: new Set(), seenMoments: new Set(),
  loading: false,
  total: 0,
};

// Mounted before anything loads so the controls are usable while results
// stream in. Changing a filter re-queries only the movies group — the other
// groups aren't filterable and shouldn't flicker.
const movieFilters = createMovieFilters({
  onChange: () => {
    const g = groups.movies;
    g.items.innerHTML = '';
    state.total -= g.n;
    g.n = 0;
    g.count.textContent = '0';
    // A new filter set is a new result set — carrying the old cursor forward
    // would page into the middle of a list that no longer exists.
    state.moviesCursor = null;
    state.moviesDone = false;
    loadMovies();
  },
});
document.getElementById('movieFilters').appendChild(movieFilters.el);

// ── Tabs ──────────────────────────────────────────────────────────────
// Results arrive asynchronously and keep arriving as the feed pages in, so this
// runs on every addition rather than once: a tab's count, and whether it's
// selectable at all, both change while you're looking at the page.
let activeTab = 'all';
const tabsEl = document.getElementById('searchTabs');

function applyTab() {
  tabsEl.hidden = false;

  for (const btn of tabsEl.querySelectorAll('.search-tab')) {
    const name = btn.dataset.tab;
    const n = name === 'all' ? state.total : groups[name].n;
    const badge = btn.querySelector('[data-n]');
    if (badge) {
      badge.textContent = n;
      badge.hidden = n === 0;
    }
    // Movies keeps its tab live even at zero, because the filter bar lives in
    // that group — being over-filtered has to stay recoverable.
    btn.disabled = n === 0 && name !== 'all' && name !== 'movies';
    if (btn.disabled && activeTab === name) activeTab = 'all';
    btn.classList.toggle('is-active', activeTab === name);
    btn.setAttribute('aria-selected', String(activeTab === name));
  }

  for (const [name, g] of Object.entries(groups)) {
    const showable = g.n > 0 || name === 'movies';
    g.el.hidden = activeTab === 'all' ? !showable : activeTab !== name;
    // The heading is redundant once a tab names the group — but in "All" it's
    // the only thing separating one list from the next.
    const title = g.el.querySelector('.search-group-title');
    if (title) title.hidden = activeTab !== 'all';
  }
}

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.search-tab');
  if (!btn || btn.disabled) return;
  activeTab = btn.dataset.tab;
  applyTab();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // The new tab has its own idea of whether more exists — and switching to a
  // short one can leave the sentinel already on screen, which would never fire
  // an intersection because it never re-enters the viewport.
  sentinelEl.classList.toggle('hidden', !moreToLoadForTab());
  if (moreToLoadForTab()) loadMoreForTab();
});

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  const input = document.getElementById('searchInput');
  input.value = q;
  document.getElementById('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const next = input.value.trim();
    if (next) window.location.href = `search.html?q=${encodeURIComponent(next)}`;
  });

  // Same delegated handlers as the feed, so the session cards found here
  // behave identically (reactions, carousels, edit/delete, media viewer).
  attachReactionHandlers(resultsEl);
  attachMomentCardHandlers(resultsEl);
  attachCarouselHandlers(resultsEl);
  attachPostActionHandlers(resultsEl);
  // Same delegated share as the feed. Search renders real session cards, so
  // the button exists here too and must not be a control that does nothing.
  attachSessionShareHandlers(resultsEl, (id) => shownSessions.get(id) || null);
  attachMediaTileHandlers(resultsEl, { viewerOptsFor: momentViewerOpts });

  init();
}

// Scrolling has to page whatever you're LOOKING at. A single sentinel wired
// only to the feed meant the Movies tab stopped at its first page however far
// you scrolled, and People needed a button while everything else was automatic.
function loadMoreForTab() {
  if (activeTab === 'movies') return loadMovies({ append: true });
  if (activeTab === 'users') {
    if (!state.usersCursor) return undefined;
    const cursor = state.usersCursor;
    state.usersCursor = null;        // claim it, so overlapping ticks can't double-fetch
    return loadUsers(cursor);
  }
  // 'all' and the three feed-backed tabs share the one feed stream.
  if (state.ownDone && state.feedDone) return undefined;
  return loadMoreFeed();
}

function moreToLoadForTab() {
  if (activeTab === 'movies') return !state.moviesDone;
  if (activeTab === 'users') return !!state.usersCursor;
  return !(state.ownDone && state.feedDone);
}

function observeSentinel() {
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && moreToLoadForTab()) loadMoreForTab();
  }, { rootMargin: '500px 0px' });
  io.observe(sentinelEl);
}

function addTo(name, html) {
  const g = groups[name];
  g.items.insertAdjacentHTML('beforeend', html);
  g.n += 1;
  g.count.textContent = g.n;
  state.total += 1;
  applyTab();
}

async function init() {
  // Filters alone are a legitimate search: "Netflix comedies rated 8+" is a
  // question with no title in it. Only prompt for text when there's nothing
  // to go on at all.
  if (!q && !movieFilters.isActive()) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = renderEmptyState('🔍', 'Type something to search for — or use the movie filters below.');
    groups.movies.el.hidden = false;
    sentinelEl.classList.add('hidden');
    loadMovies();
    return;
  }
  document.title = q ? `“${q}” — Herae Memories` : 'Browse movies — Herae Memories';
  loadMovies();

  // People/sessions/reviews/moments are all TEXT matches, and every one of them
  // reduces to `.includes(lower)` — which is vacuously true for an empty string.
  // Streaming the feed with no query would therefore match every session, review
  // and moment the viewer can see and dump the lot on screen. A filter-only
  // browse is about the catalogue, so those groups simply don't participate.
  if (!q) {
    // The feed groups sit out a query-less browse, but movies still page —
    // otherwise browsing the catalogue by filter alone stops dead at 20.
    state.ownDone = true;
    state.feedDone = true;
    observeSentinel();
    return;
  }

  loadUsers();
  observeSentinel();
  loadMoreFeed();
}

// ── People (cursor-paged server search) ────────────────────────────────
async function loadUsers(cursor) {
  try {
    const { users, nextCursor } = await searchUsers(q, cursor || undefined);
    // Presence isn't part of the user search — mark contacts' rows via the
    // contacts list, best effort.
    let online = {};
    try {
      const c = await getContacts(q);
      online = Object.fromEntries((c.contacts || []).map((x) => [x.username, x.online]));
    } catch (e) { /* fine — rows just show the neutral status */ }
    for (const u of users) {
      addTo('users', renderContactRow(u, {
        statusText: u.username in online ? (online[u.username] ? '● Online' : 'Offline') : 'View profile',
        statusClass: online[u.username] ? 'contact-online' : '',
      }));
    }
    state.usersCursor = nextCursor;
    const more = groups.users.el.querySelector('.search-more-users');
    more.hidden = !nextCursor;
    more.onclick = () => { more.hidden = true; loadUsers(state.usersCursor); };
  } catch (e) { /* the other groups still load */ }
  settleEmptyState();
}

// ── Movies (searched server-side across the whole catalogue) ───────────
// This used to fetch one page of recommendations and filter it here, which only
// ever worked while the catalogue was a few dozen curated titles — against
// thousands it searches a ~20-row sample and reports almost nothing. ?q= pushes
// the match into SQL where the whole table is visible.
async function loadMovies({ append = false } = {}) {
  if (state.moviesLoading) return;
  if (append && state.moviesDone) return;
  state.moviesLoading = true;
  try {
    const res = await getRecommendations(
      append ? state.moviesCursor : null, q || undefined, undefined, movieFilters.params(),
    );
    movieFilters.setCount(res.total);
    // nextCursor means different things on the two server paths — a row id when
    // searching, a row offset when taste-ranked — but it is always opaque here
    // and handed straight back, so this doesn't care which.
    state.moviesCursor = res.nextCursor ?? null;
    state.moviesDone = res.nextCursor == null;
    for (const rec of res.recommendations || []) addTo('movies', renderRecommendationCard(rec));
  } catch (e) {
    state.moviesDone = true;   // don't retry a failing page on every scroll tick
  } finally {
    state.moviesLoading = false;
  }
  settleEmptyState();
}

// ── Sessions / Reviews / Moments (streamed from the two feeds) ─────────
function sessionMatches(s) {
  return sessionDisplayTitle(s, '').toLowerCase().includes(lower)
    || (s.content?.title || '').toLowerCase().includes(lower)
    || s.participants.some((p) => p.toLowerCase().includes(lower));
}

function reviewRow(rv, session) {
  return `
    <a class="search-review-row" href="post.html?type=review&id=${rv.id}">
      <div class="search-review-head">
        <span class="review-author">${escapeHtml(rv.username)}</span>
        ${rv.rating ? renderStars(rv.rating, { size: 'sm' }) : ''}
        <span class="moment-date">${formatDate(rv.createdAt)}</span>
      </div>
      <div class="search-review-text">${escapeHtml(rv.text.length > 160 ? rv.text.slice(0, 160) + '…' : rv.text)}</div>
      <div class="search-review-sub">on ${escapeHtml(sessionDisplayTitle(session, 'a watch session'))}</div>
    </a>`;
}

function momentCell(m, session) {
  return `
    <div class="search-moment">
      ${renderMediaTile(m, { className: 'search-moment-media' })}
      <a class="search-moment-link" href="session.html?session=${encodeURIComponent(session.clientSessionId)}">
        ${escapeHtml(sessionDisplayTitle(session, 'View session'))}
      </a>
    </div>`;
}

// Every session card this page has put on screen, by id — the share
// handler is delegated and looks its subject up at click time.
const shownSessions = new Map();

function screenSession(session) {
  if (state.seenSessions.has(session.clientSessionId)) return;
  state.seenSessions.add(session.clientSessionId);
  shownSessions.set(session.clientSessionId, session);
  registerSessionForPanel(session);

  if (sessionMatches(session)) addTo('sessions', renderSessionCard(session));

  for (const rv of session.reviews || []) {
    if (state.seenReviews.has(rv.id)) continue;
    if (rv.text.toLowerCase().includes(lower) || rv.username.toLowerCase().includes(lower)) {
      state.seenReviews.add(rv.id);
      addTo('reviews', reviewRow(rv, session));
    }
  }
  for (const m of session.moments || []) {
    if (state.seenMoments.has(m.id)) continue;
    if ((m.description || '').toLowerCase().includes(lower)) {
      state.seenMoments.add(m.id);
      addTo('moments', momentCell(m, session));
    }
  }
}

async function loadMoreFeed() {
  if (state.loading || (state.ownDone && state.feedDone)) return;
  state.loading = true;
  sentinelEl.classList.remove('hidden');
  sentinelEl.textContent = 'Searching…';
  try {
    const [ownPage, feedPage] = await Promise.all([
      state.ownDone ? null : getSessionsMine(state.ownCursor),
      state.feedDone ? null : getFeed(state.feedCursor),
    ]);
    if (ownPage) {
      state.ownCursor = ownPage.nextCursor;
      state.ownDone = ownPage.nextCursor == null;
      ownPage.sessions.forEach(screenSession);
    }
    if (feedPage) {
      state.feedCursor = feedPage.nextCursor;
      state.feedDone = feedPage.nextCursor == null;
      groupMomentsBySession(feedPage.moments).forEach(screenSession);
    }
  } catch (err) {
    if (!state.total) {
      emptyEl.hidden = false;
      emptyEl.innerHTML = renderErrorState(escapeHtml(err.message));
    }
    state.ownDone = state.feedDone = true;
  } finally {
    state.loading = false;
    if (state.ownDone && state.feedDone) {
      sentinelEl.textContent = state.total ? "That's everything 💜" : '';
      settleEmptyState();
    } else {
      sentinelEl.textContent = 'Searching…';
    }
  }
}

function settleEmptyState() {
  if (state.total === 0 && state.ownDone && state.feedDone) {
    emptyEl.hidden = false;
    // Name what actually came up empty. Reporting a missing query when the
    // filters are what excluded everything sends people to retype a title that
    // was never the problem.
    emptyEl.innerHTML = q
      ? renderEmptyState('🔍', `Nothing matched “${escapeHtml(q)}”.`)
      : renderEmptyState('🎬', 'No films match these filters. Try relaxing one.');
  } else if (state.total > 0) {
    emptyEl.hidden = true;
  }
}
