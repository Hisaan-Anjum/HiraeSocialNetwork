// sessionCard.js — a whole watch-together session as one feed card, from
// GET /api/moments/sessions/mine (see server/src/moments.js). Bundles:
// who watched, what they watched, every moment captured (as a carousel),
// and every review + average rating.
//
// A session's reviews here come without their own like/comment counts
// (sessions/mine intentionally returns the lighter { id, username, text,
// rating, createdAt } shape, not the full reaction-hydrated one — see
// moments.js) so this card shows them read-only with a "→ open review" link
// into post.html, which fetches the fully-hydrated single review (with
// likes/comments) via GET /api/reviews/:id. Full inline reactions ARE shown
// for the session's own moments, since hydrateMoments() always includes
// those regardless of endpoint.
'use strict';

import { escapeHtml, formatRelative, formatDate, sessionDisplayTitle } from '../lib/util.js';
import { renderStars } from './starRating.js';
import { renderReactionRow } from './reactions.js';
import { renderCarousel } from './carousel.js';
import { renderMediaTile } from './mediaTile.js';
import { renderUserLink, renderUserLinks } from './userLink.js';
import { renderAvatarLink } from './avatar.js';
import { renderPostMenu, renderReviewBody } from './postActions.js';

// Two shapes of `review` reach this: the lightweight one from
// GET /sessions/mine ({id,username,text,rating,createdAt} — no
// likes/comments), and the fully-hydrated one grouped client-side from
// GET /feed|/mine|/by/:username (each moment's .reviews DOES include
// likes/comments — see hydrateMoments on the server). Render full inline
// reactions when they're present, otherwise a link out to post.html's
// single-review view, which fetches the hydrated shape itself.
function renderReviewSummary(review) {
  const hasReactions = !!review.likes;
  return `
    <div class="session-review">
      <div class="session-review-head">
        ${renderAvatarLink({ username: review.username, avatarUrl: review.avatarUrl }, { size: 'sm' })}
        <span class="session-review-author">${renderUserLink(review.username)}</span>
        <span class="session-review-date">${formatDate(review.createdAt)}</span>
        ${renderPostMenu('review', review.id, review.canEdit)}
      </div>
      ${renderReviewBody(review)}
      ${hasReactions
        ? renderReactionRow('review', review.id, review.likes, review.comments)
        : `<a class="review-open-link" href="post.html?type=review&id=${review.id}">Open review ↗</a>`}
    </div>
  `;
}

export function renderSessionCard(session) {
  const participants = session.participants || [];
  const peopleHtml = participants.length ? renderUserLinks(participants) : 'A watch session';
  // The session's own title when it has one, otherwise what was watched —
  // identical to the previous behavior for every untitled session.
  const title = sessionDisplayTitle(session);
  // Only when BOTH exist is there a second line to show: a titled session
  // still says what it was actually watching underneath.
  const watchedSub = session.sessionTitle && session.content?.title ? session.content.title : null;
  const hasReviews = session.reviews.length > 0;
  const avatars = session.participantAvatars || {};
  // Each slide carries the moment's own ⋯ menu and caption. Tiles used to
  // link out to post.html (where the menu lived) but now open the media
  // viewer instead — so editing/deleting a post has to be reachable right
  // here, on the card, which is also where a deletion should visibly land.
  const momentsHtml = session.moments.map((m) => `
    <div class="carousel-item" data-moment-id="${m.id}">
      ${renderMediaTile(m, { className: 'session-carousel-media' })}
      <div class="carousel-item-bar">
        <a class="carousel-item-open" href="session.html?session=${encodeURIComponent(session.clientSessionId)}" title="Open this session">↗</a>
        ${renderPostMenu('moment', m.id, m.canEdit)}
      </div>
      <div class="moment-description-slot carousel-item-caption" data-description="${escapeHtml(m.description || '')}">
        ${m.description ? `<div class="moment-description">${escapeHtml(m.description)}</div>` : ''}
      </div>
    </div>
  `);

  // A session itself has no like/comment row of its own in the schema —
  // only its individual moments do. Rather than a fake session-level
  // button, the reaction row underneath the carousel represents its FIRST
  // captured moment (each tile also links to its own post.html detail page
  // for reacting to a specific photo/video individually).
  const momentReactions = session.moments.length
    ? renderReactionRow('moment', session.moments[0].id, session.moments[0].likes, session.moments[0].comments)
    : '';

  const sessionHref = `session.html?session=${encodeURIComponent(session.clientSessionId)}`;

  return `
    <article class="feed-card session-card" data-session-id="${escapeHtml(session.clientSessionId)}">
      <div class="feed-card-head">
        <a class="feed-card-open" href="${sessionHref}" aria-label="Open this session"></a>
        <div class="avatar-stack">
          ${(participants.length ? participants : ['?']).slice(0, 3).map((u) =>
            renderAvatarLink({ username: u, avatarUrl: avatars[u] || null }, { size: 'md' })).join('')}
        </div>
        <div class="feed-card-headtext">
          <div class="feed-card-people">${peopleHtml}</div>
          <div class="feed-card-sub">watched <span class="feed-card-title-inline">${escapeHtml(title)}</span> · ${formatRelative(session.lastActivityAt || session.startedAt)}</div>
          ${watchedSub ? `<div class="feed-card-watched">📺 ${escapeHtml(watchedSub)}</div>` : ''}
        </div>
        ${session.averageRating ? `<div class="session-avg-rating">${renderStars(session.averageRating)}<span class="session-avg-num">${session.averageRating}</span></div>` : ''}
      </div>

      ${session.moments.length ? `
        <div class="session-carousel-wrap">
          ${renderCarousel(momentsHtml, { className: 'session-moments-carousel', mode: '3d' })}
        </div>
        ${momentReactions}
      ` : `<div class="review-no-moments">No moments were captured this time — the review still counts 💜</div>`}

      ${hasReviews ? `
        <div class="session-reviews">${session.reviews.map(renderReviewSummary).join('')}</div>
      ` : `
        <div class="session-no-review">
          <span>No review written yet.</span>
        </div>
      `}
    </article>
  `;
}
