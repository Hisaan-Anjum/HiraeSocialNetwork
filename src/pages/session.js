// session.js — session.html only. The dedicated page one session opens
// into (this replaced post.html as where "open a post" lands): its title,
// participants, every photo/video, every review with rating, likes and
// comments — all rendered through the SAME renderSessionCard the feed
// uses, off GET /api/moments/session/:id, not a second implementation.
//
// Clicking any photo/video here opens the media viewer WITH its side
// panel: the media large on the left, that moment's comments/likes/
// caption/actions and the session's reviews on the right (see
// mediaViewer.js's panelEl option).
'use strict';

import { escapeHtml, initBackLinks, sessionDisplayTitle } from '../lib/util.js';
import { renderEmptyState, renderErrorState, renderFeedSkeletons } from '../components/skeleton.js';
import { renderSessionCard, attachSessionShareHandlers } from '../components/sessionCard.js';
import { attachReactionHandlers } from '../components/reactions.js';
import { attachMomentCardHandlers } from '../components/momentCard.js';
import { attachMediaTileHandlers } from '../components/mediaTile.js';
import { attachCarouselHandlers } from '../components/carousel.js';
import { attachPostActionHandlers } from '../components/postActions.js';
import { registerSessionForPanel, momentViewerOpts } from '../components/momentPanel.js';

const { requireAuth, getAuth, whenExtensionMaybeSignsIn, logout, getSessionDetail } = window;

// As on post.html: a night with a public moment has a shareable link, and the
// person it was sent to usually has no account. They get what the link's
// preview already shows publicly; anything else goes through requireAuth().
const auth = getAuth();
const contentEl = document.getElementById('content');
// Either form: ?session=<id> as before, or /s/<id>, which is the shape a
// shared link takes now so the server can give it a real preview.
const sid = new URLSearchParams(window.location.search).get('session')
  || (window.location.pathname.match(/^\/s\/([^/]+)\/?$/) || [])[1]
  || '';
// The session this page is showing, kept so the share handler can find it.
let shownSession = null;

let detail = null;

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  initBackLinks();
  attachReactionHandlers(contentEl);
  attachMomentCardHandlers(contentEl);
  attachCarouselHandlers(contentEl);
  attachPostActionHandlers(contentEl);
  attachMediaTileHandlers(contentEl, { viewerOptsFor: momentViewerOpts });
  // One session on this page, so the lookup is trivial — but it goes through
  // the same door as the feed's, rather than a second share path here.
  attachSessionShareHandlers(contentEl, (id) => (shownSession && shownSession.clientSessionId === id ? shownSession : null));
  load();
} else {
  showPublicOrLogin();
}

const STORE_URL = 'https://chromewebstore.google.com/detail/kadhimjoddiaenogicbdnejoabdiimgn?utm_source=shared-night';

async function showPublicOrLogin() {
  let pub = null;
  if (sid) {
    try {
      const r = await fetch(`/og/session/${encodeURIComponent(sid)}.json`);
      if (r.ok) pub = await r.json();
    } catch (e) { /* treat as not public */ }
  }
  if (!pub) { requireAuth(); return; }
  for (const sel of ['.nav-links', '.topbar-right', '[data-back]']) {
    const node = document.querySelector(sel);
    if (node) node.style.display = 'none';
  }
  document.title = `${pub.title} — Herae`;
  sessionStorage.setItem('moments_return_to', location.pathname + location.search);
  contentEl.innerHTML = `
    <div class="post-detail-card">
      ${pub.image ? `<img src="${escapeHtml(pub.image)}" alt="${escapeHtml(pub.title)}" style="width:100%;display:block;border-radius:14px">` : ''}
      <div class="moment-body">
        <div style="font-weight:800;font-size:18px;margin-bottom:6px">${escapeHtml(pub.title)}</div>
        <div style="color:var(--ink-dim);font-size:14px">${escapeHtml(pub.description)}</div>
      </div>
    </div>
    <div style="margin-top:18px;border:1px solid rgba(139,92,246,.45);background:rgba(139,92,246,.08);border-radius:16px;padding:18px">
      <div style="font-weight:800;margin-bottom:6px">Watch together, however far apart</div>
      <div style="color:var(--ink-dim);font-size:14px;line-height:1.55">Herae keeps two people's video in sync on almost any site, with a video call beside it, and keeps nights like this one. Free on Chrome.</div>
      <a class="btn btn-primary" href="${STORE_URL}" target="_blank" rel="noopener" style="margin-top:12px;display:inline-flex">Try Herae — free</a>
      <a class="btn btn-ghost" href="/login.html" style="margin-top:12px;margin-left:8px;display:inline-flex">Log in</a>
    </div>`;
  whenExtensionMaybeSignsIn(() => window.location.reload(), () => {});
}

async function load() {
  if (!sid) {
    contentEl.innerHTML = renderEmptyState('🤔', 'No session specified.');
    return;
  }
  contentEl.innerHTML = renderFeedSkeletons(1);
  try {
    detail = await getSessionDetail(sid);
  } catch (err) {
    contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
    return;
  }
  // GET /session/:id returns the raw detail shape; renderSessionCard wants
  // the sessions/mine shape — the couple of derived fields are computed
  // here exactly like the server/feedGrouping compute them.
  const ratings = detail.reviews.map((r) => r.rating).filter((r) => r != null);
  const activity = [
    ...detail.moments.map((m) => m.createdAt),
    ...detail.reviews.map((r) => r.createdAt),
  ].sort();
  const participants = detail.participants.length
    ? detail.participants
    : [...new Set(detail.moments.flatMap((m) => m.participants))];
  const session = {
    clientSessionId: detail.clientSessionId,
    content: detail.content,
    sessionTitle: detail.sessionTitle,
    participants,
    participantAvatars: Object.keys(detail.participantAvatars || {}).length
      ? detail.participantAvatars
      : Object.assign({}, ...detail.moments.map((m) => m.participantAvatars || {})),
    moments: detail.moments,
    reviews: detail.reviews,
    startedAt: detail.startedAt,
    lastActivityAt: activity.at(-1) || detail.startedAt,
    averageRating: ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : null,
  };
  document.title = `${sessionDisplayTitle(session)} — Herae Memories`;
  registerSessionForPanel(session);
  shownSession = session;
  contentEl.innerHTML = renderSessionCard(session);
}

