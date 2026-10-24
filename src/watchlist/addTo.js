// addTo.js — "Add to…" for a film, anywhere you explore the catalogue (founder 2026-10-23). Three choices first:
//   ❤️ a shared watchlist  → then who (or straight in, when you're already on that person's page)
//   💬 suggest it in a chat → then which chat; it arrives there as a watch suggestion card
//   📌 my watchlist        → your own list (the watch profile's watchlist, which also feeds matching)
// Chat's own suggest form never opens this: it already IS a suggestion.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { lockScroll } from '../lib/scrollLock.js';
import { openPickContact } from './pickContact.js';

const { apiRequest } = window;
const MY_LIST_MAX = 20;   // watch-profile.js LIST_FIELDS.watchlist

// sharedWith: a username when the page is already about one relationship; onShared(movie) then does that add.
// onDone(kind, detail) fires after any successful add ('shared' | 'suggested' | 'mine').
export function openAddTo({ movie, sharedWith = null, onShared = null, onDone = null }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay at-overlay';
  overlay.innerHTML = `
    <div class="modal-card at-card" role="dialog" aria-modal="true" aria-label="Add to">
      <div class="ms-sel-head">
        <h2>Add to…</h2>
        <button class="share-close" data-at="close" aria-label="Close">✕</button>
      </div>
      <div class="at-movie">${escapeHtml(movie.title)}</div>
      <div class="at-body" id="atBody"></div>
    </div>`;
  document.body.appendChild(overlay);
  const releaseScroll = lockScroll();
  const body = overlay.querySelector('#atBody');
  const close = () => { document.removeEventListener('keydown', onKey); releaseScroll(); overlay.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-at="close"]')) close(); });

  const say = (html) => { body.innerHTML = `<div class="at-done">${html}</div><button class="btn btn-ghost at-close" data-at="close">Close</button>`; };

  function menu() {
    body.innerHTML = `
      <button class="at-opt" data-opt="shared"><span class="at-e" aria-hidden="true">❤️</span>
        <span><strong>Shared watchlist</strong><small>${sharedWith ? `With ${escapeHtml(sharedWith)}` : 'Pick who it’s with'}</small></span></button>
      <button class="at-opt" data-opt="suggest"><span class="at-e" aria-hidden="true">💬</span>
        <span><strong>Suggest it in a chat</strong><small>Send it as a “watch this?” card</small></span></button>
      <button class="at-opt" data-opt="mine"><span class="at-e" aria-hidden="true">📌</span>
        <span><strong>My watchlist</strong><small>Just for you — and it helps your matches</small></span></button>`;
    body.querySelector('[data-opt="shared"]').onclick = shared;
    body.querySelector('[data-opt="suggest"]').onclick = suggest;
    body.querySelector('[data-opt="mine"]').onclick = mine;
    body.querySelector('.at-opt').focus();
  }

  async function shared() {
    if (sharedWith && onShared) {
      body.innerHTML = '<div class="spinner-text">Adding…</div>';
      try { await onShared(movie); say(`Added to your list with ${escapeHtml(sharedWith)} 💜`); if (onDone) onDone('shared', sharedWith); }
      catch (e) { say(escapeHtml(e.message || 'Could not add it.')); }
      return;
    }
    close();
    openPickContact({ movie, onAdded: (username) => { if (onDone) onDone('shared', username); } });
  }

  async function suggest() {
    body.innerHTML = '<div class="spinner-text">Loading your chats…</div>';
    let chats = [];
    try { chats = ((await apiRequest('/api/chats')).conversations || []).filter((c) => c.canSend); }
    catch (e) { say(escapeHtml(e.message || 'Could not load your chats.')); return; }
    if (!chats.length) {
      say('No chats yet. Match with someone in <a href="social.html#discover">Discover</a>, or add your person, and suggest it there.');
      return;
    }
    body.innerHTML = `<p class="at-hint">Who should get it?</p>${chats.map((c, i) => `
      <button class="at-chat" data-i="${i}"><span class="at-av" aria-hidden="true">${escapeHtml((c.with.name || '?').trim()[0].toUpperCase())}</span>
        <span>${escapeHtml(c.with.name)}</span></button>`).join('')}
      <button class="btn btn-ghost at-back" data-back>← Back</button>`;
    body.querySelector('[data-back]').onclick = menu;
    body.querySelectorAll('.at-chat').forEach((b) => { b.onclick = async () => {
      const c = chats[Number(b.dataset.i)];
      body.innerHTML = '<div class="spinner-text">Sending…</div>';
      const link = (movie.watchLinks || []).find((l) => l && l.url && l.available !== false);
      try {
        await apiRequest(`/api/chats/${c.id}/proposals`, { method: 'POST', body: JSON.stringify({ title: movie.title, url: link ? link.url : null, when: 'now' }) });
        say(`Suggested to ${escapeHtml(c.with.name)} 💬 <a href="social.html#chats/${c.id}">Open the chat →</a>`);
        if (onDone) onDone('suggested', c.with.username);
      } catch (e) { say(escapeHtml(e.message || 'Could not send it.')); }
    }; });
  }

  async function mine() {
    body.innerHTML = '<div class="spinner-text">Adding…</div>';
    try {
      const { profile } = await apiRequest('/api/profile/watch');
      const list = (profile && profile.watchlist) || [];
      if (list.some((t) => String(t).toLowerCase() === movie.title.toLowerCase())) { say('Already on your watchlist 📌 <a href="watch-profile.html">See it</a>'); return; }
      if (list.length >= MY_LIST_MAX) { say(`Your watchlist is full (${MY_LIST_MAX}). Remove one on <a href="watch-profile.html">your profile</a> first.`); return; }
      await apiRequest('/api/profile/watch', { method: 'PUT', body: JSON.stringify({ watchlist: [...list, movie.title] }) });
      say('Added to your watchlist 📌 <a href="watch-profile.html">See it</a>');
      if (onDone) onDone('mine', null);
    } catch (e) { say(escapeHtml(e.message || 'Could not add it.')); }
  }

  menu();
  return { close };
}
