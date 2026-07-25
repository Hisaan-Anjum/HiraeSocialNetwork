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

// ── shared drawing helpers (parametric in width/height) ─────────────────
const ACCENTS = {
  gold: ['#2a1c10', '#241a33', '#0d0b12'],
  purple: ['#1b1327', '#241a33', '#0d0b12'],
  rose: ['#2a1220', '#241a33', '#0d0b12'],
};
const ACCENT_LINE = { gold: ['#f5b942', '#a78bfa'], purple: ['#a78bfa', '#f5b942'], rose: ['#fb7185', '#a78bfa'] };

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
// Accepts an <img> OR a <video> (naturalWidth vs videoWidth), so a video moment
// can be drawn frame-by-frame exactly like a photo.
function drawCover(ctx, src, x, y, w, h, r, zoom = 1) {
  const iw = src.naturalWidth || src.videoWidth;
  const ih = src.naturalHeight || src.videoHeight;
  if (!iw || !ih) return;
  ctx.save();
  if (r) { roundRect(ctx, x, y, w, h, r); ctx.clip(); }
  ctx.imageSmoothingQuality = 'high';
  const s = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * s, dh = ih * s;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

// A muted, looping <video> ready to be drawn onto the canvas. Resolves to null
// if it can't load, so the montage falls back to the moment's poster image.
function loadVideoEl(src) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true; v.playsInline = true; v.loop = true; v.preload = 'auto';
    let done = false;
    const ok = () => { if (!done) { done = true; resolve(v); } };
    v.onloadeddata = ok;
    v.oncanplay = ok;
    v.onerror = () => { if (!done) { done = true; resolve(null); } };
    setTimeout(() => { if (!done) { done = true; resolve(v.readyState >= 2 ? v : null); } }, 8000);
    v.src = src;
  });
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
  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
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
export async function buildStoryShareCard(manifest) {
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
  ctx.fillStyle = 'rgba(233,213,255,0.85)';
  ctx.font = `600 30px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  ctx.fillText(`${manifest.names.me} & ${manifest.names.them}`, SIZE / 2, 120);
  ctx.font = '64px serif';
  ctx.fillText(manifest.emoji || '❤️', SIZE / 2, 200);
  const gt = ctx.createLinearGradient(SIZE * 0.2, 0, SIZE * 0.8, 0);
  gt.addColorStop(0, line[0]); gt.addColorStop(1, line[1]);
  wrapText(ctx, manifest.title, SIZE / 2, 285, SIZE * 0.8, 62, `700 60px Georgia, serif`, gt);
  if (manifest.subtitle) {
    ctx.fillStyle = 'rgba(233,213,255,0.7)';
    ctx.font = `500 26px -apple-system, sans-serif`;
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
      drawCover(ctx, img, pad + c * (cw + gap), gy + r * (ch + gap), cw, ch, 22);
    });
  }

  const stats = (manifest.stats || []).slice(0, 3);
  if (stats.length) {
    const y = 835, colW = SIZE / stats.length;
    stats.forEach((s, i) => {
      const cx = colW * i + colW / 2;
      ctx.fillStyle = line[0]; ctx.font = `700 60px Georgia, serif`; ctx.textAlign = 'center';
      ctx.fillText(String(s.value), cx, y);
      ctx.fillStyle = 'rgba(233,213,255,0.8)'; ctx.font = `600 24px -apple-system, sans-serif`;
      ctx.fillText(`${s.emoji} ${s.label}`, cx, y + 40);
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
function drawPill(ctx, cx, cy, text) {
  ctx.font = '700 30px -apple-system, BlinkMacSystemFont, sans-serif';
  const w = ctx.measureText(text).width; const padX = 30, h = 66;
  ctx.fillStyle = 'rgba(139,92,246,0.92)';
  roundRect(ctx, cx - w / 2 - padX, cy - h / 2, w + padX * 2, h, h / 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 1); ctx.textBaseline = 'alphabetic';
}
export async function buildRelationshipCard(summary) {
  const SIZE = 1080;
  const line = ACCENT_LINE.purple;
  const logo = await loadImage('logo.png');
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  bgGradient(ctx, SIZE, SIZE, 'purple');

  const emoji = summary.label?.emoji || '❤️';
  ctx.textAlign = 'center';
  ctx.font = '120px serif'; ctx.fillStyle = '#fff'; ctx.fillText(emoji, SIZE / 2, 250);

  const g = ctx.createLinearGradient(SIZE * 0.2, 0, SIZE * 0.8, 0);
  g.addColorStop(0, line[0]); g.addColorStop(1, line[1]);
  ctx.fillStyle = g; ctx.font = '700 74px Georgia, serif';
  ctx.fillText(`${summary.me} & ${summary.them}`, SIZE / 2, 372);

  const mt = summary.monthsTogether || 0;
  const yy = Math.floor(mt / 12), mo = mt % 12;
  const monthsTxt = yy >= 1 ? `${yy} year${yy === 1 ? '' : 's'}${mo ? ` ${mo} mo` : ''}` : `${mt} month${mt === 1 ? '' : 's'}`;
  ctx.fillStyle = 'rgba(233,213,255,0.82)'; ctx.font = '500 34px -apple-system, sans-serif';
  ctx.fillText(`Together for ${monthsTxt}`, SIZE / 2, 432);

  if (summary.label?.text) drawPill(ctx, SIZE / 2, 512, `${emoji} ${summary.label.text}`);

  const st = summary.stats || {};
  const cells = [[st.movieNights || 0, 'Movie Nights'], [st.estimatedHours || 0, 'Hours Together'], [st.momentsSaved || 0, 'Memories']];
  const y = 770, colW = SIZE / 3;
  cells.forEach(([num, label], i) => {
    const cx = colW * i + colW / 2;
    ctx.fillStyle = line[0]; ctx.font = '700 78px Georgia, serif'; ctx.textAlign = 'center';
    ctx.fillText(String(num), cx, y);
    ctx.fillStyle = 'rgba(233,213,255,0.8)'; ctx.font = '600 26px -apple-system, sans-serif';
    ctx.fillText(label, cx, y + 46);
  });

  drawWatermark(ctx, SIZE, SIZE, logo);
  let url; try { url = canvas.toDataURL('image/jpeg', 0.9); } catch (e) { return null; }
  return {
    id: 'relationship-card', mediaType: 'photo', url,
    description: `${summary.me} & ${summary.them} — ${summary.label?.text || 'our story on Herae'}`,
    privacy: 'private', shareUrl: location.href, isStory: true,
  };
}

// ── the full recap as a vertical 9:16 video (player's Share button) ─────
function pickMime() {
  const candidates = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const m of candidates) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; }
  return null;
}

// Builds the ordered scene list that mirrors the on-screen player (player.js):
// title → stats → timeline → moment montage → top sessions → comments → ending.
// EVERY moment in the manifest is included (the engine already caps them at 12),
// so the exported video is the whole story, not an excerpt.
function videoScenes(manifest, images, videos) {
  const scenes = [];
  scenes.push({ kind: 'title', dur: 2600 });
  if (manifest.stats?.length) scenes.push({ kind: 'stats', dur: 2600 });
  if (manifest.timeline?.length) scenes.push({ kind: 'timeline', dur: 2600 });
  manifest.scenes.filter((s) => s.url).forEach((s, i) => {
    // A video moment is kept even if only the clip loaded, and gets a little
    // longer on screen so the motion actually reads.
    const img = images[i] || null;
    const vid = videos[i] || null;
    if (img || vid) scenes.push({ kind: 'moment', dur: vid ? 3200 : 2400, m: s, img, vid });
  });
  if (manifest.topSessions?.length) scenes.push({ kind: 'top', dur: 2400 });
  if (manifest.comments?.length) scenes.push({ kind: 'comments', dur: 2600 });
  scenes.push({ kind: 'ending', dur: 2800 });
  return scenes;
}

// Renders one scene at progress p (0..1). W/H are the vertical canvas dims.
function drawScene(ctx, W, H, manifest, scene, p, logo) {
  const accent = manifest.variant?.accent || 'purple';
  const line = ACCENT_LINE[accent] || ACCENT_LINE.purple;
  const fade = Math.min(1, p / 0.15, (1 - p) / 0.15); // fade in + out at the edges
  const cx = W / 2;

  bgGradient(ctx, W, H, accent);

  if (scene.kind === 'moment') {
    ctx.globalAlpha = Math.max(0.001, fade);
    // A video moment draws its LIVE frames (it's already moving, so no Ken
    // Burns); a photo gets the slow zoom. Falls back to the poster if the clip
    // hasn't buffered.
    const live = scene.vid && scene.vid.readyState >= 2 ? scene.vid : null;
    if (live) drawCover(ctx, live, 0, 0, W, H, 0, 1);
    else if (scene.img) drawCover(ctx, scene.img, 0, 0, W, H, 0, 1 + p * 0.12);
    const scrim = ctx.createLinearGradient(0, H * 0.5, 0, H);
    scrim.addColorStop(0, 'rgba(0,0,0,0)'); scrim.addColorStop(1, 'rgba(0,0,0,0.8)');
    ctx.fillStyle = scrim; ctx.fillRect(0, H * 0.5, W, H * 0.5);
    const m = scene.m;
    ctx.textAlign = 'left';
    let ty = H - 240;
    if (m.sessionTitle) { ctx.fillStyle = '#fff'; ctx.font = '700 52px Georgia, serif'; ctx.fillText(String(m.sessionTitle).slice(0, 26), 70, ty); ty += 62; }
    if (m.caption) { ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = '400 36px -apple-system, sans-serif'; wrapText(ctx, m.caption, 70, ty, W - 140, 44, '400 36px -apple-system, sans-serif', 'rgba(255,255,255,0.92)', 'left'); ty += 88; }
    if (m.dateLabel) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '500 30px -apple-system, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(m.dateLabel, 70, ty); }
    ctx.globalAlpha = 1;
    drawWatermark(ctx, W, H, logo);
    return;
  }

  ctx.globalAlpha = Math.max(0.001, fade);
  ctx.textAlign = 'center';

  if (scene.kind === 'title') {
    ctx.fillStyle = 'rgba(233,213,255,0.85)'; ctx.font = '600 40px -apple-system, sans-serif';
    ctx.fillText(`${manifest.names.me} & ${manifest.names.them}`, cx, H / 2 - 240);
    ctx.font = '110px serif'; ctx.fillText(manifest.emoji || '❤️', cx, H / 2 - 110);
    const g = ctx.createLinearGradient(W * 0.12, 0, W * 0.88, 0);
    g.addColorStop(0, line[0]); g.addColorStop(1, line[1]);
    const rows = wrapText(ctx, manifest.title, cx, H / 2 + 10, W * 0.82, 96, '700 86px Georgia, serif', g);
    if (manifest.subtitle) { ctx.fillStyle = 'rgba(233,213,255,0.7)'; ctx.font = '500 34px -apple-system, sans-serif'; ctx.fillText(manifest.subtitle, cx, H / 2 + 10 + rows * 96 + 20); }
  } else if (scene.kind === 'stats') {
    const stats = manifest.stats.slice(0, 4);
    const lead = stats[0];
    // Lead stat, centered and stacked with real vertical spacing.
    ctx.textAlign = 'center';
    ctx.font = '76px serif'; ctx.fillStyle = '#fff'; ctx.fillText(lead.emoji, cx, H / 2 - 330);
    ctx.fillStyle = line[0]; ctx.font = '700 190px Georgia, serif'; ctx.fillText(String(lead.value), cx, H / 2 - 140);
    ctx.fillStyle = 'rgba(233,213,255,0.9)'; ctx.font = '600 42px -apple-system, sans-serif';
    ctx.fillText(lead.label, cx, H / 2 - 70);
    // Secondary stats: value right-aligned into the left column, emoji+label
    // left-aligned into the right column. Both were previously CENTER-aligned a
    // few pixels apart, which is what stacked the text on top of the icons.
    stats.slice(1).forEach((s, i) => {
      const y = H / 2 + 90 + i * 120;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff'; ctx.font = '700 66px Georgia, serif';
      ctx.fillText(String(s.value), cx - 28, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(233,213,255,0.78)'; ctx.font = '500 34px -apple-system, sans-serif';
      ctx.fillText(`${s.emoji} ${s.label}`, cx + 28, y - 4);
    });
    ctx.textAlign = 'center';
  } else if (scene.kind === 'timeline' || scene.kind === 'top' || scene.kind === 'comments') {
    const kicker = scene.kind === 'timeline' ? 'Along the way' : scene.kind === 'top' ? 'Your best nights' : 'Things you said';
    ctx.fillStyle = line[0]; ctx.font = '700 30px -apple-system, sans-serif';
    ctx.fillText(kicker.toUpperCase(), cx, H / 2 - 320);
    ctx.textAlign = 'center';
    if (scene.kind === 'timeline') {
      manifest.timeline.slice(0, 4).forEach((t, i) => {
        ctx.fillStyle = '#fff'; ctx.font = '600 44px -apple-system, sans-serif';
        ctx.fillText(`${t.emoji}  ${t.title}`, cx, H / 2 - 180 + i * 130);
        if (t.dateLabel) { ctx.fillStyle = 'rgba(233,213,255,0.6)'; ctx.font = '400 28px -apple-system, sans-serif'; ctx.fillText(t.dateLabel, cx, H / 2 - 140 + i * 130); }
      });
    } else if (scene.kind === 'top') {
      manifest.topSessions.slice(0, 3).forEach((s, i) => {
        ctx.fillStyle = '#fff'; ctx.font = '700 48px Georgia, serif'; ctx.fillText(String(s.title).slice(0, 24), cx, H / 2 - 150 + i * 170);
        ctx.fillStyle = line[0]; ctx.font = '44px serif'; ctx.fillText('★'.repeat(Math.round(s.rating)), cx, H / 2 - 100 + i * 170);
      });
    } else {
      manifest.comments.slice(0, 3).forEach((c, i) => {
        ctx.fillStyle = '#fff';
        const rows = wrapText(ctx, `“${c.text}”`, cx, H / 2 - 200 + i * 200, W * 0.8, 52, 'italic 600 44px Georgia, serif', '#fff');
        ctx.fillStyle = 'rgba(233,213,255,0.6)'; ctx.font = '400 30px -apple-system, sans-serif';
        ctx.fillText(`— ${c.username}`, cx, H / 2 - 200 + i * 200 + rows * 52 + 6);
      });
    }
  } else if (scene.kind === 'ending') {
    ctx.font = '120px serif'; ctx.fillStyle = '#fff';
    ctx.fillText(manifest.variant?.endingStyle === 'sparkle' ? '✨' : manifest.variant?.endingStyle === 'stars' ? '🌟' : '❤️', cx, H / 2 - 120);
    wrapText(ctx, manifest.ending, cx, H / 2 + 10, W * 0.82, 70, '600 56px Georgia, serif', '#f3f0f8');
    ctx.fillStyle = 'rgba(233,213,255,0.75)'; ctx.font = '500 36px -apple-system, sans-serif';
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

const FPS = 30;
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

// Renders the whole recap to a vertical MP4/WebM. Resolves to
// { blob, mime, poster(dataURL) }.
//
// Frames are DETERMINISTIC and pushed MANUALLY: scene selection is a pure
// function of the frame index (never the wall clock), and each rendered frame is
// handed to the encoder exactly once via track.requestFrame(). That's what keeps
// the montage in order with no duplicated or dropped frames — the previous
// rAF + wall-clock loop re-sampled whatever happened to be on the canvas, so any
// jank (image decode, GC, a background tab) repeated or skipped frames.
//
// The loop is still PACED to real time, because MediaRecorder timestamps frames
// by arrival, so a ~30s story takes ~30s to record. onProgress(0..1) drives the
// loading state meanwhile.
export async function renderStoryVideo(manifest, { onProgress } = {}) {
  const mime = pickMime();
  if (!mime) throw new Error('This browser can’t record video — try the Share Card instead.');

  const W = DES_W, H = DES_H; // all scene drawing happens in design units
  const momentScenes = (manifest.scenes || []).filter((s) => s.url);
  const [logo, imgs, vids] = await Promise.all([
    loadImage('logo.png'),
    Promise.all(momentScenes.map((s) => loadImage(s.url))),
    // Video moments play for real in the export; a photo moment resolves null.
    Promise.all(momentScenes.map((s) => (s.videoUrl ? loadVideoEl(s.videoUrl) : Promise.resolve(null)))),
  ]);
  const scenes = videoScenes(manifest, imgs, vids);
  const total = scenes.reduce((a, s) => a + s.dur, 0);
  const totalFrames = Math.max(1, Math.round((total / 1000) * FPS));

  // Scene + progress-within-scene for a given moment in the timeline. Pure, so
  // frame N always renders exactly the same picture.
  function sceneAt(tMs) {
    let acc = 0;
    for (let i = 0; i < scenes.length; i++) {
      if (tMs < acc + scenes[i].dur) return { idx: i, seg: scenes[i], p: (tMs - acc) / scenes[i].dur };
      acc += scenes[i].dur;
    }
    const last = scenes.length - 1;
    return { idx: last, seg: scenes[last], p: 1 };
  }
  let playing = null; // the video element currently on screen
  function renderFrame(i) {
    const { idx, seg, p } = sceneAt((i / FPS) * 1000);
    // Start a video moment's clip the first time its scene is drawn, and stop
    // the previous one — so each clip plays from its beginning, exactly once.
    if (seg.vid !== playing) {
      if (playing) { try { playing.pause(); } catch (e) { /* ignore */ } }
      playing = seg.vid || null;
      if (playing) { try { playing.currentTime = 0; playing.play().catch(() => {}); } catch (e) { /* ignore */ } }
    }
    // Absolute transform each frame: draw in 1080×1920 design units, land on the
    // 720×1280 canvas. (drawCover's save/restore only nests inside this.)
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    drawScene(ctx, W, H, manifest, seg, p, logo);
    drawProgress(ctx, W, scenes, idx, p);
  }
  const stopVideos = () => { for (const v of vids) { if (v) { try { v.pause(); } catch (e) { /* ignore */ } } } };

  const canvas = document.createElement('canvas');
  canvas.width = OUT_W; canvas.height = OUT_H;
  const ctx = canvas.getContext('2d', { alpha: false });

  // Poster = the title card (no external images → never tainted, always exports).
  renderFrame(0);
  let poster = null; try { poster = canvas.toDataURL('image/jpeg', 0.85); } catch (e) { poster = null; }

  // captureStream(0) = "I will supply every frame myself". Fall back to
  // automatic capture where requestFrame isn't implemented.
  let stream = canvas.captureStream(0);
  let track = stream.getVideoTracks()[0];
  const manual = track && typeof track.requestFrame === 'function';
  if (!manual) { stream = canvas.captureStream(FPS); track = stream.getVideoTracks()[0]; }

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };

    rec.onstop = () => {
      if (settled) return;
      settled = true;
      stopVideos();
      try { track?.stop(); } catch (e) { /* already stopped */ }
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) return reject(new Error('The video came out empty — try again.'));
      resolve({ blob, mime: mime.split(';')[0], poster });
    };
    rec.onerror = () => { stopVideos(); fail('Recording failed.'); };

    // NO timeslice — deliberately. With one, Chrome hands back FRAGMENTED MP4
    // chunks, and concatenating those yields a file most players only read the
    // first fragment of: the video looks truncated (the closing scenes — "your
    // best nights", the comments, the ending — silently vanish). Recording to a
    // single blob and flushing once at the end produces one complete, valid file.
    rec.start();

    const startedAt = performance.now();
    let i = 0;

    function step() {
      if (settled) return;
      renderFrame(i);
      if (manual) { try { track.requestFrame(); } catch (e) { /* keep going */ } }
      i++;
      onProgress?.(Math.min(0.99, i / totalFrames));

      if (i >= totalFrames) return finish();
      // Pace this frame to its real-time slot so encoder timestamps stay honest.
      const delay = Math.max(0, startedAt + (i / FPS) * 1000 - performance.now());
      setTimeout(step, delay);
    }

    // Hold the final frame briefly and let the last timeslice land before
    // stopping — without this the encoder truncates the ending.
    // Hold the closing frame while the encoder drains. stop() throws away
    // anything still queued, so this wait is what guarantees the final scenes
    // ("your best nights", the comments, the ending) actually make the file.
    // Scaled to the story's length, since a longer story leaves a longer tail.
    function finish() {
      onProgress?.(0.99);
      // Adaptive, not a fixed guess: if the render loop itself ran behind its
      // nominal duration, the encoder is behind by at least as much, so the
      // observed lag is added to the drain. Scales with story length and with
      // how slow this particular machine turned out to be.
      const lag = Math.max(0, (performance.now() - startedAt) - total);
      const holdFor = Math.min(15000, 1200 + total * 0.05 + lag);
      const heldAt = performance.now();
      (function holdLastFrame() {
        if (settled) return;
        renderFrame(totalFrames - 1);
        if (manual) { try { track.requestFrame(); } catch (e) { /* ignore */ } }
        if (performance.now() - heldAt < holdFor) { setTimeout(holdLastFrame, 1000 / FPS); return; }
        stopVideos();
        try { rec.stop(); } catch (e) { return fail('Could not finalise the video.'); }
        // Safety net: if onstop never arrives, don't hang the loading overlay.
        setTimeout(() => fail('The video took too long to finalise — try again.'), 15000);
      }());
    }

    setTimeout(step, 0);
  });
}
