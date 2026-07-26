// pickContact.js — "add this film to a shared watchlist… with whom?"
//
// A watchlist belongs to a RELATIONSHIP, not to one person, so adding a film
// from a place that isn't already about a particular contact (the movie page)
// has to ask which of them it's for.
//
// Same shape as the contacts page: server-side search via getContacts(?q=),
// then the matched list revealed in chunks as you scroll rather than dumped
// into the DOM at once — so a large contact list stays light here too.
//
// Contacts who already have the film are shown as such rather than filtered
// out: "it's already there" is the answer you were looking for, and hiding them
// just reads as a missing contact.
'use strict';

import { escapeHtml, debounce } from '../lib/util.js';
import { renderAvatar } from '../components/avatar.js';

const { getContacts, getWatchlist, addToWatchlist } = window;

const CHUNK = 12; // rows revealed per scroll step

// `onAdded(username)` fires after a successful add.
export function openPickContact({ movie, onAdded }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay pc-overlay';
  overlay.innerHTML = `
    <div class="modal-card pc-card" role="dialog" aria-modal="true" aria-label="Add to a shared watchlist">
      <div class="ms-sel-head">
        <h2>❤️ Add to a shared watchlist</h2>
        <button class="share-close" data-pc="close" aria-label="Close">✕</button>
      </div>
      <div class="pc-movie">${escapeHtml(movie.title)}</div>
      <input type="search" class="pc-search" id="pcSearch" placeholder="Search your contacts…" autocomplete="off">
      <div class="pc-body" id="pcBody"><div class="spinner-text">Loading your contacts…</div></div>
    </div>`;
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const body = overlay.querySelector('#pcBody');
  const searchEl = overlay.querySelector('#pcSearch');

  let contacts = [];        // full server-filtered list for the current query
  let shown = 0;            // how many rows are in the DOM
  let observer = null;
  let reqToken = 0;         // guards against an older search resolving last
  const onList = new Set(); // usernames whose shared list already has this film
  const checked = new Set();// usernames we've already looked up

  const close = () => {
    observer?.disconnect();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-pc="close"]')) close();
  });

  function rowHtml(c) {
    const has = onList.has(c.username);
    return `
      <button type="button" class="pc-row${has ? ' is-on' : ''}" data-pc="add" data-user="${escapeHtml(c.username)}" ${has ? 'disabled' : ''}>
        ${renderAvatar({ username: c.username, avatarUrl: c.avatarUrl }, { size: 'sm' })}
        <span class="pc-name">${escapeHtml(c.username)}</span>
        <span class="pc-state">${has ? '✓ already on your list' : '＋ Add'}</span>
      </button>`;
  }

  // Marks the revealed rows that already have this film. Only ever runs for
  // rows actually on screen, so the number of lookups grows with what you
  // scroll past — not with the size of your contact list.
  async function markRevealed(batch) {
    await Promise.all(batch.map(async (c) => {
      if (checked.has(c.username)) return;
      checked.add(c.username);
      try {
        const { items } = await getWatchlist(c.username);
        if ((items || []).some((i) => i.movie.id === movie.id)) {
          onList.add(c.username);
          const el = body.querySelector(`[data-user="${CSS.escape(c.username)}"]`);
          if (el) el.outerHTML = rowHtml(c);
        }
      } catch (e) { /* not a readable relationship — leave it addable */ }
    }));
  }

  function revealMore() {
    const list = body.querySelector('.pc-list');
    if (!list) return;
    const next = contacts.slice(shown, shown + CHUNK);
    if (!next.length) return;
    list.insertAdjacentHTML('beforeend', next.map(rowHtml).join(''));
    shown += next.length;
    markRevealed(next);
    if (shown >= contacts.length) {
      observer?.disconnect();
      observer = null;
      body.querySelector('#pcSentinel')?.remove();
    }
  }

  function render() {
    observer?.disconnect();
    observer = null;
    shown = 0;

    if (!contacts.length) {
      body.innerHTML = searchEl.value.trim()
        ? `<div class="pc-empty">No contacts match “${escapeHtml(searchEl.value.trim())}”.</div>`
        : `<div class="pc-empty">You don't have any contacts yet. Add someone on the Contacts page and you'll be able to build a watchlist together. 💜</div>`;
      return;
    }

    body.innerHTML = '<div class="pc-list"></div><div id="pcSentinel" class="scroll-sentinel"></div>';
    revealMore();

    const sentinel = body.querySelector('#pcSentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) revealMore();
      }, { root: body, rootMargin: '200px 0px' });
      observer.observe(sentinel);
    } else if (sentinel) {
      // No IntersectionObserver — reveal everything rather than hide contacts.
      while (shown < contacts.length) revealMore();
    }
  }

  async function load(q) {
    const mine = ++reqToken;
    try {
      const data = await getContacts(q || undefined);
      if (mine !== reqToken) return; // a newer keystroke already won
      contacts = data?.contacts || [];
    } catch (e) {
      if (mine !== reqToken) return;
      body.innerHTML = '<div class="pc-empty">Could not load your contacts.</div>';
      return;
    }
    render();
  }

  body.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pc="add"]');
    if (!btn || btn.disabled) return;
    const username = btn.dataset.user;
    const state = btn.querySelector('.pc-state');
    btn.disabled = true;
    if (state) state.textContent = 'Adding…';
    try {
      await addToWatchlist(username, movie.id);
      onList.add(username);
      const c = contacts.find((x) => x.username === username) || { username };
      btn.outerHTML = rowHtml(c);
      onAdded?.(username);
    } catch (err) {
      btn.disabled = false;
      if (state) state.textContent = err.message || 'Could not add';
    }
  });

  searchEl.addEventListener('input', debounce(() => load(searchEl.value.trim()), 220));
  load('');
  setTimeout(() => searchEl.focus(), 30);

  return { close };
}
