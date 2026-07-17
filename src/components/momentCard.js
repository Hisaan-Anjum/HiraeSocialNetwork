// momentCard.js — a single moment (photo or video) as its own card: a
// single-post detail view (post.html), and
// the feed's fallback for a moment that isn't part of the viewer's own
// sessions/mine list (e.g. a contact's or public moment with no review of
// its own — see src/pages/memories.js).
'use strict';

import { escapeHtml, formatDate } from '../lib/util.js';
import { renderReactionRow } from './reactions.js';
import { renderMediaTile } from './mediaTile.js';
import { renderUserLink, renderUserLinks } from './userLink.js';
import { renderReviewBody, renderPostMenu } from './postActions.js';

const THEME_LABELS = {
  polaroid: '📷 Polaroid', grid: '🖼️ Cozy Grid', filmstrip: '🎞️ Filmstrip',
  couple: '💕 Couple', family: '🏡 Family',
};
const PRIVACY_LABELS = { public: '🌐 Public', contacts: '👥 Contacts', private: '🔒 Just us' };

function renderReviewBlock(review) {
  return `
    <div class="review-block">
      <div class="review-head-row">
        <span class="review-author">${renderUserLink(review.username)}</span>
        <a class="review-open-link" href="post.html?type=review&id=${review.id}" title="Open this review on its own page">↗</a>
        ${renderPostMenu('review', review.id, review.canEdit)}
      </div>
      ${renderReviewBody(review)}
      ${renderReactionRow('review', review.id, review.likes, review.comments)}
    </div>
  `;
}

// opts.showPrivacyControl: only true for your own posts.
// opts.detail: post.html's bigger single-post view (click-to-zoom image)
// instead of a grid tile linking out to itself.
export function renderMomentCard(moment, opts = {}) {
  const people = renderUserLinks(moment.participants);
  const reviewsHtml = moment.reviews.length
    ? moment.reviews.map(renderReviewBlock).join('')
    : '<div class="review-empty">No review written for this one yet.</div>';

  const privacyHtml = opts.showPrivacyControl
    ? `
      <select class="privacy-select" data-moment-id="${moment.id}" data-prev="${moment.privacy}">
        ${Object.entries(PRIVACY_LABELS).map(([id, label]) =>
          `<option value="${id}" ${moment.privacy === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    `
    : `<span class="privacy-badge">${PRIVACY_LABELS[moment.privacy] || moment.privacy}</span>`;

  const mediaHtml = renderMediaTile(moment, { className: opts.detail ? 'post-detail-media' : 'moment-card-media' });

  return `
    <div class="${opts.detail ? 'post-detail-card' : 'moment-card'}" data-moment-id="${moment.id}">
      ${mediaHtml}
      <div class="moment-body">
        <div class="moment-meta-row">
          <span class="theme-badge">${THEME_LABELS[moment.theme] || moment.theme}</span>
          ${privacyHtml}
          ${renderPostMenu('moment', moment.id, moment.canEdit)}
        </div>
        <div class="moment-meta">
          <span class="moment-people">${people}</span>
          <span class="moment-date">${formatDate(moment.createdAt)}</span>
        </div>
        <div class="moment-description-slot" data-description="${escapeHtml(moment.description || '')}">
          ${moment.description ? `<div class="moment-description">${escapeHtml(moment.description)}</div>` : ''}
        </div>
        ${renderReactionRow('moment', moment.id, moment.likes, moment.comments)}
        <div class="moment-reviews">${reviewsHtml}</div>
      </div>
    </div>
  `;
}

// Change handler for the privacy <select> — attached alongside the shared
// reaction handlers wherever a moment grid/card can appear.
export function attachMomentCardHandlers(container) {
  const { setMomentPrivacy } = window;
  container.addEventListener('change', async (e) => {
    const select = e.target.closest('.privacy-select');
    if (!select) return;
    const momentId = select.dataset.momentId;
    const prev = select.dataset.prev;
    select.disabled = true;
    try {
      await setMomentPrivacy(momentId, select.value);
      select.dataset.prev = select.value;
    } catch (err) {
      alert(err.message);
      select.value = prev;
    } finally {
      select.disabled = false;
    }
  });
}
