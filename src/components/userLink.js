// userLink.js — a username, rendered as a link to that person's profile.
// Every username the site prints goes through here (card heads, review
// authors, comment authors, participant lists, contact rows, search
// results), so "usernames are clickable" is one function rather than a
// convention each surface has to remember.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { profileHref } from './avatar.js';

export function renderUserLink(username, opts = {}) {
  if (!username) return '';
  const cls = `user-link ${opts.className || ''}`.trim();
  return `<a class="${cls}" href="${profileHref(username)}">${escapeHtml(username)}</a>`;
}

// A participant list ("alice & bob") with every name individually
// clickable — the join separator stays plain text between the links, so it
// reads exactly as it did before, just live.
export function renderUserLinks(usernames, opts = {}) {
  const sep = opts.separator || ' & ';
  if (!usernames || !usernames.length) return '';
  return usernames.map((u) => renderUserLink(u, opts)).join(escapeHtml(sep));
}
