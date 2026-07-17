// postActions.js — the "⋯" menu (Edit / Delete) and the inline editors
// behind it, for moments and reviews. One delegated handler installed
// alongside attachReactionHandlers on any container that renders cards, so
// the feed, the profile page, and the single-post view all get identical
// editing without any of them implementing it.
//
// Comments have their own edit/delete inside reactions.js rather than here:
// they're rendered by that component, they're a single line with no rating
// or media, and their handler is already delegated off the same container.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { renderStars, renderStarPicker } from './starRating.js';
import { renderUserLink } from './userLink.js';

const { updateMoment, deleteMoment, updateReview, deleteReview } = window;

// `canEdit` comes from the server on every moment/review (see
// hydrateMoments) — the menu simply isn't rendered without it. The routes
// re-check permission regardless; this only decides what's on screen.
export function renderPostMenu(type, id, canEdit) {
  if (!canEdit) return '';
  return `
    <div class="post-menu" data-post-type="${type}" data-post-id="${id}">
      <button class="post-menu-btn" aria-label="More actions" aria-haspopup="true" aria-expanded="false">⋯</button>
      <div class="post-menu-list" hidden>
        <button class="post-menu-item" data-action="edit">✏️ Edit</button>
        <button class="post-menu-item post-menu-item-danger" data-action="delete">🗑️ Delete</button>
      </div>
    </div>`;
}

// A review's rating + text, wrapped in the hooks the inline editor needs.
// Rendered by both momentCard and sessionCard so an edited review looks the
// same wherever it's shown.
export function renderReviewBody(review) {
  return `
    <div class="review-body" data-review-id="${review.id}">
      <div class="review-rating-slot">${review.rating ? renderStars(review.rating, { size: 'sm' }) : ''}</div>
      <div class="review-text-slot">${escapeHtml(review.text)}</div>
    </div>`;
}

// Author line + menu, shared by every place a review is shown inline.
export function renderReviewHead(review) {
  return `
    <div class="review-head-row">
      <span class="review-author">${renderUserLink(review.username)}</span>
      ${renderPostMenu('review', review.id, review.canEdit)}
    </div>`;
}

function closeAllMenus(root) {
  root.querySelectorAll('.post-menu-list').forEach((l) => { l.hidden = true; });
  root.querySelectorAll('.post-menu-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

// Removes whatever container the deleted thing lived in, and — for the last
// moment/review on a session card — the card itself, so the feed reflects
// the deletion immediately without a full reload.
function removeAndTidy(el) {
  const card = el.closest('.feed-card, .moment-card, .post-detail-card');
  el.remove();
  if (!card) return;
  const stillHasContent = card.querySelector('.media-tile-img, .media-tile-video, .review-body');
  if (!stillHasContent) card.remove();
}

// `opts.onDeleted` lets a page react (e.g. post.html navigating away, since
// removing the only card there would leave a blank page).
export function attachPostActionHandlers(container, opts = {}) {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.post-menu')) closeAllMenus(container);
  });

  container.addEventListener('click', async (e) => {
    const menuBtn = e.target.closest('.post-menu-btn');
    if (menuBtn) {
      const list = menuBtn.parentElement.querySelector('.post-menu-list');
      const wasOpen = !list.hidden;
      closeAllMenus(container);
      list.hidden = wasOpen;
      menuBtn.setAttribute('aria-expanded', String(!wasOpen));
      return;
    }

    const item = e.target.closest('.post-menu-item');
    if (!item) return;
    const menu = item.closest('.post-menu');
    const { postType, postId } = menu.dataset;
    closeAllMenus(container);

    if (item.dataset.action === 'delete') {
      const label = postType === 'moment' ? 'moment' : 'review';
      if (!confirm(`Delete this ${label}? This can't be undone.`)) return;
      try {
        if (postType === 'moment') await deleteMoment(postId);
        else await deleteReview(postId);
        if (opts.onDeleted) { opts.onDeleted(postType, postId); return; }
        if (postType === 'moment') {
          // The whole card in a single-moment context; just this tile in a
          // session carousel of several.
          const tile = menu.closest('.carousel-item') || menu.closest('.moment-card, .post-detail-card');
          removeAndTidy(tile || menu);
        } else {
          removeAndTidy(menu.closest('.session-review, .review-block') || menu);
        }
      } catch (err) {
        alert(err.message);
      }
      return;
    }

    if (item.dataset.action === 'edit') {
      if (postType === 'moment') startMomentEdit(menu, postId);
      else startReviewEdit(container, menu, postId);
    }
  });
}

