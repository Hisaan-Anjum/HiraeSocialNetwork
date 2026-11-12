// exporter.js — turns a story manifest into shareable FILES, on demand only
// (never during normal playback — that renders live from the manifest, which is
// what keeps storage/bandwidth near zero). Two outputs:
//
//   buildStoryShareCard(manifest)  → a 1080² branded image (names, title, a few
//                                    moment thumbnails, stats, Herae watermark),
//                                    returned as a synthetic "moment" the
//                                    existing Share sheet already knows how to
//                                    post/download. (The header "Share Card".)
//   renderStoryVideo(manifest, …)  → the FULL recap rendered exactly as it
//                                    plays, as a vertical 9:16 MP4/WebM (story /
//                                    reel format), via canvas + MediaRecorder.
//                                    This is what the player's Share button
//                                    produces so people can post the video
//                                    itself. Resolves to { blob, mime, poster }.
'use strict';
import { PATHS, emojiIconName } from '../lib/icons.js';
import { loadMusic, startMusic, duckAt, fadeOutAt, FADE_OUT } from './music.js';

// ── shared drawing helpers (parametric in width/height) ─────────────────
// 11-11 palette: one deliberate near-black (the ink surfaces) and solid magenta, whatever the story's variant.
const INK = ['#1F1B24', '#16131A', '#0C0A0E'];
const ACCENTS = { gold: INK, purple: INK, rose: INK };
const MAGENTA = ['#D61F69', '#D61F69'];
const ACCENT_LINE = { gold: MAGENTA, purple: MAGENTA, rose: MAGENTA };
const DISPLAY = '"Bricolage Grotesque", system-ui, sans-serif', BODY = 'Inter, system-ui, sans-serif';
// The UI's line icon (src/lib/icons.js), stroked onto the canvas: emoji never stand in for icons.
function drawIcon(ctx, name, cx, cy, size, color, lw = 1.9) {
  const k = size / 24;
  ctx.save(); ctx.translate(cx - size / 2, cy - size / 2); ctx.scale(k, k);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [, tag, attrs] of (PATHS[name] || PATHS.sparkle).matchAll(/<(path|circle|rect)\b([^>]*)>/g)) {
    const a = Object.fromEntries([...attrs.matchAll(/([a-z]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const p = tag === 'path' ? new Path2D(a.d) : new Path2D();
    if (tag === 'circle') p.arc(+a.cx, +a.cy, +a.r, 0, Math.PI * 2);
    if (tag === 'rect') p.roundRect(+a.x, +a.y, +a.width, +a.height, +(a.rx || 0));
    ctx.stroke(p);
  }
  ctx.restore();
}
// A line icon in a magenta-tinted circle (the timeline cards' look).
function drawIconBadge(ctx, emoji, cx, cy, d) {
  ctx.fillStyle = 'rgba(214, 31, 105, 0.22)'; ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.fill();
  drawIcon(ctx, emojiIconName(emoji), cx, cy, d * 0.5, '#F9A8D4');
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
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
// Draws the source WHOLE inside the box (contain), centred — the export must
// never crop a moment. Accepts an <img> OR a <video> (naturalWidth vs
// videoWidth), so a video moment is drawn frame-by-frame exactly like a photo.
// `zoom` ≤ 1 shrinks within the fitted size, so a drift animation still can't
// clip an edge.
function drawContain(ctx, src, x, y, w, h, zoom = 1) {
  const iw = src.naturalWidth || src.videoWidth;
  const ih = src.naturalHeight || src.videoHeight;
  if (!iw || !ih) return;
  const s = Math.min(w / iw, h / ih) * zoom;
  const dw = iw * s, dh = ih * s;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// A tiny cover-cropped copy of the image. Drawn back out at full size with
// smoothing on, an image this small becomes a soft blur for free — which is
// what fills the space around a contained moment. Pre-rendered ONCE per scene
// rather than blurring every frame, because a real per-frame ctx.filter blur at
// 720×1280 is exactly the kind of cost that makes the encoder fall behind.
function makeBackdrop(src, ratio) {
  const iw = src.naturalWidth || src.videoWidth;
  const ih = src.naturalHeight || src.videoHeight;
  if (!iw || !ih) return null;
  const sw = 48, sh = Math.max(1, Math.round(48 * ratio));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const cx = c.getContext('2d');
  const s = Math.max(sw / iw, sh / ih);
  cx.drawImage(src, (sw - iw * s) / 2, (sh - ih * s) / 2, iw * s, ih * s);
  return c;
}

// One rounded collage tile on the share card: the photo WHOLE, over a blurred
// copy of itself filling the tile. Same rule as the story montage — a moment is
// never cropped, wherever it's shown.
function drawTile(ctx, img, x, y, w, h, r) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const bg = makeBackdrop(img, h / w);
  if (bg) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bg, x, y, w, h); }
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fillRect(x, y, w, h);
  drawContain(ctx, img, x, y, w, h, 1);
  ctx.restore();
}

// A muted, looping <video> ready to be drawn onto the canvas. Resolves to null
// if it can't load, so the montage falls back to the moment's poster image.
// A clip for the export: { v, audio, dur } or null. One download feeds both the
// <video> (muted, drawn frame by frame) and its decoded sound track (null when the
// clip has none), which is scheduled sample-accurately in the export's audio mix.
async function loadClip(src, actx) {
  let url = src, audio = null, blobUrl = null;
  try {
    const r = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (r.ok) {
      const blob = await r.blob();
      url = blobUrl = URL.createObjectURL(blob);
      if (actx) audio = await actx.decodeAudioData(await blob.arrayBuffer()).catch(() => null);
    }
  } catch (e) { /* fall back to streaming the clip, silent */ }
  const v = await new Promise((resolve) => {
    const el = document.createElement('video');
    el.crossOrigin = 'anonymous';
    el.muted = true; el.playsInline = true; el.preload = 'auto';
    let done = false;
    const ok = () => { if (!done) { done = true; resolve(el); } };
    el.onloadeddata = ok; el.oncanplay = ok;
    el.onerror = () => { if (!done) { done = true; resolve(null); } };
    setTimeout(() => { if (!done) { done = true; resolve(el.readyState >= 2 ? el : null); } }, 8000);
    el.src = url;
  });
  if (!v) { if (blobUrl) URL.revokeObjectURL(blobUrl); return null; }
  // MediaRecorder-made webm clips report Infinity until read to the end; the decoded sound knows the real length.
  const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : (audio ? audio.duration : 0);
  return { v, audio, dur, blobUrl };
}
function bgGradient(ctx, W, H, accent) {
  const c = ACCENTS[accent] || ACCENTS.purple;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c[0]); g.addColorStop(0.55, c[1]); g.addColorStop(1, c[2]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function drawWatermark(ctx, W, H, logo, scale = 1) {
  const text = 'herae.app', fontSize = 28 * scale, markSize = 40 * scale, gap = 12 * scale, pad = 16 * scale;
  const marginX = 30 * scale, marginY = 34 * scale;
  ctx.save();
  ctx.font = `700 ${fontSize}px ${BODY}`;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const textW = ctx.measureText(text).width;
  const pillH = markSize + pad * 0.8, pillW = pad + markSize + gap + textW + pad;
  const pillX = W - marginX - pillW, pillY = H - marginY - pillH;
  ctx.fillStyle = 'rgba(15,12,22,0.5)';
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2); ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2); ctx.stroke();
  const markX = pillX + pad, markY = pillY + (pillH - markSize) / 2;
  if (logo && logo.naturalWidth) ctx.drawImage(logo, markX, markY, markSize, markSize);
  else { ctx.font = `${markSize}px serif`; ctx.fillText('❤️', markX, pillY + pillH / 2); }
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  ctx.fillText(text, markX + markSize + gap, pillY + pillH / 2 + 1);
  ctx.restore();
}
function wrapText(ctx, text, cx, y, maxW, lh, font, fill, align = 'center') {
  ctx.font = font; ctx.fillStyle = fill; ctx.textAlign = align;
  const words = String(text).split(' ');
  let line = ''; const rows = [];
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { rows.push(line); line = w; } else line = t;
  }
  if (line) rows.push(line);
  rows.forEach((r, i) => ctx.fillText(r, cx, y + i * lh));
  return rows.length;
}

