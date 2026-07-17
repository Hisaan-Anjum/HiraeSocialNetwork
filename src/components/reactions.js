// reactions.js — the like + comment row shared by every likeable/
// commentable thing on the site (moment cards, review posts, session
// cards). One render function, one delegated event handler installed once
// per page (see attachReactionHandlers), same pattern the old postcard.js
// used — cards get re-rendered often (pagination, tab switches), so
// per-element listeners would mean constant rebind/leak bookkeeping.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { renderAvatarLink } from './avatar.js';
import { renderUserLink } from './userLink.js';
// toggleMomentLike/commentOnMoment/toggleReviewLike/commentOnReview come
// from api.js — loaded on every page as a plain classic <script> (same
// file index.html/admin.html use), NOT an ES module. That's deliberate
// (see vite.config.js's comment): one shared, unduplicated copy of the
// auth/fetch model for the whole site, old pages and new. A classic
// script's top-level function declarations land on `window`, which a
// module can read directly — it just can't `import` them, since api.js
// isn't a module itself.
const {
  toggleMomentLike, commentOnMoment, toggleReviewLike, commentOnReview,
  updateComment, deleteComment,
} = window;

// One comment line: the author's picture and clickable name, the text, and
// — only when the server said `canEdit` — an edit/delete pair. canEdit is a
// rendering hint; /api/comments/:id re-checks authorship on every call.
export function renderCommentLine(c) {
  return `
    <div class="comment-line" data-comment-id="${c.id}">
      ${renderAvatarLink({ username: c.username, avatarUrl: c.avatarUrl }, { size: 'sm' })}
      <div class="comment-body">
        <span class="comment-author">${renderUserLink(c.username)}</span>
        <span class="comment-text">${escapeHtml(c.text)}</span>
      </div>
      ${c.canEdit ? `
        <div class="comment-actions">
          <button class="comment-edit-btn icon-btn" title="Edit comment" aria-label="Edit comment">✏️</button>
          <button class="comment-delete-btn icon-btn" title="Delete comment" aria-label="Delete comment">🗑️</button>
        </div>` : ''}
    </div>
  `;
}

function renderCommentsList(comments) {
  if (!comments.length) return '<div class="comment-empty">No comments yet.</div>';
  return comments.map(renderCommentLine).join('');
}

export function renderReactionRow(postType, postId, likes, comments) {
  const key = `${postType}-${postId}`;
  return `
    <div class="reaction-row">
      <button class="like-btn${likes.likedByMe ? ' like-btn-active' : ''}" data-post-type="${postType}" data-post-id="${postId}">
        <span class="like-icon">${likes.likedByMe ? '\u{1F49C}' : '\u{1F90D}'}</span> <span class="like-count">${likes.count}</span>
      </button>
      <button class="comment-toggle-btn" data-target="comments-${key}">
        \u{1F4AC} <span class="comment-count">${comments.length}</span>
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

// Attach once, to any ancestor container that will ever hold a reaction
// row (usually the page's whole feed/content element).
export function attachReactionHandlers(container) {
  container.addEventListener('click', async (e) => {
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
        likeBtn.querySelector('.like-icon').textContent = liked ? '\u{1F49C}' : '\u{1F90D}';
      } catch (err) {
        alert(err.message);
      } finally {
        likeBtn.disabled = false;
      }
      return;
    }

    const toggleBtn = e.target.closest('.comment-toggle-btn');
    if (toggleBtn) {
      // Sibling-first, id as fallback: the block is always rendered right
      // after this button's own .reaction-row, and the id alone is
      // ambiguous — the media viewer's panel shows the same moment as the
      // card behind it, so getElementById finds the hidden card's block
      // and the panel's toggle looks dead.
      const sibling = toggleBtn.closest('.reaction-row')?.nextElementSibling;
      const block = (sibling && sibling.classList.contains('comments-block'))
        ? sibling
        : document.getElementById(toggleBtn.dataset.target);
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
        // The POST response carries the same avatarUrl/canEdit the list
        // endpoints do, so a just-posted comment renders through the exact
        // same function as one that came back from the server — no
        // second, subtly-different inline template to keep in sync.
        // Prepended, not appended: the server orders the signed-in user's
        // own comments first, so the fresh one must land where a reload
        // would put it — at the top.
        list.insertAdjacentHTML('afterbegin', renderCommentLine(comment));
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

    // ── Editing a comment: swap the text for an input in place, so the
    //    rest of the line (avatar, author, actions) never re-renders. ──
    const editBtn = e.target.closest('.comment-edit-btn');
    if (editBtn) {
      const line = editBtn.closest('.comment-line');
      if (line.querySelector('.comment-edit-input')) return; // already editing
      const textEl = line.querySelector('.comment-text');
      const original = textEl.textContent;
      // Stashed so Cancel can put the line back exactly as it was without
      // needing to re-fetch the comment.
      line.dataset.originalText = original;
      textEl.innerHTML = `
        <input type="text" class="comment-edit-input" maxlength="1000" value="${escapeHtml(original)}">
        <button class="comment-edit-save btn-inline">Save</button>
        <button class="comment-edit-cancel btn-inline btn-inline-ghost">Cancel</button>`;
      const input = textEl.querySelector('.comment-edit-input');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      return;
    }

    const cancelEdit = e.target.closest('.comment-edit-cancel');
    if (cancelEdit) {
      const line = cancelEdit.closest('.comment-line');
      line.querySelector('.comment-text').textContent = line.dataset.originalText ?? '';
      return;
    }

    const saveEdit = e.target.closest('.comment-edit-save');
    if (saveEdit) {
      const line = saveEdit.closest('.comment-line');
      const textEl = line.querySelector('.comment-text');
      const input = textEl.querySelector('.comment-edit-input');
      const text = input.value.trim();
      if (!text) return;
      saveEdit.disabled = true;
      try {
        const updated = await updateComment(line.dataset.commentId, text);
        textEl.textContent = updated.text;
      } catch (err) {
        alert(err.message);
        saveEdit.disabled = false;
      }
      return;
    }

    const delBtn = e.target.closest('.comment-delete-btn');
    if (delBtn) {
      if (!confirm('Delete this comment?')) return;
      const line = delBtn.closest('.comment-line');
      delBtn.disabled = true;
      try {
        await deleteComment(line.dataset.commentId);
        const block = line.closest('.comments-block');
        const list = block.querySelector('.comments-list');
        line.remove();
        const countEl = block.parentElement.querySelector('.comment-count');
        countEl.textContent = String(Math.max(0, (parseInt(countEl.textContent, 10) || 0) - 1));
        if (!list.querySelector('.comment-line')) list.innerHTML = '<div class="comment-empty">No comments yet.</div>';
      } catch (err) {
        alert(err.message);
        delBtn.disabled = false;
      }
      return;
    }
  });

  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('comment-input')) {
      e.preventDefault();
      e.target.closest('.comment-input-row').querySelector('.comment-submit-btn').click();
      return;
    }
    // Same keyboard affordances while editing an existing comment as while
    // writing a new one: Enter commits, Escape backs out.
    if (e.target.classList.contains('comment-edit-input')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.closest('.comment-text').querySelector('.comment-edit-save').click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.target.closest('.comment-text').querySelector('.comment-edit-cancel').click();
      }
    }
  });
}
