// movieFilters.js — the filter bar above any movie grid.
//
// Design notes, since the shape of this wasn't obvious:
//
// • Four compact triggers that open popovers, NOT a wall of chips. With
//   thousands of films the catalogue carries dozens of genres and a 50-year
//   span; laying that out flat would be taller than the results it filters.
//   Collapsed, the bar is one line and reads as optional.
//
// • Options come from GET /api/recommendations/facets, never a hardcoded list.
//   The seeded dev catalogue says "Comedy" where the imported one says "comedy
//   film", and which streaming services appear depends on what the import
//   found — a baked-in list would offer options that match nothing, and would
//   do it silently.
//
// • Year is offered as decades rather than two number inputs. Nobody thinks
//   "1994 to 2003"; they think "the nineties". Ranges are generated from the
//   catalogue's real span so there are never empty buckets.
//
// • Multi-select is OR within a filter and AND across them — picking Netflix
//   and Prime means "on either", picking Netflix and Comedy means both must
//   hold. That's what these controls are read to mean, and the server
//   implements exactly that.
//
// • Popovers are position:fixed. The bar lives inside scrollable modals, and an
//   absolutely positioned panel would be clipped by the overflow.
'use strict';

import { escapeHtml } from '../lib/util.js';

const { apiRequest } = window;

// Facets change only when the catalogue is re-imported, and every overlay that
// opens wants them — fetched once per page rather than per open.
let facetsPromise = null;
function loadFacets() {
  if (!facetsPromise) {
    facetsPromise = apiRequest('/api/recommendations/facets').catch(() => null);
  }
  return facetsPromise;
}

const RATING_STEPS = [
  { value: '', label: 'Any rating' },
  { value: '6', label: '★ 6+' },
  { value: '7', label: '★ 7+' },
  { value: '8', label: '★ 8+' },
  { value: '9', label: '★ 9+  ·  the best of them' },
];

// Whole decades covering the catalogue's actual span, newest first. The most
// recent bucket is labelled by what it is rather than its decade, because
// "2020s" reads oddly while we're still in it.
function yearBuckets(range) {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return [];
  const out = [{ value: '', label: 'Any year' }];
  const thisYear = new Date().getFullYear();
  if (range.max >= thisYear - 5) {
    out.push({ value: `${thisYear - 5}:`, label: 'Last 5 years' });
  }
  const top = Math.floor(range.max / 10) * 10;
  const bottom = Math.floor(range.min / 10) * 10;
  for (let d = top; d >= bottom && out.length < 8; d -= 10) {
    out.push({ value: `${d}:${d + 9}`, label: `${d}s` });
  }
  if (bottom > range.min) out.push({ value: `:${bottom - 1}`, label: `Before ${bottom}` });
  return out;
}

