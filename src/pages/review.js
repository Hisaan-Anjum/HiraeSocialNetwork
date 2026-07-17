// review.js — review.html only. Opened by the extension via
// review.html?session=<clientSessionId> right after "Finish Session" (on
// BOTH sides of the session). Reviews are about the SESSION itself — they
// exist and work whether or not any moments were captured.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { renderEmptyState, renderErrorState } from '../components/skeleton.js';
import { renderReactionRow, attachReactionHandlers } from '../components/reactions.js';
import { renderStarPicker } from '../components/starRating.js';
import { renderMediaTile, attachMediaTileHandlers } from '../components/mediaTile.js';
import { attachCarouselHandlers } from '../components/carousel.js';
import { renderUserLink, renderUserLinks } from '../components/userLink.js';
import { renderAvatarLink } from '../components/avatar.js';
import { attachPostActionHandlers, renderPostMenu, renderReviewBody } from '../components/postActions.js';
import { registerSessionForPanel, momentViewerOpts } from '../components/momentPanel.js';

const { requireAuth, getSessionDetail, postReview } = window;

const auth = requireAuth();

function getSessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get('session') || '';
}

const contentEl = document.getElementById('content');

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  attachReactionHandlers(contentEl);
  attachMediaTileHandlers(contentEl, { viewerOptsFor: momentViewerOpts });
  attachCarouselHandlers(contentEl);
  // Deleting your own review from here re-renders the page: the "Your
  // review" form below flips back to its empty/write state, which patching
  // the DOM in place couldn't do correctly.
  attachPostActionHandlers(contentEl, { onDeleted: () => loadSession() });
  loadSession();
}

