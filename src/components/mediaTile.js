// mediaTile.js — one photo-or-video moment thumbnail. Photos are a plain
// <img>; videos render their poster frame (image_filename — the same still
// collage the photo path produces, see server/src/moments.js) with a play
// affordance. Nothing heavier than the poster ever loads for a tile: the
// clip itself only downloads once the viewer is actually opened.
//
// Clicking either kind opens the fullscreen media viewer (see
// mediaViewer.js). Videos deliberately do NOT play inside the tile — a
// carousel of small autoplaying clips was noisy and fought the carousel for
// the click; a video is watched in the viewer, at size, with real controls.
'use strict';

import { openMediaViewer } from './mediaViewer.js';

const { momentImageUrl } = window;

// `moment` is anything hydrateMoments() on the server produced: needs
// .url, .mediaType, .videoUrl, .durationMs. The tile carries the few fields
// the viewer needs in data-* so the delegated handler can open it without
// the rendering page having to keep the moment objects around.
export function renderMediaTile(moment, opts = {}) {
  const cls = opts.className || '';
  const common = `data-moment-id="${moment.id}" data-poster="${momentImageUrl(moment.url)}"`;
  if (moment.mediaType !== 'video') {
    return `
      <div class="media-tile media-tile-photo ${cls}" ${common} role="button" tabindex="0" aria-label="Open photo">
        <img src="${momentImageUrl(moment.url)}" alt="A captured moment" class="media-tile-img" loading="lazy" decoding="async">
      </div>`;
  }
  const seconds = moment.durationMs ? Math.round(moment.durationMs / 1000) : null;
  return `
    <div class="media-tile media-tile-video ${cls}" ${common} data-video-src="${momentImageUrl(moment.videoUrl)}"
         data-duration-ms="${moment.durationMs || ''}"
         role="button" tabindex="0" aria-label="Play video moment">
      <img src="${momentImageUrl(moment.url)}" alt="A captured video moment" class="media-tile-poster" loading="lazy" decoding="async">
      <button class="media-tile-play" aria-label="Play video moment" tabindex="-1">▶</button>
      ${seconds ? `<span class="media-tile-duration">${seconds}s</span>` : ''}
    </div>
  `;
}

// One delegated handler per page/container: opens the fullscreen viewer for
// whichever tile was activated. Keyboard-activatable too, since the tiles
// are role="button".
// `opts.viewerOptsFor(tile)` lets a page add viewer options per tile — the
// session page uses it to hand the viewer its comments/review side panel.
export function attachMediaTileHandlers(container, opts = {}) {
  const open = (tile) => {
    const isVideo = tile.classList.contains('media-tile-video');
    // Rebuilt from data-* rather than a captured object: these URLs are
    // already absolute (momentImageUrl ran at render), and mediaViewer's
    // mediaUrl() join is a no-op on an absolute URL.
    openMediaViewer({
      id: tile.dataset.momentId,
      mediaType: isVideo ? 'video' : 'photo',
      url: tile.dataset.poster,
      videoUrl: isVideo ? tile.dataset.videoSrc : null,
      durationMs: Number(tile.dataset.durationMs) || null,
    }, { caption: tile.dataset.caption || '', ...(opts.viewerOptsFor?.(tile) || {}) });
  };

  container.addEventListener('click', (e) => {
    const tile = e.target.closest('.media-tile');
    if (!tile || !container.contains(tile)) return;
    // Never swallow a click meant for a control layered over the tile
    // (e.g. a moment's ⋯ menu in a carousel item).
    if (e.target.closest('.post-menu, .inline-editor')) return;
    // Inside a carousel, only the focused item opens — clicking a
    // neighbour means "bring that one forward", which carousel.js handles.
    const slide = tile.closest('.carousel-item');
    if (slide && !slide.classList.contains('is-active')) return;
    e.preventDefault();
    open(tile);
  });

  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tile = e.target.closest('.media-tile');
    if (!tile) return;
    e.preventDefault();
    open(tile);
  });
}
