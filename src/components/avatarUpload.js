// avatarUpload.js — the upload / replace / remove control that sits over
// your own avatar on your profile page. Mounted only when the profile being
// viewed is yours (see user.js).
//
// The picked file is downscaled to a 320px square JPEG in the browser
// BEFORE upload (see lib/imageResize.js) — that's what keeps a profile
// picture change a ~30KB request instead of a multi-megabyte one, and why
// the server needs no image processing of its own.
'use strict';

import { fileToAvatarDataUrl } from '../lib/imageResize.js';

const { uploadAvatar, removeAvatar } = window;

// `onChange(newAvatarUrl|null)` lets the page keep its own copy of the
// profile in step without a refetch.
export function mountAvatarControls(wrap, currentAvatarUrl, onChange = () => {}) {
  let hasAvatar = !!currentAvatarUrl;

  const ui = document.createElement('div');
  ui.className = 'avatar-controls';
  ui.innerHTML = `
    <input type="file" class="avatar-file-input" accept="image/*" hidden>
    <button class="avatar-edit-btn" type="button" aria-label="Change profile picture" title="Change profile picture">📷</button>
    <div class="avatar-menu" hidden>
      <button class="avatar-menu-item" data-action="pick" type="button">🖼️ ${hasAvatar ? 'Replace picture' : 'Upload picture'}</button>
      <button class="avatar-menu-item avatar-menu-item-danger" data-action="remove" type="button" ${hasAvatar ? '' : 'hidden'}>🗑️ Remove picture</button>
    </div>
    <div class="avatar-uploading" hidden><span class="avatar-spinner"></span></div>`;
  wrap.appendChild(ui);

  const fileInput = ui.querySelector('.avatar-file-input');
  const menu = ui.querySelector('.avatar-menu');
  const busy = ui.querySelector('.avatar-uploading');
  const pickItem = ui.querySelector('[data-action="pick"]');
  const removeItem = ui.querySelector('[data-action="remove"]');

  const setBusy = (on) => { busy.hidden = !on; ui.querySelector('.avatar-edit-btn').disabled = on; };
  const closeMenu = () => { menu.hidden = true; };

  // Swaps the picture in place rather than re-rendering the header, so the
  // control (and the menu state) survives the change.
  const paint = (url) => {
    hasAvatar = !!url;
    const avatar = wrap.querySelector('.avatar');
    let img = avatar.querySelector('.avatar-img');
    if (url) {
      if (!img) {
        img = document.createElement('img');
        img.className = 'avatar-img';
        img.alt = '';
        avatar.appendChild(img);
      }
      img.src = url;
    } else if (img) {
      img.remove();
    }
    pickItem.textContent = `🖼️ ${hasAvatar ? 'Replace picture' : 'Upload picture'}`;
    removeItem.hidden = !hasAvatar;
    onChange(url || null);
  };

  ui.querySelector('.avatar-edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => { if (!ui.contains(e.target)) closeMenu(); });

  pickItem.addEventListener('click', () => { closeMenu(); fileInput.click(); });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    // Cleared immediately so picking the SAME file again still fires a
    // change event (a re-crop after a failed upload, say).
    fileInput.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const { avatarUrl } = await uploadAvatar(dataUrl);
      paint(window.mediaUrl(avatarUrl));
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  });

  removeItem.addEventListener('click', async () => {
    closeMenu();
    if (!confirm('Remove your profile picture?')) return;
    setBusy(true);
    try {
      await removeAvatar();
      paint(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  });
}