// ── the square share card (header "Share Card") ─────────────────────────
// Canvas only draws a web font once it has loaded; without this the export silently falls back to the system face.
const brandFont = () => (document.fonts ? Promise.all([document.fonts.load('700 60px "Bricolage Grotesque"'), document.fonts.load('500 30px Inter'), document.fonts.load('700 30px Inter')]).catch(() => {}) : Promise.resolve());

export async function buildStoryShareCard(manifest) {
  await brandFont();
  const SIZE = 1080;
  const accent = manifest.variant?.accent || 'purple';
  const line = ACCENT_LINE[accent] || ACCENT_LINE.purple;
  const thumbs = (manifest.scenes || []).filter((s) => s.url).slice(0, 4);
  const [logo, ...imgs] = await Promise.all([loadImage('logo.png'), ...thumbs.map((s) => loadImage(s.url))]);
  const usable = imgs.filter(Boolean);

  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  bgGradient(ctx, SIZE, SIZE, accent);

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(250,248,250,0.85)';
  ctx.font = `600 30px ${BODY}`;
  ctx.fillText(`${manifest.names.me} & ${manifest.names.them}`, SIZE / 2, 120);
  drawIconBadge(ctx, manifest.emoji || '❤️', SIZE / 2, 178, 84);
  const gt = ctx.createLinearGradient(SIZE * 0.2, 0, SIZE * 0.8, 0);
  gt.addColorStop(0, line[0]); gt.addColorStop(1, line[1]);
  wrapText(ctx, manifest.title, SIZE / 2, 285, SIZE * 0.8, 62, `700 60px ${DISPLAY}`, gt);
  if (manifest.subtitle) {
    ctx.fillStyle = 'rgba(250,248,250,0.7)';
    ctx.font = `500 26px ${BODY}`;
    ctx.fillText(manifest.subtitle, SIZE / 2, 340);
  }

  if (usable.length) {
    const gy = 385, gh = 380, pad = 90, gap = 16;
    const cols = usable.length >= 2 ? 2 : 1;
    const rows = usable.length > 2 ? 2 : 1;
    const cw = (SIZE - pad * 2 - gap * (cols - 1)) / cols;
    const ch = (gh - gap * (rows - 1)) / rows;
    usable.forEach((img, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      if (r >= rows) return;
      drawTile(ctx, img, pad + c * (cw + gap), gy + r * (ch + gap), cw, ch, 22);
    });
  }

  const stats = (manifest.stats || []).slice(0, 3);
  if (stats.length) {
    const y = 835, colW = SIZE / stats.length;
    stats.forEach((s, i) => {
      const cx = colW * i + colW / 2;
      ctx.fillStyle = line[0]; ctx.font = `700 60px ${DISPLAY}`; ctx.textAlign = 'center';
      ctx.fillText(String(s.value), cx, y);
      ctx.fillStyle = 'rgba(250,248,250,0.8)'; ctx.font = `600 24px ${BODY}`;
      ctx.fillText(s.label, cx, y + 40);
    });
  }

  drawWatermark(ctx, SIZE, SIZE, logo);
  let dataUrl;
  try { dataUrl = canvas.toDataURL('image/jpeg', 0.9); } catch (e) { return null; }
  return {
    id: 'story-card', mediaType: 'photo', url: dataUrl,
    description: `${manifest.title} — ${manifest.names.me} & ${manifest.names.them}`,
    privacy: 'private', shareUrl: location.href, isStory: true,
  };
}

