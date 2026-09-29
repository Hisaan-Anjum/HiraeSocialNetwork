// ratingAsk.js — one gentle request for a Chrome Web Store rating, after a real night.
//
// The store listing had 4 ratings (2026-09-29), which is thin proof for someone
// deciding whether to install. The best moment to ask is right after a night
// that worked, so this appears on the review page only when the night lasted
// 30+ minutes, and only once per browser.
//
// Store policy: everyone who reaches that point is asked the same way — no
// "did you like it?" filter first (review gating) and nothing offered in
// return. "Not now" dismisses it for good, like "Rate Herae" does.
'use strict';

const STORE_REVIEWS = 'https://chromewebstore.google.com/detail/kadhimjoddiaenogicbdnejoabdiimgn/reviews';
const KEY = 'herae_rating_asked';
const MIN_NIGHT_MS = 30 * 60 * 1000;

export function mountRatingAsk(container, detail) {
  if (!container || !detail || !detail.isParticipant) return;
  if (!(detail.durationMs >= MIN_NIGHT_MS)) return;
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

  const card = document.createElement('div');
  card.className = 'rating-ask';
  card.setAttribute('role', 'note');
  card.innerHTML = `
    <div class="rating-ask-text">
      <strong>A whole film, together.</strong>
      If Herae made tonight easier, a rating on the Chrome Web Store is how other couples find it.
    </div>
    <div class="rating-ask-actions">
      <a class="btn btn-gold" href="${STORE_REVIEWS}" target="_blank" rel="noopener">Rate Herae</a>
      <button type="button" class="btn btn-ghost rating-ask-later">Not now</button>
    </div>`;
  const done = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* ignore */ } card.remove(); };
  card.querySelector('a').addEventListener('click', () => setTimeout(done, 300));
  card.querySelector('.rating-ask-later').addEventListener('click', done);
  container.prepend(card);
}
