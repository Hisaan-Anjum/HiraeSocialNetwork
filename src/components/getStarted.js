// getStarted.js — the "what do I do now" card for an account that has never
// had a watch session. Signing up on the website used to land people on a feed
// of other people's memories with no mention of the extension or of their
// partner; most of them never did anything else. The three steps here are the
// only three that stand between a new account and a first night together.
//
// Shown only while the account has zero sessions, so it disappears on its own
// once it has done its job. Everything in it is best-effort: if the invite
// request fails the step still says what to do, it just has no link to copy.
'use strict';

import { escapeHtml } from '../lib/util.js';

const STORE_URL = 'https://chromewebstore.google.com/detail/kadhimjoddiaenogicbdnejoabdiimgn?utm_source=get_started';
const HIDE_KEY = 'herae_get_started_hidden';

// Same handshake invite.html and api.js use: the content script answers a
// __heraePing with __heraeExtension. Silence within the window means no install.
function detectExtension(timeoutMs = 700) {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e) => {
      if (e.source !== window || !e.data || e.data.__heraeExtension !== true) return;
      finish(true);
    };
    const finish = (v) => { if (done) return; done = true; window.removeEventListener('message', onMsg); resolve(v); };
    window.addEventListener('message', onMsg);
    try { window.postMessage({ __heraePing: true }, location.origin); } catch (e) { /* ignore */ }
    setTimeout(() => finish(false), timeoutMs);
  });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e2) { return false; }
  }
}

function step(n, done, title, body) {
  return `
    <li class="gs-step${done ? ' is-done' : ''}">
      <span class="gs-num" aria-hidden="true">${done ? '✓' : n}</span>
      <div class="gs-body">
        <div class="gs-title">${title}</div>
        ${body}
      </div>
    </li>`;
}

export async function mountGetStarted(el) {
  if (!el) return;
  try { if (localStorage.getItem(HIDE_KEY) === '1') return; } catch (e) { /* private mode */ }

  const [hasExtension, invite] = await Promise.all([
    detectExtension(),
    window.getMyInvite().catch(() => null),
  ]);
  const invited = !!(invite && invite.invitedCount > 0);

  const installBody = hasExtension
    ? `<p class="gs-text">Herae is installed in this browser.</p>`
    : `<p class="gs-text">Herae runs inside Chrome, beside whatever you're watching. It takes about a minute.</p>
       <a class="btn btn-gold gs-cta" href="${STORE_URL}" target="_blank" rel="noopener">Add to Chrome — free</a>`;

  const inviteBody = invite
    ? `<p class="gs-text">Send them this link however you normally talk. They'll add Herae too, but they don't need an account.</p>
       <div class="gs-link-row">
         <code class="gs-link">${escapeHtml(invite.url)}</code>
         <button type="button" class="btn btn-ghost gs-copy">Copy</button>
       </div>`
    : `<p class="gs-text">Open Herae from your Chrome toolbar and use <b>Invite</b> to get a link to send them.</p>`;

  const watchBody = `<p class="gs-text">When you're both free, click the Herae icon in your Chrome toolbar
       (it may be under the puzzle-piece icon) and press <b>Connect</b> next to their name. Then open a film on
       the site you normally use. Play, pause and skipping stay in step for both of you, and you can video or
       voice call without leaving the tab.</p>`;

  el.innerHTML = `
    <section class="gs-card" aria-labelledby="gsHeading">
      <div class="gs-head">
        <h2 id="gsHeading">Your first night together, in three steps</h2>
        <button type="button" class="gs-hide" title="Hide this">Hide</button>
      </div>
      <ol class="gs-steps">
        ${step(1, hasExtension, 'Add Herae to Chrome', installBody)}
        ${step(2, invited, 'Send your partner your link', inviteBody)}
        ${step(3, false, 'Press play together', watchBody)}
      </ol>
    </section>`;
  el.hidden = false;

  const copyBtn = el.querySelector('.gs-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(invite.url);
      copyBtn.textContent = ok ? '✓ Copied' : 'Press Ctrl+C';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
    });
  }
  el.querySelector('.gs-hide').addEventListener('click', () => {
    try { localStorage.setItem(HIDE_KEY, '1'); } catch (e) { /* ignore */ }
    el.hidden = true;
  });
}
