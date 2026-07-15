// postcard.js — shared post-card rendering + like/comment/privacy
// interaction, used by memories.html (feed/mine), contact.html, and
// review.html. One definition of what a "post" looks like and how liking/
// commenting on it behaves, instead of three slightly-different copies.
'use strict';

const THEME_LABELS = {
  polaroid: '📷 Polaroid', grid: '🖼️ Cozy Grid', filmstrip: '🎞️ Filmstrip',
  couple: '💕 Couple', family: '🏡 Family',
};
const PRIVACY_LABELS = { public: '🌐 Public', contacts: '👥 Contacts', private: '🔒 Just us' };

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

// Full-screen click-to-zoom, shared by post.html and (optionally) anywhere
// else that wants a bigger look at a moment's image than the card/detail
// view's own size — click anywhere (image or backdrop) to close.
function openLightbox(imageUrl) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  const img = document.createElement('img');
  img.src = imageUrl;
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
  });
  document.body.appendChild(overlay);
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString.replace(' ', 'T') + (isoString.includes('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderCommentsList(comments) {
  if (!comments.length) return '<div class="comment-empty">No comments yet.</div>';
  return comments.map((c) => `
    <div class="comment-line"><span class="comment-author">${escapeHtml(c.username)}</span> ${escapeHtml(c.text)}</div>
  `).join('');
}

// A reaction row (like + comment-toggle button) shared by moments and
// reviews — only post_type/post_id and the current counts differ.
function renderReactionRow(postType, postId, likes, comments) {
  const key = `${postType}-${postId}`;
  return `
    <div class="reaction-row">
      <button class="like-btn${likes.likedByMe ? ' like-btn-active' : ''}" data-post-type="${postType}" data-post-id="${postId}">
        ${likes.likedByMe ? '💜' : '🤍'} <span class="like-count">${likes.count}</span>
      </button>
      <button class="comment-toggle-btn" data-target="comments-${key}">
        💬 <span class="comment-count">${comments.length}</span>
      </button>
    </div>
    <div class="comments-block" id="comments-${key}" style="display:none">
      <div class="comments-list">${renderCommentsList(comments)}</div>
      <div class="comment-input-row">
        <input type="text" class="comment-input" data-post-type="${postType}" data-post-id="${postId}" placeholder="Write a comment…" maxlength="1000">
        <button class="comment-submit-btn" data-post-type="${postType}" data-post-id="${postId}">Post</button>
      </div>
    </div>
  `;
}

function renderReviewBlock(review) {
  return `
    <div class="review-block">
      <div class="review-line">
        <span class="review-author">${escapeHtml(review.username)}:</span> ${escapeHtml(review.text)}
        <a class="review-open-link" href="post.html?type=review&id=${review.id}" title="Open this review on its own page">↗</a>
      </div>
      ${renderReactionRow('review', review.id, review.likes, review.comments)}
    </div>
  `;
}

// opts.showPrivacyControl: only true for your own posts (the feed/contact
// pages pass isMine straight through; there's nothing to change on someone
// else's memory).
function renderPostCard(moment, opts = {}) {
  const people = moment.participants.join(' & ');
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

  // opts.detail: post.html's single-post view — a bigger, click-to-zoom
  // image (handled by the delegated .lightbox-trigger listener below, not
  // an inline onclick — keeps this safe regardless of what characters end
  // up in a self-hosted server's URL) instead of a link to itself.
  const imageHtml = opts.detail
    ? `<img src="${momentImageUrl(moment.url)}" alt="A captured moment" class="post-detail-img lightbox-trigger">`
    : `<a href="post.html?type=moment&id=${moment.id}"><img src="${momentImageUrl(moment.url)}" alt="A captured moment" loading="lazy"></a>`;

  return `
    <div class="${opts.detail ? 'post-detail-card' : 'moment-card'}" data-moment-id="${moment.id}">
      ${imageHtml}
      <div class="moment-body">
        <div class="moment-meta-row">
          <span class="theme-badge">${THEME_LABELS[moment.theme] || moment.theme}</span>
          ${privacyHtml}
        </div>
        <div class="moment-meta">
          <span class="moment-people">${escapeHtml(people)}</span>
          <span class="moment-date">${formatDate(moment.createdAt)}</span>
        </div>
        ${moment.description ? `<div class="moment-description">${escapeHtml(moment.description)}</div>` : ''}
        ${renderReactionRow('moment', moment.id, moment.likes, moment.comments)}
        <div class="moment-reviews">${reviewsHtml}</div>
      </div>
    </div>
  `;
}

// One delegated listener per container handles every like/comment-toggle/
// comment-submit/privacy-change for every card inside it — cards get
// re-rendered often (tab switches, new data), so binding per-element
// listeners would mean constant rebind/leak bookkeeping for no benefit.
function attachPostCardHandlers(container) {
  container.addEventListener('click', async (e) => {
    const lightboxImg = e.target.closest('.lightbox-trigger');
    if (lightboxImg) { openLightbox(lightboxImg.src); return; }

    const likeBtn = e.target.closest('.like-btn');
    if (likeBtn) {
      const { postType, postId } = likeBtn.dataset;
      likeBtn.disabled = true;
      try {
        const toggle = postType === 'moment' ? toggleMomentLike : toggleReviewLike;
        const { liked } = await toggle(postId);
        const countEl = likeBtn.querySelector('.like-count');
        const current = parseInt(countEl.textContent, 10) || 0;
        countEl.textContent = String(current + (liked ? 1 : -1));
        likeBtn.classList.toggle('like-btn-active', liked);
        likeBtn.firstChild.textContent = liked ? '💜 ' : '🤍 ';
      } catch (err) {
        alert(err.message);
      } finally {
        likeBtn.disabled = false;
      }
      return;
    }

    const toggleBtn = e.target.closest('.comment-toggle-btn');
    if (toggleBtn) {
      const block = document.getElementById(toggleBtn.dataset.target);
      if (block) block.style.display = block.style.display === 'none' ? 'block' : 'none';
      return;
    }

    const submitBtn = e.target.closest('.comment-submit-btn');
    if (submitBtn) {
      const { postType, postId } = submitBtn.dataset;
      const row = submitBtn.closest('.comment-input-row');
      const input = row.querySelector('.comment-input');
      const text = input.value.trim();
      if (!text) return;
      submitBtn.disabled = true;
      try {
        const post = postType === 'moment' ? commentOnMoment : commentOnReview;
        const comment = await post(postId, text);
        const block = row.closest('.comments-block');
        const list = block.querySelector('.comments-list');
        if (list.querySelector('.comment-empty')) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend',
          `<div class="comment-line"><span class="comment-author">${escapeHtml(comment.username)}</span> ${escapeHtml(comment.text)}</div>`);
        const countEl = block.parentElement.querySelector('.comment-count');
        countEl.textContent = String((parseInt(countEl.textContent, 10) || 0) + 1);
        input.value = '';
      } catch (err) {
        alert(err.message);
      } finally {
        submitBtn.disabled = false;
      }
      return;
    }
  });

  container.addEventListener('change', async (e) => {
    const select = e.target.closest('.privacy-select');
    if (!select) return;
    const momentId = select.dataset.momentId;
    // Captured at render time (see renderPostCard) and only ever advanced
    // after a confirmed save below — select.value itself is useless for
    // this by the time 'change' fires, since the browser has already
    // updated it to the newly picked option.
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

  // Enter-to-submit in a comment box, without needing a <form> per card.
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('comment-input')) {
      e.preventDefault();
      e.target.closest('.comment-input-row').querySelector('.comment-submit-btn').click();
    }
  });
}
