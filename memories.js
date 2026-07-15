// memories.js — memories.html only. The main feed, with a Feed/Mine tab
// switch. Card rendering + like/comment/privacy interaction all live in
// postcard.js, shared with contact.html and review.html.
'use strict';

const auth = requireAuth();
let activeTab = 'feed';

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  attachPostCardHandlers(document.getElementById('content'));

  document.querySelectorAll('.feed-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === activeTab) return;
      document.querySelectorAll('.feed-tab').forEach((t) => t.classList.remove('feed-tab-active'));
      tab.classList.add('feed-tab-active');
      activeTab = tab.dataset.tab;
      load();
    });
  });

  load();
}

async function load() {
  const contentEl = document.getElementById('content');
  contentEl.innerHTML = '<div class="spinner-text">Loading your memories…</div>';
  try {
    const { moments } = activeTab === 'mine' ? await getMine() : await getFeed();
    if (!moments.length) {
      contentEl.innerHTML = activeTab === 'mine'
        ? `<div class="empty-state"><div class="icon">🎞️</div><div class="msg">No memories saved yet.<br>Capture one with the 📸 button during your next watch-together session.</div></div>`
        : `<div class="empty-state"><div class="icon">🌍</div><div class="msg">Nothing in your feed yet.<br>Once you or a contact save a shared or public moment, it'll show up here.</div></div>`;
      return;
    }
    // Privacy is editable wherever one of your own posts shows up (feed or
    // mine), not just the "mine" tab — same as any real feed lets you
    // adjust who sees your own post right where you see it.
    contentEl.innerHTML = `<div class="moments-grid">${
      moments.map((m) => renderPostCard(m, { showPrivacyControl: m.isMine })).join('')
    }</div>`;
  } catch (err) {
    contentEl.innerHTML = `<div class="empty-state"><div class="icon">😕</div><div class="msg">${escapeHtml(err.message)}</div></div>`;
  }
}
