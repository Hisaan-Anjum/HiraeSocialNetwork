// post.js — post.html only. A single moment or a single review, reached
// via ?type=moment&id=X or ?type=review&id=Y (every card/carousel/review
// link across the site points here).
'use strict';

import { escapeHtml, formatDate, initBackLinks } from '../lib/util.js';
import { renderEmptyState, renderErrorState } from '../components/skeleton.js';
import { renderMomentCard, attachMomentCardHandlers } from '../components/momentCard.js';
import { renderReactionRow, attachReactionHandlers } from '../components/reactions.js';
import { attachMediaTileHandlers } from '../components/mediaTile.js';
import { renderMediaTile } from '../components/mediaTile.js';
import { renderUserLink, renderUserLinks } from '../components/userLink.js';
import { renderAvatarLink } from '../components/avatar.js';
import { attachPostActionHandlers, renderPostMenu, renderReviewBody } from '../components/postActions.js';
import { registerSessionForPanel, momentViewerOpts } from '../components/momentPanel.js';

const { requireAuth, getAuth, whenExtensionMaybeSignsIn, logout, getMomentById, getReviewById } = window;

// Signed out is not the same as not allowed: a moment its owners made public
// has a shareable link, and the person it was sent to usually has no account.
// They used to be sent to login (and from /post/<id>, to a 404). A public
// moment now shows what its chat preview already shows publicly; anything
// else still goes through requireAuth() exactly as before.
const auth = getAuth();

function getParams() {
  const params = new URLSearchParams(window.location.search);
  // Two URL shapes reach this page. /post/<id> is the shareable one — the
  // server injects that moment's Open Graph tags at that path, so a link
  // pasted into a chat previews as the memory itself (server/src/og.js).
  // /post.html?id=<id> is what every link shared before then looks like, and
  // what the in-app cards still use. Both must work, forever: a shared link is
  // permanent and lives in other people's message histories.
  const fromPath = window.location.pathname.match(/^\/post\/(\d+)\/?$/);
  const id = params.get('id') || (fromPath ? fromPath[1] : null);
  return { type: params.get('type') === 'review' ? 'review' : 'moment', id };
}

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  const content = document.getElementById('content');
  initBackLinks();
  attachReactionHandlers(content);
  attachMomentCardHandlers(content);
  attachMediaTileHandlers(content, { viewerOptsFor: momentViewerOpts });
  // Deleting the very thing this page exists to show can't just remove the
  // card — that would leave a blank page — so this page overrides the
  // default removal and navigates back to the feed instead.
  attachPostActionHandlers(content, {
    onDeleted: () => { window.location.href = '/memories.html'; },
  });
  load();
} else {
  rememberReferral();
  showPublicOrLogin();
}

// A shared moment link carries the sharer's referral code (?r=CODE, see
// shareSheet.js). Kept the same way /r/<CODE> keeps it (ref.html): api.js
// claims it on the first signed-in page, so a couple who signs up later, in
// the extension, is still credited to the two people who shared this.
function rememberReferral() {
  const code = new URLSearchParams(location.search).get('r');
  if (!/^[0-9A-F]{7}$/.test(code || '')) return;
  try {
    if (!localStorage.getItem('herae_ref')) localStorage.setItem('herae_ref', JSON.stringify({ code, at: Date.now() }));
    if (!localStorage.getItem('herae_first_touch')) localStorage.setItem('herae_first_touch', 'utm:shared-moment');
  } catch (e) { /* storage blocked: the visit still counts below */ }
}

// Sent from the page after it ran, so chat-preview crawlers and link scanners
// (which fetch /post/<id> but run no script) are not counted as visitors.
function countVisit(isPublic) {
  const r = new URLSearchParams(location.search).get('r') || '';
  fetch('/api/moment-visit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public: isPublic, r }), keepalive: true,
  }).catch(() => {});
}

const STORE_URL = 'https://chromewebstore.google.com/detail/kadhimjoddiaenogicbdnejoabdiimgn?utm_source=shared-moment';

