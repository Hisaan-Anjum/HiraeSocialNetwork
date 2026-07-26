// movie.js — movie.html only. One admin-curated recommendation's detail
// page: hero backdrop, poster, gallery carousel, full metadata, and a
// "similar" grid (genre-overlap heuristic — see server/src/
// recommendations.js's GET /:id) linking to other movie pages.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { renderErrorState } from '../components/skeleton.js';
import { attachCarouselHandlers } from '../components/carousel.js';
// The hero/body markup lives in components/movieDetail.js so this page and the
// watchlist's movie modal render the identical view from one definition.
import { renderMovieDetail } from '../components/movieDetail.js';
import { openPickContact } from '../watchlist/pickContact.js';

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

async function load() {
  const id = getId();
  if (!id) {
    contentEl.innerHTML = renderErrorState('No recommendation specified.');
    return;
  }
  try {
    const { recommendation: rec, similar } = await getRecommendationById(id);
    document.title = `${rec.title} — Herae Memories`;
    // A watchlist belongs to a relationship, so from here — a page that isn't
    // about any one contact — adding has to ask who it's for.
    const actionsHtml = `
      <div class="movie-modal-actions">
        <button class="btn btn-primary" id="movieAddWatchlist">❤️ Add to Watchlist</button>
        ${(rec.watchLinks || []).length ? '<button class="btn btn-ghost" id="movieFindOn">▶ Find it on…</button>' : ''}
        <span class="movie-modal-msg" id="movieActionMsg"></span>
      </div>`;
    contentEl.innerHTML = renderMovieDetail(rec, { similar, actionsHtml });

    document.getElementById('movieAddWatchlist')?.addEventListener('click', () => {
      openPickContact({
        movie: rec,
        onAdded: (username) => {
          const msg = document.getElementById('movieActionMsg');
          if (msg) msg.textContent = `Added to your list with ${username} 💜`;
        },
      });
    });
    document.getElementById('movieFindOn')?.addEventListener('click', async () => {
      const { openWatchPicker } = await import('../watchlist/providers.js');
      openWatchPicker(rec, { onPick: (link) => window.open(link.url, '_blank', 'noopener') });
    });
  } catch (err) {
    contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
  }
}
