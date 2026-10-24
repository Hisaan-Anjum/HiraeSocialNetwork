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
import { lockScroll } from '../lib/scrollLock.js';

// Brand colours only — no logo assets. `key` matches what the ingestion writes.
const BRAND = {
  netflix: { name: 'Netflix', color: '#e50914', fg: '#fff' },
  prime_video: { name: 'Prime Video', color: '#00a8e1', fg: '#04121a' },
  amazon_video: { name: 'Amazon Video', color: '#00a8e1', fg: '#04121a' },
  apple_tv: { name: 'Apple TV', color: '#f8fafc', fg: '#111' },
  hulu: { name: 'Hulu', color: '#1ce783', fg: '#04120a' },
  disney_plus: { name: 'Disney+', color: '#113ccf', fg: '#fff' },
  max: { name: 'Max', color: '#0046ff', fg: '#fff' },
  paramount_plus: { name: 'Paramount+', color: '#0064ff', fg: '#fff' },
  peacock: { name: 'Peacock', color: '#000', fg: '#fff' },
};
const fallback = (link) => ({ name: link.name || 'Watch', color: '#6366f1', fg: '#fff' });

// Region labels (founder 10-24): if this browser has Herae, it checks the film's Netflix / Apple TV pages from here —
// so for this country — and the server keeps the answer for everyone here (server/src/recommendations.js). No
// extension: nothing happens and only what others here already found is shown. Never hides a film, only labels it.
const CHECKABLE = ['netflix', 'apple_tv'];
function checkAvailabilityHere(rec, timeoutMs = 12000) {
  const checks = (rec.watchLinks || []).filter((l) => l && CHECKABLE.includes(l.provider) && l.available === undefined)
    .map((l) => ({ id: rec.id, provider: l.provider, url: l.url }));
  if (!checks.length) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (v) => { window.removeEventListener('message', onAck); resolve(v); };
    function onAck(e) { if (e.source === window && e.data && e.data.__heraeCheckAvailabilityAck === true) done(e.data.saved > 0); }
    window.addEventListener('message', onAck);
    window.postMessage({ __heraeCheckAvailability: true, checks }, window.location.origin);
    setTimeout(() => done(false), timeoutMs);
  });
}
// Checks, then re-reads the film so its links (and the "Find it on" picker, which reads rec at click time) carry the answer.
export async function refreshAvailability(rec, root) {
  if (!(await checkAvailabilityHere(rec))) return;
  try {
    const { recommendation: fresh } = await window.getRecommendationById(rec.id);
    rec.watchLinks = fresh.watchLinks; rec.availableHere = fresh.availableHere;
    const tag = root && root.querySelector('[data-region]');
    if (tag) tag.hidden = fresh.availableHere !== false;
  } catch (e) { /* the labels just stay as they were */ }
}

export function hasWatchLinks(movie) {
  return Array.isArray(movie?.watchLinks) && movie.watchLinks.length > 0;
}

// Opens the picker. `onPick(link)` receives { provider, name, url }.
export function openWatchPicker(movie, { onPick }) {
  const links = (movie.watchLinks || []).filter((l) => l && l.url);
  if (!links.length) return null;
  // One service: nothing to choose, so "Watch now" goes straight there (2026-10-16 — every step is a place to stop) —
  // unless it's known not to be there in this country: then the picker shows them why.
  if (links.length === 1 && links[0].available !== false) { onPick(links[0]); return null; }

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
          return `<button class="wp-chip${l.available === false ? ' wp-off' : ''}" data-wp="pick" data-i="${i}"
                    style="--wp-bg:${b.color};--wp-fg:${b.fg}">${escapeHtml(b.name)}${l.available === false ? '<small>Not in your country</small>' : ''}</button>`;
        }).join('')}
      </div>
      <div class="wp-note">Opens the title page on that service. Availability varies by country and changes over time.</div>
    </div>`;
  document.body.appendChild(overlay);
  const releaseScroll = lockScroll();

  const close = () => {
    document.removeEventListener('keydown', onKey);
    releaseScroll();
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
