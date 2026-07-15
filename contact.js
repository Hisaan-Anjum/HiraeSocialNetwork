// contact.js — contact.html only. All posts a specific contact is part of,
// filtered to whatever this viewer is actually allowed to see (some may
// include you, some may not, per each post's own privacy setting).
'use strict';

const auth = requireAuth();

function getTargetUsername() {
  return new URLSearchParams(window.location.search).get('user') || '';
}

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  attachPostCardHandlers(document.getElementById('content'));
  load();
}

async function load() {
  const contentEl = document.getElementById('content');
  const target = getTargetUsername();
  if (!target) {
    contentEl.innerHTML = `<div class="empty-state"><div class="icon">🤔</div><div class="msg">No contact specified.</div></div>`;
    return;
  }
  document.getElementById('brandSub').textContent = `${target}'s memories`;
  document.getElementById('pageTitle').textContent = `${target}'s memories`;
  // .textContent, not innerHTML — no escaping needed (or wanted: escapeHtml
  // would double-escape when set this way) since it never interprets markup.
  document.getElementById('pageSub').textContent = `Posts ${target} is part of that you're able to see.`;

  try {
    const { moments } = await getPostsByUser(target);
    if (!moments.length) {
      contentEl.innerHTML = `<div class="empty-state"><div class="icon">🎞️</div><div class="msg">Nothing to show here yet.</div></div>`;
      return;
    }
    contentEl.innerHTML = `<div class="moments-grid">${
      moments.map((m) => renderPostCard(m, { showPrivacyControl: m.isMine })).join('')
    }</div>`;
  } catch (err) {
    contentEl.innerHTML = `<div class="empty-state"><div class="icon">😕</div><div class="msg">${escapeHtml(err.message)}</div></div>`;
  }
}
