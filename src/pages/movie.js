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
    contentEl.innerHTML = renderMovieDetail(rec, { similar });
  } catch (err) {
    contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
  }
}
