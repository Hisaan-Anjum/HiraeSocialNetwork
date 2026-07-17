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
import { renderContactRow } from '../components/contactRow.js';
import { initSearch } from '../components/search.js';

const {
  requireAuth, logout, getContacts, requestContact, acceptContactRequest, removeContact,
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
  initSearch({ getSessions: () => [], getMovies: () => [] });

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
  if (contactAction === 'remove' && !confirm(`Remove ${contactName} from your contacts?`)) return;
  btn.disabled = true;
  try {
    if (contactAction === 'accept') await acceptContactRequest(contactId);
    else await removeContact(contactId); // decline / cancel / remove — one route
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
