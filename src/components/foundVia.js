// foundVia.js — one tap: "where did you first hear about Herae?" for new accounts.
//
// 46 of 48 accounts (2026-09-30) had no signup source: most people sign up inside the extension, which can't see
// the link that brought them, so no channel (TikTok, Instagram, Pinterest…) could be judged by the customers it
// produces. Asking once, right after signup, is the standard fix (self-reported attribution).
//
// Shown only to accounts that joined in the last 14 days, once per browser, dismissible; the answer is a
// whitelisted client event (server/src/analytics.js FOUND_VIA).
'use strict';

const KEY = 'herae_found_via';
const DAY = 864e5;
const CHOICES = [
  ['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['pinterest', 'Pinterest'],
  ['google', 'Google search'], ['chrome_store', 'Chrome Web Store'], ['partner_friend', 'My partner or a friend'],
  ['reddit', 'Reddit'], ['other', 'Somewhere else'],
];

export function mountFoundVia(anchor, joinedAt) {
  if (!anchor || !joinedAt) return;
  const joined = Date.parse(String(joinedAt).replace(' ', 'T') + (/[zZ+]/.test(String(joinedAt)) ? '' : 'Z'));
  if (!(joined > Date.now() - 14 * DAY)) return;
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }

  const card = document.createElement('div');
  card.className = 'found-via';
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Where did you hear about Herae?');
  card.innerHTML = `
    <div class="found-via-q"><strong>Quick one:</strong> where did you first hear about Herae?</div>
    <div class="found-via-chips">${CHOICES.map(([v, t]) => `<button type="button" class="found-via-chip" data-v="${v}">${t}</button>`).join('')}</div>
    <button type="button" class="found-via-skip">Skip</button>`;
  const done = (v) => { try { localStorage.setItem(KEY, v || 'skipped'); } catch (e) { /* ignore */ } };
  card.addEventListener('click', (e) => {
    const chip = e.target.closest('.found-via-chip');
    if (chip) {
      done(chip.dataset.v);
      try { if (typeof trackEvent === 'function') trackEvent('found_via', { channel: chip.dataset.v }); } catch (err) { /* never block */ }
      card.innerHTML = '<div class="found-via-q">Thank you, that helps us find more couples like you.</div>';
      setTimeout(() => card.remove(), 2500);
    } else if (e.target.closest('.found-via-skip')) { done(null); card.remove(); }
  });
  anchor.after(card);
}
