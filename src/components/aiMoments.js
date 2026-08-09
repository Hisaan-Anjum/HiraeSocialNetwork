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

// ── Three states, not two ─────────────────────────────────────────────
// A clip is recorded raw and given its theme afterwards, in the background,
// best-ranked first. So a card is one of:
//
//   ready      a photo, or a clip that has been composited
//   finishing  a clip whose footage exists and whose video does not YET
//   failed     the composite could not be produced; the poster survives
//
// `hasVideo` is the wide question ("is there footage") and `videoReady` the
// narrow one ("can it play"). Reading the wide one as the narrow one puts a
// play button on a card that cannot play; reading the narrow one as the wide
// one shows a clip as a photo forever, because nothing re-lists a candidate.
function stateOf(moment) {
  if (!moment.hasVideo) return 'ready';
  if (moment.failed) return 'failed';
  return moment.videoReady ? 'ready' : 'finishing';
}

// Progress is a real figure, not a guess: the compositor plays the footage
// back in real time, so elapsed-over-duration is exactly how far through it is.
// A spinner where a percentage was available is a page telling somebody less
// than it knows — and "how much longer" is the only question they have.
const pctOf = (moment) => Math.round(Math.max(0, Math.min(1, moment.progress || 0)) * 100);

// The words under the bar. A percentage says how far; it does not say what is
// happening — and "making video" is the honest answer to a card that shows a
// photograph and refuses to play. It disappears at 100% because at that point
// the clip IS the answer.
const makingLabel = (pct) => (pct >= 100 ? '' : 'Making video…');

function progressHtml(moment) {
  const pct = pctOf(moment);
  return `
    <div class="aim-making">
      <div class="aim-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="${pct}" aria-label="Making video">
        <div class="aim-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="aim-making-label">${escapeHtml(makingLabel(pct))}</div>
    </div>
    <span class="aim-duration aim-duration-waiting">${pct >= 90 ? 'Almost done' : `${pct}%`}</span>`;
}

function badgeHtml(moment) {
  const state = stateOf(moment);
  if (!moment.hasVideo) return '<span class="aim-duration">Photo</span>';
  if (state === 'finishing') return progressHtml(moment);
  if (state === 'failed') return '<span class="aim-duration">Photo</span>';
  return `
    <span class="aim-play" aria-hidden="true"><span class="aim-play-glyph">▶</span></span>
    <span class="aim-duration aim-duration-video">
      <span class="aim-duration-icon" aria-hidden="true">▶</span>${escapeHtml(formatDuration(moment.durationMs))}
    </span>`;
}

// ── Clicking a clip that is not ready ─────────────────────────────────
// Opening the fullscreen viewer on the poster would be answering "play this"
// with a still photograph — the one thing the person did NOT ask for, and
// indistinguishable from the clip having silently become a photo. This says
// what is actually happening and how far along it is, and gets out of the way
// the moment the real thing is ready.
function waitingOverlayHtml(moment) {
  const pct = pctOf(moment);
  return `
    <div class="aim-wait" role="dialog" aria-modal="true" aria-label="Clip still finishing">
      <div class="aim-wait-card">
        ${moment.poster ? `<img class="aim-wait-poster" src="${escapeHtml(moment.poster)}" alt="">` : ''}
        <div class="aim-wait-body">
          <div class="aim-wait-title">${pct >= 90 ? 'Almost done…' : 'Putting this clip together…'}</div>
          <div class="aim-progress aim-progress-lg" role="progressbar" aria-valuemin="0"
               aria-valuemax="100" aria-valuenow="${pct}">
            <div class="aim-progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="aim-making-label aim-making-label-lg">${escapeHtml(makingLabel(pct))}</div>
          <div class="aim-wait-sub">It will start playing on its own. You can close this and come back.</div>
        </div>
        <button type="button" class="aim-wait-close" aria-label="Close">✕</button>
      </div>
    </div>`;
}

