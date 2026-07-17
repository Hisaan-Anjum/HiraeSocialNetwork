// memories.js — memories.html only. The premium mixed feed: your own watch
// sessions (GET /sessions/mine) as rich cards — each one leading with its
// review(s) when it has any, otherwise its captured moments — interleaved
// with contacts'/public activity (grouped from GET /feed) and admin-curated
// recommendation cards, with the single featured pick pinned at the top.
// Real cursor-paginated infinite scroll via IntersectionObserver.
'use strict';

import { renderEmptyState, renderErrorState, renderFeedSkeletons } from '../components/skeleton.js';
import { renderSessionCard } from '../components/sessionCard.js';
import { renderRecommendationCard, renderFeaturedHero } from '../components/recommendationCard.js';
import { attachReactionHandlers } from '../components/reactions.js';
import { attachMomentCardHandlers } from '../components/momentCard.js';
import { attachMediaTileHandlers } from '../components/mediaTile.js';
import { attachCarouselHandlers } from '../components/carousel.js';
import { attachPostActionHandlers } from '../components/postActions.js';
import { groupMomentsBySession } from '../lib/feedGrouping.js';
import { registerSessionForPanel, momentViewerOpts } from '../components/momentPanel.js';
import { escapeHtml, formatDate } from '../lib/util.js';
import { renderAvatar } from '../components/avatar.js';
import { mountAvatarControls } from '../components/avatarUpload.js';
import { initSearch } from '../components/search.js';

const {
  requireAuth, logout, getFeed, getSessionsMine, getRecommendations, getFeaturedRecommendation,
  getUserProfile,
} = window;

const auth = requireAuth();

// Every recommendation not yet placed anywhere, kept around for the
// search overlay's client-side movie filter regardless of interleave state.
let allRecommendationsSeen = [];
// Every session card (own + contacts'/public) rendered so far, for the
// search overlay's client-side session filter.
let allSessionsSeen = [];

const RECOMMENDATION_EVERY = 4; // deterministic, non-clustered interleave

const state = {
  ownSessionIds: new Set(),
  ownCursor: undefined,
  ownDone: false,
  feedCursor: undefined,
  feedDone: false,
  recBuffer: [],
  recIndex: 0,
  itemsRendered: 0, // real (non-recommendation) cards rendered, for the every-Nth placement
  loading: false,
  includeContactsFeed: true,
};

const contentEl = document.getElementById('content');
const sentinelEl = document.getElementById('scrollSentinel');
const heroEl = document.getElementById('feedHero');

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  attachReactionHandlers(contentEl);
  attachMomentCardHandlers(contentEl);
  attachMediaTileHandlers(contentEl, { viewerOptsFor: momentViewerOpts });
  attachCarouselHandlers(contentEl);
  attachPostActionHandlers(contentEl);
  initSearch({ getSessions: () => allSessionsSeen, getMovies: () => allRecommendationsSeen });

  document.querySelectorAll('.feed-scope-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.scope === (state.includeContactsFeed ? 'everyone' : 'mine')) return;
      document.querySelectorAll('.feed-scope-tab').forEach((t) => t.classList.remove('feed-scope-tab-active'));
      tab.classList.add('feed-scope-tab-active');
      state.includeContactsFeed = tab.dataset.scope === 'everyone';
      resetAndLoad();
    });
  });

  loadMyPanel();
  loadHero();
  primeRecommendations();
  resetAndLoad();
}

// The signed-in user's own profile panel, pinned above everything on the
// feed — the same header (and CSS) their profile page shows, just framed
// as a card. Picture management works right here too (same
// mountAvatarControls the profile page uses); the whole thing is a
// nice-to-have, so any failure simply leaves the feed as it was.
async function loadMyPanel() {
  const el = document.getElementById('myProfilePanel');
  if (!el) return;
  try {
    const p = await getUserProfile(auth.username);
    const profileHref = `user.html?u=${encodeURIComponent(p.username)}`;
    el.innerHTML = `
      <header class="profile-header profile-header-feed">
        <div class="profile-header-inner">
          <div class="profile-avatar-wrap" id="feedAvatarWrap">
            ${renderAvatar(p, { size: 'lg', className: 'profile-avatar' })}
          </div>
          <div class="profile-headtext">
            <h1 class="profile-name profile-name-feed"><a class="user-link" href="${profileHref}">${escapeHtml(p.username)}</a></h1>
            <div class="profile-meta">
              <span class="profile-presence is-online">● Online</span>
              ${p.joinedAt ? `<span class="profile-joined">Joined ${formatDate(p.joinedAt)}</span>` : ''}
            </div>
            <div class="profile-stats">
              <div class="profile-stat"><span class="profile-stat-num">${p.counts.sessions}</span> sessions</div>
              <div class="profile-stat"><span class="profile-stat-num">${p.counts.moments}</span> moments</div>
              <div class="profile-stat"><span class="profile-stat-num">${p.counts.reviews}</span> reviews</div>
            </div>
          </div>
          <div class="profile-actions">
            <a class="btn btn-ghost" href="${profileHref}">View profile →</a>
          </div>
        </div>
      </header>`;
    mountAvatarControls(document.getElementById('feedAvatarWrap'), p.avatarUrl, () => {});
  } catch (e) {
    el.innerHTML = '';
  }
}