// ── the relationship Share Card (embedded in the contact banner) ────────
// Built instantly from the summary alone (no moment fetch, no external images
// except the same-origin logo → toDataURL never taints), so it can render right
// as the profile loads. Returned as a synthetic "moment" the Share sheet posts.
function drawPill(ctx, cx, cy, text, iconName) {
  ctx.font = `700 30px ${BODY}`;
  const iw = iconName ? 40 : 0;   // icon 28 + gap 12
  const w = ctx.measureText(text).width + iw; const padX = 30, h = 66;
  ctx.fillStyle = '#D61F69';
  roundRect(ctx, cx - w / 2 - padX, cy - h / 2, w + padX * 2, h, h / 2); ctx.fill();
  if (iconName) drawIcon(ctx, iconName, cx - w / 2 + 14, cy, 28, '#fff', 2.2);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx + iw / 2, cy + 1); ctx.textBaseline = 'alphabetic';
}
// A round face with the brand ring; the initial when there's no picture (or it won't load).
function drawFace(ctx, img, name, cx, cy, r) {
  ctx.fillStyle = '#D61F69'; ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#2E2933'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  if (img) {
    const iw = img.naturalWidth, ih = img.naturalHeight, k = Math.max((r * 2) / iw, (r * 2) / ih);
    ctx.drawImage(img, cx - (iw * k) / 2, cy - (ih * k) / 2, iw * k, ih * k);
  } else {
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(r * 0.9)}px ${DISPLAY}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(name || '?')[0].toUpperCase(), cx, cy + 4); ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}
// The couple's share card (founder 11-02: their faces, favourite films and best moments, not just numbers).
// Top to bottom: faces → names → together-for + badge → best moments → stats → favourite films. Anything missing
// (no picture, no moments, no rated films) is left out and the rest closes up, so the card never shows a gap.
export async function buildRelationshipCard(summary, { themAvatarUrl } = {}) {
  await brandFont();
  const SIZE = 1080, PAD = 64;
  const line = ACCENT_LINE.purple;
  const [logo, meImg, themImg, ...shots] = await Promise.all([
    loadImage('logo.png'),
    summary.meAvatarUrl ? loadImage(summary.meAvatarUrl) : null,
    themAvatarUrl ? loadImage(themAvatarUrl) : null,
    ...(summary.bestMoments || []).slice(0, 3).map(loadImage),
  ]);
  const moments = shots.filter(Boolean);
  const films = (summary.topFilms || []).slice(0, 3);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  bgGradient(ctx, SIZE, SIZE, 'purple');
  // Whatever is missing closes up, and what's left sits centred instead of leaving a hole at the bottom.
  const hasPill = !!summary.label?.text;
  ctx.save(); ctx.translate(0, ((hasPill ? 0 : 70) + (moments.length ? 0 : 204) + (films.length ? 0 : 90)) / 2);
  // a soft glow behind the faces
  const glow = ctx.createRadialGradient(SIZE / 2, 190, 20, SIZE / 2, 190, 420);
  glow.addColorStop(0, 'rgba(214,31,105,0.22)'); glow.addColorStop(1, 'rgba(214,31,105,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, -200, SIZE, SIZE + 400);
  // faces, overlapping like the couple page
  const R = 92;
  drawFace(ctx, themImg, summary.them, SIZE / 2 - 70, 180, R);
  drawFace(ctx, meImg, summary.me, SIZE / 2 + 70, 180, R);

  // names, shrunk to fit one line
  const names = `${summary.them} & ${summary.me}`;
  let fs = 68; ctx.font = `700 ${fs}px ${DISPLAY}`;
  while (ctx.measureText(names).width > SIZE - PAD * 2 && fs > 36) { fs -= 2; ctx.font = `700 ${fs}px ${DISPLAY}`; }
  ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.fillText(names, SIZE / 2, 368);

  const mt = summary.monthsTogether || 0;
  const yy = Math.floor(mt / 12), mo = mt % 12;
  const monthsTxt = yy >= 1 ? `${yy} year${yy === 1 ? '' : 's'}${mo ? ` ${mo} mo` : ''}` : `${Math.max(1, mt)} month${mt === 1 || mt === 0 ? '' : 's'}`;
  ctx.fillStyle = 'rgba(250,248,250,0.85)'; ctx.font = `500 32px ${BODY}`;
  ctx.fillText(`Together for ${monthsTxt}`, SIZE / 2, 422);
  if (hasPill) drawPill(ctx, SIZE / 2, 492, summary.label.text, emojiIconName(summary.label.emoji || '❤️'));

  // best moments: up to three tiles, centred
  let y = hasPill ? 556 : 486;
  if (moments.length) {
    const gap = 20, tw = Math.min(300, (SIZE - PAD * 2 - gap * (moments.length - 1)) / moments.length), th = 210;
    const x0 = (SIZE - (tw * moments.length + gap * (moments.length - 1))) / 2;
    moments.forEach((img, i) => drawTile(ctx, img, x0 + i * (tw + gap), y, tw, th, 22));
    y += th + 34;
  } else y += 40;

  // stats
  const st = summary.stats || {};
  const cells = [[st.movieNights || 0, 'Movie nights'], [st.estimatedHours || 0, 'Hours together'], [st.momentsSaved || 0, 'Memories']];
  const colW = (SIZE - PAD * 2) / 3;
  cells.forEach(([num, label], i) => {
    const cx = PAD + colW * i + colW / 2;
    ctx.fillStyle = '#fff'; ctx.font = `700 64px ${DISPLAY}`; ctx.textAlign = 'center';
    ctx.fillText(String(num), cx, y + 56);
    ctx.fillStyle = 'rgba(250,248,250,0.75)'; ctx.font = `600 24px ${BODY}`;
    ctx.fillText(label, cx, y + 92);
  });
  y += 140;

  // favourite films, kept clear of the watermark in the corner
  if (films.length) {
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(250,248,250,0.7)'; ctx.font = `600 22px ${BODY}`;
    ctx.fillText('OUR FAVOURITES', PAD, y);
    ctx.fillStyle = '#fff'; ctx.font = `600 30px ${DISPLAY}`;
    let txt = films.join(' · '); const maxW = SIZE - PAD * 2 - 290 - 42;
    while (ctx.measureText(txt).width > maxW && txt.length > 4) txt = txt.slice(0, -2).trimEnd() + '…';
    drawIcon(ctx, 'film', PAD + 15, y + 31, 30, '#F9A8D4');
    ctx.fillStyle = '#fff'; ctx.fillText(txt, PAD + 42, y + 42);
  }
  ctx.restore();

  drawWatermark(ctx, SIZE, SIZE, logo);
  let url; try { url = canvas.toDataURL('image/jpeg', 0.9); } catch (e) { return null; }
  return {
    id: 'relationship-card', mediaType: 'photo', url,
    description: `${summary.them} & ${summary.me} — ${summary.label?.text || 'our story on Herae.app'}`,
    privacy: 'private', shareUrl: location.href, isStory: true,
  };
}

// ── the full recap as a vertical 9:16 video (player's Share button) ─────
function pickMime() {
  // Video + sound in one file: AAC in MP4 where the browser records it, Opus in WebM otherwise.
  const candidates = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of candidates) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; }
  return null;
}

