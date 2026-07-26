// providers.js — the "Find it on…" picker.
//
// A movie's watchLinks come from Wikidata's streaming-platform identifier
// properties (CC0), which publish an authoritative URL formatter per platform —
// so these are ordinary deep links, and nothing is scraped from the streaming
// services themselves.
//
// Presented as BRANDED TEXT CHIPS rather than the platforms' logo files: a
// wordmark in the service's colour identifies it just as clearly (nominative
// use) without redistributing trademarked artwork inside the product.
//
// IMPORTANT WORDING: a platform id means "this title exists on that service",
// not "it's available in your country today" — availability is regional and
// rotates constantly. The heading says "Find it on", never "Available on", so
// the UI never promises something the data can't back.
'use strict';

import { escapeHtml } from '../lib/util.js';

// Brand colours only — no logo assets. `key` matches what the ingestion writes.
const BRAND = {
  netflix: { name: 'Netflix', color: '#e50914', fg: '#fff' },
  prime_video: { name: 'Prime Video', color: '#00a8e1', fg: '#04121a' },
  amazon_video: { name: 'Amazon Video', color: '#00a8e1', fg: '#04121a' },
  apple_tv: { name: 'Apple TV', color: '#f5f5f7', fg: '#111' },
  hulu: { name: 'Hulu', color: '#1ce783', fg: '#04120a' },
  disney_plus: { name: 'Disney+', color: '#113ccf', fg: '#fff' },
  max: { name: 'Max', color: '#0046ff', fg: '#fff' },
  paramount_plus: { name: 'Paramount+', color: '#0064ff', fg: '#fff' },
  peacock: { name: 'Peacock', color: '#000', fg: '#fff' },
};
const fallback = (link) => ({ name: link.name || 'Watch', color: '#8b5cf6', fg: '#fff' });

export function hasWatchLinks(movie) {
  return Array.isArray(movie?.watchLinks) && movie.watchLinks.length > 0;
}

// Opens the picker. `onPick(link)` receives { provider, name, url }.
export function openWatchPicker(movie, { onPick }) {
  const links = (movie.watchLinks || []).filter((l) => l && l.url);
  if (!links.length) return null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay wp-overlay';
  overlay.innerHTML = `
    <div class="modal-card wp-card" role="dialog" aria-modal="true" aria-label="Where to watch">
      <div class="ms-sel-head">
        <h2>▶ Find it on</h2>
        <button class="share-close" data-wp="close" aria-label="Close">✕</button>
      </div>
      <div class="wp-movie">${escapeHtml(movie.title)}</div>
      <div class="wp-grid">
        ${links.map((l, i) => {
          const b = BRAND[l.provider] || fallback(l);
          return `<button class="wp-chip" data-wp="pick" data-i="${i}"
                    style="--wp-bg:${b.color};--wp-fg:${b.fg}">${escapeHtml(b.name)}</button>`;
        }).join('')}
      </div>
      <div class="wp-note">Opens the title page on that service. Availability varies by country and changes over time.</div>
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
    if (e.target === overlay || e.target.closest('[data-wp="close"]')) return close();
    const pick = e.target.closest('[data-wp="pick"]');
    if (!pick) return;
    close();
    onPick(links[Number(pick.dataset.i)]);
  });

  return { close };
}
