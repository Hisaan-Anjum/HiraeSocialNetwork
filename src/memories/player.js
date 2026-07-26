// player.js — the Memory Story player. Renders a manifest (see engine.js) as a
// premium, documentary-style sequence: opening → title → stats → timeline →
// cinematic moment montage → top-rated sessions → comments → ending. It is
// deliberately DOM+CSS (Ken Burns, staggered reveals), not a slideshow and not
// a pre-rendered video — playback re-renders from CDN media each time, which is
// what makes stories free to store and instant to open. Instagram-story style
// controls: tap right/left to move, hold to pause, Esc to close.
'use strict';

import { escapeHtml } from '../lib/util.js';

// Build the ordered scene list from a manifest. Each scene: { html or build(),
// duration(ms), kind }. Durations vary a little by variant for pacing variety.
function buildScenes(m) {
  const scenes = [];
  const accent = m.variant?.accent || 'purple';
  const names = `${escapeHtml(m.names.me)} & ${escapeHtml(m.names.them)}`;

  // 1 — opening title
  scenes.push({
    kind: 'title',
    duration: 3200,
    html: `
      <div class="ms-scene ms-title ms-intro-${m.variant?.intro || 'fade'}">
        <div class="ms-title-emoji">${escapeHtml(m.emoji || '❤️')}</div>
        <div class="ms-title-names">${names}</div>
        <h1 class="ms-title-main">${escapeHtml(m.title)}</h1>
        ${m.subtitle ? `<div class="ms-title-sub">${escapeHtml(m.subtitle)}</div>` : ''}
      </div>`,
  });

  // 2 — stats (lead stat is biggest; the rest tile in)
  if (m.stats?.length) {
    const [lead, ...rest] = m.stats;
    scenes.push({
      kind: 'stats',
      duration: 3800,
      html: `
        <div class="ms-scene ms-stats">
          <div class="ms-stat-lead">
            <div class="ms-stat-emoji">${escapeHtml(lead.emoji)}</div>
            <div class="ms-stat-num" data-count="${lead.value}">${lead.value}</div>
            <div class="ms-stat-label">${escapeHtml(lead.label)}</div>
          </div>
          ${rest.length ? `<div class="ms-stat-row">${rest.map((s, i) => `
            <div class="ms-stat-mini" style="animation-delay:${0.4 + i * 0.18}s">
              <span class="ms-stat-mini-num">${s.value}</span>
              <span class="ms-stat-mini-label">${escapeHtml(s.emoji)} ${escapeHtml(s.label)}</span>
            </div>`).join('')}</div>` : ''}
        </div>`,
    });
  }

  // 3 — timeline highlights
  if (m.timeline?.length) {
    scenes.push({
      kind: 'timeline',
      duration: 3800,
      html: `
        <div class="ms-scene ms-tl">
          <div class="ms-scene-kicker">Along the way</div>
          <div class="ms-tl-list">
            ${m.timeline.map((t, i) => `
              <div class="ms-tl-item" style="animation-delay:${0.25 + i * 0.28}s">
                <span class="ms-tl-emoji">${escapeHtml(t.emoji)}</span>
                <span class="ms-tl-title">${escapeHtml(t.title)}</span>
                ${t.dateLabel ? `<span class="ms-tl-date">${escapeHtml(t.dateLabel)}</span>` : ''}
              </div>`).join('')}
          </div>
        </div>`,
    });
  }

  // 4 — the cinematic montage, one scene per moment
  m.scenes.forEach((sc, i) => {
    const kb = m.variant?.transition === 'kenburns' || (m.variant?.transition === 'crossfade' && i % 2 === 0);
    scenes.push({
      kind: 'moment',
      duration: sc.videoUrl ? 5200 : 3400,
      build() {
        const el = document.createElement('div');
        el.className = 'ms-scene ms-moment';
        // The moment is shown WHOLE (object-fit: contain) — a photo or clip
        // that isn't the screen's aspect ratio must never lose its edges, and
        // people frame their moments deliberately. The gap that leaves is
        // filled with a blurred, dimmed copy of the same image rather than
        // black bars, which is what keeps it looking composed instead of
        // letterboxed.
        const backdrop = `<div class="ms-media-bg" style="background-image:url('${escapeHtml(sc.url || '')}')"></div>`;
        if (sc.videoUrl) {
          el.innerHTML = `
            ${backdrop}
            <video class="ms-media" src="${escapeHtml(sc.videoUrl)}" poster="${escapeHtml(sc.url || '')}" muted playsinline loop></video>
            <div class="ms-vignette"></div>
            ${captionHtml(sc)}`;
        } else {
          el.innerHTML = `
            ${backdrop}
            <img class="ms-media ${kb ? 'ms-kenburns' : 'ms-fadein'}" src="${escapeHtml(sc.url)}" alt="">
            <div class="ms-vignette"></div>
            ${captionHtml(sc)}`;
        }
        return el;
      },
    });
  });

  // 5 — top sessions
  if (m.topSessions?.length) {
    // Nights filed under a shared-watchlist film get their real cover art; the
    // rest keep the plain row. Whichever a story has, the scene stays balanced
    // rather than half-empty — hence the poster/no-poster variants below.
    const anyArt = m.topSessions.some((s) => s.posterUrl);
    scenes.push({
      kind: 'top',
      duration: anyArt ? 4200 : 3600,
      html: `
        <div class="ms-scene ms-top${anyArt ? ' ms-top-art' : ''}">
          <div class="ms-scene-kicker">Your best nights</div>
          ${m.topSessions.map((s, i) => `
            <div class="ms-top-item" style="animation-delay:${0.3 + i * 0.25}s">
              ${anyArt ? `<span class="ms-top-poster${s.posterUrl ? '' : ' is-blank'}"
                    style="${s.posterUrl ? `background-image:url('${escapeHtml(s.posterUrl)}')` : ''}"
                >${s.posterUrl ? '' : '🎬'}</span>` : ''}
              <span class="ms-top-info">
                <span class="ms-top-title">${escapeHtml(s.title)}</span>
                ${s.year ? `<span class="ms-top-year">${escapeHtml(String(s.year))}</span>` : ''}
              </span>
              <span class="ms-top-rating">${'★'.repeat(Math.round(s.rating))}<span class="ms-top-num">${s.rating}</span></span>
            </div>`).join('')}
        </div>`,
    });
  }

  // 6 — comments
  if (m.comments?.length) {
    scenes.push({
      kind: 'comments',
      duration: 3800,
      html: `
        <div class="ms-scene ms-comments">
          <div class="ms-scene-kicker">Things you said</div>
          ${m.comments.map((c, i) => `
            <blockquote class="ms-quote" style="animation-delay:${0.3 + i * 0.35}s">
              <span class="ms-quote-text">“${escapeHtml(c.text)}”</span>
              <span class="ms-quote-who">— ${escapeHtml(c.username)}</span>
            </blockquote>`).join('')}
        </div>`,
    });
  }

  // 7 — ending
  scenes.push({
    kind: 'ending',
    duration: 3600,
    html: `
      <div class="ms-scene ms-ending ms-end-${m.variant?.endingStyle || 'heart'}">
        <div class="ms-end-mark">${m.variant?.endingStyle === 'sparkle' ? '✨' : m.variant?.endingStyle === 'stars' ? '🌟' : '❤️'}</div>
        <div class="ms-end-msg">${escapeHtml(m.ending)}</div>
        <div class="ms-end-names">${names}</div>
        <div class="ms-end-brand">herae.app</div>
      </div>`,
  });

  return scenes.map((s) => ({ ...s, accent }));
}

