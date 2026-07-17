// movie.js — movie.html only. One admin-curated recommendation's detail
// page: hero backdrop, poster, gallery carousel, full metadata, and a
// "similar" grid (genre-overlap heuristic — see server/src/
// recommendations.js's GET /:id) linking to other movie pages.
'use strict';

import { escapeHtml, formatDuration } from '../lib/util.js';
import { renderErrorState } from '../components/skeleton.js';
import { renderCarousel, attachCarouselHandlers } from '../components/carousel.js';

const { requireAuth, logout, getRecommendationById } = window;

const auth = requireAuth();
const contentEl = document.getElementById('content');

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  attachCarouselHandlers(contentEl);
  load();
}

function getId() {
  return new URLSearchParams(window.location.search).get('id') || '';
}

function metaLine(rec) {
  const bits = [];
  if (rec.releaseYear) bits.push(rec.releaseYear);
  if (rec.runtimeMinutes) bits.push(formatDuration(rec.runtimeMinutes));
  if (rec.genres.length) bits.push(rec.genres.join(', '));
  return bits.join(' · ');
}

function renderSimilarGrid(similar) {
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

async function load() {
  const id = getId();
  if (!id) {
    contentEl.innerHTML = renderErrorState('No recommendation specified.');
    return;
  }
  try {
    const { recommendation: rec, similar } = await getRecommendationById(id);
    document.title = `${rec.title} — Herae Memories`;
    const bg = rec.backdropUrl || rec.posterUrl;
    const galleryItems = rec.gallery.map((url) => `
      <div class="carousel-item"><img src="${url}" alt="${escapeHtml(rec.title)} gallery image" class="movie-gallery-img" loading="lazy"></div>
    `);

    contentEl.innerHTML = `
      <div class="movie-hero" style="${bg ? `background-image: linear-gradient(180deg, rgba(13,11,18,0.1) 0%, rgba(13,11,18,0.65) 60%, var(--bg-0) 100%), url('${bg}')` : ''}">
        <div class="movie-hero-inner">
          ${rec.posterUrl ? `<img src="${rec.posterUrl}" alt="${escapeHtml(rec.title)} poster" class="movie-poster">` : ''}
          <div class="movie-hero-info">
            <div class="movie-title">${escapeHtml(rec.title)}</div>
            <div class="movie-meta">${escapeHtml(metaLine(rec))}</div>
            ${rec.rating ? `<div class="movie-rating">★ ${rec.rating.toFixed(1)} / 10</div>` : ''}
          </div>
        </div>
      </div>

      <div class="page-wrap movie-body">
        ${rec.description ? `<div class="movie-description">${escapeHtml(rec.description)}</div>` : ''}
        ${rec.gallery.length ? `<div class="movie-gallery-title">Gallery</div>${renderCarousel(galleryItems, { className: 'movie-gallery-carousel' })}` : ''}
        ${renderSimilarGrid(similar)}
      </div>
    `;
  } catch (err) {
    contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
  }
}