// Builds the ordered scene list that mirrors the on-screen player (player.js):
// title → stats → timeline → moment montage → top sessions → comments → ending.
// EVERY moment in the manifest is included (the engine already caps them at 12),
// so the exported video is the whole story, not an excerpt.
function videoScenes(manifest, images, videos, ratio) {
  const scenes = [];
  scenes.push({ kind: 'title', dur: 2600 });
  if (manifest.stats?.length) scenes.push({ kind: 'stats', dur: 2600 });
  if (manifest.timeline?.length) scenes.push({ kind: 'timeline', dur: 2600 });
  manifest.scenes.filter((s) => s.url).forEach((s, i) => {
    const clip = videos[i] || null;
    // A video moment is kept even if only the clip loaded, and gets a little
    // longer on screen so the motion actually reads. The backdrop is built from
    // the poster image (cheap, and a video's own frames would change anyway).
    const img = images[i] || null;
    const vid = clip?.v || null;
    if (img || vid) {
      scenes.push({
        // A clip runs its FULL length (it used to be cut at 3.2 s), never shorter than a photo's beat.
        kind: 'moment', dur: vid ? Math.max(3200, Math.ceil(clip.dur * 1000) + 250) : 2400, m: s, img, vid, audio: clip?.audio || null,
        bg: img ? makeBackdrop(img, ratio) : null,
      });
    }
  });
  if (manifest.topSessions?.length) {
    // Longer when there's cover art to actually look at.
    const withArt = manifest.topSessions.some((t) => t.posterUrl);
    scenes.push({ kind: 'top', dur: withArt ? 3600 : 2400 });
  }
  if (manifest.comments?.length) scenes.push({ kind: 'comments', dur: 2600 });
  scenes.push({ kind: 'ending', dur: 2800 });
  return scenes;
}

