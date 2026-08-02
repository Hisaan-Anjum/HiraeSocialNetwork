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
import { mountSessionLink } from '../watchlist/sessionLink.js';
import { mountAiMoments } from '../components/aiMoments.js';

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

// The only two things a link/unlink changes on this page: the banner across
// the top, and the session-name field. Everything else — the moments strip,
// the AI memories panel and whatever is playing inside it, the review form
// and its unsaved text, the scroll position — is deliberately left alone.
function applySessionLink({ linked, title } = {}) {
  if (!detail) return; // nothing mounted yet — nothing to patch
  const nextTitle = linked ? (title || '') : '';
  detail.sessionTitle = nextTitle;

  const input = document.getElementById('sessionTitleInput');
  // Never clobber something the person is in the middle of typing.
  if (input && document.activeElement !== input) input.value = nextTitle;

  let banner = contentEl.querySelector('.review-session-title-banner');
  if (nextTitle) {
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'review-session-title-banner';
      contentEl.prepend(banner);
    }
    banner.textContent = nextTitle;
  } else if (banner) {
    banner.remove();
  }
}

// `detail` is held at module scope so applySessionLink above can keep it in
// step without re-fetching — the page's own copy of the session it is
// describing, updated in place exactly as the DOM is.
let detail = null;

async function loadSession() {
  const sessionId = getSessionIdFromUrl();
  if (!sessionId) {
    contentEl.innerHTML = renderEmptyState('🤔', 'No session to review — this page is meant to be opened from the extension.');
    return;
  }

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
    <div id="aiMomentsMount"></div>
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
        <div id="sessionLinkMount"></div>
      </div>
      <button class="btn btn-gold" id="saveReviewBtn" style="width:100%">${myReview ? '✏️ Update Review' : '💾 Save Review'}</button>
      <div class="save-confirm" id="saveConfirm"></div>
      ${myReview ? `<div style="margin-top:14px">${renderReactionRow('review', myReview.id, myReview.likes, myReview.comments)}</div>` : ''}
    </div>
  `;

  // The moments Herae found on this machine, offered before the review form
  // because they are the part of the night that is about to be lost if nobody
  // looks. Fire-and-forget: the page must render identically for someone
  // without the extension, or with the feature switched off.
  mountAiMoments(document.getElementById('aiMomentsMount'), { sessionId });

  const picker = renderStarPicker(document.getElementById('starPickerMount'), myReview?.rating || 0, () => {});

  // Offer to file this night under a film on the pair's shared watchlist —
  // autocomplete while naming it, or a one-tap "was this …?" when the detected
  // title already matches something on the list. Entirely optional; the page
  // works exactly as before if they ignore it (or aren't contacts).
  mountSessionLink({
    mount: document.getElementById('sessionLinkMount'),
    input: document.getElementById('sessionTitleInput'),
    detail,
    me: auth.username,
    // Patch, do not reload. Filing a night under a film used to rebuild the
    // whole page: the moments strip flickered, any AI memory that was
    // mid-playback stopped dead, an open caption field was wiped, and the
    // scroll jumped to the top — all to change one line of text. Filing is a
    // small, confident action and it should feel like one.
    onLinked: (info) => applySessionLink(info),
  });

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
      // A FIRST review swaps the form into its "written" state, which is a
      // genuine structural change and worth a rebuild. A rename is not — it
      // is the same one line applySessionLink already knows how to patch.
      if (!myReview) loadSession();
      else if (titleChanged) applySessionLink({ linked: !!sessionTitle, title: sessionTitle });
    } catch (err) {
      confirmEl.style.color = '#f87171';
      confirmEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
