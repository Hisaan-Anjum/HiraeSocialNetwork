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
// ── postMessage is not a queue ────────────────────────────────────────
// The content script attaches its listener at document_idle. This module is a
// deferred <script type="module">, so it runs at roughly the same moment —
// genuinely racy, and a message sent before the listener exists is not
// delivered late, it is DROPPED. The page then waits out the full timeout for
// a reply that can never arrive and renders nothing, which is
// indistinguishable from an evening that produced no moments.
//
// This was hidden for as long as the first request happened after a network
// round trip: awaiting the session fetch gave the content script all the time
// it needed. Moving the panel ahead of that fetch — so moments no longer wait
// on the server — removed the accidental delay that was holding it together.
//
// So a request that can safely be repeated is repeated, on a short backoff,
// until it is answered. `retryEveryMs` is opt-in for exactly that reason: a
// LIST may be asked twice and cost nothing, while a keep or a calibration
// verdict may not.
function askExtension(message, ackKey, matcher, { retryEveryMs = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const timers = [];
    const done = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      for (const t of timers) clearTimeout(t);
      resolve(value);
    };
    const onMessage = (e) => {
      if (e.source !== window || !e.data || e.data[ackKey] !== true) return;
      if (matcher && !matcher(e.data)) return;
      done(e.data);
    };
    window.addEventListener('message', onMessage);
    timers.push(setTimeout(() => done(null), ASK_TIMEOUT_MS));
    const send = () => { if (!settled) window.postMessage(message, window.location.origin); };
    send();
    if (retryEveryMs) {
      // Widening gaps rather than a fixed interval: the listener either
      // attaches within a frame or two, or something is genuinely wrong and
      // hammering it will not help.
      let delay = retryEveryMs;
      for (let i = 0; i < 5; i++) {
        timers.push(setTimeout(send, delay));
        delay *= 2;
      }
    }
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
// photograph and refuses to play.
//
// At 100% it says so rather than going blank. The bar reaching the end and the
// label vanishing in the same frame reads as the thing being taken away: the
// card still shows a poster and still will not play for the moment it takes
// the composite to arrive and the card to be repainted, so an empty line there
// is the one place somebody would conclude it had failed. Naming the finish is
// also the only acknowledgement they get that the wait ended in success.
const makingLabel = (pct) => (pct >= 100 ? 'Video complete' : 'Making video…');

// The figure beside it. "Almost done" is kinder than a number while there is
// still something to wait for, but at 100 it is a hedge about something that
// has already happened — so the last state is the plain figure.
const waitFigure = (pct) => (pct >= 100 ? '100%' : (pct >= 90 ? 'Almost done' : `${pct}%`));

function progressHtml(moment) {
  const pct = pctOf(moment);
  return `
    <div class="aim-making">
      <div class="aim-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="${pct}" aria-label="Making video">
        <div class="aim-progress-fill" style="width:${pct}%"></div>
      </div>
      <div class="aim-making-label${pct >= 100 ? ' is-complete' : ''}">${escapeHtml(makingLabel(pct))}</div>
    </div>
    <span class="aim-duration aim-duration-waiting">${escapeHtml(waitFigure(pct))}</span>`;
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
          <div class="aim-making-label aim-making-label-lg${pct >= 100 ? ' is-complete' : ''}">${escapeHtml(makingLabel(pct))}</div>
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

// ── Personalisation, and how little of it there is ────────────────────
// The review page is where two people relive an evening. Calibration is a
// guest here: two icons on the handful of moments the extension actually
// asked about, nothing on the rest, and no second thing to read.
//
// The words matter as much as the size. Nobody is helping improve a model or
// sending feedback — they are telling Herae about their own face, and every
// string here says so.
const CORRECTION_CHIPS = Object.freeze([
  ['neutral', 'Nothing'], ['laugh', 'Laugh'], ['smile', 'Smile'],
  ['surprise', 'Surprise'], ['fear', 'Fear'], ['horror', 'Horror'],
  ['excitement', 'Excitement'], ['embarrassment', 'Embarrassment'],
  ['cute', 'Cute'], ['tender', 'Tender'], ['celebration', 'Celebration'],
  ['cry', 'Cry'], ['disgust', 'Disgust'], ['wink', 'Wink'],
  ['squint', 'Squint'], ['other', 'Other'],
]);

function calibButtonsHtml() {
  return `
    <button type="button" class="aim-calib-btn" data-aim-verdict="confirm"
      title="Herae read this one right" aria-label="Herae read this one right">👍</button>
    <button type="button" class="aim-calib-btn" data-aim-verdict="reject"
      title="That is not what this was" aria-label="That is not what this was">👎</button>`;
}

function calibHtml(moment) {
  if (!moment.askCalibration) return '';
  return `
    <div class="aim-calib" data-aim-calib="idle" role="status" aria-live="polite">
      ${calibButtonsHtml()}
    </div>`;
}

// Built only when somebody presses 👎 — the one place this feature is allowed
// to take up room, and only because they asked a question by pressing it.
function correctionHtml() {
  return `
    <div class="aim-correct" role="group" aria-label="What was it instead?">
      <div class="aim-correct-q">What was it instead?</div>
      <div class="aim-correct-chips">
        ${CORRECTION_CHIPS.map(([v, label]) =>
    `<button type="button" class="aim-chip aim-correct-chip" data-aim-correction="${v}">${label}</button>`).join('')}
      </div>
      <!-- ── A different kind of answer, and it looks like one ─────────
           "You read it right, I just would not have kept it." Set apart from
           the chips because it is not a correction at all: it never touches
           detection, only which moments are worth keeping. Putting it in the
           same row would invite somebody to read it as one more label. -->
      <button type="button" class="aim-correct-taste" data-aim-verdict="dislike">
        I just didn’t want this moment
      </button>
    </div>`;
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
        <div class="aim-when">${escapeHtml(formatClock(moment.at))}${calibHtml(moment)}</div>
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

// ── The nights this review is not about ───────────────────────────────
// Moments from several evenings can be waiting at once — one that ended in a
// crash, one finished while an earlier was never looked at. They must never be
// shown TOGETHER: a review is a record of one night, and merging them puts
// last night's reactions in tonight's memories.
//
// But the others must not simply be invisible either. Until now the only way
// back to them was a notification, and a notification nobody clicks is how an
// evening quietly gets discarded unseen.
//
// So: a quiet line at the FOOT of the panel, after the decision about tonight,
// never above it. It is a door, not a task list — no counts shouted, no badge,
// no "you have unreviewed items". Just the date, how many, and a way through.
function formatNight(at) {
  try {
    const d = new Date(at);
    const today = new Date();
    const days = Math.round((today.setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 0) return 'Earlier today';
    if (days === 1) return 'Last night';
    if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  } catch (e) { return 'Another night'; }
}

function otherNightsHtml(others) {
  if (!others || !others.length) return '';
  return `
    <div class="aim-others">
      <div class="aim-others-title">${others.length === 1
    ? 'Another night is still waiting'
    : `${others.length} other nights are still waiting`}</div>
      ${others.map((o) => `
        <a class="aim-other" href="review.html?session=${encodeURIComponent(o.clientSessionId || '')}"
           data-aim-other="1">
          <span class="aim-other-when">${escapeHtml(formatNight(o.at))}</span>
          <span class="aim-other-count">${o.count === 1 ? '1 moment' : `${o.count} moments`}</span>
          <span class="aim-other-go" aria-hidden="true">→</span>
        </a>`).join('')}
    </div>`;
}

function panelHtml(moments, others) {
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
      ${otherNightsHtml(others)}
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

  // Retried: asking for the list twice costs nothing, and this is the one
  // request that races the content script's own startup.
  const listed = await askExtension(
    { __heraeAiMoments: true, session: sessionId || null },
    '__heraeAiMomentsAck',
    null,
    { retryEveryMs: 150 },
  );
  const moments = (listed && listed.ok && listed.moments) || [];
  // ── Three different silences, told apart ─────────────────────────
  // This returned quietly for all of them, and they mean opposite things:
  // the extension never answered (not installed, or this origin is not the
  // one configured in Settings — content.js says which, just above this line
  // in the same console), it answered with an error, or the night genuinely
  // produced nothing. Somebody told "8 moments from tonight" and shown an
  // empty review needs to be able to tell which.
  if (!moments.length) {
    if (!listed) {
      console.warn('[Herae memories] the extension did not answer, so no AI Moments'
        + ' can be shown. Either it is not installed here, or this page is not the'
        + ' address set in Settings → Memories (see the line above).');
    } else if (!listed.ok) {
      console.warn('[Herae memories] the extension refused the request:', listed.error || 'no reason given');
    } else {
      console.info('[Herae memories] the extension has no moments for this evening.');
    }
    return;
  }
  // WHICH moments to ask about is the extension's decision, not the page's.
  // It arrives as a list of ids; anything not on it renders no calibration at
  // all, so there is no second schedule here to drift from the real one.
  const askIds = new Set((listed && listed.askCalibration) || []);
  for (const m of moments) m.askCalibration = askIds.has(m.id);

  mountEl.innerHTML = panelHtml(moments, (listed && listed.otherEvenings) || []);

  const act = (payload) => askExtension(
    { __heraeAiMomentAction: true, requestId: payload.requestId, ...payload },
    '__heraeAiMomentActionAck',
    (d) => d.requestId === payload.requestId,
  );

  // ── The four acts ────────────────────────────────────────────────
  // A tap is the whole interaction. 👍 selects and stops — no toast, no
  // panel, no thank-you; the point of the gesture is that it costs nothing.
  // 👎 is the only thing that ever opens anything.
  //
  // Nothing here is sent for a moment nobody touched. Silence is not a weak
  // yes: a system that reads it as one becomes confident it is right in
  // exactly the cases where nobody could be bothered to tell it otherwise.
  async function sendCalibration(card, verdict, correction) {
    const id = card.dataset.aimId;
    const row = card.querySelector('.aim-calib');
    if (!id || !row || row.dataset.aimCalib === 'done') return;
    row.dataset.aimCalib = 'done';
    // Settled in place, optimistically. The row keeps its height so the card
    // does not jump under the cursor, and the correction panel — if one was
    // open — closes with it, because the question has been answered.
    const panel = card.querySelector('.aim-correct');
    if (panel) panel.remove();
    // ── …and a way back ──────────────────────────────────────────────
    // A tap is a judgement about somebody's own face made in a second, and the
    // commonest reason to want it back is the most banal: the wrong icon.
    // Without this the only honest options are to leave a wrong answer in the
    // profile or to retune the whole thing, and both are worse than the slip.
    row.innerHTML = '<span class="aim-calib-done">✓ Noted</span>'
      + '<button type="button" class="aim-calib-undo" data-aim-undo="1">Undo</button>';
    // ── …but "Noted" has to be true ──────────────────────────────────
    // The extension refuses a verdict it cannot attach to a real reading, and
    // stores nothing at all when personalisation is switched off. Saying
    // "Noted" anyway would be the product claiming to have listened while
    // discarding what it heard — a small lie, and exactly the one that makes
    // somebody stop believing the feature does anything.
    const ack = await act({ action: 'calibrate', id, verdict, correction, requestId: nextRequestId() });
    if (ack && ack.ok) return;
    row.dataset.aimCalib = 'idle';
    row.innerHTML = calibButtonsHtml();
  }

  mountEl.addEventListener('click', (e) => {
    const undoBtn = e.target.closest('[data-aim-undo]');
    if (undoBtn) {
      const card = undoBtn.closest('.aim-card');
      const row = card && card.querySelector('.aim-calib');
      if (!card || !row) return;
      undoBtn.disabled = true;
      act({ action: 'calibrate', verdict: 'undo', id: card.dataset.aimId, requestId: nextRequestId() })
        .then((ack) => {
          // Restored to the question, not to a third state. Somebody undoing a
          // slip means to answer again, and leaving the card blank would take
          // the choice away as the price of fixing it.
          if (ack && ack.ok) {
            row.dataset.aimCalib = 'idle';
            row.innerHTML = calibButtonsHtml();
          } else { undoBtn.disabled = false; }
        });
      return;
    }
    const btn = e.target.closest('[data-aim-verdict], [data-aim-correction]');
    if (!btn) return;
    const card = btn.closest('.aim-card');
    if (!card) return;
    const correction = btn.dataset.aimCorrection;
    if (correction) { sendCalibration(card, 'reject', correction); return; }
    const verdict = btn.dataset.aimVerdict;
    if (verdict === 'confirm' || verdict === 'dislike') { sendCalibration(card, verdict, null); return; }
    if (verdict !== 'reject') return;
    // 👎 asks a question rather than answering one. The panel is built here
    // and nowhere else, so a card nobody rejected has no correction markup in
    // it at all — not hidden, absent.
    const row = card.querySelector('.aim-calib');
    if (!row || row.dataset.aimCalib === 'done') return;
    if (card.querySelector('.aim-correct')) return;
    row.dataset.aimCalib = 'asking';
    btn.classList.add('is-active');
    // Directly under the two icons, not at the foot of the card: the answer
    // belongs beside the question, and appending to the body would put it
    // below the caption and the Keep button somebody is reaching for.
    (row.parentElement || row).insertAdjacentHTML('afterend', correctionHtml());
  });

  // ── Stepping to another night is not leaving ──────────────────────
  // Leaving IS the decision: anything still here when the page goes away is
  // discarded, which is the promise made at capture time and the reason the
  // decision can be a calm one.
  //
  // Following a link to another waiting night is not that. It is somebody
  // going to look at MORE of their moments — and destroying tonight's on the
  // way would turn the one affordance offering an evening back into the thing
  // that deletes a different one. Tonight stays where it is, and is offered
  // again the next time it is asked for.
  let steppingAway = false;
  mountEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-aim-other]')) steppingAway = true;
  }, true);

  // Everything that is still on the page when it goes away is dropped. A
  // pagehide handler rather than a button: leaving IS the decision, and
  // asking somebody to confirm that they meant to not keep something is the
  // opposite of the calm this feature is supposed to feel like.
  const discardRest = () => {
    if (steppingAway) return;
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
  // How long the finished bar is held before the card becomes the clip. Long
  // enough to read two words, short enough that nobody waits on it.
  const COMPLETE_HOLD_MS = 1200;
  const completionHolds = new Map();
  // Cancels a hold in flight. Called before starting one (a repeated
  // composited event must not leave two timers racing to repaint) and by
  // teardown, where a timer firing into a removed grid would throw.
  function finishCompletion(id) {
    const t = completionHolds.get(id);
    if (t) { clearTimeout(t); completionHolds.delete(id); }
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
      if (making) {
        making.textContent = makingLabel(pct);
        making.classList.toggle('is-complete', pct >= 100);
      }
      // Moved in place rather than re-rendered: repainting the badges every
      // 400ms would restart the CSS transition and make the bar stutter.
      if (bar) bar.style.width = `${pct}%`;
      if (label) label.textContent = waitFigure(pct);
      if (!bar) repaintCard(moment);
    }
    if (waitingEl && awaitingOpen === moment.id) {
      const bar = waitingEl.querySelector('.aim-progress-fill');
      if (bar) bar.style.width = `${pct}%`;
      const title = waitingEl.querySelector('.aim-wait-title');
      if (title && pct >= 90) title.textContent = pct >= 100 ? 'Video complete' : 'Almost done…';
      const making = waitingEl.querySelector('.aim-making-label');
      if (making) {
        making.textContent = makingLabel(pct);
        making.classList.toggle('is-complete', pct >= 100);
      }
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
      moment.hasVideo = true;
      moment.failed = false;
      moment.progress = 1;
      if (e.data.durationMs) moment.durationMs = e.data.durationMs;
      // Somebody is sitting in front of the viewer waiting for exactly this.
      // A card with a deferred keep is NOT resolved here — the extension owns
      // that upload and reports it below; retrying from both sides would
      // upload the same memory twice.
      if (awaitingOpen === moment.id) {
        moment.videoReady = true;
        repaintCard(moment);
        if (waitingEl) { waitingEl.remove(); waitingEl = null; }
        awaitingOpen = null;
        openGallery(moment.id);
        return;
      }
      // ── Let the bar finish before the card changes underneath it ─────
      // The compositor reports 100% and hands over the blob in the same tick,
      // so without this the bar jumps from 99% to a playable card and the
      // finish is never seen — the wait just stops, which reads as the card
      // having given up rather than succeeded.
      //
      // Costs nothing: the clip is already playable, openGallery asks the
      // extension for it rather than trusting the card, and a click during
      // these few frames plays it immediately.
      finishCompletion(moment.id);
      paintProgress(moment);
      completionHolds.set(moment.id, setTimeout(() => {
        completionHolds.delete(moment.id);
        moment.videoReady = true;
        if (cardFor(moment.id)) repaintCard(moment);
      }, COMPLETE_HOLD_MS));
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
      finishCompletion(e.data.id);
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
      finishCompletion(moment.id);
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