// Renders one scene at progress p (0..1). W/H are the vertical canvas dims.
function drawScene(ctx, W, H, manifest, scene, p, logo, topArt = []) {
  const accent = manifest.variant?.accent || 'purple';
  const line = ACCENT_LINE[accent] || ACCENT_LINE.purple;
  const fade = Math.min(1, p / 0.15, (1 - p) / 0.15); // fade in + out at the edges
  const cx = W / 2;

  bgGradient(ctx, W, H, accent);

  if (scene.kind === 'moment') {
    ctx.globalAlpha = Math.max(0.001, fade);
    // The moment is drawn WHOLE (contain) — never cropped to fill the frame.
    // Behind it goes the pre-blurred backdrop so the leftover space reads as
    // part of the composition instead of black bars.
    if (scene.bg) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(scene.bg, 0, 0, W, H); }
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    // A video moment draws its LIVE frames (already moving, so no drift); a
    // photo drifts gently UP TO its fitted size, which can't clip an edge.
    // Falls back to the poster if the clip hasn't buffered.
    const live = scene.vid && scene.vid.readyState >= 2 ? scene.vid : null;
    if (live) drawContain(ctx, live, 0, 0, W, H, 1);
    else if (scene.img) drawContain(ctx, scene.img, 0, 0, W, H, 0.94 + p * 0.06);
    const scrim = ctx.createLinearGradient(0, H * 0.5, 0, H);
    scrim.addColorStop(0, 'rgba(0,0,0,0)'); scrim.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = scrim; ctx.fillRect(0, H * 0.5, W, H * 0.5);
    const m = scene.m;
    ctx.textAlign = 'left';
    let ty = H - 240;
    if (m.sessionTitle) { ctx.fillStyle = '#fff'; ctx.font = `700 52px ${DISPLAY}`; ctx.fillText(String(m.sessionTitle).slice(0, 26), 70, ty); ty += 62; }
    if (m.caption) { ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = `400 36px ${BODY}`; wrapText(ctx, m.caption, 70, ty, W - 140, 44, `400 36px ${BODY}`, 'rgba(255,255,255,0.92)', 'left'); ty += 88; }
    if (m.dateLabel) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `500 30px ${BODY}`; ctx.textAlign = 'left'; ctx.fillText(m.dateLabel, 70, ty); }
    ctx.globalAlpha = 1;
    drawWatermark(ctx, W, H, logo);
    return;
  }

  ctx.globalAlpha = Math.max(0.001, fade);
  ctx.textAlign = 'center';

  if (scene.kind === 'title') {
    ctx.fillStyle = 'rgba(250,248,250,0.85)'; ctx.font = `600 40px ${BODY}`;
    ctx.fillText(`${manifest.names.me} & ${manifest.names.them}`, cx, H / 2 - 240);
    drawIconBadge(ctx, manifest.emoji || '❤️', cx, H / 2 - 140, 130);
    const g = ctx.createLinearGradient(W * 0.12, 0, W * 0.88, 0);
    g.addColorStop(0, line[0]); g.addColorStop(1, line[1]);
    const rows = wrapText(ctx, manifest.title, cx, H / 2 + 10, W * 0.82, 96, `700 86px ${DISPLAY}`, g);
    if (manifest.subtitle) { ctx.fillStyle = 'rgba(250,248,250,0.7)'; ctx.font = `500 34px ${BODY}`; ctx.fillText(manifest.subtitle, cx, H / 2 + 10 + rows * 96 + 20); }
  } else if (scene.kind === 'stats') {
    const stats = manifest.stats.slice(0, 4);
    const lead = stats[0];
    // Lead stat, centered and stacked with real vertical spacing.
    ctx.textAlign = 'center';
    drawIconBadge(ctx, lead.emoji, cx, H / 2 - 350, 110);
    ctx.fillStyle = line[0]; ctx.font = `700 190px ${DISPLAY}`; ctx.fillText(String(lead.value), cx, H / 2 - 140);
    ctx.fillStyle = 'rgba(250,248,250,0.9)'; ctx.font = `600 42px ${BODY}`;
    ctx.fillText(lead.label, cx, H / 2 - 70);
    // Secondary stats: value right-aligned into the left column, emoji+label
    // left-aligned into the right column. Both were previously CENTER-aligned a
    // few pixels apart, which is what stacked the text on top of the icons.
    stats.slice(1).forEach((s, i) => {
      const y = H / 2 + 90 + i * 120;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff'; ctx.font = `700 66px ${DISPLAY}`;
      ctx.fillText(String(s.value), cx - 28, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(250,248,250,0.78)'; ctx.font = `500 34px ${BODY}`;
      ctx.fillText(s.label, cx + 28, y - 4);
    });
    ctx.textAlign = 'center';
  } else if (scene.kind === 'timeline' || scene.kind === 'top' || scene.kind === 'comments') {
    const kicker = scene.kind === 'timeline' ? 'Along the way' : scene.kind === 'top' ? 'Your best nights' : 'Things you said';
    ctx.fillStyle = line[0]; ctx.font = `700 30px ${BODY}`;
    ctx.fillText(kicker.toUpperCase(), cx, H / 2 - 320);
    ctx.textAlign = 'center';
    if (scene.kind === 'timeline') {
      manifest.timeline.slice(0, 4).forEach((t, i) => {
        ctx.fillStyle = '#fff'; ctx.font = `600 44px ${BODY}`;
        const tw = ctx.measureText(t.title).width;   // badge (64) + gap (16) + title, centred as one group
        drawIconBadge(ctx, t.emoji, cx - tw / 2 - 8, H / 2 - 196 + i * 130, 64);
        ctx.fillText(t.title, cx + 40, H / 2 - 180 + i * 130);
        if (t.dateLabel) { ctx.fillStyle = 'rgba(250,248,250,0.6)'; ctx.font = `400 28px ${BODY}`; ctx.fillText(t.dateLabel, cx, H / 2 - 140 + i * 130); }
      });
    } else if (scene.kind === 'top') {
      const tops = manifest.topSessions.slice(0, 3);
      const anyArt = topArt.some(Boolean);
      tops.forEach((s, i) => {
        const y = H / 2 - 210 + i * 200;
        if (anyArt) {
          // Poster-left, details-right — the same composition as the player,
          // so the exported video and the on-screen story read identically.
          const pw = 132, ph = 196, px = cx - 400;
          const art = topArt[i];
          if (art) {
            ctx.save();
            roundRect(ctx, px, y - ph / 2, pw, ph, 14);
            ctx.clip();
            drawContain(ctx, art, px, y - ph / 2, pw, ph, 1);
            ctx.restore();
            ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 2;
            roundRect(ctx, px, y - ph / 2, pw, ph, 14); ctx.stroke();
          } else {
            ctx.fillStyle = 'rgba(255,255,255,.07)';
            roundRect(ctx, px, y - ph / 2, pw, ph, 14); ctx.fill();
            drawIcon(ctx, 'film', px + pw / 2, y, 52, 'rgba(255,255,255,.5)');
          }
          ctx.textAlign = 'left';
          ctx.fillStyle = '#fff'; ctx.font = `700 46px ${DISPLAY}`;
          ctx.fillText(String(s.title).slice(0, 22), px + pw + 34, y - 14);
          if (s.year) { ctx.fillStyle = 'rgba(250,248,250,.65)'; ctx.font = `500 30px ${BODY}`; ctx.fillText(String(s.year), px + pw + 34, y + 26); }
          ctx.fillStyle = line[0]; ctx.font = '38px serif';
          ctx.fillText('★'.repeat(Math.round(s.rating)) + '  ' + s.rating, px + pw + 34, y + 74);
          ctx.textAlign = 'center';
        } else {
          ctx.fillStyle = '#fff'; ctx.font = `700 48px ${DISPLAY}`; ctx.fillText(String(s.title).slice(0, 24), cx, y);
          ctx.fillStyle = line[0]; ctx.font = '44px serif'; ctx.fillText('★'.repeat(Math.round(s.rating)), cx, y + 52);
        }
      });
    } else {
      manifest.comments.slice(0, 3).forEach((c, i) => {
        ctx.fillStyle = '#fff';
        const rows = wrapText(ctx, `“${c.text}”`, cx, H / 2 - 200 + i * 200, W * 0.8, 52, `italic 600 44px ${DISPLAY}`, '#fff');
        ctx.fillStyle = 'rgba(250,248,250,0.6)'; ctx.font = `400 30px ${BODY}`;
        ctx.fillText(`— ${c.username}`, cx, H / 2 - 200 + i * 200 + rows * 52 + 6);
      });
    }
  } else if (scene.kind === 'ending') {
    drawIconBadge(ctx, manifest.variant?.endingStyle === 'sparkle' ? '✨' : manifest.variant?.endingStyle === 'stars' ? '⭐' : '❤️', cx, H / 2 - 150, 150);
    wrapText(ctx, manifest.ending, cx, H / 2 + 10, W * 0.82, 70, `600 56px ${DISPLAY}`, '#f8fafc');
    ctx.fillStyle = 'rgba(250,248,250,0.75)'; ctx.font = `500 36px ${BODY}`;
    ctx.fillText(`${manifest.names.me} & ${manifest.names.them}`, cx, H / 2 + 180);
  }

  ctx.globalAlpha = 1;
  drawWatermark(ctx, W, H, logo);
}

