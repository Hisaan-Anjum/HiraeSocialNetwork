// momentPanel.js — the media viewer's right-hand column for one moment:
// participants, metadata, the (editable) caption, likes + comments opened,
// and the session's reviews. One implementation shared by every page that
// opens media, so the panel is never "missing" depending on where a moment
// was clicked.
//
// Pages register each session as they render it (registerSessionForPanel);
// the tile handler then finds the full hydrated moment + its session here
// at click time (momentViewerOpts, passed as attachMediaTileHandlers'
// viewerOptsFor). One persistent host element carries the delegated
// reaction/post-action handlers — the viewer moves it in and out of its
// overlay without ever destroying it.
'use strict';

import { escapeHtml, formatDate, sessionDisplayTitle } from '../lib/util.js';
import { renderReactionRow, attachReactionHandlers } from './reactions.js';
import { attachPostActionHandlers, renderPostMenu, renderReviewBody } from './postActions.js';
import { renderUserLink, renderUserLinks } from './userLink.js';
import { renderAvatarLink } from './avatar.js';

const registry = new Map(); // String(momentId) -> { moment, session }
let panelHost = null;

function host() {
  if (panelHost) return panelHost;
  panelHost = document.createElement('div');
  attachReactionHandlers(panelHost);
  // Deleting from inside the viewer leaves the page behind stale (slide,
  // counts, reviews all reference what's gone) — reload is the honest sync.
  attachPostActionHandlers(panelHost, { onDeleted: () => window.location.reload() });
  return panelHost;
}

// `session` needs { clientSessionId, sessionTitle?, content?, moments,
// reviews } — the shape both /sessions/mine and feedGrouping already
// produce; pages with only a bare moment pass a session-alike built from it.
export function registerSessionForPanel(session) {
  for (const m of session.moments || []) registry.set(String(m.id), { moment: m, session });
}

// attachMediaTileHandlers' viewerOptsFor. A tile whose moment was never
// registered opens the viewer without a panel, exactly as before.
export function momentViewerOpts(tile) {
  const hit = registry.get(String(tile.dataset.momentId));
  if (!hit) return {};
  buildPanel(hit.moment, hit.session);
  return { panelEl: host() };
}

function buildPanel(m, session) {
  const seconds = m.durationMs ? Math.round(m.durationMs / 1000) : null;
  const reviews = session.reviews || [];
  host().innerHTML = `
    <div class="mvp-session-line">
      <a href="session.html?session=${encodeURIComponent(session.clientSessionId)}">
        ${escapeHtml(sessionDisplayTitle(session, 'View this session'))} ↗
      </a>
    </div>
    <div class="mvp-head">
      <span class="moment-people">${renderUserLinks(m.participants)}</span>
      ${renderPostMenu('moment', m.id, m.canEdit)}
    </div>
    <div class="mvp-meta">
      <span class="theme-badge">${escapeHtml(m.theme)}</span>
      <span class="privacy-badge">${escapeHtml(m.privacy)}</span>
      ${seconds ? `<span class="mvp-duration">🎥 ${seconds}s</span>` : ''}
      <span class="moment-date">${formatDate(m.createdAt)}</span>
    </div>
    <div class="moment-description-slot" data-description="${escapeHtml(m.description || '')}">
      ${m.description ? `<div class="moment-description">${escapeHtml(m.description)}</div>` : ''}
    </div>
    ${renderReactionRow('moment', m.id, m.likes, m.comments)}
    ${reviews.length ? `
      <div class="mvp-section-title">Reviews</div>
      ${reviews.map((rv) => `
        <div class="mvp-review">
          <div class="review-head-row">
            ${renderAvatarLink({ username: rv.username, avatarUrl: rv.avatarUrl }, { size: 'sm' })}
            <span class="review-author">${renderUserLink(rv.username)}</span>
            ${renderPostMenu('review', rv.id, rv.canEdit)}
          </div>
          ${renderReviewBody(rv)}
          ${rv.likes ? renderReactionRow('review', rv.id, rv.likes, rv.comments) : ''}
        </div>
      `).join('')}` : ''}
  `;
  // Comments are the panel's point — open them instead of leaving them
  // behind the 💬 toggle.
  const comments = panelHost.querySelector('.comments-block');
  if (comments) comments.style.display = 'block';
}