// createMovieFilters({ onChange }) → { el, params(), isActive(), setCount(n, noun) }
// `onChange` fires whenever a selection changes; the caller re-queries with
// params() and calls setCount() with what came back.
export function createMovieFilters({ onChange } = {}) {
  const state = { providers: new Set(), genres: new Set(), year: '', ratingMin: '' };

  const el = document.createElement('div');
  el.className = 'mf-bar';
  el.innerHTML = `
    <div class="mf-chips" id="mfChips"></div>
    <div class="mf-meta">
      <span class="mf-count" id="mfCount"></span>
      <button type="button" class="mf-clear" id="mfClear" hidden>Clear all</button>
    </div>`;

  const chipsEl = el.querySelector('#mfChips');
  const countEl = el.querySelector('#mfCount');
  const clearEl = el.querySelector('#mfClear');
  let openPop = null;

  function closePop() {
    if (!openPop) return;
    openPop.pop.remove();
    openPop.chip.classList.remove('is-open');
    openPop = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onDocKey, true);
    window.removeEventListener('scroll', closePop, true);
    window.removeEventListener('resize', closePop);
  }
  function onDocDown(e) {
    if (openPop && !openPop.pop.contains(e.target) && !openPop.chip.contains(e.target)) closePop();
  }
  function onDocKey(e) { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } }

  function openPopover(chip, render) {
    if (openPop && openPop.chip === chip) { closePop(); return; }
    closePop();
    const pop = document.createElement('div');
    pop.className = 'mf-pop';
    pop.innerHTML = render();
    document.body.appendChild(pop);

    // Fixed positioning, flipped up when there isn't room below — the bar often
    // sits near the bottom of a short modal.
    const r = chip.getBoundingClientRect();
    const h = pop.offsetHeight;
    const below = window.innerHeight - r.bottom;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = (below < h + 12 && r.top > h + 12)
      ? `${r.top - h - 6}px`
      : `${r.bottom + 6}px`;

    chip.classList.add('is-open');
    openPop = { chip, pop };
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onDocKey, true);
    // Closing on scroll rather than tracking it: a fixed panel would otherwise
    // detach from its trigger the moment the list behind it moves.
    window.addEventListener('scroll', closePop, true);
    window.addEventListener('resize', closePop);
    return pop;
  }

  function optionRow(checked, label, count, value, kind) {
    return `
      <button type="button" class="mf-opt${checked ? ' is-on' : ''}" data-kind="${kind}" data-value="${escapeHtml(value)}">
        <span class="mf-opt-tick" aria-hidden="true">${checked ? '✓' : ''}</span>
        <span class="mf-opt-label">${escapeHtml(label)}</span>
        ${count != null ? `<span class="mf-opt-count">${count}</span>` : ''}
      </button>`;
  }

  function changed() {
    renderChips();
    if (onChange) onChange();
  }

  function bindOptions(pop, multi, set) {
    pop.querySelectorAll('.mf-opt').forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.dataset.value;
        if (multi) {
          if (set.has(v)) set.delete(v); else set.add(v);
          // Kept open for multi-select: choosing two services is one thought,
          // and reopening the panel between them would be tedious.
          b.classList.toggle('is-on');
          b.querySelector('.mf-opt-tick').textContent = set.has(v) ? '✓' : '';
          changed();
        } else {
          set(v);
          closePop();
          changed();
        }
      });
    });
  }

  async function renderChips() {
    const facets = await loadFacets();
    if (!facets) { el.style.display = 'none'; return; }

    const providerLabel = () => {
      if (!state.providers.size) return 'Available on';
      const first = facets.providers.find((p) => state.providers.has(p.value));
      const name = first ? first.label : [...state.providers][0];
      return state.providers.size > 1 ? `${name} +${state.providers.size - 1}` : name;
    };
    const genreLabel = () => {
      if (!state.genres.size) return 'Genre';
      const [first] = [...state.genres];
      return state.genres.size > 1 ? `${first} +${state.genres.size - 1}` : first;
    };
    const buckets = yearBuckets(facets.yearRange);
    const yearLabel = () => buckets.find((b) => b.value === state.year)?.label || 'Year';
    const ratingLabel = () => (state.ratingMin ? `★ ${state.ratingMin}+` : 'Rating');

    const defs = [
      { key: 'providers', label: providerLabel(), on: state.providers.size > 0, hide: !facets.providers.length },
      { key: 'genres', label: genreLabel(), on: state.genres.size > 0, hide: !facets.genres.length },
      { key: 'year', label: yearLabel(), on: !!state.year, hide: buckets.length < 2 },
      { key: 'rating', label: ratingLabel(), on: !!state.ratingMin, hide: false },
    ].filter((d) => !d.hide);

    chipsEl.innerHTML = defs.map((d) => `
      <button type="button" class="mf-chip${d.on ? ' is-active' : ''}" data-key="${d.key}">
        <span>${escapeHtml(d.label)}</span>
        <span class="mf-caret" aria-hidden="true">▾</span>
      </button>`).join('');

    chipsEl.querySelectorAll('.mf-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.key;
        if (key === 'providers') {
          const pop = openPopover(chip, () => `<div class="mf-pop-title">Available on</div>` +
            facets.providers.map((p) => optionRow(state.providers.has(p.value), p.label, p.count, p.value, 'p')).join(''));
          if (pop) bindOptions(pop, true, state.providers);
        } else if (key === 'genres') {
          const pop = openPopover(chip, () => `<div class="mf-pop-title">Genre</div>` +
            facets.genres.map((g) => optionRow(state.genres.has(g.value), g.value, g.count, g.value, 'g')).join(''));
          if (pop) bindOptions(pop, true, state.genres);
        } else if (key === 'year') {
          const pop = openPopover(chip, () => `<div class="mf-pop-title">Year</div>` +
            buckets.map((b) => optionRow(state.year === b.value, b.label, null, b.value, 'y')).join(''));
          if (pop) bindOptions(pop, false, (v) => { state.year = v; });
        } else {
          const pop = openPopover(chip, () => `<div class="mf-pop-title">Minimum rating</div>` +
            RATING_STEPS.map((s) => optionRow(state.ratingMin === s.value, s.label, null, s.value, 'r')).join(''));
          if (pop) bindOptions(pop, false, (v) => { state.ratingMin = v; });
        }
      });
    });

    clearEl.hidden = !isActive();
  }

  function isActive() {
    return state.providers.size > 0 || state.genres.size > 0 || !!state.year || !!state.ratingMin;
  }

  function clearAll() {
    state.providers.clear();
    state.genres.clear();
    state.year = '';
    state.ratingMin = '';
    closePop();
    changed();
  }
  clearEl.addEventListener('click', clearAll);

  renderChips();

  return {
    el,
    isActive,
    // Exposed so an empty-results state can offer the way out of it, which is
    // where people actually notice they're over-filtered.
    clear: clearAll,
    // The query params the current selection maps to. Year buckets are stored
    // as "min:max" with either side optional, so one control produces both
    // bounds without the caller knowing how it's encoded.
    params() {
      const p = {};
      if (state.providers.size) p.providers = [...state.providers].join(',');
      if (state.genres.size) p.genres = [...state.genres].join(',');
      if (state.ratingMin) p.ratingMin = state.ratingMin;
      if (state.year) {
        const [min, max] = state.year.split(':');
        if (min) p.yearMin = min;
        if (max) p.yearMax = max;
      }
      return p;
    },
    setCount(n, noun = 'film') {
      countEl.textContent = typeof n === 'number'
        ? `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`
        : '';
    },
    destroy: closePop,
  };
}
