// contacts.js — contacts.html only. The site's own view of the SAME contact
// list the extension popup shows: it drives the identical /api/contacts
// endpoints (list, request, accept, delete), so there is one contacts system
// and one set of rules, not a second one built for the web.
//
// The search box narrows the list via that endpoint's ?q= (server-side, see
// api.js's getContacts). The matched list is then revealed in chunks as you
// scroll rather than dumped into the DOM all at once — so even a very large
// contact list stays light and scrolls smoothly (only the rows near the
// viewport exist).
'use strict';

import { escapeHtml, debounce } from '../lib/util.js';
import { renderEmptyState, renderErrorState } from '../components/skeleton.js';
import { confirmDialog, listPhrase } from '../components/confirmDialog.js';
import { renderContactRow } from '../components/contactRow.js';
import { initSearch } from '../components/search.js';

const {
  requireAuth, logout, getContacts, requestContact, acceptContactRequest, removeContact,
  getSharedHistory, deleteSharedHistory,
} = window;

const CHUNK = 24; // rows revealed per scroll step

const auth = requireAuth();

let allContacts = [];   // full server-filtered list for the current query
let shown = 0;          // how many rows are currently in the DOM
let observer = null;
let currentQuery = '';

const contentEl = document.getElementById('content');
const requestsEl = document.getElementById('requests');

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  initSearch({ getSessions: () => [] });
  initInviteCard();

  const searchInput = document.getElementById('contactSearch');
  searchInput.addEventListener('input', debounce(() => {
    currentQuery = searchInput.value;
    load(currentQuery);
  }, 200));

  document.getElementById('addContactForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sendRequest();
  });

  // Delegated, so lazily-revealed rows need no per-row wiring — same reason
  // the reaction/media handlers elsewhere on the site are delegated.
  requestsEl.addEventListener('click', onActionClick);
  contentEl.addEventListener('click', onActionClick);

  load();
}

async function sendRequest() {
  const input = document.getElementById('addContactInput');
  const btn = document.getElementById('addContactBtn');
  const msg = document.getElementById('addContactMsg');
  const username = input.value.trim().toLowerCase();
  if (!username) return;

  btn.disabled = true;
  msg.className = 'add-contact-msg';
  msg.textContent = 'Sending…';
  try {
    await requestContact(username);
    msg.className = 'add-contact-msg is-ok';
    msg.textContent = `✓ Request sent to ${username}.`;
    input.value = '';
    await load(currentQuery);
  } catch (err) {
    msg.className = 'add-contact-msg is-error';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

async function onActionClick(e) {
  const btn = e.target.closest('[data-contact-action]');
  if (!btn) {
    // A row carrying action buttons can't itself be an <a> (a button inside
    // a link is invalid), so the "tap anyone to open their profile" the
    // page promises is restored here — anywhere on the row except an actual
    // control navigates, exactly like the plain link rows elsewhere.
    const row = e.target.closest('.contact-row[data-username]');
    if (row && !e.target.closest('button, a')) {
      window.location.href = `user.html?u=${encodeURIComponent(row.dataset.username)}`;
    }
    return;
  }
  const { contactAction, contactId, contactName } = btn.dataset;

  // Removing an accepted contact is the one action here that can cost
  // somebody something. Declining or cancelling a REQUEST is not — there is
  // no history behind a request — so those stay a single click and are not
  // dressed up as consequential.
  let purgeShared = false;
  if (contactAction === 'remove') {
    // Two questions, deliberately different ones. The first is reversible:
    // add them back and every moment and night is still there. The second is
    // not, and it deletes for BOTH people, which is why it says so.
    const removeConfirmed = await confirmDialog({
      title: `Remove ${contactName}?`,
      body: `They'll come off your contacts list and you won't see when they're online. `
        + `Everything you've watched and saved together stays exactly where it is.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!removeConfirmed) return;

    // Asked before the relationship row goes — it is what the server uses to
    // work out whose history this is. Best-effort: if the preview cannot be
    // fetched we simply do not offer the second question, rather than
    // offering it without being able to say what it would do.
    let shared = null;
    try { shared = await getSharedHistory(contactId); } catch (err) { /* preview only */ }

    const bits = shared ? [
      shared.moments && `${shared.moments} moment${shared.moments === 1 ? '' : 's'}`,
      shared.nights && `${shared.nights} night${shared.nights === 1 ? '' : 's'}`,
      shared.reviews && `${shared.reviews} review${shared.reviews === 1 ? '' : 's'}`,
      shared.watchlist && `${shared.watchlist} on your shared watchlist`,
      shared.importantDates && `${shared.importantDates} important date${shared.importantDates === 1 ? '' : 's'}`,
    ].filter(Boolean) : [];

    // Only worth asking when there is something to answer it about.
    if (bits.length) {
      purgeShared = await confirmDialog({
        title: 'Delete everything you made together?',
        body: `This permanently deletes ${listPhrase(bits)}. It deletes them for ${contactName} too, `
          + `and it can't be undone.`
          + (shared.protectedNights
            ? `\n\n${shared.protectedNights} night${shared.protectedNights === 1 ? '' : 's'} you watched `
              + `with other people ${shared.protectedNights === 1 ? 'is' : 'are'} never touched.`
            : ''),
        confirmLabel: 'Delete everything',
        cancelLabel: 'Keep our memories',
        danger: true,
      });
    }
  }

  btn.disabled = true;
  try {
    if (contactAction === 'accept') {
      await acceptContactRequest(contactId);
    } else {
      // History first, relationship second. A failed purge then leaves the
      // contact exactly as it was and the whole thing can be retried —
      // whereas the other order can strand history with no relationship left
      // to reach it through.
      if (purgeShared) await deleteSharedHistory(contactId);
      await removeContact(contactId); // decline / cancel / remove — one route
    }
    await load(currentQuery);
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
  }
}

const actionBtn = (action, c, label, cls = 'btn-ghost') =>
  `<button class="btn ${cls} btn-sm" data-contact-action="${action}" data-contact-id="${c.id}" data-contact-name="${escapeHtml(c.username)}">${label}</button>`;

function renderRequests({ incoming, outgoing }) {
  const sections = [];
  if (incoming.length) {
    sections.push(`
      <div class="requests-section">
        <div class="section-title">Wants to connect <span class="pill-count">${incoming.length}</span></div>
        <div class="contacts-list">
          ${incoming.map((c) => renderContactRow(c, {
            statusText: 'Sent you a request',
            actions: `<div class="contact-actions">
              ${actionBtn('accept', c, '✓ Accept', 'btn-primary')}
              ${actionBtn('decline', c, 'Decline')}
            </div>`,
          })).join('')}
        </div>
      </div>`);
  }
  if (outgoing.length) {
    sections.push(`
      <div class="requests-section">
        <div class="section-title">Requests you sent</div>
        <div class="contacts-list">
          ${outgoing.map((c) => renderContactRow(c, {
            statusText: 'Waiting for them to accept…',
            actions: `<div class="contact-actions">${actionBtn('cancel', c, 'Cancel')}</div>`,
          })).join('')}
        </div>
      </div>`);
  }
  requestsEl.innerHTML = sections.join('');
}

// Appends the next CHUNK rows and tears the observer down once the whole
// list is on screen.
function revealMore() {
  const listEl = contentEl.querySelector('.contacts-list');
  if (!listEl) return;
  const next = allContacts.slice(shown, shown + CHUNK);
  listEl.insertAdjacentHTML('beforeend', next.map((c) => renderContactRow(c, {
    actions: `<div class="contact-actions">${actionBtn('remove', c, '✕')}</div>`,
  })).join(''));
  shown += next.length;
  if (shown >= allContacts.length) {
    observer?.disconnect();
    observer = null;
    document.getElementById('contactsSentinel')?.remove();
  }
}

function renderList() {
  observer?.disconnect();
  observer = null;
  shown = 0;

  document.getElementById('contactsHeading').innerHTML = allContacts.length
    ? `Your contacts <span class="pill-count">${allContacts.length}</span>`
    : 'Your contacts';

  if (!allContacts.length) {
    contentEl.innerHTML = currentQuery.trim()
      ? renderEmptyState('🔍', `No contacts match “${escapeHtml(currentQuery.trim())}”.`)
      : renderEmptyState('👥', 'No contacts yet — add someone by username above, or from the Herae extension.');
    return;
  }

  contentEl.innerHTML = '<div class="contacts-list"></div><div id="contactsSentinel" class="scroll-sentinel"></div>';
  revealMore(); // first chunk (also removes the sentinel if everything fits)

  const sentinel = document.getElementById('contactsSentinel');
  if (sentinel && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) revealMore();
    }, { rootMargin: '300px 0px' });
    observer.observe(sentinel);
  } else if (sentinel) {
    // No IntersectionObserver — reveal everything so nothing is hidden.
    while (shown < allContacts.length) revealMore();
  }
}

