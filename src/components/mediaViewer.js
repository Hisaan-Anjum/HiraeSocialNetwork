// mediaViewer.js — the fullscreen overlay a moment's media opens into.
// Photos get zoom (wheel / buttons / double-click / pinch) and panning;
// videos get native controls and fullscreen playback. Replaces the old
// click-to-zoom lightbox in lib/util.js, which showed one static image at
// whatever size it happened to be and nothing else.
//
// One overlay element is built per open and torn down on close — nothing
// persists between views, so a stale zoom/pan or a still-playing video can
// never leak into the next thing opened.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { openShareSheet } from './shareSheet.js';

const { mediaUrl } = window;

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

let openViewer = null; // { close } while an overlay is up, else null

// `item` is a hydrated moment (needs .mediaType, .url, .videoUrl) — the same
// shape renderMediaTile takes, so callers pass what they already have.
export function openMediaViewer(item, opts = {}) {
  if (openViewer) openViewer.close();

  const isVideo = item.mediaType === 'video' && item.videoUrl;
  const overlay = document.createElement('div');
  overlay.className = 'mv-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', isVideo ? 'Video moment' : 'Photo moment');

  overlay.innerHTML = `
    <div class="mv-main">
      <div class="mv-topbar">
        <div class="mv-caption">${opts.caption ? escapeHtml(opts.caption) : ''}</div>
        <div class="mv-actions">
          ${isVideo ? '' : `
            <button class="mv-btn" data-mv="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
            <span class="mv-zoom-level" aria-live="off">100%</span>
            <button class="mv-btn" data-mv="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
            <button class="mv-btn" data-mv="zoom-reset" aria-label="Reset zoom" title="Reset zoom">⟲</button>
          `}
          ${opts.shareItem ? '<button class="mv-btn mv-btn-share" data-mv="share" aria-label="Share this moment" title="Share">❤ Share</button>' : ''}
          <button class="mv-btn" data-mv="fullscreen" aria-label="Fullscreen" title="Fullscreen">⛶</button>
          <button class="mv-btn mv-btn-close" data-mv="close" aria-label="Close" title="Close (Esc)">✕</button>
        </div>
      </div>
      <div class="mv-stage">
        ${isVideo
          ? `<div class="mv-video-wrap">
               <video class="mv-video" src="${escapeHtml(mediaUrl(item.videoUrl))}" poster="${escapeHtml(mediaUrl(item.url))}"
                      autoplay playsinline preload="metadata"></video>
               <div class="mv-vc">
                 <button class="mv-vc-btn" data-vc="play" aria-label="Pause">⏸</button>
                 <span class="mv-vc-time mv-vc-current">0:00</span>
                 <input type="range" class="mv-vc-seek" min="0" max="1000" step="1" value="0" aria-label="Seek">
                 <span class="mv-vc-time mv-vc-duration">0:00</span>
                 <button class="mv-vc-btn" data-vc="mute" aria-label="Mute">🔊</button>
                 <input type="range" class="mv-vc-vol" min="0" max="1" step="0.05" value="1" aria-label="Volume">
                 <button class="mv-vc-btn" data-vc="fs" aria-label="Fullscreen">⛶</button>
               </div>
             </div>`
          : `<img class="mv-image" src="${escapeHtml(mediaUrl(item.url))}" alt="A captured moment" draggable="false">`}
      </div>
      ${isVideo ? '' : '<div class="mv-hint">Scroll or pinch to zoom · drag to pan · double-click to reset</div>'}
    </div>
  `;
  // Optional right-hand panel (the session page passes its comments/likes/
  // review/metadata column here). The caller owns the element — it's moved
  // into this overlay for the viewer's lifetime and survives the close, so
  // the caller's delegated handlers (attached once) keep working across
  // opens.
  if (opts.panelEl) {
    overlay.classList.add('has-panel');
    opts.panelEl.classList.add('mv-panel');
    overlay.appendChild(opts.panelEl);
  }
  document.body.appendChild(overlay);
  // The page behind must not scroll while the overlay owns the screen.
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const stage = overlay.querySelector('.mv-stage');
  const media = overlay.querySelector(isVideo ? '.mv-video' : '.mv-image');

  // ── Close ──
  // Set by the photo path below for listeners bound outside `overlay`
  // (which removing the element wouldn't clean up on its own).
  let extraCleanup = null;
  const close = () => {
    if (openViewer !== api) return;
    openViewer = null;
    document.removeEventListener('keydown', onKey);
    extraCleanup?.();
    if (document.fullscreenElement && overlay.contains(document.fullscreenElement)) {
      document.exitFullscreen().catch(() => {});
    }
    // Stop playback explicitly — removing the element alone can leave audio
    // running for a beat in some Chromium builds.
    if (isVideo) { try { media.pause(); media.removeAttribute('src'); media.load(); } catch (e) {} }
    document.body.style.overflow = prevBodyOverflow;
    overlay.remove();
  };
  const api = { close };
  openViewer = api;

  const onKey = (e) => {
    // Typing in the side panel (comment box, caption editor) must never
    // trigger the viewer's shortcuts — otherwise '+', '-' and '0' zoom the
    // photo instead of appearing in the text, and Esc throws away the
    // draft by closing the whole overlay (blur the field instead).
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      if (e.key === 'Escape') { e.preventDefault(); t.blur(); }
      return;
    }
    if (e.key === 'Escape') {
      // Esc leaves fullscreen first (the browser handles that itself);
      // only close the overlay when it isn't fullscreen.
      if (!document.fullscreenElement) { e.preventDefault(); close(); }
      return;
    }
    if (isVideo) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.3); }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.3); }
    if (e.key === '0') { e.preventDefault(); reset(); }
  };
  document.addEventListener('keydown', onKey);

  // ONLY the media goes fullscreen — never the overlay, the stage box or
  // the page. For a photo that's the <img> itself; for a video it's the
  // tight player wrap (the video plus its own control bar — a fullscreen
  // <video> with no controls attribute would be uncontrollable).
  const fsTarget = isVideo ? overlay.querySelector('.mv-video-wrap') : media;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    fsTarget.requestFullscreen?.().catch(() => {});
  };

  overlay.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mv]');
    if (btn) {
      const action = btn.dataset.mv;
      if (action === 'close') close();
      else if (action === 'share') openShareSheet(opts.shareItem);
      else if (action === 'fullscreen') toggleFullscreen();
      else if (action === 'zoom-in') zoomBy(1.4);
      else if (action === 'zoom-out') zoomBy(1 / 1.4);
      else if (action === 'zoom-reset') reset();
      return;
    }
    // Backdrop click closes; a click on the media itself must not (you're
    // panning/scrubbing it).
    if (e.target === overlay || e.target === stage) close();
  });

  if (isVideo) {
    setupVideoControls(overlay, media, item.durationMs);
    media.play().catch(() => { /* autoplay blocked — the play button is right there */ });
    return api;
  }

  // ── Photo: zoom + pan ────────────────────────────────────────────────
  let scale = 1;
  let tx = 0;
  let ty = 0;
  const zoomLabel = overlay.querySelector('.mv-zoom-level');

  const paint = () => {
    media.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    media.classList.toggle('mv-zoomed', scale > 1);
    if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  };

  // The box zoom/pan is measured against — normally the stage, but while
  // the <img> itself is fullscreened its frame IS the viewport.
  const stageBox = () => (document.fullscreenElement === media
    ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    : stage.getBoundingClientRect());

  // Keeps the image from being dragged off into empty space: at any scale,
  // panning is bounded to the overflow that scale actually produces.
  const clampPan = () => {
    const rect = stageBox();
    const w = media.clientWidth * scale;
    const h = media.clientHeight * scale;
    const maxX = Math.max(0, (w - rect.width) / 2);
    const maxY = Math.max(0, (h - rect.height) / 2);
    tx = clamp(tx, -maxX, maxX);
    ty = clamp(ty, -maxY, maxY);
  };

  const setScale = (next, originX, originY) => {
    const prev = scale;
    scale = clamp(next, MIN_SCALE, MAX_SCALE);
    if (scale === prev) return;
    if (scale === 1) { tx = 0; ty = 0; }
    else if (originX !== undefined) {
      // Zoom toward the cursor/pinch midpoint rather than the image centre,
      // so the point under the pointer stays under it.
      const rect = stageBox();
      const cx = originX - rect.left - rect.width / 2;
      const cy = originY - rect.top - rect.height / 2;
      const ratio = scale / prev;
      tx = cx - (cx - tx) * ratio;
      ty = cy - (cy - ty) * ratio;
    }
    clampPan();
    paint();
  };
  const zoomBy = (f) => setScale(scale * f);
  const reset = () => { scale = 1; tx = 0; ty = 0; paint(); };

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    setScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
  }, { passive: false });

  media.addEventListener('dblclick', (e) => {
    e.preventDefault();
    if (scale > 1) reset();
    else setScale(2.5, e.clientX, e.clientY);
  });

  // Pointer Events cover mouse, touch and pen with one path — and give
  // pinch-to-zoom on touch screens by tracking two pointers at once.
  const pointers = new Map();
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let panStart = null;

  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const mid = () => {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  media.addEventListener('pointerdown', (e) => {
    media.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      pinchStartDist = dist();
      pinchStartScale = scale;
      panStart = null;
    } else if (pointers.size === 1 && scale > 1) {
      panStart = { x: e.clientX - tx, y: e.clientY - ty };
    }
  });

  media.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinchStartDist > 0) {
      e.preventDefault();
      const m = mid();
      setScale(pinchStartScale * (dist() / pinchStartDist), m.x, m.y);
    } else if (panStart && pointers.size === 1) {
      e.preventDefault();
      tx = e.clientX - panStart.x;
      ty = e.clientY - panStart.y;
      clampPan();
      paint();
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = 0;
    if (pointers.size === 0) panStart = null;
  };
  media.addEventListener('pointerup', endPointer);
  media.addEventListener('pointercancel', endPointer);

  // A resize (incl. entering/leaving fullscreen) changes the stage box, so
  // an existing pan can fall out of bounds.
  const onResize = () => { clampPan(); paint(); };
  window.addEventListener('resize', onResize);
  extraCleanup = () => window.removeEventListener('resize', onResize);

  paint();
  return api;
}

