// recap.js — the auto-generated "Moments Recap": a beautiful, social-media
// style collage built ENTIRELY client-side from a person's own captured
// moments, watermarked with the Herae mark, and openable like any other post
// through the existing media viewer + Share flow.
//
// Everything here runs in the browser: the poster images the recap is made of
// are already loaded by the feed, we just composite them onto a square canvas
// and hand back a data-URL "moment" the rest of the app treats exactly like a
// real one. No server work, no storage, no extra requests beyond the images
// the profile already shows — which is the whole point (zero backend cost,
// instant, private).
'use strict';

import { escapeHtml } from '../lib/util.js';

const { mediaUrl } = window;

// Below this there just isn't enough to make a recap worth showing — the
// profile page simply doesn't render one (per the spec).
const MIN_MOMENTS = 4;
const SIZE = 1080; // square, ideal for Instagram/Facebook/WhatsApp/Telegram

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    // Needed so the composited canvas isn't tainted when media is served from
    // a different origin (dev). In production media is same-origin, so this is
    // a harmless no-op. If it fails either way we just skip that tile.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCover(ctx, img, x, y, w, h, r) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r); ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawHeart(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  const top = cy - size * 0.35;
  ctx.moveTo(cx, top + size * 0.3);
  ctx.bezierCurveTo(cx, top, cx - size / 2, top, cx - size / 2, top + size * 0.3);
  ctx.bezierCurveTo(cx - size / 2, top + size * 0.65, cx, top + size * 0.8, cx, top + size);
  ctx.bezierCurveTo(cx, top + size * 0.8, cx + size / 2, top + size * 0.65, cx + size / 2, top + size * 0.3);
  ctx.bezierCurveTo(cx + size / 2, top, cx, top, cx, top + size * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Same premium bottom-right mark the extension bakes into every export
// (themes.js drawWatermark), re-expressed here since the site doesn't load the
// extension's themes.js. `logo` is the Herae logo bitmap (or null → heart
// fallback). Sized generously and lifted off the bottom edge, matching the
// extension.
function drawWatermark(ctx, W, H, logo) {
  const fontSize = 34, pad = 20, marginX = 34, marginY = Math.round(H * 0.06);
  const markSize = 52, gap = 16, text = 'herae.app';
  ctx.save();
  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const textW = ctx.measureText(text).width;
  const pillH = markSize + pad * 0.9;
  const pillW = pad + markSize + gap + textW + pad;
  const pillX = W - marginX - pillW, pillY = H - marginY - pillH;
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(15,12,22,0.52)';
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2); ctx.stroke();
  const markX = pillX + pad, markY = pillY + (pillH - markSize) / 2;
  if (logo && logo.complete && logo.naturalWidth) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logo, markX, markY, markSize, markSize);
  } else {
    const hcx = markX + markSize / 2, hcy = markY + markSize / 2;
    const g = ctx.createLinearGradient(hcx - markSize / 2, hcy - markSize / 2, hcx + markSize / 2, hcy + markSize / 2);
    g.addColorStop(0, '#f5b942'); g.addColorStop(1, '#a78bfa');
    drawHeart(ctx, hcx, hcy + markSize * 0.06, markSize * 0.95, g);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.fillText(text, markX + markSize + gap, pillY + pillH / 2 + 1);
  ctx.restore();
}

// Fisher–Yates, so "memorable moments" are a fresh random pick each visit
// rather than always the newest few.
function pickRandom(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Grid geometry for a given tile count — 2×2, 3×2, or 3×3.
function gridFor(count) {
  if (count >= 9) return { cols: 3, rows: 3, take: 9 };
  if (count >= 6) return { cols: 3, rows: 2, take: 6 };
  if (count >= 4) return { cols: 2, rows: 2, take: 4 };
  return { cols: 2, rows: 2, take: count };
}

// Builds the recap. `moments` is the caller's list of hydrated moments (any
// media type — we use each one's poster `url`). Returns a moment-like object
// the media viewer + Share flow accept, or null when there isn't enough (or
// the canvas couldn't be produced, e.g. tainted in a cross-origin dev setup).
export async function buildRecap({ username, moments, profileUrl }) {
  const usable = (moments || []).filter((m) => m && m.url);
  if (usable.length < MIN_MOMENTS) return null;

  const { cols, rows, take } = gridFor(usable.length);
  const chosen = pickRandom(usable, take);
  // The Herae logo (same asset the site's brand lockups use) for the
  // watermark, loaded alongside the moment posters.
  const [logo, ...imgsRaw] = await Promise.all([
    loadImage('logo.png'),
    ...chosen.map((m) => loadImage(mediaUrl(m.url))),
  ]);
  const imgs = imgsRaw.filter(Boolean);
  if (imgs.length < MIN_MOMENTS) return null;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  // Background — warm Herae gradient.
  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, '#1b1327');
  bg.addColorStop(0.55, '#241a33');
  bg.addColorStop(1, '#0d0b12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Header.
  const headerH = 150;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const gTitle = ctx.createLinearGradient(64, 0, 520, 0);
  gTitle.addColorStop(0, '#f5b942'); gTitle.addColorStop(1, '#a78bfa');
  ctx.fillStyle = gTitle;
  ctx.font = `700 54px Georgia, 'Times New Roman', serif`;
  ctx.fillText('Herae Recap', 64, 92);
  ctx.fillStyle = 'rgba(233,213,255,0.85)';
  ctx.font = `500 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillText(`${username} · ${usable.length} moments worth reliving`, 64, 130);

  // Grid.
  const pad = 64, gap = 20;
  const gridY = headerH + 10;
  const gridH = SIZE - gridY - 40;
  const cellW = (SIZE - pad * 2 - gap * (cols - 1)) / cols;
  const cellH = (gridH - gap * (rows - 1)) / rows;
  imgs.forEach((img, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    if (r >= rows) return;
    const x = pad + c * (cellW + gap);
    const y = gridY + r * (cellH + gap);
    drawCover(ctx, img, x, y, cellW, cellH, 20);
    ctx.save();
    roundRect(ctx, x, y, cellW, cellH, 20);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(167,139,250,0.35)'; ctx.stroke();
    ctx.restore();
  });

  drawWatermark(ctx, SIZE, SIZE, logo);

  let dataUrl;
  try {
    dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  } catch (e) {
    // Tainted canvas (cross-origin media without CORS) — can't export. Skip
    // the recap rather than show a broken one.
    return null;
  }

  return {
    id: 'recap',
    mediaType: 'photo',
    url: dataUrl,
    description: `${username}'s Herae Recap`,
    privacy: 'private',
    // The Share flow copies this instead of a per-post link (a recap has no
    // server id); the platform buttons share the downloaded image itself.
    shareUrl: profileUrl,
    isRecap: true,
  };
}

// The card that sits at the top of your own profile and opens the recap.
export function renderRecapCard(recap) {
  return `
    <div class="recap-card" data-recap role="button" tabindex="0" aria-label="Open your Moments Recap">
      <div class="recap-card-media">
        <img src="${recap.url}" alt="Your Moments Recap" class="recap-card-img">
        <div class="recap-card-play">✨</div>
      </div>
      <div class="recap-card-body">
        <div class="recap-card-kicker">Featured · auto-generated</div>
        <div class="recap-card-title">Your Herae Recap</div>
        <div class="recap-card-sub">${escapeHtml(recap.description)} — a collage of your moments, ready to share.</div>
        <button class="btn btn-primary recap-card-open">Open recap →</button>
      </div>
    </div>`;
}
