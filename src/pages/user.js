// user.js — user.html only. Any account's profile: a header (picture,
// username, contact status + the button that acts on it, and — on your own
// profile — the upload/replace/remove picture controls), then everything of
// theirs this viewer is allowed to see.
//
// The content below the header is NOT a second feed implementation: it's the
// exact same GET /by/:username → groupMomentsBySession → renderSessionCard
// pipeline, with the same delegated reaction/media/carousel/post-action
// handlers, that the main feed and the old contact page used. This page
// replaced contact.html rather than sitting next to it — the two would
// otherwise have been the same page with a different heading.
'use strict';

import { escapeHtml, formatDate, initBackLinks } from '../lib/util.js';
import { renderEmptyState, renderErrorState, renderFeedSkeletons } from '../components/skeleton.js';
import { renderSessionCard } from '../components/sessionCard.js';
import { attachReactionHandlers } from '../components/reactions.js';
import { attachMomentCardHandlers } from '../components/momentCard.js';
import { attachMediaTileHandlers } from '../components/mediaTile.js';
import { attachCarouselHandlers } from '../components/carousel.js';
import { attachPostActionHandlers } from '../components/postActions.js';
import { groupMomentsBySession } from '../lib/feedGrouping.js';
import { renderAvatar } from '../components/avatar.js';
import { initSearch } from '../components/search.js';
import { mountAvatarControls } from '../components/avatarUpload.js';
import { registerSessionForPanel, momentViewerOpts } from '../components/momentPanel.js';

const {
  requireAuth, logout, getPostsByUser, getUserProfile,
  requestContact, acceptContactRequest, removeContact,
} = window;

const auth = requireAuth();

const contentEl = document.getElementById('content');
const sentinelEl = document.getElementById('scrollSentinel');
const headerEl = document.getElementById('profileHeader');

const target = (new URLSearchParams(window.location.search).get('u') || '').toLowerCase().trim();

const state = { cursor: undefined, done: false, loading: false, profile: null, sessionsSeen: [] };

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  initBackLinks();
  attachReactionHandlers(contentEl);
  attachMomentCardHandlers(contentEl);
  attachMediaTileHandlers(contentEl, { viewerOptsFor: momentViewerOpts });
  attachCarouselHandlers(contentEl);
  attachPostActionHandlers(contentEl);
  initSearch({ getSessions: () => state.sessionsSeen, getMovies: () => [] });
  init();
}

// ── Header ───────────────────────────────────────────────────────────
const CONTACT_ACTIONS = {
  none: { label: '＋ Request contact', cls: 'btn-primary', action: 'request' },
  pending_outgoing: { label: 'Cancel request', cls: 'btn-ghost', action: 'cancel', note: 'Request sent — waiting for them to accept.' },
  pending_incoming: { label: '✓ Accept request', cls: 'btn-primary', action: 'accept', note: 'They asked to connect with you.' },
  accepted: { label: 'Remove contact', cls: 'btn-ghost', action: 'remove', note: '💜 You’re contacts.' },
  self: null,
};

function renderHeader(profile) {
  const conf = CONTACT_ACTIONS[profile.contact.status];
  const counts = profile.counts;
  headerEl.innerHTML = `
    <header class="profile-header">
      <div class="profile-header-inner">
        <div class="profile-avatar-wrap" id="profileAvatarWrap">
          ${renderAvatar(profile, { size: 'xl', className: 'profile-avatar' })}
        </div>
        <div class="profile-headtext">
          <h1 class="profile-name">${escapeHtml(profile.username)}</h1>
          <div class="profile-meta">
            <span class="profile-presence ${profile.online ? 'is-online' : ''}">${profile.online ? '● Online' : 'Offline'}</span>
            ${profile.joinedAt ? `<span class="profile-joined">Joined ${formatDate(profile.joinedAt)}</span>` : ''}
          </div>
          <div class="profile-stats">
            <div class="profile-stat"><span class="profile-stat-num">${counts.sessions}</span> sessions</div>
            <div class="profile-stat"><span class="profile-stat-num">${counts.moments}</span> moments</div>
            <div class="profile-stat"><span class="profile-stat-num">${counts.reviews}</span> reviews</div>
          </div>
          ${conf?.note ? `<div class="profile-contact-note">${escapeHtml(conf.note)}</div>` : ''}
        </div>
        <div class="profile-actions" id="profileActions">
          ${profile.isMe ? '<span class="profile-you-badge">This is you</span>' : ''}
          ${conf ? `<button class="btn ${conf.cls}" id="contactActionBtn" data-action="${conf.action}">${conf.label}</button>` : ''}
          ${profile.contact.status === 'pending_incoming'
            ? `<button class="btn btn-ghost" id="contactDeclineBtn" data-action="decline">Decline</button>` : ''}
        </div>
      </div>
    </header>`;

  // Your own profile is where you manage your picture — same page a viewer
  // sees, so what you set is exactly what they get.
  if (profile.isMe) {
    mountAvatarControls(document.getElementById('profileAvatarWrap'), profile.avatarUrl, (newUrl) => {
      state.profile.avatarUrl = newUrl;
    });
  }

  // Scoped to #profileActions, NOT the whole header: the avatar controls
  // mounted just above carry their own data-action buttons ("pick",
  // "remove"), and a header-wide query would wire "remove picture" up to
  // the remove-contact handler too.
  document.getElementById('profileActions').querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => runContactAction(btn.dataset.action, btn));
  });
}

