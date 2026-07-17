// admin.js — admin.html only. Recommendations management: table with
// drag-to-reorder, a create/edit modal (with client-side image resize
// before upload), and delete-with-confirmation. Every mutation hits
// server/src/recommendations.js's adminRouter, which independently
// re-checks is_admin on every request — nothing here is the real gate,
// it's just what decides whether to show the UI at all.
'use strict';

const auth = requireAuth();

const MAX_ARTWORK_DIMENSION = 1600;
const ARTWORK_QUALITY = 0.85;
const MAX_GALLERY_IMAGES = 8;

let recommendations = [];
let editingId = null;
// Staged as base64 data URLs, only sent to the server on Save — { poster,
// backdrop, gallery: [...] }. Any key left unset here means "don't touch
// that artwork slot" (see the artwork PATCH route's "any subset" shape).
let pendingArtwork = {};

const gateEl = document.getElementById('gate');
const appEl = document.getElementById('adminApp');
const tableWrap = document.getElementById('tableWrap');

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  init();
}

async function init() {
  try {
    const { recommendations: rows } = await getAdminRecommendations();
    recommendations = rows;
    gateEl.classList.add('hidden');
    appEl.classList.remove('hidden');
    renderTable();
  } catch (err) {
    if (err.message === 'Admin access required.') {
      gateEl.innerHTML = `
        <div class="empty-state">
          <div class="icon">🔒</div>
          <div class="msg">
            You're logged in as <strong>${escapeHtml(auth.username)}</strong>, but that account
            doesn't have admin access.<br>
            <a href="index.html">← Back to the site</a>
          </div>
        </div>`;
    } else {
      gateEl.innerHTML = `<div class="empty-state"><div class="icon">😕</div><div class="msg">${escapeHtml(err.message)}</div></div>`;
    }
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showToast(message, kind) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = 'toast toast-show' + (kind === 'error' ? ' toast-error' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = 'toast'; }, 2600);
}

// ── Table rendering + drag-to-reorder ─────────────────────────────────
function renderTable() {
  if (!recommendations.length) {
    tableWrap.innerHTML = `<div class="empty-state"><div class="icon">🎬</div><div class="msg">No recommendations yet.<br>Click "+ New recommendation" to add the first one.</div></div>`;
    return;
  }
  tableWrap.innerHTML = `
    <table class="rec-table">
      <thead class="rec-table-head">
        <tr><th></th><th></th><th>Title</th><th>Year</th><th>Runtime</th><th>Rating</th><th>Featured</th><th></th></tr>
      </thead>
      <tbody id="recTbody">
        ${recommendations.map(rowHtml).join('')}
      </tbody>
    </table>`;
  attachRowHandlers();
}

function rowHtml(rec) {
  const genres = (rec.genres || []).join(', ');
  return `
    <tr class="rec-row" draggable="true" data-id="${rec.id}">
      <td><span class="drag-handle" title="Drag to reorder">⠿</span></td>
      <td>${rec.posterUrl
        ? `<img class="rec-thumb" src="${momentImageUrl(rec.posterUrl)}" alt="">`
        : `<div class="rec-thumb-empty">🎬</div>`}</td>
      <td class="rec-title-cell">
        <div class="rec-title">${escapeHtml(rec.title)}</div>
        ${genres ? `<div class="rec-genres">${escapeHtml(genres)}</div>` : ''}
      </td>
      <td class="rec-meta">${rec.releaseYear ?? '—'}</td>
      <td class="rec-meta">${rec.runtimeMinutes ? `${rec.runtimeMinutes}m` : '—'}</td>
      <td class="rec-rating">${rec.rating != null ? `★ ${rec.rating}` : '—'}</td>
      <td>${rec.featured ? '<span class="featured-pill">Featured</span>' : ''}</td>
      <td>
        <div class="rec-actions">
          <button class="icon-btn" data-action="edit" data-id="${rec.id}" title="Edit">✏️</button>
          <button class="icon-btn icon-btn-danger" data-action="delete" data-id="${rec.id}" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>`;
}

