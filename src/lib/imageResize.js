// imageResize.js — turns a picked <input type="file"> image into a small
// square JPEG data URL before it ever leaves the browser.
//
// This is the whole "optimize uploads" story for profile pictures: a phone
// photo is 3-8MB and 4000px wide, but an avatar is never rendered above
// ~160px. Downscaling client-side means the request is tens of KB instead of
// megabytes, the server does no image processing at all (no native image
// library to install or keep patched), and /media/avatars stays tiny.
//
// admin.js has its own resizeImageFile for recommendation artwork — that one
// is deliberately left alone: it preserves aspect ratio for posters/backdrops
// at much larger dimensions, which is the opposite of what a square,
// center-cropped avatar wants.
'use strict';

const AVATAR_SIZE = 320; // 2x the largest rendered size (160px profile header)
const JPEG_QUALITY = 0.85;

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // guard before decoding

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file doesn't look like an image.")); };
    img.src = url;
  });
}

// Center-crops to a square, then scales to AVATAR_SIZE — so a portrait or
// landscape photo fills the circle instead of being squashed into it.
export async function fileToAvatarDataUrl(file) {
  if (!file) throw new Error('No file selected.');
  if (!/^image\//.test(file.type)) throw new Error('Please choose an image file.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is too large (max 12MB).');

  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  // JPEG, not PNG: a photo as PNG is several times larger for no visible
  // gain at this size, and the server accepts jpeg/png/webp either way.
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}
