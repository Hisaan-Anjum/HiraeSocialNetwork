// rateHerae.js — after a real night, ask for a Chrome Web Store rating (STRATEGY_LOOP.md, search arm, 2026-10-05).
//
// The store ranks extensions on ratings and engagement; Herae had 4 ratings and never asked anyone. Extensions that ask
// at a success moment collect ratings every day (Web Highlights: 1.6k). Asked once per browser, only after a night of
// 10+ minutes, never with an incentive, and "something was off?" sits right next to it — everyone sees both, so it is
// a plain ask, not a filter that only sends happy people to the store.
'use strict';

const STORE_REVIEWS = 'https://chromewebstore.google.com/detail/kadhimjoddiaenogicbdnejoabdiimgn/reviews?utm_source=review_rate';
const ISSUE = 'https://herae.app/api/q/night/2';
const KEY = 'herae_rate_asked';

export function mountRateHerae(anchor, { durationMs } = {}) {
  if (!anchor || !(durationMs >= 10 * 60 * 1000)) return null;
  try { if (localStorage.getItem(KEY)) return null; } catch (e) { return null; }
  const track = (action) => { try { window.trackEvent && window.trackEvent('store_rating_ask', { action }); } catch (e) { /* best-effort */ } };
  const done = (action) => { try { localStorage.setItem(KEY, action); } catch (e) { /* ignore */ } };
  const card = document.createElement('div');
  card.className = 'rate-herae';
  card.innerHTML = `
    <div class="rate-herae-title">⭐ Did Herae make tonight easier?</div>
    <div class="rate-herae-sub">Ratings are how other long-distance couples find Herae in the Chrome Web Store. If tonight worked, a quick rating helps more than you'd think.</div>
    <div class="rate-herae-row">
      <a class="btn btn-gold rate-herae-go" href="${STORE_REVIEWS}" target="_blank" rel="noopener">Rate Herae</a>
      <a class="btn btn-ghost rate-herae-issue" href="${ISSUE}" target="_blank" rel="noopener">Something was off? Tell us</a>
      <button type="button" class="rate-herae-later">Not now</button>
    </div>`;
  anchor.after(card);
  track('shown');
  card.querySelector('.rate-herae-go').addEventListener('click', () => { track('rate'); done('rate'); card.querySelector('.rate-herae-sub').textContent = 'Thank you, it really helps. 💜'; });
  card.querySelector('.rate-herae-issue').addEventListener('click', () => { track('issue'); done('issue'); });
  card.querySelector('.rate-herae-later').addEventListener('click', () => { track('dismiss'); done('dismiss'); card.remove(); });
  return card;
}