async function loadSession() {
  const sessionId = getSessionIdFromUrl();
  if (!sessionId) {
    contentEl.innerHTML = renderEmptyState('🤔', 'No session to review — this page is meant to be opened from the extension.');
    return;
  }

  let detail;
  try {
    detail = await getSessionDetail(sessionId);
  } catch (err) {
    contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
    return;
  }

  registerSessionForPanel(detail);
  const others = detail.participants.filter((p) => p !== auth.username);
  const partnerName = others.length ? others.join(' & ') : 'your partner';
  const myReview = detail.reviews.find((r) => r.username === auth.username);
  // Every OTHER participant's review, not just one — a session can have
  // 3+ people (group calls), and each of them can leave their own review.
  const otherReviews = detail.reviews.filter((r) => r.username !== auth.username);
  const stillWaitingOn = others.filter((u) => !otherReviews.some((r) => r.username === u));
  const title = detail.content?.title;

  const momentsStrip = detail.moments.length
    ? `<div class="review-moment-strip">${detail.moments.map((m) => `
        <div class="review-moment-strip-item">${renderMediaTile(m, { className: 'review-strip-media' })}</div>
      `).join('')}</div>`
    : `<div class="review-no-moments">No moments were captured this time — the review still counts 💜</div>`;

  contentEl.innerHTML = `
    ${detail.sessionTitle ? `<div class="review-session-title-banner">${escapeHtml(detail.sessionTitle)}</div>` : ''}
    ${title ? `<div class="review-content-banner">📺 ${escapeHtml(title)}</div>` : ''}
    ${momentsStrip}
    <div class="review-panel">
      <div class="review-section-title">Watched with ${others.length ? renderUserLinks(others) : escapeHtml(partnerName)}</div>

      ${otherReviews.map((r) => `
        <div class="review-section-title" style="margin-top:16px">${renderUserLink(r.username)}'s review</div>
        <div class="partner-review-box">
          <div class="review-head-row">
            ${renderAvatarLink({ username: r.username, avatarUrl: r.avatarUrl }, { size: 'sm' })}
            <span class="review-author">${renderUserLink(r.username)}</span>
            ${renderPostMenu('review', r.id, r.canEdit)}
          </div>
          ${renderReviewBody(r)}
          ${renderReactionRow('review', r.id, r.likes, r.comments)}
        </div>
      `).join('')}
      ${stillWaitingOn.map((u) => `
        <div class="review-section-title" style="margin-top:16px">${renderUserLink(u)}'s review</div>
        <div class="partner-review-box partner-review-waiting">Waiting for ${escapeHtml(u)} to write theirs…</div>
      `).join('')}

      <div class="review-section-title review-own-title" style="margin-top:22px">
        <span>Your review <span style="font-weight:400;color:var(--ink-faint)">(totally optional)</span></span>
        ${myReview ? `<button class="btn-inline btn-inline-danger" id="deleteMyReviewBtn">🗑️ Delete</button>` : ''}
      </div>
      <div class="field">
        <label>Your rating</label>
        <div id="starPickerMount"></div>
      </div>
      <div class="field">
        <textarea id="reviewText" placeholder="What did you think of tonight's watch?">${myReview ? escapeHtml(myReview.text) : ''}</textarea>
      </div>
      <div class="field">
        <label for="sessionTitleInput">Name this session <span style="font-weight:400;color:var(--ink-faint);text-transform:none;letter-spacing:0">(optional — you both see it)</span></label>
        <input type="text" id="sessionTitleInput" maxlength="120" autocomplete="off"
               placeholder="e.g. Finale night 💜" value="${escapeHtml(detail.sessionTitle || '')}">
      </div>
      <button class="btn btn-gold" id="saveReviewBtn" style="width:100%">${myReview ? '✏️ Update Review' : '💾 Save Review'}</button>
      <div class="save-confirm" id="saveConfirm"></div>
      ${myReview ? `<div style="margin-top:14px">${renderReactionRow('review', myReview.id, myReview.likes, myReview.comments)}</div>` : ''}
    </div>
  `;

  const picker = renderStarPicker(document.getElementById('starPickerMount'), myReview?.rating || 0, () => {});

  // Editing your own review here stays the existing "type into the form and
  // save" flow (postReview upserts) — the ⋯ menu's inline editor is for the
  // OTHER reviews on this page and everywhere else on the site. Deleting is
  // the one thing that form can't express, so it gets its own button.
  document.getElementById('deleteMyReviewBtn')?.addEventListener('click', async (e) => {
    if (!confirm("Delete your review? This can't be undone.")) return;
    e.currentTarget.disabled = true;
    try {
      await window.deleteReview(myReview.id);
      loadSession();
    } catch (err) {
      alert(err.message);
      e.currentTarget.disabled = false;
    }
  });

  document.getElementById('saveReviewBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveReviewBtn');
    const confirmEl = document.getElementById('saveConfirm');
    const text = document.getElementById('reviewText').value.trim();
    // Always sent (even empty) so clearing the field clears the title —
    // the server treats '' as "clear" and undefined as "don't touch".
    const sessionTitle = document.getElementById('sessionTitleInput').value.trim();
    const titleChanged = sessionTitle !== (detail.sessionTitle || '');
    // Both fields are optional and independent: naming the session without
    // writing a review is a perfectly good thing to want, so only complain
    // when there's genuinely nothing to save.
    if (!text && !titleChanged) {
      confirmEl.style.color = '#f87171';
      confirmEl.textContent = 'Write a few words, or name this session.';
      return;
    }
    const rating = picker.getValue() || null;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      if (!text) await window.setSessionTitle(sessionId, sessionTitle);
      else await postReview(sessionId, text, { rating, sessionTitle, content: detail.content || undefined });
      confirmEl.style.color = '#6ee7b7';
      confirmEl.textContent = '✓ Saved';
      if (text) btn.textContent = '✏️ Update Review';
      // A renamed session must re-render its banner/heading; a first review
      // also swaps the form into its "written" state.
      if (!myReview || titleChanged) loadSession();
    } catch (err) {
      confirmEl.style.color = '#f87171';
      confirmEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
