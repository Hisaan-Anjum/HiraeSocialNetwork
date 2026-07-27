// addMovie.js — the "Add Movie" overlay for the shared Watchlist.
//
// Deliberately NOT a new recommendation system: both halves of this overlay are
// the existing recommendations engine. The default list is GET
// /api/recommendations — ranked by what the two of you have actually watched and
// rated — and the search box is the same endpoint with ?q=. One movie database,
// one ranking, nothing duplicated.
// Clicking any result opens the shared movie detail modal
// (components/movieDetail.js), which carries the "Add to Shared Watchlist"
// action.
'use strict';

import { escapeHtml, debounce } from '../lib/util.js';
import { openMovieModal } from '../components/movieDetail.js';
import { lockScroll } from '../lib/scrollLock.js';
import { createMovieFilters } from '../components/movieFilters.js';

const { getRecommendations } = window;

// `onAdd(recommendationId)` must resolve once the server has accepted the add.
// `isOnList(id)` lets already-added titles render as such.
// `withUser` is the contact this list is shared with — passed to the ranking so
// the suggestions reflect both partners rather than only whoever is looking.
export function openAddMovie({ onAdd, isOnList = () => false, withUser = '' }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay wl-add-overlay';
  overlay.innerHTML = `
    <div class="modal-card wl-add" role="dialog" aria-modal="true" aria-label="Add a movie to your watchlist">
      <div class="ms-sel-head">
        <h2>🍿 Add a Movie</h2>
        <button class="share-close" data-wa="close" aria-label="Close">✕</button>
      </div>
      <input type="search" class="wl-add-search" id="wlAddSearch" placeholder="Search movies…" autocomplete="off">
      <div id="wlAddFilters"></div>
      <div class="wl-add-kicker" id="wlAddKicker">Recommended for you</div>
      <div class="wl-add-grid" id="wlAddGrid"><div class="spinner-text">Loading…</div></div>
      <div id="wlAddSentinel" class="scroll-sentinel hidden"></div>
    </div>`;
  document.body.appendChild(overlay);
  const releaseScroll = lockScroll();

  const grid = overlay.querySelector('#wlAddGrid');
  const kicker = overlay.querySelector('#wlAddKicker');
  const searchEl = overlay.querySelector('#wlAddSearch');

  // Filters narrow whatever is on screen — the taste-ranked suggestions AND a
  // title search alike — so "Netflix, 8+" works the same either way.
  const filters = createMovieFilters({ onChange: () => load(searchEl.value.trim()) });
  overlay.querySelector('#wlAddFilters').appendChild(filters.el);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    filters.destroy();
    releaseScroll();
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-wa="close"]')) return close();
    if (e.target.closest('[data-wa-clearfilters]')) return filters.clear();
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
      // Name the actual cause. "No movies match that search" while four filters
      // are quietly on sends people to retype a title that was never the problem.
      grid.innerHTML = filters.isActive()
        ? `<div class="wl-add-empty">Nothing matches these filters.<br>
             <button type="button" class="mf-clear" data-wa-clearfilters>Clear all filters</button></div>`
        : '<div class="wl-add-empty">No movies match that search.</div>';
      return;
    }
    grid.innerHTML = cardsHtml(list);
  }

  function appendMovies(list) {
    grid.insertAdjacentHTML('beforeend', cardsHtml(list));
  }

  function cardsHtml(list) {
    return list.map((m) => `
      <button class="wl-add-card" data-wa-movie="${m.id}" title="${escapeHtml(m.title)}">
        <span class="wl-add-art" style="${m.posterUrl ? `background-image:url('${m.posterUrl}')` : ''}">
          ${!m.posterUrl ? '<span class="recommendation-card-placeholder">🎬</span>' : ''}
          ${isOnList(m.id) ? '<span class="wl-add-on">✓ On list</span>' : ''}
        </span>
        <span class="wl-add-name">${escapeHtml(m.title)}</span>
        ${m.releaseYear ? `<span class="wl-add-year">${m.releaseYear}</span>` : ''}
      </button>`).join('');
  }

  // Paged, because this browses the whole catalogue — thousands of titles, of
  // which one fetch is 20. Without this the overlay silently pretended the rest
  // didn't exist.
  const sentinel = overlay.querySelector('#wlAddSentinel');
  // Declared with the rest of the paging state rather than beside load(): the
  // observer registered below reaches it, and a `let` further down would sit in
  // its temporal dead zone.
  let reqToken = 0;
  let cursor = null;
  let done = false;
  let loadingMore = false;

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !done && !loadingMore) loadMore();
    // The scroll container is the modal card, not the page.
    }, { root: overlay.querySelector('.wl-add'), rootMargin: '300px 0px' });
    io.observe(sentinel);
  }

  async function loadMore() {
    if (done || loadingMore) return;
    loadingMore = true;
    const mine = reqToken;
    try {
      const res = await getRecommendations(cursor, searchEl.value.trim() || undefined,
        withUser || undefined, filters.params());
      // A newer search or filter change happened while this was in flight — its
      // results belong to a query nobody is looking at any more.
      if (mine !== reqToken) return;
      cursor = res.nextCursor ?? null;
      done = res.nextCursor == null;
      appendMovies(res.recommendations || []);
      sentinel.classList.toggle('hidden', done);
    } catch (e) {
      done = true;   // don't retry a failing page on every scroll tick
      sentinel.classList.add('hidden');
    } finally {
      loadingMore = false;
    }
  }

  async function load(q) {
    const mine = ++reqToken;
    cursor = null; done = false;
    sentinel.classList.add('hidden');
    grid.innerHTML = '<div class="spinner-text">Loading…</div>';
    kicker.textContent = q
      ? `Results for “${q}”`
      : withUser ? `Recommended for you & ${withUser}` : 'Recommended for you';
    try {
      const res = await getRecommendations(null, q || undefined, withUser || undefined, filters.params());
      if (mine !== reqToken) return; // a newer keystroke already won
      filters.setCount(res.total);
      cursor = res.nextCursor ?? null;
      done = res.nextCursor == null;
      renderMovies(res.recommendations || []);
      sentinel.classList.toggle('hidden', done);
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
