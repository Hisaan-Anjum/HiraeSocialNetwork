// avatar.js — one person's face, everywhere one appears: feed card heads,
// review authors, comment lines, contact rows, the profile header, and the
// search overlay. One function so a picture and its no-picture fallback can
// never drift apart between surfaces.
//
// No picture set (avatarUrl null — the default for every account that hasn't
// uploaded one) renders the SAME gradient initial the site has always shown,
// so this is purely additive: nothing looks different until someone actually
// uploads something.
'use strict';

import { escapeHtml, initials } from '../lib/util.js';

const { mediaUrl } = window;

// `person` is { username, avatarUrl } — the shape every endpoint now
// returns for a named person (contacts rows, review authors, comments,
// participantAvatars). `opts.size` maps to a CSS class, not an inline
// width, so sizing stays in style.css with the rest of the design.
export function renderAvatar(person, opts = {}) {
  const username = person?.username || '';
  const url = person?.avatarUrl ? mediaUrl(person.avatarUrl) : null;
  const size = opts.size || 'md'; // sm | md | lg | xl
  const cls = `avatar avatar-${size} ${opts.className || ''}`.trim();
  if (!url) {
    return `<div class="${cls}" aria-hidden="true">${escapeHtml(initials(username))}</div>`;
  }
  // loading=lazy + decoding=async: a long feed of faces costs nothing until
  // those cards are actually scrolled near. The initial stays underneath as
  // the background so a slow/failed image never flashes an empty circle —
  // see watchAvatarLoading below, which is what makes that actually true.
  return `
    <div class="${cls}" aria-hidden="true">
      <span class="avatar-initial">${escapeHtml(initials(username))}</span>
      <img class="avatar-img" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async">
    </div>`;
}

// ── Why this exists ─────────────────────────────────────────────────
// Avatars are rendered as HTML strings from a dozen call sites, so there is
// no element to attach a handler to at the moment one is created — and the
// site's CSP rules out inline onload/onerror. A single delegated listener in
// the CAPTURE phase catches both events for every avatar on the page, present
// and future, including ones injected long after this runs.
//
// (`error` and `load` do not bubble, which is why this must capture rather
// than listen normally. That subtlety is the reason the naive version of this
// fix silently does nothing.)
//
// The failure it removes: an image that 404s, or is still in flight, used to
// paint an opaque backdrop over the gradient initial — so a perfectly good
// fallback was hidden behind an empty circle. Intermittent, because it
// depended entirely on cache state and network timing, which is exactly why
// it was hard to pin down.
let watching = false;
export function watchAvatarLoading(root = document) {
  if (watching) return;
  watching = true;
  const mark = (event, cls) => {
    const img = event.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('avatar-img')) return;
    img.classList.add(cls);
  };
  root.addEventListener('load', (e) => mark(e, 'is-loaded'), true);
  root.addEventListener('error', (e) => mark(e, 'is-failed'), true);
  // An image already complete before the listener existed (a warm cache, a
  // render that happened earlier in the same tick) never fires either event.
  // Reconciling on the next frame covers it, and a MutationObserver keeps
  // doing so for everything rendered afterwards.
  const reconcile = () => {
    for (const img of root.querySelectorAll('.avatar-img:not(.is-loaded):not(.is-failed)')) {
      if (!img.complete) continue;
      img.classList.add(img.naturalWidth > 0 ? 'is-loaded' : 'is-failed');
    }
  };
  requestAnimationFrame(reconcile);
  new MutationObserver(reconcile).observe(root.body || root, { childList: true, subtree: true });
}

// The same avatar, wrapped in a link to that person's profile — the common
// case in a card head or a comment line.
export function renderAvatarLink(person, opts = {}) {
  const username = person?.username || '';
  if (!username) return renderAvatar(person, opts);
  return `<a class="avatar-link" href="${profileHref(username)}" title="${escapeHtml(username)}">${renderAvatar(person, opts)}</a>`;
}

// Self-installing, deliberately. Every page that can show a face imports this
// module, so there is no page where the watcher is needed and absent — and no
// eleven call sites to remember to update when a twelfth appears.
if (typeof document !== 'undefined') {
  if (document.body) watchAvatarLoading();
  else document.addEventListener('DOMContentLoaded', () => watchAvatarLoading(), { once: true });
}

// The one place the profile URL is spelled out — imported by userLink.js and
// anything else that links to a person, so the route can move without a
// site-wide find/replace.
export function profileHref(username) {
  return `user.html?u=${encodeURIComponent(username)}`;
}
