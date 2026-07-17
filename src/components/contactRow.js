// contactRow.js — one person in a contacts list: picture, username,
// presence, and whatever actions apply to them. Shared by the contacts page
// and the search overlay so a contact looks and behaves identically in both.
//
// The extension popup's contacts tab renders the same markup and mirrors
// this file's classes against overlay-matched styles — the two lists are
// meant to read as one product, so this is the shape both follow.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { renderAvatar, profileHref } from './avatar.js';
import { renderUserLink } from './userLink.js';

// `opts.actions` is HTML for the right-hand side (accept/decline/remove);
// with none, the whole row is a link to the profile — the plain
// "browse my contacts" case.
export function renderContactRow(c, opts = {}) {
  const status = opts.statusText !== undefined
    ? opts.statusText
    : (c.online ? '● Online' : 'Offline');
  const statusCls = opts.statusClass || (c.online ? 'contact-online' : '');

  const inner = `
    ${renderAvatar(c, { size: 'md', className: 'contact-avatar' })}
    <div class="contact-info">
      <div class="contact-name">${opts.actions ? renderUserLink(c.username) : escapeHtml(c.username)}</div>
      <div class="contact-status ${statusCls}">${escapeHtml(status)}</div>
    </div>
    ${opts.actions || '<div class="contact-arrow">→</div>'}`;

  // With actions present the row can't itself be an <a> — a button inside a
  // link is both invalid and unclickable-feeling — so the username inside
  // becomes the link instead.
  return opts.actions
    ? `<div class="contact-row" data-username="${escapeHtml(c.username)}" data-id="${c.id}">${inner}</div>`
    : `<a class="contact-row" href="${profileHref(c.username)}" data-username="${escapeHtml(c.username)}" data-id="${c.id}">${inner}</a>`;
}
