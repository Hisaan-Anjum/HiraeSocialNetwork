// post.js — post.html only. A single moment or a single review, "just that
// post," reached via ?type=moment&id=X or ?type=review&id=Y (the card grid
// and review-block links both point here — see postcard.js).
'use strict';

const auth = requireAuth();

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return { type: params.get('type') === 'review' ? 'review' : 'moment', id: params.get('id') };
}

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  attachPostCardHandlers(document.getElementById('content'));
  load();
}

async function load() {
  const contentEl = document.getElementById('content');
  const { type, id } = getParams();
  if (!id) {
    contentEl.innerHTML = `<div class="empty-state"><div class="icon">🤔</div><div class="msg">No post specified.</div></div>`;
    return;
  }

  try {
    if (type === 'review') {
      const { review, moment } = await getReviewById(id);
      contentEl.innerHTML = `
        <div class="post-detail-card">
          <img src="${momentImageUrl(moment.url)}" alt="A captured moment" class="post-detail-img lightbox-trigger">
          <div class="moment-body">
            <div class="moment-meta">
              <span class="moment-people">${escapeHtml(moment.participants.join(' & '))}</span>
              <span class="moment-date">${formatDate(moment.createdAt)}</span>
            </div>
            <div class="review-block">
              <div class="review-line"><span class="review-author">${escapeHtml(review.username)}:</span> ${escapeHtml(review.text)}</div>
              ${renderReactionRow('review', review.id, review.likes, review.comments)}
            </div>
            <div style="text-align:center;margin-top:18px">
              <a class="btn btn-ghost" href="post.html?type=moment&id=${moment.id}">See the full moment →</a>
            </div>
          </div>
        </div>
      `;
    } else {
      const { moment } = await getMomentById(id);
      contentEl.innerHTML = renderPostCard(moment, { detail: true, showPrivacyControl: moment.isMine });
    }
  } catch (err) {
    contentEl.innerHTML = `<div class="empty-state"><div class="icon">😕</div><div class="msg">${escapeHtml(err.message)}</div></div>`;
  }
}