function captionHtml(sc) {
  if (!sc.caption && !sc.sessionTitle && !sc.dateLabel) return '';
  return `
    <div class="ms-caption">
      ${sc.sessionTitle ? `<div class="ms-cap-title">${escapeHtml(sc.sessionTitle)}</div>` : ''}
      ${sc.caption ? `<div class="ms-cap-text">${escapeHtml(sc.caption)}</div>` : ''}
      ${sc.dateLabel ? `<div class="ms-cap-date">${escapeHtml(sc.dateLabel)}</div>` : ''}
    </div>`;
}

// Opens the player. `opts.onShare` (optional) wires the share button.
export function playStory(manifest, opts = {}) {
  const scenes = buildScenes(manifest);
  const overlay = document.createElement('div');
  overlay.className = `ms-player ms-accent-${manifest.variant?.accent || 'purple'}`;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="ms-progress">${scenes.map(() => '<div class="ms-seg"><i></i></div>').join('')}</div>
    <div class="ms-topbar">
      <div class="ms-topbar-title">${escapeHtml(manifest.emoji)} ${escapeHtml(manifest.title)}</div>
      <div class="ms-topbar-actions">
        ${opts.onShare ? '<button class="ms-btn" data-ms="share" aria-label="Share this story">Share</button>' : ''}
        <button class="ms-btn ms-btn-icon" data-ms="close" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="ms-stage"></div>
    <button class="ms-nav ms-nav-prev" data-ms="prev" aria-label="Previous"></button>
    <button class="ms-nav ms-nav-next" data-ms="next" aria-label="Next"></button>`;
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const stage = overlay.querySelector('.ms-stage');
  const segs = [...overlay.querySelectorAll('.ms-seg i')];
  let idx = 0, paused = false, raf = 0, startedAt = 0, elapsedBefore = 0, currentEl = null;

  function renderScene(i) {
    stage.innerHTML = '';
    const s = scenes[i];
    currentEl = s.build ? s.build() : (() => { const d = document.createElement('div'); d.innerHTML = s.html; return d.firstElementChild; })();
    stage.appendChild(currentEl);
    const vid = currentEl.querySelector('video');
    if (vid) { vid.play().catch(() => {}); }
    // mark past/current/future progress segments
    segs.forEach((el, k) => { el.style.transition = 'none'; el.style.width = k < i ? '100%' : '0%'; });
    // force reflow so the current segment animates from 0
    void stage.offsetWidth;
  }

  function tick(now) {
    if (paused) { raf = requestAnimationFrame(tick); return; }
    if (!startedAt) startedAt = now;
    const s = scenes[idx];
    const elapsed = elapsedBefore + (now - startedAt);
    const pct = Math.min(100, (elapsed / s.duration) * 100);
    if (segs[idx]) { segs[idx].style.transition = 'none'; segs[idx].style.width = pct + '%'; }
    if (elapsed >= s.duration) { next(); return; }
    raf = requestAnimationFrame(tick);
  }

  function go(i) {
    cancelAnimationFrame(raf);
    if (i < 0) i = 0;
    if (i >= scenes.length) { close(); return; }
    idx = i; startedAt = 0; elapsedBefore = 0;
    renderScene(idx);
    raf = requestAnimationFrame(tick);
  }
  const next = () => go(idx + 1);
  const prev = () => go(idx - 1);

  let holdTimer = null;
  function setPaused(p) {
    paused = p;
    if (p) { elapsedBefore += performance.now() - (startedAt || performance.now()); startedAt = 0; }
    else { startedAt = 0; }
    const v = currentEl?.querySelector('video'); if (v) { p ? v.pause() : v.play().catch(() => {}); }
    overlay.classList.toggle('ms-paused', p);
  }

  function close() {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    overlay.remove();
    if (opts.onExit) opts.onExit();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === ' ') { e.preventDefault(); setPaused(!paused); }
  }
  document.addEventListener('keydown', onKey);

  overlay.addEventListener('click', (e) => {
    const act = e.target.closest('[data-ms]')?.dataset.ms;
    if (act === 'close') return close();
    if (act === 'next') return next();
    if (act === 'prev') return prev();
    if (act === 'share') { setPaused(true); opts.onShare?.(manifest); return; }
  });
  // hold-to-pause on the stage
  stage.addEventListener('pointerdown', () => { holdTimer = setTimeout(() => setPaused(true), 220); });
  const release = () => { clearTimeout(holdTimer); if (paused) setPaused(false); };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointerleave', release);

  go(0);
  return { close };
}