function attachRowHandlers() {
  const tbody = document.getElementById('recTbody');
  tbody.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => openForm(Number(btn.dataset.id)));
  });
  tbody.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => openDeleteConfirm(Number(btn.dataset.id)));
  });

  let dragSrc = null;
  tbody.querySelectorAll('.rec-row').forEach((row) => {
    row.addEventListener('dragstart', () => {
      dragSrc = row;
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      tbody.querySelectorAll('.rec-row').forEach((r) => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (row !== dragSrc) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (!dragSrc || row === dragSrc) return;
      const rows = Array.from(tbody.querySelectorAll('.rec-row'));
      const srcIndex = rows.indexOf(dragSrc);
      const destIndex = rows.indexOf(row);
      if (srcIndex < destIndex) row.after(dragSrc);
      else row.before(dragSrc);
      persistOrder();
    });
  });
}

async function persistOrder() {
  const ids = Array.from(document.querySelectorAll('#recTbody .rec-row')).map((r) => Number(r.dataset.id));
  try {
    await reorderRecommendations(ids);
    recommendations = ids.map((id) => recommendations.find((r) => r.id === id));
    showToast('Order saved.');
  } catch (err) {
    showToast(err.message, 'error');
    renderTable(); // snap back to last known-good order
  }
}

// ── Create / edit form ────────────────────────────────────────────────
const formModalBackdrop = document.getElementById('formModalBackdrop');
const recForm = document.getElementById('recForm');
const formError = document.getElementById('formError');
const formSubmit = document.getElementById('formSubmit');

document.getElementById('btnNew').addEventListener('click', () => openForm(null));
document.getElementById('formCancel').addEventListener('click', closeForm);
document.getElementById('formModalClose').addEventListener('click', closeForm);
formModalBackdrop.addEventListener('click', (e) => { if (e.target === formModalBackdrop) closeForm(); });

function openForm(id) {
  editingId = id;
  pendingArtwork = {};
  formError.textContent = '';
  recForm.reset();
  document.getElementById('previewPoster').innerHTML = '<span class="artwork-placeholder">No poster</span>';
  document.getElementById('previewBackdrop').innerHTML = '<span class="artwork-placeholder">No backdrop</span>';
  document.getElementById('previewGallery').innerHTML = '';
  document.getElementById('artworkHint').textContent = '';

  const rec = id ? recommendations.find((r) => r.id === id) : null;
  document.getElementById('formModalTitle').textContent = rec ? `Edit "${rec.title}"` : 'New recommendation';
  if (rec) {
    document.getElementById('fTitle').value = rec.title || '';
    document.getElementById('fDescription').value = rec.description || '';
    document.getElementById('fGenres').value = (rec.genres || []).join(', ');
    document.getElementById('fYear').value = rec.releaseYear ?? '';
    document.getElementById('fRuntime').value = rec.runtimeMinutes ?? '';
    document.getElementById('fRating').value = rec.rating ?? '';
    document.getElementById('fFeatured').checked = !!rec.featured;
    if (rec.posterUrl) document.getElementById('previewPoster').innerHTML = `<img src="${momentImageUrl(rec.posterUrl)}" alt="">`;
    if (rec.backdropUrl) document.getElementById('previewBackdrop').innerHTML = `<img src="${momentImageUrl(rec.backdropUrl)}" alt="">`;
    if (rec.gallery && rec.gallery.length) {
      document.getElementById('previewGallery').innerHTML = rec.gallery.map((u) => `<img src="${momentImageUrl(u)}" alt="">`).join('');
    }
  }
  formModalBackdrop.classList.remove('hidden');
  document.getElementById('fTitle').focus();
}

