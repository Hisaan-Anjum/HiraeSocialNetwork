// pairNights.js — "You and X" (binge-moat B4): every night the viewer had with this person, newest first, on that
// person's profile. Server: GET /api/moments/with/:username (the viewer's own nights with them only; 404 = none, and
// then nothing renders). Moments come as signed, expiring links; nothing here downloads or exports anything.
'use strict';

import { escapeHtml } from '../lib/util.js';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fmtDate = (at) => {
  const d = new Date(String(at).replace(' ', 'T') + (/[zZ]$/.test(at) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
// The page title the night was filed under: "Inception | Netflix" → "Inception".
const filmName = (n) => n.title || (n.film ? String(n.film).split(/\s[|–—-]\s/)[0].trim() : '') || 'A night together';

function nightHtml(n, me, other) {
  const stars = (u) => (n.ratings && n.ratings[u] ? `${escapeHtml(u === me ? 'You' : u)} ${'★'.repeat(n.ratings[u])}` : '');
  const rated = [stars(me), stars(other)].filter(Boolean).join(' · ');
  const thumbs = (n.moments || []).slice(0, 4).map((m) => `<img src="${escapeHtml(m.url)}" alt="" loading="lazy">`).join('');
  const more = (n.moments || []).length > 4 ? `<span class="pn-more">+${n.moments.length - 4}</span>` : '';
  return `<li class="pn-night">
    <a class="pn-link" href="review.html?session=${encodeURIComponent(n.clientSessionId)}">
      <div class="pn-top"><span class="pn-film">${escapeHtml(filmName(n))}</span><span class="pn-date">${escapeHtml(fmtDate(n.at))}</span></div>
      <div class="pn-meta">${n.minutes ? `${n.minutes} min` : ''}${n.moments.length ? ` · ${plural(n.moments.length, 'moment')}` : ''}${rated ? ` · ${rated}` : ''}</div>
      ${thumbs ? `<div class="pn-thumbs">${thumbs}${more}</div>` : ''}
    </a>
  </li>`;
}

export async function mountPairNights(container, { me, other }) {
  if (!container || !me || !other || me === other || !window.apiRequest) return;
  let page;
  try { page = await window.apiRequest(`/api/moments/with/${encodeURIComponent(other)}`); } catch (e) { container.innerHTML = ''; return; }
  if (!page || !page.nights || !page.nights.length) { container.innerHTML = ''; return; }
  const t = page.totals || {};
  const sum = [plural(t.nights || page.nights.length, 'night'), t.moments ? plural(t.moments, 'moment') : '', t.hours >= 1 ? `${t.hours} hours` : '']
    .filter(Boolean).join(' · ');
  container.innerHTML = `<section class="pair-nights" id="nights" aria-labelledby="pnTitle">
    <h2 class="pn-title" id="pnTitle">You and ${escapeHtml(other)}</h2>
    <div class="pn-sum">${escapeHtml(sum)}</div>
    ${t.genres && t.genres.length ? `<div class="pn-genres">Most watched: ${escapeHtml(t.genres.join(', '))}</div>` : ''}
    <ol class="pn-list">${page.nights.map((n) => nightHtml(n, me, other)).join('')}</ol>
    ${page.nextCursor ? '<button type="button" class="btn btn-ghost pn-next">More nights</button>' : ''}
  </section>`;
  let cursor = page.nextCursor;
  container.querySelector('.pn-next')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const next = await window.apiRequest(`/api/moments/with/${encodeURIComponent(other)}?cursor=${encodeURIComponent(cursor)}`);
      container.querySelector('.pn-list').insertAdjacentHTML('beforeend', (next.nights || []).map((n) => nightHtml(n, me, other)).join(''));
      cursor = next.nextCursor;
      if (cursor) btn.disabled = false; else btn.remove();
    } catch (err) { btn.disabled = false; }
  });
  if (location.hash === '#nights') container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