// The stories-style segmented progress bar across the top.
function drawProgress(ctx, W, scenes, idx, elapsedInScene) {
  const margin = 24, top = 26, h = 6, gap = 6;
  const segW = (W - margin * 2 - gap * (scenes.length - 1)) / scenes.length;
  for (let i = 0; i < scenes.length; i++) {
    const x = margin + i * (segW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    roundRect(ctx, x, top, segW, h, h / 2); ctx.fill();
    const fillPct = i < idx ? 1 : i === idx ? Math.min(1, elapsedInScene) : 0;
    if (fillPct > 0) { ctx.fillStyle = '#fff'; roundRect(ctx, x, top, segW * fillPct, h, h / 2); ctx.fill(); }
  }
}

// 24 fps: the cinema rate, and 20% less encoding than 30. Real-time H.264 at 720×1280 is barely real-time on a
// modest machine; under load the encoder fell seconds behind and the ending was lost (QA 11-12).
const FPS = 24;
// Encoded at 720×1280 — the size Stories/Reels/TikTok actually deliver — while
// every scene is still DRAWN in a 1080×1920 design space (see SCALE below), so
// none of the layout maths changes.
//
// This is a throughput fix, not a downgrade: encoding 1080×1920 at 10 Mbps in
// real time is more than a browser's software encoder can sustain, so it fell
// steadily behind and everything still queued when stop() ran was DISCARDED —
// which is exactly why a long story capped out around 36s and lost its closing
// scenes. 720×1280 is 2.25× fewer pixels, so the encoder keeps up and the file
// runs to the end. At 6 Mbps, 720p is visibly cleaner than a 1080p encode that
// is dropping frames.
const OUT_W = 720, OUT_H = 1280;      // encoded frame size
const DES_W = 1080, DES_H = 1920;     // design space all drawing code uses
const SCALE = OUT_W / DES_W;
const VIDEO_BITRATE = 6_000_000;

// Total length of the exported story in ms (sum of its scenes). Exported for the QA check.
export const storyDurationMs = (scenes) => scenes.reduce((a, sc) => a + sc.dur, 0);

// A timer that keeps firing when the tab is in the background (page timers drop to
// ~1/s there, which stalled the render whenever someone switched tabs mid-export).
function makeTicker() {
  try {
    const w = new Worker(new URL('./tick-worker.js', import.meta.url));
    let cb = null; w.onmessage = () => { const f = cb; cb = null; f?.(); };
    return { after(ms, f) { cb = f; w.postMessage(ms); }, stop() { w.terminate(); } };
  } catch (e) { return { after: (ms, f) => setTimeout(f, ms), stop() {} }; }
}

// Renders the whole recap to a vertical MP4/WebM with its soundtrack. Resolves to
// { blob, mime, poster(dataURL), durationMs }.
//
// MediaRecorder records in real time, so the story is PLAYED into it: the story's
// music (faded in and out, ducked to ~18% under every clip with sound) and each
// clip's own sound are scheduled up front on one AudioContext, and that audio clock
// is the timeline. Each tick draws the frame for "now" on that clock, so a slow or
// throttled tick can only drop a frame, never shorten or stretch the story or slip
// the picture against the sound. Recording stops once the clock has passed the
// last scene's end, so the file runs the story's full length.
export async function renderStoryVideo(manifest, { onProgress } = {}) {
  // Created first, synchronously inside the Share tap, so the browser lets it run.
  let actx = null;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); actx.resume().catch(() => {}); } catch (e) { actx = null; }
  try {
    return await recordStory(manifest, actx, onProgress);
  } finally {
    actx?.close().catch(() => {});
  }
}

