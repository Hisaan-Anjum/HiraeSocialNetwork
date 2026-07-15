// contacts.js — contacts.html only. Reuses the extension's own
// /api/contacts endpoint (same account, same contact list); this page just
// links each one to their shared-memories view.
'use strict';

const auth = requireAuth();
if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  load();
}

function initials(name) {
  return (name || '?').charAt(0).toUpperCase();
}

async function load() {
  const contentEl = document.getElementById('content');
  try {
    const { contacts } = await getContacts();
    if (!contacts.length) {
      contentEl.innerHTML = `<div class="empty-state"><div class="icon">👥</div><div class="msg">No contacts yet — add some from the Hirae extension.</div></div>`;
      return;
    }
    contentEl.innerHTML = `<div class="contacts-list">${contacts.map((c) => `
      <a class="contact-row" href="contact.html?user=${encodeURIComponent(c.username)}">
        <div class="contact-avatar">${initials(c.username)}</div>
        <div class="contact-info">
          <div class="contact-name">${escapeHtml(c.username)}</div>
          <div class="contact-status ${c.online ? 'contact-online' : ''}">${c.online ? '● Online' : 'Offline'}</div>
        </div>
        <div class="contact-arrow">→</div>
      </a>
    `).join('')}</div>`;
  } catch (err) {
    contentEl.innerHTML = `<div class="empty-state"><div class="icon">😕</div><div class="msg">${escapeHtml(err.message)}</div></div>`;
  }
}
