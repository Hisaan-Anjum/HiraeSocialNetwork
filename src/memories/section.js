// section.js — the premium "Memories" block that sits ABOVE the moments feed on
// a contact's profile. It renders the relationship header (names, how long
// together, a computed label), the Share Card + Important Dates controls, the
// Featured Story, and the ever-growing Relationship Timeline — and wires every
// one of them to the Story Engine. This is the one module user.js talks to.
//
// On your OWN profile there's no single partner, so instead of a relationship
// this renders a chooser of your contacts (each opens that relationship's
// profile) — the decision agreed for the "view yourself" case.
'use strict';

import { escapeHtml } from '../lib/util.js';
import { renderAvatar } from '../components/avatar.js';
import { buildStoryManifest } from './engine.js';
import { playStory } from './player.js';
import { openStorySelector } from './selector.js';
import { openImportantDates } from './dates.js';
import { buildStoryShareCard, renderStoryVideo, buildRelationshipCard } from './exporter.js';
import { openShareSheet } from '../components/shareSheet.js';

const {
  getRelationshipSummary, getStory, saveStory, uploadStoryVideo,
  getContacts, trackEvent,
} = window;

// ── loading state ("❤️ Creating your memories…") ──────────────────────
function showLoading(message) {
  const el = document.createElement('div');
  el.className = 'ms-loading';
  el.innerHTML = `<div class="ms-loading-inner"><div class="ms-loading-heart">❤️</div><div class="ms-loading-msg">${escapeHtml(message)}</div></div>`;
  document.body.appendChild(el);
  return { setMsg(m) { el.querySelector('.ms-loading-msg').textContent = m; }, close() { el.remove(); } };
}
function toast(message) {
  const t = document.createElement('div');
  t.className = 'ms-toast'; t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('is-in'), 10);
  setTimeout(() => { t.classList.remove('is-in'); setTimeout(() => t.remove(), 300); }, 3200);
}

// `headerEl` (the topmost #profileHeader) is where the unified relationship
// banner renders for an accepted contact; `onRemoveContact` lets that banner
// trigger the page's contact-removal flow without this module owning it.
export function mountMemoriesSection(container, { profile, headerEl = null, onRemoveContact = null }) {
  if (profile.isMe) return mountOwnChooser(container, profile);
  if (profile.contact?.status !== 'accepted') return; // memories are a two-sided thing
  mountRelationship(container, profile, { headerEl, onRemoveContact });
}

// ── your own profile → pick a relationship ────────────────────────────
async function mountOwnChooser(container, profile) {
  let data;
  try { data = await getContacts(); } catch (e) { return; }
  const contacts = data?.contacts || [];
  if (!contacts.length) return;
  const wrap = document.createElement('section');
  wrap.className = 'ms-section ms-chooser';
  wrap.innerHTML = `
    <div class="ms-block-head"><h2>❤️ Memories</h2></div>
    <p class="ms-chooser-sub">Open a relationship to relive your movie nights together.</p>
    <div class="ms-chooser-grid">
      ${contacts.map((c) => `
        <a class="ms-chooser-card" href="user.html?u=${encodeURIComponent(c.username)}">
          ${renderAvatar({ username: c.username, avatarUrl: c.avatarUrl }, { size: 'lg' })}
          <span class="ms-chooser-name">${escapeHtml(profile.username)} & ${escapeHtml(c.username)}</span>
          <span class="ms-chooser-open">Open memories →</span>
        </a>`).join('')}
    </div>`;
  container.appendChild(wrap);
}