function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// The Herae player: a custom control bar over the plain HTML5 <video> —
// playback itself is untouched, this only replaces the browser chrome.
// `durationMsHint`: MediaRecorder's webm files often report duration as
// Infinity until the whole file has been scanned, so the moment's own
// stored duration seeds the bar immediately; the seek-to-end trick below
// then gets Chrome to compute the real value.
function setupVideoControls(overlay, video, durationMsHint) {
  const wrap = overlay.querySelector('.mv-video-wrap');
  const playBtn = wrap.querySelector('[data-vc="play"]');
  const muteBtn = wrap.querySelector('[data-vc="mute"]');
  const fsBtn = wrap.querySelector('[data-vc="fs"]');
  const seek = wrap.querySelector('.mv-vc-seek');
  const vol = wrap.querySelector('.mv-vc-vol');
  const curEl = wrap.querySelector('.mv-vc-current');
  const durEl = wrap.querySelector('.mv-vc-duration');

  let duration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : (durationMsHint ? durationMsHint / 1000 : 0);
  const paintDuration = () => { durEl.textContent = fmtTime(duration); };
  paintDuration();

  video.addEventListener('loadedmetadata', () => {
    if (video.duration === Infinity) {
      // Classic Chrome workaround: seeking far past the end forces the
      // demuxer to find the true duration, reported via durationchange.
      video.currentTime = 1e7;
      const onDur = () => {
        if (!Number.isFinite(video.duration)) return;
        duration = video.duration;
        video.currentTime = 0;
        paintDuration();
        video.removeEventListener('durationchange', onDur);
      };
      video.addEventListener('durationchange', onDur);
    } else if (Number.isFinite(video.duration) && video.duration > 0) {
      duration = video.duration;
      paintDuration();
    }
  });

  const paintPlay = () => {
    playBtn.textContent = video.paused ? '▶' : '⏸';
    playBtn.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    wrap.classList.toggle('is-paused', video.paused);
  };
  const togglePlay = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
  video.addEventListener('play', paintPlay);
  video.addEventListener('pause', paintPlay);
  video.addEventListener('ended', paintPlay);
  playBtn.addEventListener('click', togglePlay);
  video.addEventListener('click', togglePlay);
  paintPlay();

  let scrubbing = false;
  video.addEventListener('timeupdate', () => {
    curEl.textContent = fmtTime(video.currentTime);
    if (!scrubbing && duration > 0) seek.value = String(Math.round((video.currentTime / duration) * 1000));
  });
  seek.addEventListener('input', () => {
    scrubbing = true;
    if (duration > 0) curEl.textContent = fmtTime((Number(seek.value) / 1000) * duration);
  });
  seek.addEventListener('change', () => {
    if (duration > 0) video.currentTime = (Number(seek.value) / 1000) * duration;
    scrubbing = false;
  });

  const paintMute = () => {
    muteBtn.textContent = (video.muted || video.volume === 0) ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', video.muted ? 'Unmute' : 'Mute');
  };
  muteBtn.addEventListener('click', () => { video.muted = !video.muted; });
  vol.addEventListener('input', () => {
    video.volume = Number(vol.value);
    video.muted = vol.value === '0';
  });
  video.addEventListener('volumechange', () => {
    paintMute();
    if (!video.muted) vol.value = String(video.volume);
  });
  paintMute();

  // Same media-only rule as the topbar button: fullscreen the player wrap
  // (video + this bar), nothing else.
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else wrap.requestFullscreen?.().catch(() => {});
  });
}