async function showPublicOrLogin() {
  const { type, id } = getParams();
  let pub = null;
  if (type === 'moment' && id) {
    try {
      const r = await fetch(`/og/moment/${encodeURIComponent(id)}.json`);
      if (r.ok) pub = await r.json();
    } catch (e) { /* treat as not public */ }
  }
  countVisit(!!pub);
  if (!pub) {
    // Private (or deleted): a visitor without an account used to land on a bare
    // login page. Say what this is and offer Herae; owners can still log in.
    if (id) renderPrivate(); else requireAuth();
    whenExtensionMaybeSignsIn(() => window.location.reload(), () => {});
    return;
  }
  renderPublic(pub);
  // Someone who has the extension is signed in there even when this site
  // isn't yet; when the mirror lands, give them the full page.
  whenExtensionMaybeSignsIn(() => window.location.reload(), () => {});
}

function renderPublic(pub) {
  for (const sel of ['.nav-links', '.topbar-right', '[data-back]']) {
    const node = document.querySelector(sel);
    if (node) node.style.display = 'none';
  }
  document.title = `${pub.title} — Herae`;
  const media = pub.videoUrl
    ? `<video src="${escapeHtml(pub.videoUrl)}" ${pub.image ? `poster="${escapeHtml(pub.image)}"` : ''} controls playsinline muted autoplay loop style="width:100%;display:block;border-radius:14px;background:#000"></video>`
    : null;
  const image = media || (pub.image
    ? `<div style="position:relative"><img src="${escapeHtml(pub.image)}" alt="${escapeHtml(pub.title)}" style="width:100%;display:block;border-radius:14px">
       ${pub.isVideo ? '<span style="position:absolute;left:12px;bottom:12px;background:rgba(0,0,0,.6);color:#fff;font-size:12.5px;padding:4px 10px;border-radius:999px">▶ Video moment</span>' : ''}</div>`
    : '');
  sessionStorage.setItem('moments_return_to', location.pathname + location.search);
  document.getElementById('content').innerHTML = `
    <div class="post-detail-card">
      ${image}
      <div class="moment-body">
        <div style="font-weight:800;font-size:18px;margin-bottom:6px">${escapeHtml(pub.title)}</div>
        <div style="color:var(--ink-dim);font-size:14px">${escapeHtml(pub.description)}</div>
      </div>
    </div>
    ${visitorCta('Watch together, however far apart')}`;
}

function renderPrivate() {
  for (const sel of ['.nav-links', '.topbar-right', '[data-back]']) {
    const node = document.querySelector(sel);
    if (node) node.style.display = 'none';
  }
  sessionStorage.setItem('moments_return_to', location.pathname + location.search);
  document.getElementById('content').innerHTML = `
    <div class="post-detail-card"><div class="moment-body">
      <div style="font-weight:800;font-size:18px;margin-bottom:6px">This moment is just for the two people in it</div>
      <div style="color:var(--ink-dim);font-size:14px;line-height:1.55">It's from a night two people spent watching a film together on Herae. If it's yours, log in to see it.</div>
    </div></div>
    ${visitorCta('Make your own nights like this')}`;
}

