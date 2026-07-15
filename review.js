// review.js — review.html only. Opened by the extension via
// review.html?session=<clientSessionId> right after "Finish Session" (on
// BOTH sides of the session). Reviews are about the SESSION itself — they
// exist and work whether or not any moments were captured; any moments
// that WERE captured during the session are shown linked above the review.
'use strict';

const auth = requireAuth();

function getSessionIdFromUrl() {
  return new URLSearchParams(window.location.search).get('session') || '';
}

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  attachPostCardHandlers(document.getElementById('content'));
  loadSession();
}

async function loadSession() {
  const contentEl = document.getElementById('content');
  const sessionId = getSessionIdFromUrl();
  if (!sessionId) {
    contentEl.innerHTML = `<div class="empty-state"><div class="icon">🤔</div><div class="msg">No session to review — this page is meant to be opened from the extension.</div></div>`;
    return;
  }

  let detail;
  try {
    detail = await getSessionDetail(sessionId);
  } catch (err) {
    contentEl.innerHTML = `<div class="empty-state"><div class="icon">😕</div><div class="msg">${escapeHtml(err.message)}</div></div>`;
    return;
  }

  const others = detail.participants.filter((p) => p !== auth.username);
  const partnerName = others.length ? others.join(' & ') : 'your partner';
  const myReview = detail.reviews.find((r) => r.username === auth.username);
  const partnerReview = detail.reviews.find((r) => r.username !== auth.username);

  const momentsStrip = detail.moments.length
    ? `<div class="review-moment-strip">
        ${detail.moments.map((m) => `<a href="post.html?type=moment&id=${m.id}"><img src="${momentImageUrl(m.url)}" alt="A moment from this session"></a>`).join('')}
      </div>`
    : `<div class="review-no-moments">No moments were captured this time — the review still counts 💜</div>`;

  contentEl.innerHTML = `
    ${momentsStrip}
    <div class="review-panel">
      <div class="review-section-title">Watched with ${escapeHtml(partnerName)}</div>

      <div class="review-section-title" style="margin-top:16px">${escapeHtml(partnerReview ? partnerReview.username : partnerName)}'s review</div>
      ${partnerReview
        ? `<div class="partner-review-box">
            ${escapeHtml(partnerReview.text)}
            ${renderReactionRow('review', partnerReview.id, partnerReview.likes, partnerReview.comments)}
          </div>`
        : `<div class="partner-review-box partner-review-waiting">Waiting for ${escapeHtml(partnerName)} to write theirs…</div>`}

      <div class="review-section-title" style="margin-top:22px">Your review <span style="font-weight:400;color:var(--ink-faint)">(totally optional)</span></div>
      <div class="field">
        <textarea id="reviewText" placeholder="What did you think of tonight's watch?">${myReview ? escapeHtml(myReview.text) : ''}</textarea>
      </div>
      <button class="btn btn-gold" id="saveReviewBtn" style="width:100%">${myReview ? '✏️ Update Review' : '💾 Save Review'}</button>
      <div class="save-confirm" id="saveConfirm"></div>
      ${myReview ? `<div style="margin-top:14px">${renderReactionRow('review', myReview.id, myReview.likes, myReview.comments)}</div>` : ''}
    </div>
  `;

  document.getElementById('saveReviewBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveReviewBtn');
    const confirmEl = document.getElementById('saveConfirm');
    const text = document.getElementById('reviewText').value.trim();
    if (!text) { confirmEl.textContent = ''; return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await postReview(sessionId, text);
      confirmEl.style.color = '#6ee7b7';
      confirmEl.textContent = '✓ Saved';
      btn.textContent = '✏️ Update Review';
      // A brand-new review has no id to like/comment on until we reload —
      // simplest correct thing is to just re-render with fresh data.
      if (!myReview) loadSession();
    } catch (err) {
      confirmEl.style.color = '#f87171';
      confirmEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
