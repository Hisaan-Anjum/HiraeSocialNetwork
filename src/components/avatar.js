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
  // the background so a slow/failed image never flashes an empty circle.
  return `
    <div class="${cls}" aria-hidden="true">
      <span class="avatar-initial">${escapeHtml(initials(username))}</span>
      <img class="avatar-img" src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async">
    </div>`;
}

// The same avatar, wrapped in a link to that person's profile — the common
// case in a card head or a comment line.
export function renderAvatarLink(person, opts = {}) {
  const username = person?.username || '';
  if (!username) return renderAvatar(person, opts);
  return `<a class="avatar-link" href="${profileHref(username)}" title="${escapeHtml(username)}">${renderAvatar(person, opts)}</a>`;
}

// The one place the profile URL is spelled out — imported by userLink.js and
// anything else that links to a person, so the route can move without a
// site-wide find/replace.
export function profileHref(username) {
  return `user.html?u=${encodeURIComponent(username)}`;
}
