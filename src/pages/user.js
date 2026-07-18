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
import { buildRecap, renderRecapCard } from '../components/recap.js';
import { openMediaViewer } from '../components/mediaViewer.js';

const {
  requireAuth, logout, getPostsByUser, getUserProfile,
  requestContact, acceptContactRequest, removeContact,
  deleteAccount, clearAuth, trackEvent,
} = window;

const auth = requireAuth();

const contentEl = document.getElementById('content');
const sentinelEl = document.getElementById('scrollSentinel');
const headerEl = document.getElementById('profileHeader');

const target = (new URLSearchParams(window.location.search).get('u') || '').toLowerCase().trim();

const state = { cursor: undefined, done: false, loading: false, profile: null, sessionsSeen: [], recapDone: false };

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

  // Your own profile also carries the account danger zone (delete account).
  if (profile.isMe) renderDangerZone(profile);
}

// ── Delete account ─────────────────────────────────────────────────────
// Rendered only on your own profile, below the header. Opens a confirmation
// modal that re-authenticates (password for a local account, username for a
// Google one — see profile.authProvider) before calling DELETE /api/me.
function renderDangerZone(profile) {
  const zone = document.createElement('div');
  zone.className = 'danger-zone';
  zone.innerHTML = `
    <div class="danger-zone-inner">
      <div>
        <h3>Delete account</h3>
        <p>Permanently delete your Herae account, your Moments and their photos and videos, your
           reviews and comments, and your contacts. This can't be undone.
           <a href="account-deletion.html">Learn what's removed</a>.</p>
      </div>
      <button class="btn btn-danger" id="deleteAccountBtn">Delete account</button>
    </div>`;
  headerEl.appendChild(zone);
  zone.querySelector('#deleteAccountBtn').addEventListener('click', () => openDeleteModal(profile));
}

function openDeleteModal(profile) {
  const isGoogle = profile.authProvider && profile.authProvider !== 'local';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Delete account">
      <h2>Delete your account?</h2>
      <div class="modal-warn">
        This is permanent. Your Moments (and their photos and videos), reviews, comments, and
        contacts will be deleted for good. There is no undo and no recovery period.
      </div>
      <p>${isGoogle
        ? `To confirm, type your username <strong>${escapeHtml(profile.username)}</strong> below.`
        : 'Enter your password to confirm.'}</p>
      <div class="field" style="margin-bottom:6px">
        <input type="${isGoogle ? 'text' : 'password'}" id="deleteConfirmInput"
               placeholder="${isGoogle ? 'your username' : 'your password'}"
               autocomplete="${isGoogle ? 'off' : 'current-password'}"
               autocapitalize="none" spellcheck="false">
      </div>
      <div class="error-text" id="deleteError"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="deleteCancel">Cancel</button>
        <button class="btn btn-danger" id="deleteConfirm">Delete forever</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const input = overlay.querySelector('#deleteConfirmInput');
  const errEl = overlay.querySelector('#deleteError');
  const confirmBtn = overlay.querySelector('#deleteConfirm');
  input.focus();

  const close = () => { document.body.style.overflow = prevOverflow; overlay.remove(); };
  overlay.querySelector('#deleteCancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  confirmBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    const val = input.value;
    if (!val) { errEl.textContent = isGoogle ? 'Type your username to confirm.' : 'Enter your password.'; return; }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    try {
      await deleteAccount(isGoogle ? { confirmUsername: val } : { password: val });
      // Clear the local session and leave for the marketing home. replace()
      // so the now-dead profile page isn't left in history.
      clearAuth();
      window.location.replace('index.html');
    } catch (err) {
      errEl.textContent = err.message || 'Could not delete your account.';
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete forever';
    }
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
  state.recapDone = false;
  contentEl.innerHTML = renderFeedSkeletons(2);
  sentinelEl.classList.remove('hidden');
  loadMore(true);
}

// ── Moments Recap ──────────────────────────────────────────────────────
// Built once, from the moments already loaded into the feed, and only on your
// own profile. Opens through the same media viewer as any post and carries the
// Share flow. If there aren't enough moments (or the canvas can't be exported),
// buildRecap returns null and nothing is shown — exactly the spec's behavior.
async function maybeBuildRecap() {
  if (state.recapDone || !state.profile?.isMe) return;
  state.recapDone = true;
  const moments = state.sessionsSeen.flatMap((s) => s.moments || []);
  const profileUrl = `${location.origin}/user.html?u=${encodeURIComponent(state.profile.username)}`;
  let recap;
  try {
    recap = await buildRecap({ username: state.profile.username, moments, profileUrl });
  } catch (e) { return; }
  if (!recap || !contentEl.firstChild) return;

  contentEl.insertAdjacentHTML('afterbegin', renderRecapCard(recap));
  if (trackEvent) trackEvent('recap_generated');
  const card = contentEl.querySelector('.recap-card');
  if (!card) return;
  const open = () => openMediaViewer(recap, { caption: 'Your Herae Recap', shareItem: recap });
  card.addEventListener('click', (e) => {
    // The "Open recap" button and the card both open it.
    e.preventDefault();
    open();
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
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

    // On your OWN profile, once there's a first page of content, try to
    // generate a featured Moments Recap from what's loaded — entirely
    // client-side (see recap.js). Silently does nothing if there isn't enough.
    if (isFirstPage) maybeBuildRecap();

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
