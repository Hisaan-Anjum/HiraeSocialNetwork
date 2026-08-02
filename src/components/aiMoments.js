// aiMoments.js — the review page's AI Moments panel.
//
// These moments are not on the server and deliberately never were. They were
// found on the watcher's own machine, by their own machine, and they live in
// the extension until the person decides one is worth keeping. So this
// component talks to the extension over the same window.postMessage bridge
// the invite and watchlist flows already use, rather than to the API.
//
// The shape of the review follows from that. Every card can be looked at
// immediately (the poster still came across with the list), played on demand
// (the clip is fetched only when asked for), kept (the extension uploads it —
// the bytes never touch this page), or deleted. Anything still sitting here
// when the page is finished with is discarded for good, which is the promise
// made at the moment of capture and the reason this can be a calm decision
// rather than an anxious one.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { openMediaViewer } from './mediaViewer.js';

const ASK_TIMEOUT_MS = 20000;

// One request/response over the bridge. Mirrors api.js's askExtension pattern
// on the invite page — same reason it exists there: without an ack the page
// cannot tell "the extension handled it" from "there is no extension", and
// would have to guess on a timer.
function askExtension(message, ackKey, matcher) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (e) => {
      if (e.source !== window || !e.data || e.data[ackKey] !== true) return;
      if (matcher && !matcher(e.data)) return;
      done(e.data);
    };
    window.addEventListener('message', onMessage);
    const timer = setTimeout(() => done(null), ASK_TIMEOUT_MS);
    window.postMessage(message, window.location.origin);
  });
}

let requestSeq = 0;
function nextRequestId() { return `air_${Date.now().toString(36)}_${(requestSeq += 1).toString(36)}`; }

