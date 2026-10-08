// watchLink.js — "Watch something together now": paste a movie / video link, pick your person, press Watch together.
//
// From a real customer (CUSTOMER_TALKS.md 2026-10-08, Jana): "I wanted to copy the link of the movie from Chrome,
// paste it in the app and watch it with my partner. When I didn't see that feature I didn't use the app." Herae could
// always do it — start on the page, the partner follows — but nothing SAID so. This box is the thing she looked for.
// It uses the same extension hand-off as the watchlist's "Watch now" (handOffToExtension → __heraeStartSession: the
// extension opens the link, starts the night and invites the partner). Shown to anyone with at least one contact.
import { escapeHtml } from '../lib/util.js';
import { handOffToExtension } from '../watchlist/panel.js';

export async function mountWatchLink(anchor) {
  if (!anchor || !window.getContacts) return null;
  let contacts = [];
  try { contacts = ((await window.getContacts()) || {}).contacts || []; } catch (e) { return null; }
  if (!contacts.length) return null;
  const track = (result) => { try { window.trackEvent && window.trackEvent('watch_link_start', { result }); } catch (e) { /* best-effort */ } };
  const box = document.createElement('section');
  box.className = 'watch-link';
  const pick = contacts.length > 1
    ? `<select class="watch-link-who" aria-label="Who to watch with">${contacts.map((c) => `<option value="${escapeHtml(c.username)}">${escapeHtml(c.username)}</option>`).join('')}</select>`
    : `<input type="hidden" class="watch-link-who" value="${escapeHtml(contacts[0].username)}">`;
  box.innerHTML = `
    <div class="watch-link-title">🍿 Watch something together now</div>
    <div class="watch-link-sub">Paste the link to the movie or video (Netflix, Prime Video, YouTube or almost any site)${contacts.length > 1 ? ' and pick who to watch with' : ` and we'll invite ${escapeHtml(contacts[0].username)}`}. Herae opens it, keeps you both in sync, and puts your call beside it.</div>
    <form class="watch-link-row" novalidate>
      <input type="url" class="watch-link-url" placeholder="https://… paste the movie link" aria-label="Movie or video link" required>
      ${pick}
      <button type="submit" class="btn btn-gold">Watch together</button>
    </form>
    <div class="watch-link-note" role="status"></div>`;
  anchor.after(box);
  const note = box.querySelector('.watch-link-note');
  box.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = box.querySelector('.watch-link-url').value.trim();
    const who = box.querySelector('.watch-link-who').value;
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) { note.textContent = 'Paste the full link, starting with https://'; return; }
    const btn = box.querySelector('button'); btn.disabled = true; note.textContent = 'Opening it…';
    const r = await handOffToExtension(url, who, { timeoutMs: 1500 });
    btn.disabled = false;
    if (!r.handled) {
      track('no_extension');
      note.innerHTML = 'Herae isn\'t running in this browser. Open this page in Chrome on the computer where you added Herae, or <a href="https://chromewebstore.google.com/detail/kadhimjoddiaenogicbdnejoabdiimgn?utm_source=watch-link" target="_blank" rel="noopener">add it to Chrome</a>.';
      return;
    }
    if (r.busy) { track('busy'); note.textContent = 'You\'re already in a movie night with someone else. Finish it first, then try again.'; return; }
    if (r.error) { track('error'); note.textContent = 'That didn\'t start: ' + r.error; return; }
    track('ok');
    note.textContent = `Opened. ${who} gets your invite; when they join, Herae takes them to the same page.`;
  });
  return box;
}