async function load(q) {
  try {
    const { contacts, incoming, outgoing } = await getContacts(q);
    allContacts = contacts;
    renderRequests({ incoming, outgoing });
    renderList();
  } catch (err) {
    contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
  }
}

// ── Invite Friends ────────────────────────────────────────────────────
// The card stays hidden until the link is in hand, so a failed request leaves
// nothing broken on screen rather than an empty box with a dead Copy button.
async function initInviteCard() {
  const card = document.getElementById('inviteCard');
  if (!card) return;
  let invite;
  try {
    invite = await window.getMyInvite();
  } catch (e) {
    return;   // contacts still work perfectly without it
  }

  const linkEl = document.getElementById('inviteLink');
  const copyEl = document.getElementById('inviteCopy');
  const shareEl = document.getElementById('inviteShare');
  const countEl = document.getElementById('inviteCount');

  linkEl.textContent = invite.url;
  if (invite.invitedCount > 0) {
    countEl.textContent = `${invite.invitedCount} joined`;
    countEl.hidden = false;
  }
  card.hidden = false;

  copyEl.addEventListener('click', async () => {
    const ok = await copyText(invite.url);
    copyEl.textContent = ok ? '✓ Copied' : 'Press ⌘C';
    copyEl.classList.toggle('is-done', ok);
    setTimeout(() => { copyEl.textContent = 'Copy'; copyEl.classList.remove('is-done'); }, 1800);
  });

  // Shown only where the OS actually has a share sheet — on desktop Chrome the
  // button would either do nothing or open something unhelpful, and Copy is the
  // better action there anyway.
  if (navigator.share) {
    shareEl.hidden = false;
    shareEl.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: 'Join me on Herae.app',
          text: 'Keep every movie night we watch together.',
          url: invite.url,
        });
      } catch (e) { /* dismissed — not an error */ }
    });
  }
}

// navigator.clipboard needs a secure context, which rules it out on a plain-http
// LAN address in development; the textarea fallback works everywhere.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e2) { return false; }
  }
}