function formatDuration(ms) {
  const s = Math.max(1, Math.round((ms || 0) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatClock(at) {
  try {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

function cardHtml(moment) {
  // Duration, timestamp, thumbnail, play, keep, delete — the amendment's
  // exact list, in the order somebody actually reads them. Confidence and
  // rank stay internal: they order this list and are never shown, because a
  // number next to a memory invites arguing with it.
  return `
    <div class="aim-card" data-aim-id="${escapeHtml(moment.id)}">
      <div class="aim-thumb" role="button" tabindex="0"
           aria-label="${escapeHtml(moment.label)} — ${moment.hasVideo ? 'play full screen' : 'view full screen'}">
        ${moment.poster
          ? `<img src="${escapeHtml(moment.poster)}" alt="${escapeHtml(moment.label)}" loading="lazy">`
          : '<div class="aim-thumb-empty">✨</div>'}
        ${moment.hasVideo ? `
          <span class="aim-play" aria-hidden="true"><span class="aim-play-glyph">▶</span></span>
          <span class="aim-duration aim-duration-video">
            <span class="aim-duration-icon" aria-hidden="true">▶</span>${escapeHtml(formatDuration(moment.durationMs))}
          </span>` : '<span class="aim-duration">Photo</span>'}
      </div>
      <div class="aim-body">
        <div class="aim-title">
          ${escapeHtml(moment.label)}
          ${moment.synced ? '<span class="aim-badge" title="You both reacted at the same time">together</span>' : ''}
        </div>
        <div class="aim-when">${escapeHtml(formatClock(moment.at))}</div>
        <input class="aim-caption" type="text" maxlength="300" placeholder="Add a caption (optional)">
        <div class="aim-privacy" role="group" aria-label="Who can see this">
          <button type="button" class="aim-chip is-active" data-aim-privacy="private">🔒 Just us</button>
          <button type="button" class="aim-chip" data-aim-privacy="contacts">👥 Contacts</button>
          <button type="button" class="aim-chip" data-aim-privacy="public">🌐 Public</button>
        </div>
        <div class="aim-actions">
          <button type="button" class="btn btn-ghost aim-delete">Delete</button>
          <button type="button" class="btn btn-gold aim-keep">Keep</button>
        </div>
        <div class="aim-status" role="status" aria-live="polite"></div>
      </div>
    </div>`;
}

function panelHtml(moments) {
  return `
    <div class="aim-panel" id="aiMomentsPanel">
      <div class="aim-head">
        <div>
          <div class="aim-heading">Herae kept ${moments.length === 1 ? 'a moment' : `${moments.length} moments`} from tonight</div>
          <div class="aim-sub">
            Found on your computer, and still only on your computer.
            <strong>Tap any moment to see it full screen.</strong>
            Keep the ones you want — everything else is deleted when you leave this page.
          </div>
        </div>
      </div>
      <div class="aim-grid">${moments.map(cardHtml).join('')}</div>
    </div>`;
}

// Mounts the panel, if there is anything to mount. Returns silently when the
// extension is absent, when the feature is off, or when a quiet night simply
// produced nothing — none of which is a state worth explaining on a page
// somebody opened to write about their evening.
export async function mountAiMoments(mountEl, { sessionId } = {}) {
  if (!mountEl) return;

  const listed = await askExtension(
    { __heraeAiMoments: true, session: sessionId || null },
    '__heraeAiMomentsAck',
  );
  const moments = (listed && listed.ok && listed.moments) || [];
  if (!moments.length) return;

  mountEl.innerHTML = panelHtml(moments);

  const act = (payload) => askExtension(
    { __heraeAiMomentAction: true, requestId: payload.requestId, ...payload },
    '__heraeAiMomentActionAck',
    (d) => d.requestId === payload.requestId,
  );

  // Everything that is still on the page when it goes away is dropped. A
  // pagehide handler rather than a button: leaving IS the decision, and
  // asking somebody to confirm that they meant to not keep something is the
  // opposite of the calm this feature is supposed to feel like.
  const discardRest = () => {
    if (!mountEl.querySelector('.aim-card')) return;
    window.postMessage({
      __heraeAiMomentAction: true, action: 'discardRest',
      requestId: nextRequestId(), session: sessionId || null,
    }, window.location.origin);
  };
  window.addEventListener('pagehide', discardRest);

  const removeCard = (card) => {
    card.classList.add('aim-card-out');
    setTimeout(() => {
      card.remove();
      const panel = document.getElementById('aiMomentsPanel');
      if (panel && !panel.querySelector('.aim-card')) panel.remove();
    }, 220);
  };

  // ── Keep / Delete ─────────────────────────────────────────────────
  // One implementation each, called from the grid card AND from inside the
  // fullscreen gallery. Two copies would be two places for "keep" to mean
  // subtly different things.
  function deleteMoment(id) {
    const card = cardFor(id);
    if (card) removeCard(card);
    act({ action: 'discard', id, requestId: nextRequestId() });
  }

  async function keepMoment(id) {
    const card = cardFor(id);
    if (!card) return;
    const keepBtn = card.querySelector('.aim-keep');
    const deleteBtn = card.querySelector('.aim-delete');
    const statusEl = card.querySelector('.aim-status');
    keepBtn.disabled = true;
    deleteBtn.disabled = true;
    keepBtn.textContent = 'Saving…';
    statusEl.textContent = '';
    const resp = await act({
      action: 'keep',
      id,
      requestId: nextRequestId(),
      // Whatever was chosen on the card — the gallery deliberately does not
      // ask again, so a decision made in the grid is carried through.
      privacy: card.querySelector('[data-aim-privacy].is-active')?.dataset.aimPrivacy || 'private',
      description: card.querySelector('.aim-caption').value.trim(),
    });
    if (!resp || !resp.ok) {
      // The clip is untouched on a failure, so Keep is simply pressable
      // again rather than the moment being lost to a bad connection.
      keepBtn.disabled = false;
      deleteBtn.disabled = false;
      keepBtn.textContent = 'Keep';
      statusEl.textContent = (resp && resp.error) || 'Could not save that one — try again.';
      return;
    }
    statusEl.textContent = '✓ Kept';
    removeCard(card);
  }

  // ── Fullscreen gallery ────────────────────────────────────────────
  // Reuses the site's existing media viewer rather than adding a second
  // lightbox: zoom, pinch, pan, the video controls, focus handling and Esc
  // already live there and are already the behaviour people know from the
  // rest of the feed. What is added here is the collection around it —
  // moving between moments, and keeping or deleting one without dropping
  // back to the grid first.
  //
  // Nothing about opening it touches the page: no fetch, no re-render, no
  // navigation. Scroll position, captions half-typed and privacy chips
  // already chosen are all exactly where they were on close.
  let liveOrder = moments.map((m) => m.id);

  function cardFor(id) { return mountEl.querySelector(`[data-aim-id="${CSS.escape(id)}"]`); }
  function stillOnPage() { return liveOrder.filter((id) => cardFor(id)); }

  async function openGallery(id) {
    const order = stillOnPage();
    const index = order.indexOf(id);
    if (index < 0) return;
    const moment = moments.find((m) => m.id === id);
    const card = cardFor(id);
    if (!moment || !card) return;

    // A clip is fetched on demand — the same one-at-a-time rule the inline
    // player uses, so opening the gallery never pulls every video across.
    // Fetched once per moment and cached on the card, so moving back and
    // forth through the gallery never re-requests the same clip.
    let videoUrl = card.dataset.aimVideo || null;
    if (moment.hasVideo && !videoUrl) {
      const resp = await act({ action: 'play', id, requestId: nextRequestId() });
      if (resp?.ok && resp.video) {
        videoUrl = resp.video;
        card.dataset.aimVideo = videoUrl;
      }
    }

    const go = (delta) => {
      const now = stillOnPage();
      if (!now.length) return;
      const at = now.indexOf(id);
      const next = now[(at + delta + now.length) % now.length];
      if (next && next !== id) openGallery(next);
    };

    openMediaViewer(
      {
        mediaType: videoUrl ? 'video' : 'photo',
        url: moment.poster || '',
        videoUrl: videoUrl || null,
      },
      {
        caption: `${moment.label}${moment.synced ? ' · together' : ''} · ${formatClock(moment.at)}`,
        nav: order.length > 1
          ? { index, total: order.length, onPrev: () => go(-1), onNext: () => go(1) }
          : null,
        actions: [
          {
            label: 'Keep',
            kind: 'keep',
            title: 'Keep this moment (it will be saved to your memories)',
            onClick: ({ close }) => {
              const remaining = stillOnPage().filter((x) => x !== id);
              keepMoment(id);
              // Straight on to the next one, so reviewing a night is a single
              // pass rather than open-decide-close-open-decide-close.
              if (remaining.length) openGallery(remaining[0]); else close();
            },
          },
          {
            label: 'Delete',
            kind: 'delete',
            title: 'Delete this moment permanently',
            onClick: ({ close }) => {
              const remaining = stillOnPage().filter((x) => x !== id);
              deleteMoment(id);
              if (remaining.length) openGallery(remaining[0]); else close();
            },
          },
        ],
      },
    );
  }

  // Enter/Space on a focused thumbnail does what a click does. Without this
  // the gallery would be mouse-only, which for the primary way of viewing a
  // memory is not acceptable.
  mountEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const thumb = e.target.closest('.aim-thumb');
    if (!thumb || e.target.closest('button')) return;
    e.preventDefault();
    const card = thumb.closest('.aim-card');
    if (card) openGallery(card.dataset.aimId);
  });

  mountEl.addEventListener('click', async (e) => {
    const card = e.target.closest('.aim-card');
    if (!card) return;
    const id = card.dataset.aimId;
    const statusEl = card.querySelector('.aim-status');

    // ── Privacy chips ───────────────────────────────────────────────
    const chip = e.target.closest('[data-aim-privacy]');
    if (chip) {
      card.querySelectorAll('[data-aim-privacy]').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      return;
    }

    // ── Play ────────────────────────────────────────────────────────
    // The clip is fetched here and not with the list: a review can hold
    // several of these, and pulling every one across as a data URL up front
    // would cost tens of megabytes to show thumbnails.
    // ── The thumbnail is a POSTER, never a player ───────────────────
    // Anywhere on it — including the play icon, which is decoration rather
    // than a control — opens the fullscreen viewer. A grid of tiny autoplay
    // videos is not a gallery: it decodes several streams at once, fights for
    // the same CPU the compositor needs, and shows the memory at a size where
    // nobody can actually see it. One video, full screen, playing.
    if (e.target.closest('.aim-thumb')) {
      openGallery(id);
      return;
    }

    // ── Delete ──────────────────────────────────────────────────────
    if (e.target.closest('.aim-delete')) { deleteMoment(id); return; }

    // ── Keep ────────────────────────────────────────────────────────
    if (e.target.closest('.aim-keep')) { keepMoment(id); }
  });
}
