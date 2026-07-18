// shareSheet.js — the "❤️ Share your Moment" desktop sharing flow.
//
// A single, reliable, API-free flow: no social-media SDKs, no OAuth, no
// server calls. Each destination is either a plain share-intent URL (the
// documented web endpoints WhatsApp/Telegram/Facebook expose) or a local
// download of the already-watermarked media — whichever actually works on a
// desktop browser without asking the user to install or authorize anything.
//
// Instagram has no public web "share to feed" URL at all, so the only honest
// desktop flow is: export the media, download it, open Instagram, and tell the
// user it's ready to upload. Facebook works the same way when there's no
// public link to point at.
'use strict';

import { escapeHtml } from '../lib/util.js';

const { mediaUrl, momentPublicUrl } = window;

let openSheet = null;

// `moment` needs: id, mediaType, url (poster/photo), videoUrl (if video),
// description (optional), privacy (optional — enables link-based sharing).
export function openShareSheet(moment) {
  if (openSheet) openSheet();

  const isVideo = moment.mediaType === 'video' && moment.videoUrl;
  // A recap (or any synthetic post) can pass its own shareUrl since it has no
  // per-post page of its own; everything else links to post.html?id=…
  const link = moment.shareUrl || momentPublicUrl(moment.id);
  const isPublic = moment.privacy === 'public';
  const caption = moment.description
    ? `${moment.description} — on Herae`
    : 'A moment from Herae 💜';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay share-overlay';
  overlay.innerHTML = `
    <div class="modal-card share-card" role="dialog" aria-modal="true" aria-label="Share your moment">
      <div class="share-head">
        <h2>❤️ Share your Moment</h2>
        <button class="share-close" data-share="close" aria-label="Close">✕</button>
      </div>
      ${isPublic ? '' : `<div class="share-note">This moment is <strong>${escapeHtml(moment.privacy || 'private')}</strong>. Links only open for people allowed to see it, so we'll share the media file directly where that's clearer.</div>`}
      <div class="share-grid">
        <button class="share-opt" data-share="instagram"><span class="share-ico">📸</span><span>Instagram</span></button>
        <button class="share-opt" data-share="facebook"><span class="share-ico">📘</span><span>Facebook</span></button>
        <button class="share-opt" data-share="whatsapp"><span class="share-ico">💬</span><span>WhatsApp</span></button>
        <button class="share-opt" data-share="telegram"><span class="share-ico">✈️</span><span>Telegram</span></button>
        <button class="share-opt" data-share="copy"><span class="share-ico">📋</span><span>Copy Link</span></button>
        <button class="share-opt" data-share="download"><span class="share-ico">⬇</span><span>Download</span></button>
      </div>
      <div class="share-status" id="shareStatus" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const statusEl = overlay.querySelector('#shareStatus');
  const setStatus = (msg, kind = '') => {
    statusEl.textContent = msg || '';
    statusEl.className = `share-status${kind ? ' ' + kind : ''}`;
  };

  const close = () => {
    if (openSheet !== close) return;
    openSheet = null;
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = prevOverflow;
    overlay.remove();
  };
  openSheet = close;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const mediaHref = mediaUrl(isVideo ? moment.videoUrl : moment.url);
  // Extension derived from the actual stored media — a video may be .mp4 (new,
  // iOS-shareable) or .webm (older) — so the shared file carries the right name
  // and, below, the right MIME type for navigator.canShare to accept it.
  const mediaExt = isVideo
    ? (/\.mp4(?:$|\?)/i.test(moment.videoUrl || '') ? 'mp4' : 'webm')
    : 'jpg';
  const filename = `herae-moment-${moment.id}.${mediaExt}`;

  // The media as a File object — used both to hand off to another app via the
  // Web Share API and to download. Cached so a retry doesn't re-fetch. The type
  // comes from the fetched blob (the real content type) so iOS accepts an mp4.
  let cachedFile = null;
  async function getMediaFile() {
    if (cachedFile) return cachedFile;
    const resp = await fetch(mediaHref);
    if (!resp.ok) throw new Error('fetch failed');
    const blob = await resp.blob();
    const type = blob.type || (isVideo ? `video/${mediaExt}` : 'image/jpeg');
    cachedFile = new File([blob], filename, { type });
    return cachedFile;
  }

  // Pre-fetch the file the INSTANT the sheet opens, and DISABLE the platform
  // buttons until it's ready. navigator.share() requires a live user
  // activation and MUST be called with no async gap after the tap — even
  // awaiting an already-settled promise has been unreliable on some mobile
  // builds. So instead we make the file synchronously available (readyFile)
  // before the button can be tapped, and the click handler calls
  // navigator.share() directly. This is the fix for "share does nothing / just
  // downloads" on phones.
  let readyFile = null;
  const platformBtns = overlay.querySelectorAll(
    '.share-opt[data-share="instagram"],.share-opt[data-share="facebook"],.share-opt[data-share="whatsapp"],.share-opt[data-share="telegram"]'
  );
  platformBtns.forEach((b) => { b.disabled = true; });
  setStatus('Preparing your media…');
  const filePromise = getMediaFile().then((f) => (readyFile = f)).catch(() => null);
  filePromise.then(() => {
    platformBtns.forEach((b) => { b.disabled = false; });
    setStatus(readyFile ? '' : 'Could not load this moment’s media — try Download.', readyFile ? '' : 'bad');
  });

  // Why a platform can't use the native share sheet, in plain words — shown in
  // the fallback message so it's never a silent "it just downloaded".
  function shareUnavailableReason() {
    if (!window.isSecureContext) return 'sharing needs a secure https connection';
    if (!navigator.share || typeof navigator.canShare !== 'function') return "this browser can't share to apps";
    if (readyFile && !navigator.canShare({ files: [readyFile] })) {
      return isVideo ? "this browser can't share this video format" : "this browser can't share this file";
    }
    return null;
  }

  // A PNG blob ready to drop on the clipboard — the desktop path that actually
  // works: copy the image, the user pastes (Ctrl+V) it straight into a new
  // WhatsApp / Telegram / Facebook post or story draft. Images only (you can't
  // put a video on the clipboard); null for video or on any failure.
  const clipboardPromise = (async () => {
    try {
      const file = await filePromise;
      if (!file || file.type.indexOf('image/') !== 0) return null;
      if (!navigator.clipboard || !window.ClipboardItem) return null;
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      return await new Promise((res) => c.toBlob(res, 'image/png'));
    } catch (e) { return null; }
  })();

  async function copyImageToClipboard() {
    const png = await clipboardPromise;
    if (!png) return false;
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]);
      return true;
    } catch (e) { return false; }
  }

  // PRIMARY path — hand the actual media file to the OS/browser share sheet.
  // The user picks the destination app (Instagram, WhatsApp, Telegram, …),
  // which opens with the media loaded into a NEW post / story / message DRAFT
  // they can edit and publish — no manual download, no re-upload. This is the
  // only standards-based way a web page can push media into another app's
  // composer (social platforms don't allow direct programmatic posting without
  // their private APIs + OAuth). Requires a browser/OS that supports sharing
  // files (mobile, ChromeOS, Windows, recent Safari); returns 'unsupported'
  // where it doesn't so the caller can fall back.
  // Called synchronously from the tap: readyFile is already resolved (the
  // buttons are disabled until it is), so navigator.share() runs with the tap's
  // user activation fully intact — no await in between.
  function shareFileToApp(text) {
    const file = readyFile;
    if (!file || !navigator.share || typeof navigator.canShare !== 'function'
        || !navigator.canShare({ files: [file] })) {
      return Promise.resolve('unsupported');
    }
    return navigator.share({ files: [file], text, title: 'Herae' })
      .then(() => 'shared')
      .catch((e) => (e && e.name === 'AbortError') ? 'aborted' : 'unsupported');
  }

  function triggerDownload(href, name) {
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function downloadMedia() {
    setStatus('Preparing your media…');
    try {
      const file = await getMediaFile();
      const objUrl = URL.createObjectURL(file);
      triggerDownload(objUrl, filename);
      setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
      return true;
    } catch (e) {
      window.open(mediaHref, '_blank', 'noopener');
      return false;
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setStatus('Link copied to your clipboard ✓', 'ok');
    } catch (e) {
      window.prompt('Copy this link:', link);
    }
  }

  // One flow per platform button, tried in order of "closest to a real draft
  // with the media already in it":
  //   1. Native share sheet with the file (mobile / supported desktops) — the
  //      app opens with the media in a new post/story/message draft.
  //   2. Copy the image to the clipboard + open the web app — the user pastes
  //      (Ctrl+V) it into a new draft. Works on WhatsApp/Telegram/Facebook web.
  //   3. Public-link web composer (an editable draft seeded with the link).
  //   4. Download the media + open the app (manual attach — the only option
  //      Instagram leaves on desktop).
  // `pasteable` says whether that platform's web composer accepts a pasted
  // image (Instagram's does not).
  async function shareToPlatform(name, home, { linkComposer = null, pasteable = false } = {}) {
    setStatus('Opening your share options…');

    const r = await shareFileToApp(caption);
    if (r === 'shared') { setStatus(`Shared — open ${name}, then edit and post your draft ✓`, 'ok'); return; }
    if (r === 'aborted') { setStatus(''); return; }

    if (pasteable && !isVideo && await copyImageToClipboard()) {
      window.open(home, '_blank', 'noopener');
      setStatus(`Image copied ✓ — in the ${name} tab, start a new post and paste it with Ctrl/⌘+V, then post.`, 'ok');
      return;
    }

    if (isPublic && linkComposer) {
      linkComposer();
      setStatus(`Opening ${name} with a new post draft — edit it and post.`, 'ok');
      return;
    }

    const reason = shareUnavailableReason();
    await downloadMedia();
    window.open(home, '_blank', 'noopener');
    setStatus(
      `Saved your ${isVideo ? 'video' : 'photo'} ✓ — in the ${name} tab, start a new post/story and attach it.`
      + (reason ? ` (Direct sharing unavailable: ${reason}.)` : ''),
      'ok'
    );
  }

  overlay.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-share]');
    if (!btn) return;
    const action = btn.dataset.share;

    if (action === 'close') { close(); return; }
    if (action === 'copy') { copyLink(); return; }

    if (action === 'download') {
      const ok = await downloadMedia();
      setStatus(ok ? 'Saved to your downloads ✓' : 'Opened your moment in a new tab — right-click to save.', 'ok');
      return;
    }

    if (action === 'instagram') {
      // Instagram's web composer accepts neither a link nor a paste, so on
      // desktop it's download + manual upload; on mobile the share sheet (1)
      // handles it into a real draft.
      await shareToPlatform('Instagram', 'https://www.instagram.com/', { pasteable: false });
      return;
    }
    if (action === 'facebook') {
      await shareToPlatform('Facebook', 'https://www.facebook.com/', {
        pasteable: true,
        linkComposer: () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`, '_blank', 'noopener'),
      });
      return;
    }
    if (action === 'whatsapp') {
      await shareToPlatform('WhatsApp', 'https://web.whatsapp.com/', {
        pasteable: true,
        linkComposer: () => window.open(`https://wa.me/?text=${encodeURIComponent(`${caption} ${link}`)}`, '_blank', 'noopener'),
      });
      return;
    }
    if (action === 'telegram') {
      await shareToPlatform('Telegram', 'https://web.telegram.org/', {
        pasteable: true,
        linkComposer: () => window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(caption)}`, '_blank', 'noopener'),
      });
      return;
    }
  });
}
