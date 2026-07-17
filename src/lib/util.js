// util.js — small helpers shared by every component/page module. Ported
// from the old postcard.js (same behavior), just as ES exports instead of
// globals, since everything under src/ is bundled by Vite as real modules.
'use strict';

export function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

export function initials(name) {
  return (name || '?').charAt(0).toUpperCase();
}

export function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString.replace(' ', 'T') + (isoString.includes('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Relative "3h ago"/"2d ago" framing for feed cards — falls back to
// formatDate once it's far enough in the past that a relative label stops
// being useful at a glance.
export function formatRelative(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString.replace(' ', 'T') + (isoString.includes('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return isoString;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(isoString);
}

export function formatDuration(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Full-screen click-to-zoom, shared by every card that shows an image at
// less than full size.
export function openLightbox(imageUrl) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  const img = document.createElement('img');
  img.src = imageUrl;
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); }
  });
  document.body.appendChild(overlay);
}

// What to call a session on screen. The optional title its participants
// gave it (see the review page) wins; otherwise it falls back to the title
// scraped from whatever was being watched, exactly as before this field
// existed — so untitled and pre-existing sessions read identically to how
// they always have. One helper so every surface agrees.
export function sessionDisplayTitle(session, fallback = 'Something you watched together') {
  return session?.sessionTitle || session?.content?.title || fallback;
}

// Turns any `<a data-back href="…">` into a real Back button: it steps back
// through history when the previous page was somewhere on this site, and
// otherwise falls back to the href it already carries.
//
// The href stays the destination-of-last-resort rather than the always-
// destination, which is the bug this fixes: a post opened from a profile
// (or from search) sent you to the feed instead of back where you were.
// cameFromThisSite() (api.js) is what makes it safe — a post.html opened
// cold from the extension or a shared link has no in-site history to step
// back to, so it still lands on the href.
export function initBackLinks(root = document) {
  root.querySelectorAll('a[data-back]').forEach((link) => {
    link.addEventListener('click', (e) => {
      if (!window.cameFromThisSite?.()) return; // let the href do its job
      e.preventDefault();
      history.back();
    });
  });
}

// Debounce for the search box — fires `fn` `wait`ms after the last call.
export function debounce(fn, wait = 250) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