// ── Inline caption editor (moments) ──────────────────────────────────
function startMomentEdit(menu, momentId) {
  // .mv-panel: the media viewer's side panel carries the same menu + slot.
  const card = menu.closest('.moment-card, .post-detail-card, .carousel-item, .mv-panel') || menu.parentElement;
  const slot = card.querySelector('.moment-description-slot');
  if (!slot || slot.querySelector('textarea')) return;
  const original = slot.dataset.description || '';

  slot.innerHTML = `
    <div class="inline-editor">
      <textarea class="inline-edit-text" maxlength="300" placeholder="Add a caption…">${escapeHtml(original)}</textarea>
      <div class="inline-editor-actions">
        <button class="btn-inline inline-save">Save</button>
        <button class="btn-inline btn-inline-ghost inline-cancel">Cancel</button>
      </div>
    </div>`;
  const textarea = slot.querySelector('textarea');
  textarea.focus();

  const restore = (description) => {
    slot.dataset.description = description || '';
    slot.innerHTML = description ? `<div class="moment-description">${escapeHtml(description)}</div>` : '';
  };

  slot.querySelector('.inline-cancel').addEventListener('click', () => restore(original));
  slot.querySelector('.inline-save').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const { description } = await updateMoment(momentId, textarea.value.trim());
      restore(description);
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  });
}

// ── Inline review editor (text + rating) ─────────────────────────────
function startReviewEdit(container, menu, reviewId) {
  const body = container.querySelector(`.review-body[data-review-id="${reviewId}"]`)
    || menu.closest('.session-review, .review-block')?.querySelector('.review-body');
  if (!body || body.querySelector('textarea')) return;

  const textSlot = body.querySelector('.review-text-slot');
  const ratingSlot = body.querySelector('.review-rating-slot');
  const originalText = textSlot.textContent.trim();
  const originalRatingHtml = ratingSlot.innerHTML;
  // The rendered stars carry the value, so an edit doesn't need a refetch.
  const originalRating = Number(ratingSlot.querySelector('[data-rating]')?.dataset.rating || 0);

  ratingSlot.innerHTML = '<div class="review-edit-stars"></div>';
  const picker = renderStarPicker(ratingSlot.querySelector('.review-edit-stars'), originalRating, () => {});

  textSlot.innerHTML = `
    <div class="inline-editor">
      <textarea class="inline-edit-text" maxlength="2000">${escapeHtml(originalText)}</textarea>
      <div class="inline-editor-actions">
        <button class="btn-inline inline-save">Save</button>
        <button class="btn-inline btn-inline-ghost inline-cancel">Cancel</button>
      </div>
    </div>`;
  const textarea = textSlot.querySelector('textarea');
  textarea.focus();

  textSlot.querySelector('.inline-cancel').addEventListener('click', () => {
    textSlot.textContent = originalText;
    ratingSlot.innerHTML = originalRatingHtml;
  });

  textSlot.querySelector('.inline-save').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const text = textarea.value.trim();
    if (!text) { alert('Write a few words first.'); return; }
    btn.disabled = true;
    try {
      const rating = picker.getValue() || null;
      const updated = await updateReview(reviewId, text, rating);
      textSlot.textContent = updated.text;
      ratingSlot.innerHTML = updated.rating ? renderStars(updated.rating, { size: 'sm' }) : '';
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  });
}
