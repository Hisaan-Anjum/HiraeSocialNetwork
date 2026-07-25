// panel.js — the ❤️ Shared Watchlist on a contact profile.
//
// One list per relationship, editable by both partners (see
// server/src/watchlist.js). Every entry shows its poster, title, who added it,
// when, and an optional shared rating and comment; each can be marked watched,
// rated, commented, reordered by drag & drop, removed, or started.
//
// Every mutation re-renders from the server's returned list rather than from
// patched local state, so what's on screen is always what's stored — and the
// partner's changes land the next time anything is touched.
'use strict';

import { escapeHtml, formatDate } from '../lib/util.js';
import { openAddMovie } from './addMovie.js';
import { openMovieModal } from '../components/movieDetail.js';

const {
  getWatchlist, addToWatchlist, updateWatchlistItem, removeFromWatchlist, reorderWatchlist,
} = window;

function toast(message) {
  const t = document.createElement('div');
  t.className = 'ms-toast'; t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('is-in'), 10);
  setTimeout(() => { t.classList.remove('is-in'); setTimeout(() => t.remove(), 300); }, 3200);
}

export function mountWatchlist(container, { profile }) {
  if (profile.isMe || profile.contact?.status !== 'accepted') return; // a shared list needs two people
  const username = profile.username;
  let items = [];

  const panel = document.createElement('section');
  panel.className = 'wl-panel';
  container.appendChild(panel);

  const onList = (recId) => items.some((i) => i.movie.id === recId);

  render(true);
  load();

  async function load() {
    try {
      const { items: list } = await getWatchlist(username);
      items = list || [];
      render();
    } catch (e) {
      panel.innerHTML = wrap('<div class="wl-empty">Could not load your watchlist.</div>');
    }
  }

  function wrap(inner) {
    const unwatched = items.filter((i) => !i.watched).length;
    return `
      <div class="wl-head">
        <h2>❤️ Shared Watchlist</h2>
        ${items.length ? `<span class="wl-count">${unwatched} to watch</span>` : ''}
      </div>
      ${inner}
      <button class="btn btn-primary wl-add-btn" data-wl="add">＋ Add Movie</button>`;
  }

  function renderItem(it) {
    const m = it.movie;
    return `
      <li class="wl-item${it.watched ? ' is-watched' : ''}" draggable="true" data-id="${it.id}">
        <span class="wl-grip" aria-hidden="true">⠿</span>
        <span class="wl-art" data-wl="open" data-movie="${m.id}" role="button" tabindex="0"
              style="${m.posterUrl ? `background-image:url('${m.posterUrl}')` : ''}">
          ${!m.posterUrl ? '<span class="recommendation-card-placeholder">🎬</span>' : ''}
        </span>
        <div class="wl-main">
          <div class="wl-title" data-wl="open" data-movie="${m.id}" role="button" tabindex="0">${escapeHtml(m.title)}</div>
          <div class="wl-meta">
            Added by ${escapeHtml(it.addedBy)} · ${escapeHtml(formatDate(it.addedAt))}
          </div>
          <div class="wl-stars" role="group" aria-label="Rate this movie">
            ${[1, 2, 3, 4, 5].map((n) => `
              <button class="wl-star${it.rating >= n ? ' is-on' : ''}" data-wl="rate" data-id="${it.id}" data-rating="${n}"
                      aria-label="${n} star${n === 1 ? '' : 's'}">★</button>`).join('')}
            ${it.rating ? `<button class="wl-clear" data-wl="rate" data-id="${it.id}" data-rating="0" aria-label="Clear rating">✕</button>` : ''}
          </div>
          ${it.comment ? `<div class="wl-comment">“${escapeHtml(it.comment)}”</div>` : ''}
          <div class="wl-actions">
            <button class="wl-chip" data-wl="watched" data-id="${it.id}">${it.watched ? '✓ Watched' : 'Mark watched'}</button>
            <button class="wl-chip" data-wl="comment" data-id="${it.id}">${it.comment ? 'Edit note' : 'Add note'}</button>
            <button class="wl-chip wl-chip-go" data-wl="start" data-id="${it.id}">▶ Watch together</button>
            <button class="wl-chip wl-chip-danger" data-wl="remove" data-id="${it.id}" aria-label="Remove">✕</button>
          </div>
        </div>
      </li>`;
  }

  function render(loading = false) {
    if (loading) { panel.innerHTML = wrap('<div class="spinner-text">Loading…</div>'); return; }
    panel.innerHTML = wrap(items.length
      ? `<ul class="wl-list" id="wlList">${items.map(renderItem).join('')}</ul>`
      : `<div class="wl-empty">
           <div class="wl-empty-emoji">🍿</div>
           <div class="wl-empty-title">Nothing on your list yet.</div>
           <div class="wl-empty-sub">Add a film you both want to see — it'll be waiting here for movie night.</div>
         </div>`);
    attachDrag();
  }

  // ── drag & drop reorder ──
  // Order is persisted the moment a drop lands (the server rewrites sort_order
  // in one transaction), so it survives a reload without an explicit "save".
  function attachDrag() {
    const list = panel.querySelector('#wlList');
    if (!list) return;
    let dragEl = null;

    list.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.wl-item');
      if (!li) return;
      dragEl = li;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', li.dataset.id); } catch (err) { /* Safari */ }
    });

    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragEl) return;
      const over = e.target.closest('.wl-item');
      if (!over || over === dragEl) return;
      const rect = over.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      list.insertBefore(dragEl, after ? over.nextSibling : over);
    });

    list.addEventListener('dragend', async () => {
      if (!dragEl) return;
      dragEl.classList.remove('is-dragging');
      dragEl = null;
      const ids = [...list.querySelectorAll('.wl-item')].map((li) => Number(li.dataset.id));
      const before = items.slice();
      try {
        const { items: updated } = await reorderWatchlist(username, ids);
        items = updated; render();
      } catch (e) {
        items = before; render();
        toast('Could not save the new order.');
      }
    });
  }

  // ── actions ──
  panel.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-wl]');
    if (!t) return;
    const act = t.dataset.wl;
    const id = Number(t.dataset.id);

    if (act === 'add') {
      return openAddMovie({
        isOnList: onList,
        onAdd: async (recId) => {
          const { items: updated } = await addToWatchlist(username, recId);
          items = updated; render();
        },
      });
    }
    if (act === 'open') return openMovieModal(Number(t.dataset.movie), { alreadyAdded: true });

    const it = items.find((x) => x.id === id);
    if (!it) return;

    if (act === 'watched') return mutate(id, { watched: !it.watched });
    if (act === 'rate') {
      const n = Number(t.dataset.rating);
      // Clicking the current rating again clears it — no separate "unrate" step.
      return mutate(id, { rating: n === 0 || it.rating === n ? null : n });
    }
    if (act === 'comment') {
      const next = window.prompt('Add a note about this film', it.comment || '');
      if (next === null) return;
      return mutate(id, { comment: next.trim() });
    }
    if (act === 'remove') {
      if (!confirm(`Remove "${it.movie.title}" from your watchlist?`)) return;
      try {
        const { items: updated } = await removeFromWatchlist(username, id);
        items = updated; render();
      } catch (err) { toast(err.message || 'Could not remove that.'); }
      return;
    }
    if (act === 'start') {
      // The extension is what actually runs a watch party, and it exposes no
      // "start a session" hook to this page — so this pins the film to the top
      // of the list as what's up next and tells them how to begin. Marking it
      // watched afterwards is a normal one-tap action.
      try {
        const ids = [id, ...items.filter((x) => x.id !== id).map((x) => x.id)];
        const { items: updated } = await reorderWatchlist(username, ids);
        items = updated; render();
      } catch (err) { /* pinning is a nicety, not the point */ }
      toast(`“${it.movie.title}” is up next — open it in a tab and start the party from the Herae extension 💜`);
    }
  });

  async function mutate(id, patch) {
    const before = items.slice();
    try {
      const { items: updated } = await updateWatchlistItem(username, id, patch);
      items = updated; render();
    } catch (err) {
      items = before; render();
      toast(err.message || 'Could not save that.');
    }
  }
}
