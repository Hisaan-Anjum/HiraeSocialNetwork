// engine.js — the reusable Story Engine.
//
// One engine produces EVERY kind of Memory Story (monthly, anniversary,
// milestone, holiday, important-date, custom). A story is a small MANIFEST — a
// chosen+ordered set of moments, computed stats, timeline highlights, top
// sessions, comments, an emotional title, and a randomized "variant" that makes
// each story feel handcrafted — NOT a rendered video. The player renders the
// manifest live from CDN media (see player.js); the exporter only makes a real
// file when someone shares/downloads (see exporter.js). This is what keeps the
// whole system near-free to run at any scale.
//
// Adding a future story type is one entry in STORY_REGISTRY (a range resolver +
// a title) — the manifest builder, player, selector and exporter don't change.
'use strict';

const { mediaUrl, getPostsByUser, getAuth } = window;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const MAX_SCENES = 12;      // moments shown in the cinematic montage
const MOMENT_CAP = 240;     // hard ceiling on how many moments we ever scan
const MANIFEST_VERSION = 4; // bump to force every cached story to regenerate

// created_at / event dates are 'YYYY-MM-DD HH:MM:SS' (UTC) or 'YYYY-MM-DD'.
function parseTs(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : (String(s).length <= 10 ? 'T00:00:00Z' : 'Z')));
  return Number.isNaN(d.getTime()) ? null : d;
}
const addYears = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x; };
function monthLabel(d) { return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ── Story-type registry ───────────────────────────────────────────────
// Each type knows only how to turn its `key` into a date window and a default
// title. `range` returns { start, end } Dates, or null for "all of time".
export const STORY_REGISTRY = {
  monthly: {
    range(key) {
      const [y, m] = key.split('-').map(Number);
      return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
    },
    title(key) { const [y, m] = key.split('-').map(Number); return `${MONTH_NAMES[m - 1]} Together`; },
    subtitle(key) { const [y, m] = key.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; },
  },
  anniversary: {
    range(key, summary) {
      const since = parseTs(summary.togetherSince);
      const n = Number(String(key).replace('year-', '')) || summary.yearsTogether || 1;
      return since ? { start: addYears(since, n - 1), end: addYears(since, n) } : null;
    },
    title(key) { const n = Number(String(key).replace('year-', '')) || 1; return n === 1 ? 'One Year Together' : `${n} Years Together`; },
    subtitle() { return 'Another chapter together'; },
  },
  milestone: {
    range() { return null; },
    title(key) { const n = Number(String(key).replace('movies-', '')) || 0; return `${n} Movies Together`; },
    subtitle(key) { const n = Number(String(key).replace('movies-', '')) || 0; return `${n} movie nights and counting`; },
  },
  holiday: {
    range(key) {
      const y = Number(String(key).split('-').pop());
      if (String(key).startsWith('christmas')) return { start: new Date(Date.UTC(y, 11, 1)), end: new Date(Date.UTC(y, 11, 31, 23, 59)) };
      if (String(key).startsWith('valentine')) return { start: new Date(Date.UTC(y, 1, 8)), end: new Date(Date.UTC(y, 1, 16)) };
      return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)) };
    },
    title(key) { return String(key).startsWith('valentine') ? "Valentine's Together" : 'Christmas Together'; },
    subtitle(key) { return String(key).startsWith('valentine') ? '❤️' : '🎄'; },
  },
  important_date: {
    range(key, summary) {
      const d = (summary.importantDates || []).find((x) => String(x.id) === String(key));
      const dt = d && parseTs(d.date);
      if (!dt) return null;
      // The month around the date, so there's material to draw from.
      return { start: new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1)), end: new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1)) };
    },
    title(key, summary) { const d = (summary.importantDates || []).find((x) => String(x.id) === String(key)); return d ? d.title : 'A Special Day'; },
    subtitle(key, summary) { const d = (summary.importantDates || []).find((x) => String(x.id) === String(key)); return d ? d.date : ''; },
  },
  custom: {
    range() { return null; },
    title() { return 'Our Story'; },
    subtitle() { return 'Every night, together'; },
  },
};