function closeForm() {
  formModalBackdrop.classList.add('hidden');
  editingId = null;
  pendingArtwork = {};
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

// Resizes to at most MAX_ARTWORK_DIMENSION on the long edge and re-encodes
// as JPEG — keeps admin uploads from shipping multi-megabyte data URLs to
// the (20mb-capped, but still) artwork endpoint.
async function resizeImageFile(file, maxSize = MAX_ARTWORK_DIMENSION, quality = ARTWORK_QUALITY) {
  const img = await loadImageFromFile(file);
  let { width, height } = img;
  if (width > maxSize || height > maxSize) {
    if (width >= height) { height = Math.round((height * maxSize) / width); width = maxSize; }
    else { width = Math.round((width * maxSize) / height); height = maxSize; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

document.getElementById('filePoster').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImageFile(file);
    pendingArtwork.poster = dataUrl;
    document.getElementById('previewPoster').innerHTML = `<img src="${dataUrl}" alt="">`;
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('fileBackdrop').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImageFile(file);
    pendingArtwork.backdrop = dataUrl;
    document.getElementById('previewBackdrop').innerHTML = `<img src="${dataUrl}" alt="">`;
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('fileGallery').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []).slice(0, MAX_GALLERY_IMAGES);
  if (!files.length) return;
  document.getElementById('artworkHint').textContent = 'Selecting gallery images replaces the whole gallery on save.';
  try {
    const dataUrls = await Promise.all(files.map((f) => resizeImageFile(f)));
    pendingArtwork.gallery = dataUrls;
    document.getElementById('previewGallery').innerHTML = dataUrls.map((u) => `<img src="${u}" alt="">`).join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

recForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.textContent = '';

  const title = document.getElementById('fTitle').value.trim();
  if (!title) { formError.textContent = 'Title is required.'; return; }

  const payload = {
    title,
    description: document.getElementById('fDescription').value.trim(),
    genres: document.getElementById('fGenres').value.split(',').map((g) => g.trim()).filter(Boolean),
    releaseYear: document.getElementById('fYear').value ? Number(document.getElementById('fYear').value) : null,
    runtimeMinutes: document.getElementById('fRuntime').value ? Number(document.getElementById('fRuntime').value) : null,
    rating: document.getElementById('fRating').value ? Number(document.getElementById('fRating').value) : null,
    featured: document.getElementById('fFeatured').checked,
  };

  formSubmit.disabled = true;
  formSubmit.textContent = 'Saving…';
  try {
    let rec;
    if (editingId) {
      ({ recommendation: rec } = await updateRecommendation(editingId, payload));
    } else {
      ({ recommendation: rec } = await createRecommendation(payload));
    }
    if (Object.keys(pendingArtwork).length) {
      ({ recommendation: rec } = await uploadRecommendationArtwork(rec.id, pendingArtwork));
    }
    const idx = recommendations.findIndex((r) => r.id === rec.id);
    if (idx >= 0) recommendations[idx] = rec; else recommendations.push(rec);
    closeForm();
    renderTable();
    showToast(editingId ? 'Recommendation updated.' : 'Recommendation created.');
  } catch (err) {
    formError.textContent = err.message;
  } finally {
    formSubmit.disabled = false;
    formSubmit.textContent = 'Save recommendation';
  }
});

// ── Delete confirmation ────────────────────────────────────────────────
const deleteModalBackdrop = document.getElementById('deleteModalBackdrop');
let pendingDeleteId = null;

function openDeleteConfirm(id) {
  pendingDeleteId = id;
  const rec = recommendations.find((r) => r.id === id);
  document.getElementById('deleteTitle').textContent = rec ? rec.title : 'this recommendation';
  deleteModalBackdrop.classList.remove('hidden');
}
function closeDeleteConfirm() {
  deleteModalBackdrop.classList.add('hidden');
  pendingDeleteId = null;
}
document.getElementById('deleteCancel').addEventListener('click', closeDeleteConfirm);
document.getElementById('deleteModalClose').addEventListener('click', closeDeleteConfirm);
deleteModalBackdrop.addEventListener('click', (e) => { if (e.target === deleteModalBackdrop) closeDeleteConfirm(); });

document.getElementById('deleteConfirm').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const btn = document.getElementById('deleteConfirm');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    await deleteRecommendation(pendingDeleteId);
    recommendations = recommendations.filter((r) => r.id !== pendingDeleteId);
    closeDeleteConfirm();
    renderTable();
    showToast('Recommendation deleted.');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete permanently';
  }
});
