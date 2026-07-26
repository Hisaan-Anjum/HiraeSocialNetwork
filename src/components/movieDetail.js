// movieDetail.js — ONE definition of "what a movie's detail view looks like",
// shared by the full-page view (pages/movie.js) and the modal the shared
// Watchlist opens. Extracted from movie.js unchanged in appearance — the markup
// and classes are the same, so both surfaces stay identical for free instead of
// drifting apart as two copies.
'use strict';

import { escapeHtml, formatDuration } from '../lib/util.js';
import { renderCarousel, attachCarouselHandlers } from './carousel.js';

const { getRecommendationById } = window;

export function movieMetaLine(rec) {
  const bits = [];
  if (rec.releaseYear) bits.push(rec.releaseYear);
  if (rec.runtimeMinutes) bits.push(formatDuration(rec.runtimeMinutes));
  if (rec.genres.length) bits.push(rec.genres.join(', '));
  return bits.join(' · ');
}

export function renderSimilarGrid(similar) {
  if (!similar.length) return '';
  return `
    <div class="movie-similar-title">You might also watch together</div>
    <div class="movie-similar-grid">
      ${similar.map((m) => `
        <a class="movie-similar-card" href="movie.html?id=${m.id}">
          <div class="movie-similar-art" style="${m.posterUrl ? `background-image:url('${m.posterUrl}')` : ''}">
            ${!m.posterUrl ? '<span class="recommendation-card-placeholder">🎬</span>' : ''}
          </div>
          <div class="movie-similar-name">${escapeHtml(m.title)}</div>
        </a>
      `).join('')}
    </div>
  `;
}

// The hero + body of a movie. `actionsHtml` is an optional slot under the
// title — the modal drops "❤️ Add to Shared Watchlist" in there; the page
// passes nothing and looks exactly as it always has.
export function renderMovieDetail(rec, { similar = [], actionsHtml = '' } = {}) {
  const bg = rec.backdropUrl || rec.posterUrl;
  const galleryItems = rec.gallery.map((url) => `
    <div class="carousel-item"><img src="${url}" alt="${escapeHtml(rec.title)} gallery image" class="movie-gallery-img" loading="lazy"></div>
  `);
  return `
    <div class="movie-hero" style="${bg ? `background-image: linear-gradient(180deg, rgba(13,11,18,0.1) 0%, rgba(13,11,18,0.65) 60%, var(--bg-0) 100%), url('${bg}')` : ''}">
      <div class="movie-hero-inner">
        ${rec.posterUrl ? `<img src="${rec.posterUrl}" alt="${escapeHtml(rec.title)} poster" class="movie-poster">` : ''}
        <div class="movie-hero-info">
          <div class="movie-title">${escapeHtml(rec.title)}</div>
          <div class="movie-meta">${escapeHtml(movieMetaLine(rec))}</div>
          ${rec.rating ? `<div class="movie-rating">★ ${rec.rating.toFixed(1)} / 10</div>` : ''}
          ${actionsHtml}
        </div>
      </div>
    </div>

    <div class="page-wrap movie-body">
      ${rec.description ? `<div class="movie-description">${escapeHtml(rec.description)}</div>` : ''}
      ${rec.gallery.length ? `<div class="movie-gallery-title">Gallery</div>${renderCarousel(galleryItems, { className: 'movie-gallery-carousel' })}` : ''}
      ${renderSimilarGrid(similar)}
    </div>
  `;
}

// Opens the movie detail as a modal. `onAdd(rec)` — when provided — renders the
// "Add to Shared Watchlist" button and is awaited on click, so the button can
// report success/failure inline. `alreadyAdded` renders it as a done state.
export function openMovieModal(recommendationId, { onAdd = null, alreadyAdded = false } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay movie-modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card movie-modal" role="dialog" aria-modal="true" aria-label="Movie details">
      <button class="share-close movie-modal-close" data-mm="close" aria-label="Close">✕</button>
      <div class="movie-modal-body" id="movieModalBody">
        <div class="spinner-text">Loading…</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const close = () => {
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-mm="close"]')) close();
  });

  const body = overlay.querySelector('#movieModalBody');
  (async () => {
    try {
      const { recommendation: rec, similar } = await getRecommendationById(recommendationId);
      // "Find it on" only appears when we actually hold links for this title —
      // most of the long tail has none, and a dead button is worse than none.
      const canWatch = Array.isArray(rec.watchLinks) && rec.watchLinks.length > 0;
      const actions = (onAdd || canWatch)
        ? `<div class="movie-modal-actions">
             ${onAdd ? `<button class="btn btn-primary" data-mm="add" ${alreadyAdded ? 'disabled' : ''}>
               ${alreadyAdded ? '✓ On your watchlist' : '❤️ Add to Shared Watchlist'}
             </button>` : ''}
             ${canWatch ? '<button class="btn btn-ghost" data-mm="watch">▶ Find it on…</button>' : ''}
             <span class="movie-modal-msg" id="movieModalMsg"></span>
           </div>`
        : '';
      body.innerHTML = renderMovieDetail(rec, { similar, actionsHtml: actions });
      attachCarouselHandlers(body);

      body.querySelector('[data-mm="watch"]')?.addEventListener('click', async () => {
        const { openWatchPicker } = await import('../watchlist/providers.js');
        openWatchPicker(rec, { onPick: (link) => window.open(link.url, '_blank', 'noopener') });
      });

      const addBtn = body.querySelector('[data-mm="add"]');
      if (addBtn && onAdd) {
        addBtn.addEventListener('click', async () => {
          const msg = body.querySelector('#movieModalMsg');
          addBtn.disabled = true;
          addBtn.textContent = 'Adding…';
          try {
            await onAdd(rec);
            addBtn.textContent = '✓ Added to your watchlist';
            if (msg) msg.textContent = '';
            setTimeout(close, 700);
          } catch (err) {
            addBtn.disabled = false;
            addBtn.textContent = '❤️ Add to Shared Watchlist';
            if (msg) msg.textContent = err.message || 'Could not add that.';
          }
        });
      }
    } catch (err) {
      body.innerHTML = `<div class="empty-state">${escapeHtml(err.message || 'Could not load that movie.')}</div>`;
    }
  })();

  return { close };
}
