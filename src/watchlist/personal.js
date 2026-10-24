// personal.js — a person's own watchlist on their Herae page (founder 2026-10-24), drawn like the shared watchlist:
// poster, title, year. Filled by "Add to… → My watchlist" (addTo.js). On your own page each film can be removed.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { openMovieModal } from '../components/movieDetail.js';

const { apiRequest } = window;

// Resolves { allowed, items: [{ title, film|null }] } — allowed is false when the viewer may not see it.
export function fetchPersonalWatchlist(username) {
  return apiRequest(`/api/profile/watch/watchlist/${encodeURIComponent(username)}`).catch(() => ({ allowed: false, items: [] }));
}

export function mountPersonalWatchlist(container, { username, isMe, name, data }) {
  const panel = document.createElement('section');
  panel.className = 'wl-panel wl-personal';
  container.appendChild(panel);
  let items = data.items || [];

  function render() {
    panel.innerHTML = `
      <div class="wl-head"><h2>📌 ${isMe ? 'My watchlist' : `${escapeHtml(name)}’s watchlist`}</h2>
        ${items.length ? `<span class="wl-count">${items.length} film${items.length === 1 ? '' : 's'}</span>` : ''}</div>
      ${items.length ? `<ul class="wl-list">${items.map((it, i) => {
        const m = it.film;
        return `<li class="wl-item">
          <span class="wl-art" ${m ? `data-pw="open" data-movie="${m.id}" role="button" tabindex="0"` : ''}
            style="${m && m.posterUrl ? `background-image:url('${m.posterUrl}')` : ''}">${!m || !m.posterUrl ? '<span class="recommendation-card-placeholder">🎬</span>' : ''}</span>
          <div class="wl-main">
            <div class="wl-title" ${m ? `data-pw="open" data-movie="${m.id}" role="button" tabindex="0"` : ''}>${escapeHtml(it.title)}</div>
            <div class="wl-meta">${m && m.releaseYear ? m.releaseYear : ''}</div>
            ${isMe ? `<div class="wl-actions"><button class="wl-chip" data-pw="remove" data-i="${i}">Remove</button></div>` : ''}
          </div></li>`;
      }).join('')}</ul>`
      : `<div class="wl-empty">${isMe ? 'Nothing yet. On any film, tap “Add to…” → My watchlist.' : 'Nothing here yet.'}</div>`}`;
  }

  panel.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-pw="open"]');
    if (open) { openMovieModal(Number(open.dataset.movie)); return; }
    const rm = e.target.closest('[data-pw="remove"]');
    if (rm && isMe) {
      const next = items.filter((_, i) => i !== Number(rm.dataset.i));
      rm.disabled = true;
      try { await apiRequest('/api/profile/watch', { method: 'PUT', body: JSON.stringify({ watchlist: next.map((x) => x.title) }) }); items = next; render(); }
      catch (err) { rm.disabled = false; rm.textContent = 'Try again'; }
    }
  });
  render();
  return panel;
}