function thumbLabel(moment) {
  const state = stateOf(moment);
  if (state === 'finishing') return `${moment.label} — still finishing, opens when ready`;
  return `${moment.label} — ${moment.hasVideo && state === 'ready' ? 'play full screen' : 'view full screen'}`;
}

function cardHtml(moment) {
  // Duration, timestamp, thumbnail, play, keep, delete — the amendment's
  // exact list, in the order somebody actually reads them. Confidence and
  // rank stay internal: they order this list and are never shown, because a
  // number next to a memory invites arguing with it.
  return `
    <div class="aim-card" data-aim-id="${escapeHtml(moment.id)}" data-aim-state="${stateOf(moment)}">
      <div class="aim-thumb" role="button" tabindex="0"
           aria-label="${escapeHtml(thumbLabel(moment))}">
        ${moment.poster
          ? `<img src="${escapeHtml(moment.poster)}" alt="${escapeHtml(moment.label)}" loading="lazy">`
          : '<div class="aim-thumb-empty">✨</div>'}
        ${badgeHtml(moment)}
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
  const finishing = moments.filter((m) => stateOf(m) === 'finishing').length;
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
          <div class="aim-sub aim-finishing-note" ${finishing ? '' : 'hidden'} role="status" aria-live="polite">
            ${finishingNote(finishing)}
          </div>
        </div>
      </div>
      <div class="aim-grid">${moments.map(cardHtml).join('')}</div>
    </div>`;
}

