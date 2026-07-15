// index.js — index.html (the landing page) only. If you're already logged
// in (including via the extension's auto-login, which runs before this),
// skip the marketing pitch and go straight to the feed.
'use strict';

if (getAuth()) {
  window.location.href = 'memories.html';
}
