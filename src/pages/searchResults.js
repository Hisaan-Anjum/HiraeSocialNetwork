// searchResults.js — search.html only. The full results page behind the
// overlay's Enter key: everything matching the query, grouped by type.
//
// Sources, all existing endpoints — no new search infrastructure:
//   People    GET /api/users?q=            (cursor-paged, "show more")
//   Movies    GET /api/recommendations     (small curated set, filtered here)
//   Sessions/Reviews/Moments — the same two cursor-paged feeds the main
//   page merges (GET /sessions/mine + GET /feed), pulled page by page as
//   you scroll and filtered as they stream in. That IS the pagination:
//   the sentinel keeps drawing more pages until both feeds are exhausted,
//   so a match on page 9 shows up when you get there, exactly like the
//   feed itself. Cards are the feed's own components, not copies.
'use strict';

import { escapeHtml, formatDate, sessionDisplayTitle } from '../lib/util.js';
import { renderEmptyState, renderErrorState } from '../components/skeleton.js';
import { renderSessionCard } from '../components/sessionCard.js';
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
  ownCursor: undefined, ownDone: false,
  feedCursor: undefined, feedDone: false,
  seenSessions: new Set(), seenReviews: new Set(), seenMoments: new Set(),
  loading: false,
  total: 0,
};

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
  attachMediaTileHandlers(resultsEl, { viewerOptsFor: momentViewerOpts });

  init();
}

function addTo(name, html) {
  const g = groups[name];
  g.el.hidden = false;
  g.items.insertAdjacentHTML('beforeend', html);
  g.n += 1;
  g.count.textContent = g.n;
  state.total += 1;
}

async function init() {
  if (!q) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = renderEmptyState('🔍', 'Type something to search for.');
    sentinelEl.classList.add('hidden');
    return;
  }
  document.title = `“${q}” — Herae Memories`;

  loadUsers();
  loadMovies();

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !(state.ownDone && state.feedDone)) loadMoreFeed();
    }, { rootMargin: '500px 0px' });
    io.observe(sentinelEl);
  }
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

// ── Movies (small curated set, filtered client-side like the overlay) ──
async function loadMovies() {
  try {
    const { recommendations } = await getRecommendations();
    for (const rec of recommendations || []) {
      const hit = rec.title.toLowerCase().includes(lower)
        || (rec.genres || []).some((g) => g.toLowerCase().includes(lower));
      if (hit) addTo('movies', renderRecommendationCard(rec));
    }
  } catch (e) { /* fine */ }
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

function screenSession(session) {
  if (state.seenSessions.has(session.clientSessionId)) return;
  state.seenSessions.add(session.clientSessionId);
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
    emptyEl.innerHTML = renderEmptyState('🔍', `Nothing matched “${escapeHtml(q)}”.`);
  } else if (state.total > 0) {
    emptyEl.hidden = true;
  }
}