async function recordStory(manifest, actx, onProgress) {
  await brandFont();
  const mime = pickMime();
  if (!mime) throw new Error('This browser can’t record video — try the Share Card instead.');

  const W = DES_W, H = DES_H; // all scene drawing happens in design units
  const momentScenes = (manifest.scenes || []).filter((s) => s.url);
  const topSessions = manifest.topSessions || [];
  const [logo, imgs, clips, topArt, music] = await Promise.all([
    loadImage('logo.png'),
    Promise.all(momentScenes.map((s) => loadImage(s.url))),
    // Video moments play for real (full length, with their sound); a photo moment resolves null.
    Promise.all(momentScenes.map((s) => (s.videoUrl ? loadClip(s.videoUrl, actx) : Promise.resolve(null)))),
    // Cover art for "your best nights", preloaded: a half-loaded poster draws nothing.
    Promise.all(topSessions.map((t) => (t.posterUrl ? loadImage(t.posterUrl) : Promise.resolve(null)))),
    actx ? loadMusic(actx, manifest.type) : null,
  ]);
  const scenes = videoScenes(manifest, imgs, clips, DES_H / DES_W);
  const total = storyDurationMs(scenes);

  // Scene + progress-within-scene for a moment on the timeline. Pure.
  function sceneAt(tMs) {
    let acc = 0;
    for (let i = 0; i < scenes.length; i++) {
      if (tMs < acc + scenes[i].dur) return { idx: i, seg: scenes[i], p: (tMs - acc) / scenes[i].dur };
      acc += scenes[i].dur;
    }
    const last = scenes.length - 1;
    return { idx: last, seg: scenes[last], p: 1 };
  }
  let playing = null; // the clip currently on screen
  function renderFrame(tMs) {
    const { idx, seg, p } = sceneAt(tMs);
    // Each clip starts from its beginning the first time its scene is drawn, once.
    if (seg.vid !== playing) {
      if (playing) { try { playing.pause(); } catch (e) { /* ignore */ } }
      playing = seg.vid || null;
      if (playing) { try { playing.currentTime = 0; playing.play().catch(() => {}); } catch (e) { /* ignore */ } }
    }
    // Draw in 1080×1920 design units, land on the 720×1280 canvas.
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    drawScene(ctx, W, H, manifest, seg, p, logo, topArt);
    drawProgress(ctx, W, scenes, idx, p);
  }
  const cleanup = () => {
    for (const c of clips) { if (c) { try { c.v.pause(); } catch (e) { /* ignore */ } if (c.blobUrl) URL.revokeObjectURL(c.blobUrl); } }
  };

  const canvas = document.createElement('canvas');
  canvas.width = OUT_W; canvas.height = OUT_H;
  const ctx = canvas.getContext('2d', { alpha: false });

  // Poster = the title card (no external images → never tainted, always exports).
  renderFrame(0);
  let poster = null; try { poster = canvas.toDataURL('image/jpeg', 0.85); } catch (e) { poster = null; }

  // captureStream(0) = "I will supply every frame myself"; automatic capture where requestFrame isn't implemented.
  let stream = canvas.captureStream(0);
  let track = stream.getVideoTracks()[0];
  const manual = track && typeof track.requestFrame === 'function';
  if (!manual) { stream = canvas.captureStream(FPS); track = stream.getVideoTracks()[0]; }

  // The sound: if the browser won't run audio (no user gesture), the file is still made, silent, on the page clock.
  if (actx && actx.state !== 'running') await Promise.race([actx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
  const audioOn = !!actx && actx.state === 'running';
  let dest = null;
  if (audioOn) {
    dest = actx.createMediaStreamDestination();
    stream = new MediaStream([track, ...dest.stream.getAudioTracks()]);
  }
  let t0 = 0;
  // Schedules the whole soundtrack from the moment recording starts, so sound and picture share one zero.
  function scheduleAudio() {
    t0 = actx.currentTime + 0.03;
    let musicNode = null;
    if (music) {
      musicNode = startMusic(actx, music, dest, manifest.type, t0);
      fadeOutAt(musicNode.fade, t0 + Math.max(0, total / 1000 - FADE_OUT), FADE_OUT);
      musicNode.stop(t0 + total / 1000 + 0.1);
    }
    let at = 0;
    for (const sc of scenes) {
      if (sc.audio) {
        const src = actx.createBufferSource(); src.buffer = sc.audio;
        src.connect(dest); src.start(t0 + at / 1000);
        if (musicNode) duckAt(musicNode.duck, t0 + at / 1000, t0 + (at + sc.audio.duration * 1000) / 1000);
      }
      at += sc.dur;
    }
  }
  const s0 = performance.now();
  const clock = () => (audioOn ? (actx.currentTime - t0) * 1000 : performance.now() - s0);

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 128000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const ticker = makeTicker();

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (msg) => { if (!settled) { settled = true; ticker.stop(); cleanup(); reject(new Error(msg)); } };

    rec.onstop = () => {
      if (settled) return;
      settled = true; ticker.stop(); cleanup();
      try { track?.stop(); } catch (e) { /* already stopped */ }
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) return reject(new Error('The video came out empty — try again.'));
      resolve({ blob, mime: mime.split(';')[0], poster, durationMs: total });
    };
    rec.onerror = () => fail('Recording failed.');

    // NO timeslice: with one, Chrome hands back fragmented MP4 chunks that most players read only the first of.
    rec.start();
    if (audioOn) scheduleAudio();

    let stopping = false;
    function step() {
      if (settled || stopping) return;
      const t = clock();
      if (t >= 0) {
        renderFrame(Math.min(t, total - 1));
        if (manual) { try { track.requestFrame(); } catch (e) { /* keep going */ } }
        onProgress?.(Math.min(0.99, t / total));
      }
      if (t >= total) {
        // The clock is past the last scene. stop() DISCARDS frames the encoder hasn't finished, and on a busy
        // machine that backlog is seconds long: that was the lost ending (QA 11-12: 3.4 s short under load). So
        // first end the input — the soundtrack stops and no more frames are fed, which adds nothing to the file —
        // then give the encoder time to finish what's queued, then stop.
        stopping = true;
        for (const at of stream.getAudioTracks()) { try { at.stop(); } catch (e) { /* ignore */ } }
        const drain = Math.min(30000, 3000 + total * 0.2);   // covers an encoder running ~20% slower than real time
        setTimeout(() => {
          if (settled) return;
          try { rec.stop(); } catch (e) { return fail('Could not finalise the video.'); }
          setTimeout(() => fail('The video took too long to finalise — try again.'), 30000);
        }, drain);
        return;
      }
      // Aim at the next frame slot on the clock.
      const next = (Math.floor(Math.max(0, t) / (1000 / FPS)) + 1) * (1000 / FPS);
      ticker.after(Math.max(1, Math.min(1000 / FPS, next - t)), step);
    }
    ticker.after(0, step);
  });
}