// Every branch ends by re-reading the profile rather than patching the
// button locally — the server owns the relationship state (and the other
// side may have changed it since this page loaded), and it's one small
// request on an explicit user action, not a render-loop cost.
async function runContactAction(action, btn) {
  btn.disabled = true;
  try {
    if (action === 'request') await requestContact(target);
    else if (action === 'accept') await acceptContactRequest(state.profile.contact.id);
    else if (action === 'cancel' || action === 'decline') await removeContact(state.profile.contact.id);
    else if (action === 'remove') {
      if (!confirm(`Remove ${target} from your contacts?`)) { btn.disabled = false; return; }
      await removeContact(state.profile.contact.id);
    }
    await loadProfile();
    // What's visible to you can change the moment you become (or stop
    // being) a contact — 'contacts'-privacy posts appear/disappear — so the
    // content below the header is reloaded, not left stale.
    resetFeed();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
}

async function loadProfile() {
  const profile = await getUserProfile(target);
  state.profile = profile;
  document.title = `${profile.username} — Herae Memories`;
  document.getElementById('brandSub').textContent = `${profile.username}'s profile`;
  renderHeader(profile);
}

// ── Their content (the shared feed pipeline) ─────────────────────────
async function init() {
  if (!target) {
    headerEl.innerHTML = '';
    contentEl.innerHTML = renderEmptyState('🤔', 'No profile specified.');
    sentinelEl.classList.add('hidden');
    return;
  }

  try {
    await loadProfile();
  } catch (err) {
    headerEl.innerHTML = '';
    contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
    sentinelEl.classList.add('hidden');
    return;
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !state.done) loadMore(false);
    }, { rootMargin: '400px 0px' });
    io.observe(sentinelEl);
  } else {
    // Very old browser with no IntersectionObserver — a manual button beats
    // a feed that silently never loads page 2 (mirrors memories.js).
    sentinelEl.textContent = '';
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = 'Load more';
    btn.addEventListener('click', () => loadMore(false));
    sentinelEl.appendChild(btn);
  }

  resetFeed();
}

function resetFeed() {
  state.cursor = undefined;
  state.done = false;
  state.loading = false;
  state.sessionsSeen = [];
  contentEl.innerHTML = renderFeedSkeletons(2);
  sentinelEl.classList.remove('hidden');
  loadMore(true);
}

async function loadMore(isFirstPage = false) {
  if (state.loading || state.done) return;
  state.loading = true;
  sentinelEl.classList.remove('hidden');
  if (!sentinelEl.querySelector('button')) sentinelEl.textContent = 'Loading more…';

  try {
    const { moments, nextCursor } = await getPostsByUser(target, state.cursor);
    state.cursor = nextCursor;
    state.done = nextCursor == null;

    // One card per session (newest-active first), exactly like the main feed.
    const grouped = groupMomentsBySession(moments)
      .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
    state.sessionsSeen = state.sessionsSeen.concat(grouped);

    if (isFirstPage && !grouped.length) {
      const isMe = state.profile?.isMe;
      contentEl.innerHTML = renderEmptyState('🎞️', isMe
        ? "You haven't captured anything yet — start a watch session from the Herae extension."
        : `Nothing from ${escapeHtml(target)} is visible to you yet.`);
      sentinelEl.classList.add('hidden');
      return;
    }

    grouped.forEach(registerSessionForPanel);
    const html = grouped.map(renderSessionCard).join('');
    if (isFirstPage) contentEl.innerHTML = html;
    else contentEl.insertAdjacentHTML('beforeend', html);

    if (state.done) {
      sentinelEl.textContent = "That's everything 💜";
    } else if (!sentinelEl.querySelector('button')) {
      sentinelEl.textContent = 'Loading more…';
    }
  } catch (err) {
    if (isFirstPage) contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
    sentinelEl.classList.add('hidden');
  } finally {
    state.loading = false;
  }
}