// Emotional-title variety — occasionally replaces the default with something
// that fits what the story turned out to be (spec: never just "July 2026").
function emotionalTitle(type, key, summary, feel) {
  const base = STORY_REGISTRY[type]?.title(key, summary) || summary.label?.text || 'Together';
  if (type !== 'monthly') return base;
  const pool = [base];
  if (feel.videoHeavy) pool.push('Caught on Camera', 'Our Little Movies');
  if (feel.movieHeavy) pool.push('Movie Marathon Month', 'Nothing But Movie Nights');
  if (feel.cozy) pool.push('🌙 Cozy Nights', 'Just the Two of Us');
  if (feel.laughs) pool.push("The Month We Couldn't Stop Laughing");
  return Math.random() < 0.55 ? base : pick(pool);
}

// Fetches the pair's moments within a window by paging the existing by-user
// feed and keeping only the ones this viewer is actually IN (their shared
// relationship), newest-first. `range` null = most-recent up to the cap.
async function fetchPairMoments(them, range) {
  const me = (getAuth()?.username || '').toLowerCase();
  const out = [];
  let cursor;
  for (let page = 0; page < 20 && out.length < MOMENT_CAP; page++) {
    let res;
    try { res = await getPostsByUser(them, cursor); } catch (e) { break; }
    const batch = res.moments || [];
    if (!batch.length) break;
    let wentPast = false;
    for (const m of batch) {
      const parts = (m.participants || []).map((p) => String(p).toLowerCase());
      if (!parts.includes(me)) continue; // someone else's moment with `them`
      const ts = parseTs(m.createdAt);
      if (range && ts && ts < range.start) { wentPast = true; continue; }
      if (range && ts && ts >= range.end) continue;
      out.push(m);
    }
    cursor = res.nextCursor;
    if (!cursor || wentPast) break;
  }
  return out;
}

// Turns a raw hydrated moment into a manifest scene (media reused from the CDN,
// never re-uploaded).
function toScene(m) {
  return {
    id: m.id,
    url: m.url ? mediaUrl(m.url) : null,
    videoUrl: m.mediaType === 'video' && m.videoUrl ? mediaUrl(m.videoUrl) : null,
    caption: m.description || null,
    sessionTitle: m.sessionTitle || m.content?.title || null,
    dateLabel: (() => { const d = parseTs(m.createdAt); return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null; })(),
  };
}

