// post.js — post.html only. A single moment or a single review, reached
// via ?type=moment&id=X or ?type=review&id=Y (every card/carousel/review
// link across the site points here).
'use strict';

import { escapeHtml, formatDate, initBackLinks } from '../lib/util.js';
import { renderEmptyState, renderErrorState } from '../components/skeleton.js';
import { renderMomentCard, attachMomentCardHandlers } from '../components/momentCard.js';
import { renderReactionRow, attachReactionHandlers } from '../components/reactions.js';
import { attachMediaTileHandlers } from '../components/mediaTile.js';
import { renderMediaTile } from '../components/mediaTile.js';
import { renderUserLink, renderUserLinks } from '../components/userLink.js';
import { renderAvatarLink } from '../components/avatar.js';
import { attachPostActionHandlers, renderPostMenu, renderReviewBody } from '../components/postActions.js';
import { registerSessionForPanel, momentViewerOpts } from '../components/momentPanel.js';

const { requireAuth, logout, getMomentById, getReviewById } = window;

const auth = requireAuth();

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return { type: params.get('type') === 'review' ? 'review' : 'moment', id: params.get('id') };
}

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  const content = document.getElementById('content');
  initBackLinks();
  attachReactionHandlers(content);
  attachMomentCardHandlers(content);
  attachMediaTileHandlers(content, { viewerOptsFor: momentViewerOpts });
  // Deleting the very thing this page exists to show can't just remove the
  // card — that would leave a blank page — so this page overrides the
  // default removal and navigates back to the feed instead.
  attachPostActionHandlers(content, {
    onDeleted: () => { window.location.href = 'memories.html'; },
  });
  load();
}

async function load() {
  const contentEl = document.getElementById('content');
  const { type, id } = getParams();
  if (!id) {
    contentEl.innerHTML = renderEmptyState('🤔', 'No post specified.');
    return;
  }

  try {
    if (type === 'review') {
      const { review, moment } = await getReviewById(id);
      if (moment) {
        registerSessionForPanel({
          clientSessionId: moment.clientSessionId, sessionTitle: moment.sessionTitle || null,
          content: moment.content, moments: [moment], reviews: moment.reviews || [],
        });
      }
      // `moment` is deliberately nullable here — GET /api/reviews/:id
      // returns the review alone when none of its session's moments pass
      // the per-moment privacy check (the accompanying photo is only
      // illustrative context; see that route's comment). Every use of it
      // below is guarded accordingly.
      contentEl.innerHTML = `
        <div class="post-detail-card">
          ${moment ? renderMediaTile(moment, { className: 'post-detail-media' }) : ''}
          <div class="moment-body">
            ${moment ? `
              <div class="moment-meta">
                <span class="moment-people">${renderUserLinks(moment.participants)}</span>
                <span class="moment-date">${formatDate(moment.createdAt)}</span>
              </div>` : ''}
            <div class="review-block">
              <div class="review-head-row">
                ${renderAvatarLink({ username: review.username, avatarUrl: review.avatarUrl }, { size: 'sm' })}
                <span class="review-author">${renderUserLink(review.username)}</span>
                <span class="moment-date">${formatDate(review.createdAt)}</span>
                ${renderPostMenu('review', review.id, review.canEdit)}
              </div>
              ${renderReviewBody(review)}
              ${renderReactionRow('review', review.id, review.likes, review.comments)}
            </div>
            ${moment ? `
              <div style="text-align:center;margin-top:18px">
                <a class="btn btn-ghost" href="post.html?type=moment&id=${moment.id}">See the full moment →</a>
              </div>` : ''}
          </div>
        </div>
      `;
    } else {
      const { moment } = await getMomentById(id);
      registerSessionForPanel({
        clientSessionId: moment.clientSessionId, sessionTitle: moment.sessionTitle || null,
        content: moment.content, moments: [moment], reviews: moment.reviews || [],
      });
      contentEl.innerHTML = renderMomentCard(moment, { detail: true, showPrivacyControl: moment.isMine });
    }
  } catch (err) {
    contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
  }
}
