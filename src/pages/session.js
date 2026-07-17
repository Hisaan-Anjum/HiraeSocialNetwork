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
import { renderSessionCard } from '../components/sessionCard.js';
import { attachReactionHandlers } from '../components/reactions.js';
import { attachMomentCardHandlers } from '../components/momentCard.js';
import { attachMediaTileHandlers } from '../components/mediaTile.js';
import { attachCarouselHandlers } from '../components/carousel.js';
import { attachPostActionHandlers } from '../components/postActions.js';
import { registerSessionForPanel, momentViewerOpts } from '../components/momentPanel.js';

const { requireAuth, logout, getSessionDetail } = window;

const auth = requireAuth();
const contentEl = document.getElementById('content');
const sid = new URLSearchParams(window.location.search).get('session') || '';

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
  load();
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
  document.title = `${sessionDisplayTitle(session)} — Hirae Memories`;
  registerSessionForPanel(session);
  contentEl.innerHTML = renderSessionCard(session);
}

