// addMovie.js — the "Add Movie" overlay for the shared Watchlist.
//
// Deliberately NOT a new recommendation system: both halves of this overlay are
// the existing recommendations engine. The default list is GET
// /api/recommendations (the admin-curated catalogue), and the search box is the
// same endpoint with ?q= — one movie database, one ranking, nothing duplicated.
// Clicking any result opens the shared movie detail modal
// (components/movieDetail.js), which carries the "Add to Shared Watchlist"
// action.
'use strict';

import { escapeHtml, debounce } from '../lib/util.js';
import { openMovieModal } from '../components/movieDetail.js';

const { getRecommendations } = window;

// `onAdd(recommendationId)` must resolve once the server has accepted the add.
// `isOnList(id)` lets already-added titles render as such.
export function openAddMovie({ onAdd, isOnList = () => false }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay wl-add-overlay';
  overlay.innerHTML = `
    <div class="modal-card wl-add" role="dialog" aria-modal="true" aria-label="Add a movie to your watchlist">
      <div class="ms-sel-head">
        <h2>🍿 Add a Movie</h2>
        <button class="share-close" data-wa="close" aria-label="Close">✕</button>
      </div>
      <input type="search" class="wl-add-search" id="wlAddSearch" placeholder="Search movies…" autocomplete="off">
      <div class="wl-add-kicker" id="wlAddKicker">Recommended for you</div>
      <div class="wl-add-grid" id="wlAddGrid"><div class="spinner-text">Loading…</div></div>
    </div>`;
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const grid = overlay.querySelector('#wlAddGrid');
  const kicker = overlay.querySelector('#wlAddKicker');
  const searchEl = overlay.querySelector('#wlAddSearch');

  const close = () => {
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-wa="close"]')) return close();
    const card = e.target.closest('[data-wa-movie]');
    if (card) openDetail(Number(card.dataset.waMovie));
  });

  function openDetail(id) {
    openMovieModal(id, {
      alreadyAdded: isOnList(id),
      onAdd: async (rec) => { await onAdd(rec.id); close(); },
    });
  }

  function renderMovies(list) {
    if (!list.length) {
      grid.innerHTML = '<div class="wl-add-empty">No movies match that search.</div>';
      return;
    }
    grid.innerHTML = list.map((m) => `
      <button class="wl-add-card" data-wa-movie="${m.id}" title="${escapeHtml(m.title)}">
        <span class="wl-add-art" style="${m.posterUrl ? `background-image:url('${m.posterUrl}')` : ''}">
          ${!m.posterUrl ? '<span class="recommendation-card-placeholder">🎬</span>' : ''}
          ${isOnList(m.id) ? '<span class="wl-add-on">✓ On list</span>' : ''}
        </span>
        <span class="wl-add-name">${escapeHtml(m.title)}</span>
        ${m.releaseYear ? `<span class="wl-add-year">${m.releaseYear}</span>` : ''}
      </button>`).join('');
  }

  let reqToken = 0;
  async function load(q) {
    const mine = ++reqToken;
    grid.innerHTML = '<div class="spinner-text">Loading…</div>';
    kicker.textContent = q ? `Results for “${q}”` : 'Recommended for you';
    try {
      const { recommendations } = await getRecommendations(null, q || undefined);
      if (mine !== reqToken) return; // a newer keystroke already won
      renderMovies(recommendations || []);
    } catch (err) {
      if (mine !== reqToken) return;
      grid.innerHTML = `<div class="wl-add-empty">${escapeHtml(err.message || 'Could not load movies.')}</div>`;
    }
  }

  searchEl.addEventListener('input', debounce(() => load(searchEl.value.trim()), 220));
  load('');
  setTimeout(() => searchEl.focus(), 30);

  return { close };
}
