// carousel.js — two carousels behind one API.
//
// `mode: '3d'` (a session's captured moments) is a coverflow: one large
// focused item with its neighbours angled back in perspective either side.
// Position is state, not scroll offset — the active index lives on the
// element and every item's transform is derived from its distance to it, so
// there's no scroll container to fight and nothing to snap. It replaced the
// plain scrolling strip, which showed small tiles in a scrollbar-driven row.
//
// The default mode is that original strip (native momentum scroll + snap,
// arrows layered on top), still used by the movie page's gallery — a row of
// thumbnails is what that surface wants, and it's deliberately untouched.
'use strict';

// How many neighbours stay visible either side of the focused item; beyond
// this they're faded out entirely rather than stacking up forever.
const VISIBLE_NEIGHBOURS = 2;

export function renderCarousel(itemsHtml, { id, className = '', mode } = {}) {
  if (!itemsHtml.length) return '';
  if (mode !== '3d') {
    // Original strip — unchanged.
    return `
      <div class="carousel ${className}" id="${id || ''}">
        <div class="carousel-track">${itemsHtml.join('')}</div>
        ${itemsHtml.length > 1 ? `
          <button class="carousel-arrow carousel-arrow-prev" aria-label="Scroll left">‹</button>
          <button class="carousel-arrow carousel-arrow-next" aria-label="Scroll right">›</button>
        ` : ''}
      </div>
    `;
  }
  const single = itemsHtml.length === 1;
  return `
    <div class="carousel carousel-3d ${single ? 'carousel-single' : ''} ${className}" id="${id || ''}"
         data-active="0" data-count="${itemsHtml.length}"
         ${single ? '' : 'tabindex="0" role="group" aria-roledescription="carousel" aria-label="Captured moments"'}>
      <div class="carousel-stage">
        <div class="carousel-track">${itemsHtml.join('')}</div>
      </div>
      ${single ? '' : `
        <button class="carousel-arrow carousel-arrow-prev" aria-label="Previous moment">‹</button>
        <button class="carousel-arrow carousel-arrow-next" aria-label="Next moment">›</button>
        <div class="carousel-dots">
          ${itemsHtml.map((_, i) => `<button class="carousel-dot" data-index="${i}" aria-label="Go to moment ${i + 1}"></button>`).join('')}
        </div>
      `}
    </div>
  `;
}

// Lays every item out relative to the focused one. Called on mount and on
// every move — cheap (a transform/opacity write per item, all compositor
// properties, no layout).
function layout(carousel) {
  const items = [...carousel.querySelectorAll('.carousel-item')];
  const active = Number(carousel.dataset.active) || 0;
  items.forEach((item, i) => {
    const offset = i - active;
    const dist = Math.abs(offset);
    const beyond = dist > VISIBLE_NEIGHBOURS;
    const dir = Math.sign(offset);
    // Neighbours sit progressively further out, smaller, and rotated away
    // from the viewer — the coverflow read.
    const x = offset * 52;
    const scale = Math.max(0.62, 1 - dist * 0.18);
    const rotate = -dir * Math.min(dist, VISIBLE_NEIGHBOURS) * 26;
    const z = -dist * 120;
    item.style.transform = `translateX(${x}%) translateZ(${z}px) rotateY(${rotate}deg) scale(${scale})`;
    item.style.opacity = beyond ? '0' : String(Math.max(0.25, 1 - dist * 0.42));
    item.style.zIndex = String(100 - dist);
    // Only the focused item is interactive; the others are scenery until
    // they're brought forward (clicking one moves to it — see below).
    item.style.pointerEvents = beyond ? 'none' : 'auto';
    item.classList.toggle('is-active', offset === 0);
    item.setAttribute('aria-hidden', offset === 0 ? 'false' : 'true');
  });
  carousel.querySelectorAll('.carousel-dot').forEach((d, i) => {
    d.classList.toggle('is-active', i === active);
  });
  const count = Number(carousel.dataset.count) || items.length;
  const prev = carousel.querySelector('.carousel-arrow-prev');
  const next = carousel.querySelector('.carousel-arrow-next');
  if (prev) prev.disabled = active <= 0;
  if (next) next.disabled = active >= count - 1;
}

function goTo(carousel, index) {
  const count = Number(carousel.dataset.count) || 1;
  const next = Math.min(Math.max(index, 0), count - 1);
  if (next === Number(carousel.dataset.active)) return;
  carousel.dataset.active = String(next);
  layout(carousel);
}

// `container` is the page's feed/content element — the same delegated
// pattern every other component here uses, so carousels rendered by a later
// page of infinite scroll need no extra wiring.
export function attachCarouselHandlers(container) {
  // Newly-rendered 3d carousels have inline transforms only once laid out;
  // a MutationObserver keeps paginated/re-rendered ones covered.
  const layoutAll = () => container.querySelectorAll('.carousel-3d').forEach(layout);
  layoutAll();
  new MutationObserver(layoutAll).observe(container, { childList: true, subtree: true });

  container.addEventListener('click', (e) => {
    const carousel = e.target.closest('.carousel');
    if (!carousel) return;

    // Strip mode (movie gallery): arrows scroll the track, exactly as before.
    if (!carousel.classList.contains('carousel-3d')) {
      const prev = e.target.closest('.carousel-arrow-prev');
      const next = e.target.closest('.carousel-arrow-next');
      if (!prev && !next) return;
      const track = carousel.querySelector('.carousel-track');
      const amount = track.clientWidth * 0.85;
      track.scrollBy({ left: next ? amount : -amount, behavior: 'smooth' });
      return;
    }

    const dot = e.target.closest('.carousel-dot');
    if (dot) { goTo(carousel, Number(dot.dataset.index)); return; }
    if (e.target.closest('.carousel-arrow-prev')) { goTo(carousel, Number(carousel.dataset.active) - 1); return; }
    if (e.target.closest('.carousel-arrow-next')) { goTo(carousel, Number(carousel.dataset.active) + 1); return; }

    // A click on a neighbour brings it forward instead of opening it — the
    // media viewer only ever opens the item you're actually looking at
    // (mediaTile.js enforces the same rule from its side).
    const item = e.target.closest('.carousel-item');
    if (item && !item.classList.contains('is-active')) {
      const items = [...carousel.querySelectorAll('.carousel-item')];
      goTo(carousel, items.indexOf(item));
    }
  });

  container.addEventListener('keydown', (e) => {
    const carousel = e.target.closest('.carousel-3d');
    if (!carousel || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    goTo(carousel, Number(carousel.dataset.active) + (e.key === 'ArrowRight' ? 1 : -1));
  });

  // Swipe / drag — one pointer, horizontal, past a threshold. Deliberately
  // does not preventDefault on move, so a vertical scroll of the feed
  // through a carousel still works normally.
  let start = null;
  container.addEventListener('pointerdown', (e) => {
    const carousel = e.target.closest('.carousel-3d:not(.carousel-single)');
    if (!carousel) return;
    start = { x: e.clientX, y: e.clientY, carousel };
  });
  container.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const { carousel } = start;
    start = null;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;
    goTo(carousel, Number(carousel.dataset.active) + (dx < 0 ? 1 : -1));
  });
  container.addEventListener('pointercancel', () => { start = null; });
}
