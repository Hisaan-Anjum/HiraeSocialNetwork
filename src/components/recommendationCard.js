// recommendationCard.js — admin-curated "watch this together" cards (see
// server/src/recommendations.js). Two renderings: a compact inline card
// dropped periodically into the feed, and a large Netflix-style hero for
// the single featured pick pinned at the top.
'use strict';

import { escapeHtml, formatDuration } from '../lib/util.js';

function genreLine(rec) {
  const bits = [];
  if (rec.releaseYear) bits.push(rec.releaseYear);
  if (rec.runtimeMinutes) bits.push(formatDuration(rec.runtimeMinutes));
  if (rec.genres.length) bits.push(rec.genres.slice(0, 3).join(', '));
  return bits.join(' · ');
}

export function renderRecommendationCard(rec) {
  const bg = rec.backdropUrl || rec.posterUrl;
  return `
    <article class="feed-card recommendation-card">
      <a href="movie.html?id=${rec.id}" class="recommendation-card-link">
        <div class="recommendation-card-art" style="${bg ? `background-image:url('${bg}')` : ''}">
          ${!bg ? '<span class="recommendation-card-placeholder">🎬</span>' : ''}
          <span class="recommendation-card-flag">Recommended together</span>
        </div>
        <div class="recommendation-card-body">
          <div class="recommendation-card-title">${escapeHtml(rec.title)}</div>
          <div class="recommendation-card-meta">${escapeHtml(genreLine(rec))}</div>
          ${rec.description ? `<div class="recommendation-card-desc">${escapeHtml(rec.description)}</div>` : ''}
          ${rec.rating ? `<div class="recommendation-card-rating">★ ${rec.rating.toFixed(1)}</div>` : ''}
        </div>
      </a>
    </article>
  `;
}

export function renderFeaturedHero(rec) {
  if (!rec) return '';
  const bg = rec.backdropUrl || rec.posterUrl;
  return `
    <a href="movie.html?id=${rec.id}" class="hero-card" style="${bg ? `background-image: linear-gradient(180deg, rgba(13,11,18,0.05) 0%, rgba(13,11,18,0.55) 55%, var(--bg-0) 100%), url('${bg}')` : ''}">
      <div class="hero-card-badge">✨ Tonight's pick</div>
      <div class="hero-card-title">${escapeHtml(rec.title)}</div>
      <div class="hero-card-meta">${escapeHtml(genreLine(rec))}${rec.rating ? ` · ★ ${rec.rating.toFixed(1)}` : ''}</div>
      ${rec.description ? `<div class="hero-card-desc">${escapeHtml(rec.description)}</div>` : ''}
      <span class="btn btn-gold hero-card-cta">See details →</span>
    </a>
  `;
}