// ── a real relationship ───────────────────────────────────────────────
async function mountRelationship(container, profile, opts = {}) {
  const username = profile.username;
  const { headerEl, onRemoveContact } = opts;
  let summary;
  try { summary = await getRelationshipSummary(username); } catch (e) { return; }

  const section = document.createElement('section');
  section.className = 'ms-section';
  container.appendChild(section);
  renderBanner();
  renderSection();
  // Delegated banner clicks (property assignment → no duplicate listeners across
  // re-renders); the section keeps its own listener further down.
  if (headerEl) headerEl.onclick = onBannerClick;

  function monthsText(mt) {
    if (mt >= 12) { const y = Math.floor(mt / 12), mo = mt % 12; return `${y} year${y === 1 ? '' : 's'}${mo ? ` ${mo} mo` : ''}`; }
    return `${mt} month${mt === 1 ? '' : 's'}`;
  }

  // The unified top banner: couple identity on the left, the two action tiles
  // (+ a discreet Remove contact) on the right — one full-bleed header.
  function renderBanner() {
    if (!headerEl) return;
    const s = summary;
    const avThem = renderAvatar({ username: s.them, avatarUrl: profile.avatarUrl }, { size: 'xl' });
    const avMe = renderAvatar({ username: s.me }, { size: 'lg' });
    const st = s.stats || {};
    headerEl.innerHTML = `
      <header class="profile-header rel-header">
        <div class="profile-header-inner rel-header-inner">
          <div class="rel-identity">
            <div class="rel-avatars-wrap">
              <div class="rel-avatars">${avThem}${avMe}</div>
              <div class="rel-presence ${profile.online ? 'is-online' : ''}">
                <span class="rel-dot"></span>${profile.online ? 'Online' : 'Offline'}
              </div>
            </div>
            <div class="rel-idtext">
              <h1 class="rel-names">
                <span class="rel-name-line">
                  <span class="rel-name-them">${escapeHtml(s.them)}</span>
                  <span class="rel-amp">&amp;</span>
                </span>
                <span class="rel-name-me">${escapeHtml(s.me)}</span>
              </h1>
              <div class="rel-meta">
                <span>💜 Together for ${escapeHtml(monthsText(s.monthsTogether))}</span>
              </div>
              <div><span class="rel-label">${escapeHtml(s.label?.emoji || '❤️')} ${escapeHtml(s.label?.text || '')}</span></div>
              <div class="rel-stats">
                <div class="profile-stat"><span class="profile-stat-num">${st.movieNights || 0}</span> movie nights</div>
                <div class="profile-stat"><span class="profile-stat-num">${st.estimatedHours || 0}</span> hours</div>
                <div class="profile-stat"><span class="profile-stat-num">${st.momentsSaved || 0}</span> memories</div>
              </div>
            </div>
          </div>
          <div class="rel-actions">
            <button class="ms-action-tile" data-ms="sharecard">
              <span class="ms-action-ico">💞</span>
              <span class="ms-action-title">Share Card</span>
              <span class="ms-action-sub">Post your story</span>
            </button>
            <button class="ms-action-tile" data-ms="dates">
              <span class="ms-action-ico">📅</span>
              <span class="ms-action-title">Important Dates</span>
              <span class="ms-action-sub">${s.importantDates?.length ? `${s.importantDates.length} saved` : 'Add events'}</span>
            </button>
            ${onRemoveContact ? '<button class="rel-remove" data-ms="remove">Remove contact</button>' : ''}
          </div>
        </div>
      </header>`;
  }

  function onBannerClick(e) {
    const t = e.target.closest('[data-ms]');
    if (!t) return;
    const act = t.dataset.ms;
    if (act === 'sharecard') return shareRelationshipCard();
    if (act === 'dates') return openDates();
    if (act === 'remove') return onRemoveContact && onRemoveContact();
  }

  function renderSection() {
    const s = summary;
    section.innerHTML = `
      <div class="ms-block">
        <div class="ms-block-head">
          <h2>❤️ Memories</h2>
          <button class="ms-link-btn" data-ms="browse">Browse stories →</button>
        </div>
        ${renderFeatured(s)}
      </div>

      ${s.timeline?.length ? `
        <div class="ms-block">
          <div class="ms-block-head"><h2>❤️ Relationship Timeline</h2></div>
          <div class="ms-timeline">
            ${s.timeline.slice().reverse().map((t) => `
              <div class="ms-tl-card">
                <div class="ms-tl-card-emoji">${escapeHtml(t.emoji)}</div>
                <div class="ms-tl-card-title">${escapeHtml(t.title)}</div>
                ${t.subtitle ? `<div class="ms-tl-card-sub">${escapeHtml(t.subtitle)}</div>` : ''}
                <div class="ms-tl-card-date">${escapeHtml(t.date)}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
    `;
  }

  function renderFeatured(s) {
    if (!s.featured) {
      return `<div class="ms-empty">
        <div class="ms-empty-emoji">❤️</div>
        <div class="ms-empty-title">Keep making memories together.</div>
        <div class="ms-empty-sub">Once you've shared enough special moments, your first story will be ready.</div>
      </div>`;
    }
    const f = s.featured;
    const stats = [
      f.stats.estimatedHours ? `${f.stats.estimatedHours} Hours Together` : null,
      f.stats.movieNights ? `${f.stats.movieNights} Movie Nights` : null,
      f.stats.momentsSaved ? `${f.stats.momentsSaved} Memories` : null,
    ].filter(Boolean);
    return `
      <div class="ms-featured" data-ms="play-featured" role="button" tabindex="0">
        <div class="ms-featured-kicker">Featured Story</div>
        <div class="ms-featured-title">${escapeHtml(f.emoji)} ${escapeHtml(f.title)}</div>
        <div class="ms-featured-stats">${stats.map((x) => `<span>${escapeHtml(x)}</span>`).join('')}</div>
        <button class="btn btn-primary ms-play-btn">▶ Play Story</button>
      </div>`;
  }

  // ── generation + playback ──
  // Playback renders the manifest live (cheap, instant, identical experience).
  // A cached manifest whose contentVersion still matches is reused as-is; a
  // stale or missing one is regenerated and saved. See the architecture note.
  // `action`: 'play' opens the cinematic player; 'card' shares the square image.
  async function openStory(descriptor, action) {
    const loading = showLoading('Creating your memories…');
    try {
      let manifest = null;
      try {
        const cached = await getStory(username, descriptor.type, descriptor.key);
        if (cached?.story?.manifest && cached.story.contentVersion === summary.contentVersion) {
          manifest = cached.story.manifest;
        }
      } catch (e) { /* fall through to generation */ }

      if (!manifest) {
        manifest = await buildStoryManifest({ summary, descriptor });
        if (!manifest) {
          loading.close();
          toast('Not enough moments for this story yet — keep making memories 💜');
          return;
        }
        // Persist the manifest so the next open is instant (fire-and-forget).
        saveStory(username, descriptor.type, descriptor.key, {
          title: manifest.title, manifest, contentVersion: manifest.contentVersion,
        }).catch(() => {});
        trackEvent?.('story_generated', { story_type: descriptor.type });
      }

      loading.close();
      if (action === 'card') return shareStoryCard(manifest);
      // The player's own Share button renders the full recap as a video.
      playStory(manifest, { onShare: shareStoryVideo });
    } catch (e) {
      loading.close();
      toast(e.message || 'Could not create that story.');
    }
  }

  // The header "Share Card" — a branded square image, instant, works everywhere.
  async function shareStoryCard(manifest) {
    const card = await buildStoryShareCard(manifest);
    if (card) openShareSheet(card);
    else toast("Couldn't build the card — try again.");
    trackEvent?.('story_shared', { platform: 'card' });
  }

  // Sharing FROM a story = render the whole recap, exactly as it plays, into a
  // vertical MP4 (9:16, story/reel format) entirely on the client, then hand
  // THAT video to the share sheet. The finished file is also uploaded in the
  // background so future opens can stream it instead of re-rendering.
  let rendering = false;
  async function shareStoryVideo(manifest) {
    if (rendering) return;
    rendering = true;
    const loading = showLoading('Creating your video… 0%');
    try {
      const { blob, mime, poster } = await renderStoryVideo(manifest, {
        onProgress: (p) => loading.setMsg(`Creating your video… ${Math.round(p * 100)}%`),
      });
      loading.close();
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      const blobUrl = URL.createObjectURL(blob);
      openShareSheet({
        id: `story-${manifest.type}-${manifest.key}`,
        mediaType: 'video',
        url: poster,          // still frame for previews / the poster
        videoUrl: blobUrl,    // the rendered recap MP4 itself
        mediaExt: ext,
        description: `${manifest.title} — ${manifest.names.me} & ${manifest.names.them}`,
        privacy: 'private', shareUrl: location.href, isStory: true,
      });
      // Keep the blob alive long enough for the share sheet to use it.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000);
      trackEvent?.('story_shared', { platform: 'video' });
      uploadRenderedVideo(manifest, blob); // best-effort, non-blocking
    } catch (e) {
      loading.close();
      toast(e.message || 'Could not create the video — try the Share Card instead.');
    } finally {
      rendering = false;
    }
  }

  async function uploadRenderedVideo(manifest, blob) {
    try {
      // Make sure the manifest row exists so the video attaches to it.
      await saveStory(username, manifest.type, manifest.key, {
        title: manifest.title, manifest, contentVersion: manifest.contentVersion,
      }).catch(() => {});
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
      });
      await uploadStoryVideo(username, manifest.type, manifest.key, dataUrl);
    } catch (e) { /* best-effort — the share already succeeded */ }
  }

  // ── delegated clicks ──
  section.addEventListener('click', (e) => {
    const t = e.target.closest('[data-ms]');
    if (!t) return;
    const act = t.dataset.ms;
    if (act === 'browse') return openStorySelector({ summary, onPick: (d) => openStory(d, 'play') });
    if (act === 'play-featured' && summary.featured) return openStory(summary.featured, 'play');
  });

  // The "Share Card" tile → a beautiful relationship card image, built instantly
  // from the summary (no network) and handed to the Share sheet.
  async function shareRelationshipCard() {
    const card = await buildRelationshipCard(summary);
    if (card) openShareSheet(card); else toast("Couldn't build the card — try again.");
    trackEvent?.('story_shared', { platform: 'card' });
  }
  section.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-ms="play-featured"]')) {
      e.preventDefault(); if (summary.featured) openStory(summary.featured, 'play');
    }
  });

  function openDates() {
    openImportantDates({
      username,
      dates: summary.importantDates || [],
      onChange: async () => {
        // Dates feed the banner count, the timeline and available stories, so
        // refresh the summary and re-render both the banner and the section.
        try { summary = await getRelationshipSummary(username); renderBanner(); renderSection(); } catch (e) { /* keep old */ }
      },
    });
  }
}
