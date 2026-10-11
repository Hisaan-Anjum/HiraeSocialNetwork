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
import { mountPlanNext } from './planNext.js';

const STORE_URL = 'https://chromewebstore.google.com/detail/kadhimjoddiaenogicbdnejoabdiimgn?utm_source=get_started';
const HIDE_KEY = 'herae_get_started_hidden';

// Same handshake invite.html and api.js use: the content script answers a
// __heraePing with __heraeExtension. Silence within the window means no install.
// The content script can attach a moment after the page loads, so ping a few times over two seconds; a single
// 0.7 s ping told people who had just installed Herae to "Add Herae to Chrome" (journey test 2026-10-01).
function detectExtension(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let done = false;
    const onMsg = (e) => {
      if (e.source !== window || !e.data || e.data.__heraeExtension !== true) return;
      finish(true);
    };
    const finish = (v) => { if (done) return; done = true; window.removeEventListener('message', onMsg); resolve(v); };
    window.addEventListener('message', onMsg);
    const ping = () => { try { window.postMessage({ __heraePing: true }, location.origin); } catch (e) { /* ignore */ } };
    ping(); setTimeout(ping, 400); setTimeout(ping, 900); setTimeout(ping, 1500);
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

  // On a phone the store can't install anything: say so, and src-tag.js turns the button into "send it to my laptop"
  // (2026-10-11: 8 of 10 site sign-ups never used the extension).
  const onPhone = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (window.matchMedia && matchMedia('(pointer: coarse)').matches && window.innerWidth < 900);
  const installBody = hasExtension
    ? `<p class="gs-text">Herae is installed in this browser.</p>`
    : onPhone
      ? `<p class="gs-text">Your account is ready. Herae runs in Chrome on a computer, so send yourself the link and add it on your laptop. It takes a minute.</p>
       <a class="btn btn-gold gs-cta" href="${STORE_URL}" target="_blank" rel="noopener">Send it to my laptop</a>`
      : `<p class="gs-text">Herae runs inside Chrome, beside whatever you're watching. It takes about a minute.</p>
       <a class="btn btn-gold gs-cta" href="${STORE_URL}" target="_blank" rel="noopener">Add to Chrome — free</a>`;

  // One tap to send it the way they already talk (2026-10-01: "even a non-tech user should be able to do it").
  const shareText = invite ? `Watch a film with me? Open this on your laptop in Chrome, it's free and you don't need an account: ${invite.url}` : '';
  const inviteBody = invite
    ? `<p class="gs-text">Send them this link however you normally talk. They'll add Herae too, but they don't need an account.</p>
       <div class="gs-share">
         <a class="btn btn-gold gs-share-btn" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener">Send on WhatsApp</a>
         <a class="btn btn-ghost gs-share-btn" href="mailto:?subject=${encodeURIComponent('Movie night?')}&body=${encodeURIComponent(shareText)}">Email it</a>
         <button type="button" class="btn btn-ghost gs-share-btn gs-native" hidden>Share…</button>
       </div>
       <div class="gs-link-row">
         <code class="gs-link">${escapeHtml(invite.url)}</code>
         <button type="button" class="btn btn-ghost gs-copy">Copy link</button>
       </div>
       <form class="gs-email" novalidate>
         <label class="gs-email-label" for="gsEmail">Or let Herae email them the setup</label>
         <div class="gs-email-row">
           <input id="gsEmail" class="gs-email-input" type="email" inputmode="email" autocomplete="off" placeholder="their email address" maxlength="254">
           <button type="submit" class="btn btn-ghost gs-email-send">Send</button>
         </div>
         <div class="gs-email-msg" aria-live="polite"></div>
       </form>`
    : `<p class="gs-text">Open Herae from your Chrome toolbar and use <b>Invite</b> to get a link to send them.</p>`;

  const watchBody = `<p class="gs-text">When they open your link, Herae connects the two of you by itself. Then open a film on
       Netflix, YouTube or whatever you normally use and press play: play, pause and skipping stay in step for both of
       you, with a video call right there. (If it ever doesn't connect, click the Herae icon at the top right of Chrome,
       it may be inside the puzzle-piece menu, and press <b>Connect</b> next to their name.)</p>
       <div class="gs-plan-anchor"></div>`;

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

  const native = el.querySelector('.gs-native');
  if (native && navigator.share) {
    native.hidden = false;
    native.addEventListener('click', () => navigator.share({ text: shareText }).catch(() => {}));
  }
  const copyBtn = el.querySelector('.gs-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(invite.url);
      copyBtn.textContent = ok ? '✓ Copied' : 'Press Ctrl+C';
      setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1800);
    });
  }
  // Connected but no night yet → pick the evening now (PMF.md 2026-10-05: "we haven't had a free evening yet").
  // Same card as after a night, in its first-night mode; best-effort, the steps above work without it.
  const planAnchor = el.querySelector('.gs-plan-anchor');
  if (planAnchor && window.getContacts) {
    window.getContacts().then((r) => {
      const partner = ((r && r.contacts) || [])[0];
      if (partner && partner.username) mountPlanNext(planAnchor, { partner: partner.username, via: 'first', shareLink: invite && invite.url });
    }).catch(() => {});
  }
  // "Let Herae email them" (server/src/partner-invite-email.js, PMF.md 2026-10-04): the inviter stops being the
  // middleman — Herae sends the three steps, plus one reminder a day later if they haven't joined.
  const emailForm = el.querySelector('.gs-email');
  if (emailForm) {
    emailForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = emailForm.querySelector('.gs-email-input');
      const btn = emailForm.querySelector('.gs-email-send');
      const msg = emailForm.querySelector('.gs-email-msg');
      const addr = input.value.trim();
      if (!addr) { msg.textContent = 'Type their email address first.'; input.focus(); return; }
      btn.disabled = true; msg.textContent = 'Sending…';
      try {
        await window.apiRequest('/api/invite/email', { method: 'POST', body: JSON.stringify({ email: addr }) });
        msg.textContent = `Sent. ${addr} will get the three steps from Herae, and one reminder tomorrow if they haven't joined yet.`;
        input.value = '';
      } catch (e) {
        msg.textContent = (e && e.message) || 'Could not send it. Try again, or send them your link above.';
      }
      btn.disabled = false;
    });
  }
  el.querySelector('.gs-hide').addEventListener('click', () => {
    try { localStorage.setItem(HIDE_KEY, '1'); } catch (e) { /* ignore */ }
    el.hidden = true;
  });
}