// Builds a story manifest for a descriptor { type, key, title?, emoji? }, or
// returns null when there isn't enough to make a good story (the quality gate —
// the section then shows a beautiful empty state).
export async function buildStoryManifest({ summary, descriptor }) {
  const reg = STORY_REGISTRY[descriptor.type];
  if (!reg) return null;
  const range = reg.range(descriptor.key, summary);
  const moments = await fetchPairMoments(summary.them, range);

  const minMoments = summary.minStoryMoments || 4;
  if (moments.length < minMoments) return null;

  const sessions = new Set(moments.map((m) => m.clientSessionId));
  const videos = moments.filter((m) => m.videoUrl);
  const captioned = moments.filter((m) => m.description);
  const allComments = moments.flatMap((m) => (m.comments || []).map((c) => ({ username: c.username, text: c.text })));
  // clientSessionId is carried through so reviews can be grouped by the NIGHT
  // they belong to (see topSessions below), not merely by its title.
  const allReviews = moments.flatMap((m) => (m.reviews || []).map((r) => ({
    ...r, sessionTitle: m.sessionTitle || m.content?.title, clientSessionId: m.clientSessionId,
  })));

  const feel = {
    videoHeavy: videos.length >= Math.max(3, moments.length * 0.4),
    movieHeavy: sessions.size >= 6,
    cozy: sessions.size <= 4 && moments.length >= minMoments,
    laughs: allComments.length >= 6,
  };

  // ── stat ordering (lead with whatever made THIS story unique) ──
  const est = Math.round(sessions.size * 1.9);
  const statDefs = [
    { emoji: '🍿', label: 'Movie Nights', value: sessions.size, weight: sessions.size },
    { emoji: '📸', label: 'Memories', value: moments.length, weight: moments.length * 0.8 },
    { emoji: '⏱️', label: est === 1 ? 'Hour Together' : 'Hours Together', value: est, weight: est * 1.2 },
    { emoji: '🎥', label: 'Video Moments', value: videos.length, weight: videos.length * 2.5 },
  ].filter((s) => s.value > 0);
  statDefs.sort((a, b) => b.weight - a.weight); // dominant stat first
  const stats = statDefs.map(({ emoji, label, value }) => ({ emoji, label, value }));

  // ── scene selection + ordering (variety) ──
  const orderMode = pick(['chronological', 'chronological', 'highlights', 'shuffle']);
  let chosen;
  if (orderMode === 'highlights') {
    // videos + captioned first, then the rest — a "best bits" cut.
    const rest = moments.filter((m) => !m.videoUrl && !m.description);
    chosen = [...shuffle(videos), ...shuffle(captioned.filter((m) => !m.videoUrl)), ...shuffle(rest)];
  } else if (orderMode === 'shuffle') {
    chosen = shuffle(moments);
  } else {
    chosen = moments.slice().sort((a, b) => (parseTs(a.createdAt) - parseTs(b.createdAt)));
  }
  // De-dupe while capping.
  const seen = new Set();
  const scenes = [];
  for (const m of chosen) {
    if (seen.has(m.id) || !m.url) continue;
    seen.add(m.id); scenes.push(toScene(m));
    if (scenes.length >= MAX_SCENES) break;
  }

  // ── timeline highlights within (or leading up to) this story ──
  const timeline = (summary.timeline || [])
    .filter((t) => !range || (parseTs(t.date) >= range.start && parseTs(t.date) < range.end))
    .slice(-4)
    .map((t) => ({ emoji: t.emoji, title: t.title, dateLabel: t.date }));

  // ── top-rated sessions in this story ──
  // Grouped by the session itself, not by its title: two different nights can
  // share a name, and the id is what carries the film they were filed under.
  const bySession = {};
  for (const m of moments) {
    const sid = m.clientSessionId;
    (bySession[sid] ||= {
      title: m.sessionTitle || m.content?.title || 'Movie Night',
      movie: m.sessionMovie || null,
      ratings: [],
    });
    if (m.sessionMovie && !bySession[sid].movie) bySession[sid].movie = m.sessionMovie;
  }
  for (const r of allReviews) {
    if (r.rating == null || !bySession[r.clientSessionId]) continue;
    bySession[r.clientSessionId].ratings.push(r.rating);
  }
  const topSessions = Object.values(bySession)
    .filter((s) => s.ratings.length)
    .map((s) => ({
      title: s.title,
      rating: Math.round((s.ratings.reduce((a, b) => a + b, 0) / s.ratings.length) * 10) / 10,
      // Cover art, when this night was filed under a shared-watchlist film —
      // that's what lets the story illustrate its best nights instead of
      // listing bare titles.
      posterUrl: s.movie?.posterUrl || null,
      year: s.movie?.releaseYear || null,
    }))
    .sort((a, b) => b.rating - a.rating).slice(0, 3);

  const comments = shuffle(allComments).slice(0, 3);

  const endings = [
    'Here’s to the next chapter 💜',
    'And the story continues…',
    'More memories, coming soon.',
    'Same time next month? ❤️',
    'To be continued, together.',
  ];

  return {
    v: MANIFEST_VERSION,
    type: descriptor.type,
    key: descriptor.key,
    emoji: descriptor.emoji || summary.label?.emoji || '❤️',
    title: descriptor.title || emotionalTitle(descriptor.type, descriptor.key, summary, feel),
    subtitle: reg.subtitle ? reg.subtitle(descriptor.key, summary) : '',
    names: { me: summary.me, them: summary.them },
    stats,
    scenes,
    timeline,
    topSessions,
    comments,
    ending: pick(endings),
    variant: {
      intro: pick(['bloom', 'fade', 'rise', 'sweep']),
      transition: pick(['crossfade', 'slide', 'kenburns']),
      accent: pick(['gold', 'purple', 'rose']),
      endingStyle: pick(['heart', 'sparkle', 'stars']),
    },
    contentVersion: summary.contentVersion,
    generatedAt: new Date().toISOString(),
  };
}

export { MANIFEST_VERSION, MONTH_NAMES, parseTs };
