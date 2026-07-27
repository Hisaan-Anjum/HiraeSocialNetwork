// search.js — the search overlay, mounted anywhere the page provides a
// #searchTrigger button.
//
// Contacts and movies are searched server-side; sessions are still filtered
// client-side over whatever the feed has loaded, which is fine because a
// person's own sessions are a bounded list.
//
// Movies USED to be client-side too, over the recommendation cards the feed
// happened to have fetched. That was reasonable against a few dozen curated
// titles and became wrong the moment the catalogue import took the table to
// thousands: searching a ~20-card buffer misses almost everything. It now hits
// GET /api/recommendations?q=, which searches the whole catalogue.
'use strict';

import { escapeHtml, debounce, sessionDisplayTitle } from '../lib/util.js';
import { renderContactRow } from './contactRow.js';

const { getContacts, getRecommendations } = window;

let overlayEl = null;
let dataSource = { getSessions: () => [] };
// Both lookups are async, so a slow reply for "ma" must not land after "matrix"
// and repaint the panel with stale results.
let searchSeq = 0;

function sessionMatches(session, q) {
  // Matches on whatever the session is CALLED (its own title when it has
  // one) and on what was watched, so both find it.
  const title = sessionDisplayTitle(session, '').toLowerCase();
  const watched = (session.content?.title || '').toLowerCase();
  const people = session.participants.join(' ').toLowerCase();
  return title.includes(q) || watched.includes(q) || people.includes(q);
}

function renderResultsSection(title, items, renderItem) {
  if (!items.length) return '';
  return `
    <div class="search-section">
      <div class="search-section-title">${title}</div>
      ${items.map(renderItem).join('')}
    </div>
  `;
}

async function runSearch(q) {
  const resultsEl = overlayEl.querySelector('.search-results');
  const query = q.trim();
  if (!query) {
    resultsEl.innerHTML = `<div class="search-hint">Search contacts, watch sessions, and recommendations.</div>`;
    return;
  }
  resultsEl.innerHTML = `<div class="spinner-text">Searching…</div>`;

  const mine = ++searchSeq;
  const lower = query.toLowerCase();
  const sessions = dataSource.getSessions().filter((s) => sessionMatches(s, lower)).slice(0, 8);

  // Both are best-effort and independent: one failing still shows the other,
  // which matters because a movie search hitting a cold cache is the slower of
  // the two and shouldn't be able to hide the contact hits.
  const [contacts, movies] = await Promise.all([
    getContacts(query).then((r) => r.contacts || []).catch(() => []),
    getRecommendations(null, query).then((r) => (r.recommendations || []).slice(0, 8)).catch(() => []),
  ]);
  if (mine !== searchSeq) return;   // a newer keystroke already won

  const html = [
    // The same row component the contacts page uses (picture, name,
    // presence), so a contact looks identical wherever it's listed.
    renderResultsSection('Contacts', contacts, (c) =>
      `<div class="search-result search-result-contact">${renderContactRow(c)}</div>`),
    renderResultsSection('Watch sessions', sessions, (s) => `
      <a class="search-result" href="session.html?session=${encodeURIComponent(s.clientSessionId)}">
        <div class="search-result-title">${escapeHtml(sessionDisplayTitle(s, 'Untitled session'))}</div>
        <div class="search-result-sub">${escapeHtml(s.participants.join(' & '))}</div>
      </a>
    `),
    renderResultsSection('Recommendations', movies, (m) => `
      <a class="search-result" href="movie.html?id=${m.id}">
        <div class="search-result-title">${escapeHtml(m.title)}</div>
        <div class="search-result-sub">${escapeHtml(m.genres.slice(0, 3).join(', '))}</div>
      </a>
    `),
  ].join('');

  resultsEl.innerHTML = html || `<div class="search-hint">No matches for "${escapeHtml(query)}".</div>`;
}

const debouncedSearch = debounce(runSearch, 220);

export function initSearch(source = {}) {
  dataSource = { ...dataSource, ...source };
  if (overlayEl) return; // already mounted on this page

  const trigger = document.getElementById('searchTrigger');
  if (!trigger) return;

  overlayEl = document.createElement('div');
  overlayEl.className = 'search-overlay hidden';
  overlayEl.innerHTML = `
    <div class="search-panel">
      <div class="search-input-row">
        <input type="text" class="search-input" placeholder="Search contacts, sessions, movies…" autocomplete="off">
        <button class="btn btn-ghost search-close-btn" aria-label="Close search">✕</button>
      </div>
      <div class="search-results">
        <div class="search-hint">Search contacts, watch sessions, and recommendations.</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  const input = overlayEl.querySelector('.search-input');
  const open = () => {
    overlayEl.classList.remove('hidden');
    input.value = '';
    input.focus();
    runSearch('');
  };
  const close = () => overlayEl.classList.add('hidden');

  trigger.addEventListener('click', open);
  overlayEl.querySelector('.search-close-btn').addEventListener('click', close);
  overlayEl.addEventListener('click', (e) => { if (e.target === overlayEl) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlayEl.classList.contains('hidden')) close();
    if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && overlayEl.classList.contains('hidden') && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      open();
    }
  });
  input.addEventListener('input', () => debouncedSearch(input.value));
  // Enter skips the suggestions and goes to the full results page — the
  // overlay only surfaces a handful of quick hits from what's already
  // loaded; search.html fetches and pages through everything.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = input.value.trim();
    if (q) window.location.href = `search.html?q=${encodeURIComponent(q)}`;
  });
}
