// sessionLink.js — connects a finished watch night back to the shared
// Watchlist, from the review page.
//
// Two ways in, both entirely client-side until the moment something is actually
// linked (the list is one small request the page makes anyway):
//
//   1. AUTOCOMPLETE — typing in "Name this session" suggests films from the
//      pair's watchlist. Picking one locks the field to that film's title and
//      files the night under it.
//   2. FUZZY MATCH — if the session's detected content title looks like a film
//      already on the list, that's offered up front as "Was this …?", so the
//      common case is one tap and no typing.
//
// Filing a night under an entry is what lets the watchlist show the rating
// everyone actually gave it that night (see watchlist.js's derived
// sessionRating) instead of asking them to re-rate by hand.
'use strict';

import { escapeHtml } from '../lib/util.js';

const { getWatchlist, attachSessionToWatchlistItem, detachSessionFromWatchlist } = window;

// ── fuzzy title matching ──────────────────────────────────────────────
// Deliberately simple and CHEAP: normalise away punctuation/case/articles and
// year suffixes, then compare. Runs over one couple's watchlist (tens of items,
// already in memory), so there's no index to build and nothing server-side.
function normalise(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(\d{4}\)/g, ' ')          // "(2019)"
    .replace(/\b(19|20)\d{2}\b/g, ' ')   // bare years
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
// Dice coefficient over bigrams — tolerant of the junk streaming sites append
// ("Neon Getaway | Netflix", "Watch Neon Getaway HD"), unlike exact equality.
function similarity(a, b) {
  const A = normalise(a); const B = normalise(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.92;
  const grams = (s) => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const ga = grams(A); const gb = grams(B);
  if (!ga.size || !gb.size) return 0;
  let hits = 0;
  for (const g of ga) if (gb.has(g)) hits++;
  return (2 * hits) / (ga.size + gb.size);
}
export function bestWatchlistMatch(title, items, threshold = 0.62) {
  let best = null; let bestScore = 0;
  for (const it of items) {
    const s = similarity(title, it.movie.title);
    if (s > bestScore) { bestScore = s; best = it; }
  }
  return bestScore >= threshold ? { item: best, score: bestScore } : null;
}

// The partner whose shared watchlist this session belongs to. A watchlist is
// per PAIR, so this only makes sense for a two-person session; group nights get
// no suggestions rather than an arbitrary guess about whose list to use.
export function partnerForSession(participants, me) {
  const others = (participants || []).filter((p) => p !== me);
  return others.length === 1 ? others[0] : null;
}

// Mounts the whole feature onto the review page's "Name this session" field.
//   mount        — a container rendered directly under the input
//   input        — the #sessionTitleInput element
//   detail       — the session detail (participants, content, watchlistItemId)
//   me           — the logged-in username
//   onLinked()   — called after a successful link/unlink so the page can refresh
export async function mountSessionLink({ mount, input, detail, me, onLinked }) {
  const partner = partnerForSession(detail.participants, me);
  if (!mount || !input || !partner) return;

  let items = [];
  try { ({ items } = await getWatchlist(partner)); } catch (e) { return; } // not contacts / nothing to offer
  if (!items.length) return;

  let linkedId = detail.watchlistItemId || null;

  // Both ways in behave the same: the field takes the film's name and LOCKS,
  // the night is filed under that entry, and its rating (the average across
  // everyone who reviewed the session) rolls up to the watchlist item. Press
  // Change to unlock and pick something else.
  function renderLinked() {
    const it = items.find((x) => x.id === linkedId);
    if (!it) { mount.innerHTML = ''; return; }
    input.value = it.movie.title;
    input.readOnly = true;
    input.classList.add('is-locked');
    const rating = it.sessionRating != null
      ? ` · ★ ${it.sessionRating} from ${it.sessionCount} night${it.sessionCount === 1 ? '' : 's'}`
      : '';
    mount.innerHTML = `
      <div class="sl-linked">
        <span class="sl-linked-text">🔒 Filed under <strong>${escapeHtml(it.movie.title)}</strong>${escapeHtml(rating)}</span>
        <button type="button" class="sl-unlink" data-sl="unlink">Change</button>
      </div>`;
  }

  // The detected content title, if it confidently matches something on the
  // list. Shown as a pinned first option rather than instead of the list, so
  // the autocomplete is always right there either way.
  function currentGuess() {
    return detail.content?.title ? bestWatchlistMatch(detail.content.title, items) : null;
  }

  function renderSuggestion() {
    const guess = currentGuess();
    if (guess) {
      mount.innerHTML = `
        <div class="sl-suggest">
          <span>Was this <strong>${escapeHtml(guess.item.movie.title)}</strong> from your watchlist?</span>
          <button type="button" class="sl-yes" data-sl="link" data-id="${guess.item.id}">Yes, file it</button>
        </div>
        <button type="button" class="sl-hint" data-sl="browse">
          🍿 No — pick a different one from your watchlist (${items.length})
        </button>`;
      return;
    }
    // No confident guess — say the option exists rather than leaving a dead
    // field the user has to discover by clicking into it.
    mount.innerHTML = `
      <button type="button" class="sl-hint" data-sl="browse">
        🍿 Pick it from your shared watchlist (${items.length})
      </button>`;
  }

  function renderMatches(query) {
    const q = query.trim();
    const nq = normalise(q);
    const guess = currentGuess();
    let hits;
    if (!nq) {
      // Focused with nothing typed: show the list itself, unwatched first.
      // Showing NOTHING here was the whole reason this felt broken — an
      // autocomplete you have to guess the first letters of isn't one.
      hits = items.slice().sort((a, b) => Number(a.watched) - Number(b.watched));
    } else {
      hits = items
        .map((it) => ({ it, s: similarity(q, it.movie.title), n: normalise(it.movie.title) }))
        // Substring as well as prefix: people type a distinctive word from the
        // middle of a title ("getaway") far more often than its opening word.
        .filter((x) => x.s > 0.28 || x.n.startsWith(nq) || x.n.includes(nq))
        .sort((a, b) => b.s - a.s)
        .map(({ it }) => it);
    }
    // Pin the detected match to the top wherever it qualifies, so the obvious
    // answer is always the first thing under the cursor.
    if (guess) {
      hits = hits.filter((it) => it.id !== guess.item.id);
      if (!nq || similarity(q, guess.item.movie.title) > 0.28) hits.unshift(guess.item);
    }
    hits = hits.slice(0, 6);
    if (!hits.length) { mount.innerHTML = ''; return; }
    mount.innerHTML = `
      <div class="sl-list">
        <div class="sl-list-head">From your shared watchlist — picking one names, locks and files this night</div>
        ${hits.map((it) => `
          <button type="button" class="sl-option" data-sl="link" data-id="${it.id}">
            <span class="sl-option-art" style="${it.movie.posterUrl ? `background-image:url('${escapeHtml(it.movie.posterUrl)}')` : ''}"></span>
            <span class="sl-option-title">${escapeHtml(it.movie.title)}</span>
            ${guess && it.id === guess.item.id ? '<span class="sl-option-guess">looks like this</span>' : ''}
            ${it.watched ? '<span class="sl-option-seen">watched</span>' : ''}
          </button>`).join('')}
      </div>`;
  }

  mount.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-sl]');
    if (!t) return;
    if (t.dataset.sl === 'link') {
      const id = Number(t.dataset.id);
      mount.innerHTML = '<div class="sl-busy">Filing…</div>';
      try {
        // The server hands back the whole updated list, so adopt it — that's
        // what makes the rating this night just contributed (the average across
        // everyone who reviewed it) show immediately, instead of the stale
        // pre-link copy we loaded on mount.
        const res = await attachSessionToWatchlistItem(partner, id, detail.clientSessionId);
        if (res?.items?.length) items = res.items;
        linkedId = id;
        renderLinked();
        onLinked?.();
      } catch (err) {
        mount.innerHTML = `<div class="sl-err">${escapeHtml(err.message || 'Could not file that.')}</div>`;
      }
      return;
    }
    if (t.dataset.sl === 'browse') { renderMatches(''); input.focus(); return; }
    if (t.dataset.sl === 'unlink') {
      try {
        const res = await detachSessionFromWatchlist(partner, detail.clientSessionId);
        if (res?.items?.length) items = res.items;
      } catch (err) { /* fall through — unlocking locally still makes sense */ }
      linkedId = null;
      input.readOnly = false;
      input.classList.remove('is-locked');
      input.focus();
      renderMatches(input.value);
      onLinked?.();
    }
  });

  input.addEventListener('input', () => { if (!linkedId) renderMatches(input.value); });
  input.addEventListener('focus', () => { if (!linkedId) renderMatches(input.value); });

  if (linkedId) renderLinked(); else renderSuggestion();
}