// What a visitor who isn't on Herae needs: what it is, and the next step on
// whichever device they're holding. Herae runs in Chrome on a computer, and most
// shared links are opened on phones, so phones get "email me the link" (the
// same handoff as the landing page, handoff.js) instead of a dead store link.
function visitorCta(heading) {
  const phone = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return `
    <div style="margin-top:18px;border:1px solid rgba(139,92,246,.45);background:rgba(139,92,246,.08);border-radius:16px;padding:18px">
      <div style="font-weight:800;margin-bottom:6px">${escapeHtml(heading)}</div>
      <div style="color:var(--ink-dim);font-size:14px;line-height:1.55">Herae plays the same film for two people at the same second, on Netflix, Prime Video, YouTube and almost any site, with a video call beside it. It catches your best moments too. Free on Chrome.</div>
      ${phone ? `
        <form id="handoffForm" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <input type="email" required placeholder="Your email" aria-label="Your email" id="handoffEmail" style="flex:1 1 180px;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.05);color:var(--ink)">
          <button class="btn btn-primary" type="submit">Email me the link</button>
        </form>
        <div id="handoffMsg" style="font-size:13px;color:var(--ink-dim);margin-top:8px">Herae runs on a computer. We'll send the link once, so it's waiting on your laptop.</div>`
      : `<a class="btn btn-primary" href="${STORE_URL}" target="_blank" rel="noopener" style="margin-top:12px;display:inline-flex">Try Herae — free</a>`}
      <a class="btn btn-ghost" href="/login.html" style="margin-top:12px;${phone ? '' : 'margin-left:8px;'}display:inline-flex">Log in</a>
    </div>`;
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'handoffForm') return;
  e.preventDefault();
  const msg = document.getElementById('handoffMsg');
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const r = await fetch('/api/handoff', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('handoffEmail').value.trim(),
        src: 'shared-moment',
        ref: new URLSearchParams(location.search).get('r') || undefined,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || 'Could not send it. Try again.');
    msg.textContent = 'Sent. Open it on your computer 💜';
    msg.style.color = '#86efac';
  } catch (err) {
    btn.disabled = false;
    msg.textContent = err.message;
    msg.style.color = '#fca5a5';
  }
});

async function load() {
  const contentEl = document.getElementById('content');
  const { type, id } = getParams();
  if (!id) {
    contentEl.innerHTML = renderEmptyState('🤔', 'No post specified.');
    return;
  }

  try {
    if (type === 'review') {
      const { review, moment } = await getReviewById(id);
      if (moment) {
        registerSessionForPanel({
          clientSessionId: moment.clientSessionId, sessionTitle: moment.sessionTitle || null,
          content: moment.content, moments: [moment], reviews: moment.reviews || [],
        });
      }
      // `moment` is deliberately nullable here — GET /api/reviews/:id
      // returns the review alone when none of its session's moments pass
      // the per-moment privacy check (the accompanying photo is only
      // illustrative context; see that route's comment). Every use of it
      // below is guarded accordingly.
      contentEl.innerHTML = `
        <div class="post-detail-card">
          ${moment ? renderMediaTile(moment, { className: 'post-detail-media' }) : ''}
          <div class="moment-body">
            ${moment ? `
              <div class="moment-meta">
                <span class="moment-people">${renderUserLinks(moment.participants)}</span>
                <span class="moment-date">${formatDate(moment.createdAt)}</span>
              </div>` : ''}
            <div class="review-block">
              <div class="review-head-row">
                ${renderAvatarLink({ username: review.username, avatarUrl: review.avatarUrl }, { size: 'sm' })}
                <span class="review-author">${renderUserLink(review.username)}</span>
                <span class="moment-date">${formatDate(review.createdAt)}</span>
                ${renderPostMenu('review', review.id, review.canEdit)}
              </div>
              ${renderReviewBody(review)}
              ${renderReactionRow('review', review.id, review.likes, review.comments)}
            </div>
            ${moment ? `
              <div style="text-align:center;margin-top:18px">
                <a class="btn btn-ghost" href="post.html?type=moment&id=${moment.id}">See the full moment →</a>
              </div>` : ''}
          </div>
        </div>
      `;
    } else {
      const { moment } = await getMomentById(id);
      registerSessionForPanel({
        clientSessionId: moment.clientSessionId, sessionTitle: moment.sessionTitle || null,
        content: moment.content, moments: [moment], reviews: moment.reviews || [],
      });
      contentEl.innerHTML = renderMomentCard(moment, { detail: true, showPrivacyControl: moment.isMine });
    }
  } catch (err) {
    contentEl.innerHTML = renderErrorState(escapeHtml(err.message));
  }
}