// Deliberately NOT "don't close this tab". The clips are put together by the
// extension, not by this page — closing it does not stop the work, and closing
// the browser does not lose it either. Saying otherwise would be a lie that
// makes somebody sit and wait for no reason.
function finishingNote(n) {
  if (!n) return '';
  return `${n === 1 ? 'One clip is' : `${n} clips are`} still being put together — `
    + 'you can leave this page open or come back to it.';
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

  // Keeps that are waiting on a composite, and the one moment (if any) somebody
  // is sitting in front of waiting to watch. Both are resolved by the
  // composited event below rather than by polling.
  const queuedKeeps = new Set();
  let awaitingOpen = null;

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
    // ── Keeping a clip that is still being put together ───────────────
    // The extension refuses to upload the poster alone, because that would
    // silently turn the clip somebody chose into a photo. So the decision is
    // HELD here — the card stays, visibly committed — and the upload happens
    // the moment the composite lands. Asking that clip for is what moved it to
    // the front of the queue, so this is a short wait, not an open-ended one.
    if (resp && resp.pending) {
      // The extension has taken the decision and will upload it when the clip
      // is ready — including if this page is closed first, which is why this
      // does NOT retry from here. It waits to be told the outcome.
      queuedKeeps.add(id);
      keepBtn.textContent = 'Keeping…';
      statusEl.textContent = 'Saving as soon as this clip is finished.';
      return;
    }
    if (!resp || !resp.ok) {
      // The clip is untouched on a failure, so Keep is simply pressable
      // again rather than the moment being lost to a bad connection.
      queuedKeeps.delete(id);
      keepBtn.disabled = false;
      deleteBtn.disabled = false;
      keepBtn.textContent = 'Keep';
      statusEl.textContent = (resp && resp.error) || 'Could not save that one — try again.';
      return;
    }
    queuedKeeps.delete(id);
    statusEl.textContent = '✓ Kept';
    removeCard(card);
  }

  // ── A card graduating from "finishing" to playable ────────────────────
  // Pushed by the extension, never polled: this page has no way to know when a
  // background composite finishes, and a card that says "still finishing"
  // forever is indistinguishable from one that is broken.
  function repaintCard(moment) {
    const card = cardFor(moment.id);
    if (!card) return;
    card.dataset.aimState = stateOf(moment);
    const thumb = card.querySelector('.aim-thumb');
    if (!thumb) return;
    thumb.setAttribute('aria-label', thumbLabel(moment));
    // Only the badges are replaced. Re-rendering the whole card would throw
    // away a half-typed caption and a privacy chip somebody already chose.
    thumb.querySelectorAll('.aim-play, .aim-duration').forEach((el) => el.remove());
    thumb.insertAdjacentHTML('beforeend', badgeHtml(moment));
    const note = mountEl.querySelector('.aim-finishing-note');
    if (note) {
      const left = moments.filter((m) => cardFor(m.id) && stateOf(m) === 'finishing').length;
      note.innerHTML = finishingNote(left);
      note.hidden = !left;
    }
  }

  // The waiting view, if one is open. At most one — it is a modal.
  let waitingEl = null;
  function closeWaiting() {
    waitingEl?.remove();
    waitingEl = null;
    // Closing it is not cancelling: the composite carries on, and the card
    // keeps its progress bar. Only the automatic open is withdrawn, because
    // a viewer springing open after somebody dismissed it is a page fighting
    // its user.
    awaitingOpen = null;
  }

  function openWaiting(moment) {
    closeWaiting();
    const wrap = document.createElement('div');
    wrap.innerHTML = waitingOverlayHtml(moment);
    waitingEl = wrap.firstElementChild;
    waitingEl.addEventListener('click', (ev) => {
      if (ev.target.closest('.aim-wait-close') || ev.target === waitingEl) closeWaiting();
    });
    document.body.appendChild(waitingEl);
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return;
      document.removeEventListener('keydown', onKey);
      closeWaiting();
    };
    document.addEventListener('keydown', onKey);
    waitingEl.querySelector('.aim-wait-close')?.focus();
  }

  function paintProgress(moment) {
    const card = cardFor(moment.id);
    const pct = pctOf(moment);
    if (card && stateOf(moment) === 'finishing') {
      const bar = card.querySelector('.aim-progress-fill');
      const label = card.querySelector('.aim-duration-waiting');
      const making = card.querySelector('.aim-making-label');
      if (making) making.textContent = makingLabel(pct);
      // Moved in place rather than re-rendered: repainting the badges every
      // 400ms would restart the CSS transition and make the bar stutter.
      if (bar) bar.style.width = `${pct}%`;
      if (label) label.textContent = pct >= 90 ? 'Almost done' : `${pct}%`;
      if (!bar) repaintCard(moment);
    }
    if (waitingEl && awaitingOpen === moment.id) {
      const bar = waitingEl.querySelector('.aim-progress-fill');
      if (bar) bar.style.width = `${pct}%`;
      const title = waitingEl.querySelector('.aim-wait-title');
      if (title && pct >= 90) title.textContent = 'Almost done…';
      const making = waitingEl.querySelector('.aim-making-label');
      if (making) making.textContent = makingLabel(pct);
    }
  }

  const onExtensionEvent = (e) => {
    if (e.source !== window || !e.data) return;

    if (e.data.__heraeAiMomentProgress === true) {
      const moment = moments.find((m) => m.id === e.data.id);
      if (!moment) return;
      moment.progress = Number(e.data.pct) || 0;
      paintProgress(moment);
      return;
    }

    if (e.data.__heraeAiMomentComposited === true) {
      const moment = moments.find((m) => m.id === e.data.id);
      if (!moment) return;
      moment.videoReady = true;
      moment.hasVideo = true;
      moment.failed = false;
      moment.progress = 1;
      if (e.data.durationMs) moment.durationMs = e.data.durationMs;
      repaintCard(moment);
      if (waitingEl && awaitingOpen === moment.id) { waitingEl.remove(); waitingEl = null; }
      // Somebody is sitting in front of the viewer waiting for exactly this.
      // A card with a deferred keep is NOT resolved here — the extension owns
      // that upload and reports it below; retrying from both sides would
      // upload the same memory twice.
      if (awaitingOpen === moment.id) { awaitingOpen = null; openGallery(moment.id); }
      return;
    }

    // ── The post-session pass changed its mind ──────────────────────
    // Clips are re-read from their own footage before they are themed, so a
    // card can be showing a caption the live reading guessed at. The list was
    // fetched once; this is the only correction it will ever get.
    if (e.data.__heraeAiMomentReviewed === true) {
      const moment = moments.find((m) => m.id === e.data.id);
      if (!moment || !e.data.meta) return;
      Object.assign(moment, e.data.meta);
      const card = cardFor(moment.id);
      if (card) {
        const title = card.querySelector('.aim-title');
        // Rebuilt rather than patched: the "together" badge lives here too and
        // a text-only update would drop it.
        if (title) {
          title.innerHTML = `${escapeHtml(moment.label || '')}`
            + (moment.synced ? ' <span class="aim-badge" title="You both reacted at the same time">together</span>' : '');
        }
      }
      repaintCard(moment);
      return;
    }

    // …or decided it was not a moment at all. Without this the card sits at
    // "Making video…" forever for a clip that no longer exists.
    if (e.data.__heraeAiMomentDropped === true) {
      const at = moments.findIndex((m) => m.id === e.data.id);
      if (at >= 0) moments.splice(at, 1);
      if (waitingEl && awaitingOpen === e.data.id) closeWaiting();
      queuedKeeps.delete(e.data.id);
      const card = cardFor(e.data.id);
      if (card) removeCard(card);
      const note = mountEl.querySelector('.aim-finishing-note');
      if (note) {
        const left = moments.filter((m) => cardFor(m.id) && stateOf(m) === 'finishing').length;
        note.innerHTML = finishingNote(left);
        note.hidden = !left;
      }
      return;
    }

    // The clip could not be built. The poster is a real memory, so the card
    // becomes a photo — anything is better than "Making video…" in perpetuity.
    if (e.data.__heraeAiMomentFailed === true) {
      const moment = moments.find((m) => m.id === e.data.id);
      if (!moment) return;
      moment.failed = true;
      moment.hasVideo = false;
      moment.videoReady = false;
      repaintCard(moment);
      if (waitingEl && awaitingOpen === e.data.id) closeWaiting();
      const card = cardFor(e.data.id);
      const statusEl = card && card.querySelector('.aim-status');
      if (statusEl) statusEl.textContent = 'This one could only be saved as a photo.';
      return;
    }

    if (e.data.__heraeAiMomentKept === true) {
      const id = e.data.id;
      if (!queuedKeeps.has(id)) return;
      queuedKeeps.delete(id);
      const card = cardFor(id);
      if (!card) return;
      const statusEl = card.querySelector('.aim-status');
      if (e.data.ok) {
        if (statusEl) statusEl.textContent = '✓ Kept';
        removeCard(card);
        return;
      }
      // The clip is untouched on a failure, so Keep is pressable again.
      const keepBtn = card.querySelector('.aim-keep');
      const deleteBtn = card.querySelector('.aim-delete');
      if (keepBtn) { keepBtn.disabled = false; keepBtn.textContent = 'Keep'; }
      if (deleteBtn) deleteBtn.disabled = false;
      if (statusEl) statusEl.textContent = e.data.error || 'Could not save that one — try again.';
    }
  };
  window.addEventListener('message', onExtensionEvent);

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
      // ── Asked for, not ready yet ────────────────────────────────────
      // Asking IS the priority bump — the extension moves this clip to the
      // front of its queue — so the honest thing is to say so and open it the
      // instant it lands, rather than dropping the person into a poster they
      // did not ask for and leaving them to guess whether to press again.
      if (resp && resp.pending) {
        awaitingOpen = id;
        moment.videoReady = false;
        repaintCard(moment);
        openWaiting(moment);
        return;
      }
      if (resp?.ok && resp.video) {
        videoUrl = resp.video;
        card.dataset.aimVideo = videoUrl;
        if (resp.durationMs) moment.durationMs = resp.durationMs;
      } else if (moment.videoReady) {
        // It claimed to be playable and is not. Marked failed so the card
        // stops promising a clip; the poster is still a real memory.
        moment.failed = true;
        repaintCard(moment);
      }
    }
    if (awaitingOpen === id) awaitingOpen = null;

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