async function loadHero() {
  try {
    const { recommendation } = await getFeaturedRecommendation();
    heroEl.innerHTML = renderFeaturedHero(recommendation);
  } catch (e) {
    heroEl.innerHTML = '';
  }
}

// One batch of recommendations, fetched once up front and cycled through
// for the feed's periodic interleave — these are admin-curated and few
// (see server/src/recommendations.js), so re-cycling after exhausting a
// ~20-card batch reads as "recommended again" rather than broken pagination.
async function primeRecommendations() {
  try {
    const { recommendations } = await getRecommendations();
    state.recBuffer = recommendations;
    allRecommendationsSeen = recommendations;
  } catch (e) { /* the feed still works without recommendation cards */ }
}

function nextRecommendation() {
  if (!state.recBuffer.length) return null;
  const rec = state.recBuffer[state.recIndex % state.recBuffer.length];
  state.recIndex += 1;
  return rec;
}

function resetAndLoad() {
  state.ownSessionIds = new Set();
  state.ownCursor = undefined;
  state.ownDone = false;
  state.feedCursor = undefined;
  state.feedDone = !state.includeContactsFeed;
  state.itemsRendered = 0;
  state.recIndex = 0;
  allSessionsSeen = [];
  contentEl.innerHTML = renderFeedSkeletons(3);
  loadMore(true);
}

// Fetches the next page from whichever source(s) still have more, merges
// by recency, and renders — used both for the very first page and every
// subsequent IntersectionObserver-triggered load.
async function loadMore(isFirstPage = false) {
  if (state.loading || (state.ownDone && state.feedDone)) return;
  state.loading = true;
  sentinelEl.classList.remove('hidden');
  sentinelEl.textContent = 'Loading more…';

  try {
    const [ownPage, feedGroups] = await Promise.all([
      state.ownDone ? Promise.resolve(null) : getSessionsMine(state.ownCursor),
      state.feedDone ? Promise.resolve(null) : getFeed(state.feedCursor),
    ]);

    const batch = [];
    if (ownPage) {
      state.ownCursor = ownPage.nextCursor;
      state.ownDone = ownPage.nextCursor == null;
      for (const s of ownPage.sessions) {
        state.ownSessionIds.add(s.clientSessionId);
        batch.push(s);
      }
    }
    if (feedGroups) {
      state.feedCursor = feedGroups.nextCursor;
      state.feedDone = feedGroups.nextCursor == null;
      const grouped = groupMomentsBySession(feedGroups.moments)
        .filter((g) => !state.ownSessionIds.has(g.clientSessionId));
      batch.push(...grouped);
    }

    batch.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
    allSessionsSeen = allSessionsSeen.concat(batch);

    if (isFirstPage && !batch.length) {
      contentEl.innerHTML = renderEmptyState('🎞️',
        'No moments yet — capture one on your next watch together, or write a review after your session ends.');
      sentinelEl.classList.add('hidden');
      return;
    }

    const html = [];
    for (const session of batch) {
      registerSessionForPanel(session);
      html.push(renderSessionCard(session));
      state.itemsRendered += 1;
      if (state.itemsRendered % RECOMMENDATION_EVERY === 0) {
        const rec = nextRecommendation();
        if (rec) html.push(renderRecommendationCard(rec));
      }
    }
    if (isFirstPage) contentEl.innerHTML = html.join('');
    else contentEl.insertAdjacentHTML('beforeend', html.join(''));

    if (state.ownDone && state.feedDone) {
      sentinelEl.textContent = "You're all caught up 💜";
    } else {
      sentinelEl.textContent = 'Loading more…';
    }
  } catch (err) {
    if (isFirstPage) contentEl.innerHTML = renderErrorState(err.message);
    sentinelEl.classList.add('hidden');
  } finally {
    state.loading = false;
  }
}

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !(state.ownDone && state.feedDone)) loadMore(false);
  }, { rootMargin: '400px 0px' });
  io.observe(sentinelEl);
} else {
  // No IntersectionObserver support (very old browser) — a manual "load
  // more" fallback beats a feed that silently never loads page 2.
  sentinelEl.textContent = '';
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost';
  btn.textContent = 'Load more';
  btn.addEventListener('click', () => loadMore(false));
  sentinelEl.appendChild(btn);
}
