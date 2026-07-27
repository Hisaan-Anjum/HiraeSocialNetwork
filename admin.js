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

// Server-side list state. The catalogue import made this table far too big to
// hold in the page, so search/sort/paging all round-trip rather than filtering
// an in-memory array.
const PAGE_SIZE = 50;
let query = '';
let sortKey = 'manual';
let offset = 0;
let total = 0;
// Guards against a slow response for an old query landing after a newer one and
// repainting the table with stale rows.
let listSeq = 0;

const gateEl = document.getElementById('gate');
const appEl = document.getElementById('adminApp');
const tableWrap = document.getElementById('tableWrap');
const searchEl = document.getElementById('adminSearch');
const sortEl = document.getElementById('adminSort');
const countEl = document.getElementById('adminCount');
const pagerEl = document.getElementById('adminPager');
const pageInfoEl = document.getElementById('pageInfo');
const subEl = document.getElementById('adminSub');

if (auth) {
  document.getElementById('whoAmI').textContent = `logged in as ${auth.username}`;
  document.getElementById('logoutBtn').addEventListener('click', logout);
  init();
}

async function init() {
  try {
    await loadPage({ keepOffset: true });
    gateEl.classList.add('hidden');
    appEl.classList.remove('hidden');
    wireListControls();
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

// ── Search / sort / paging ────────────────────────────────────────────
async function loadPage({ keepOffset = false } = {}) {
  if (!keepOffset) offset = 0;
  const seq = ++listSeq;
  const res = await getAdminRecommendations({ q: query, sort: sortKey, cursor: offset, limit: PAGE_SIZE });
  if (seq !== listSeq) return;   // a newer request already won
  recommendations = res.recommendations;
  total = res.total ?? recommendations.length;
  offset = res.offset ?? 0;
  renderTable();
  renderPager();
}

// Reloading must not lose the admin's place: after an edit or a delete the row
// count can shrink past the current offset, which would otherwise show an empty
// page with no obvious way back.
async function reload() {
  if (offset > 0 && offset >= total - 1) offset = Math.max(0, offset - PAGE_SIZE);
  try {
    await loadPage({ keepOffset: true });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderPager() {
  const showing = recommendations.length;
  countEl.textContent = total
    ? `${total.toLocaleString()} title${total === 1 ? '' : 's'}${query ? ' matching' : ''}`
    : '';

  if (total <= showing && offset === 0) {
    pagerEl.classList.add('hidden');
  } else {
    pagerEl.classList.remove('hidden');
    const from = total ? offset + 1 : 0;
    const to = offset + showing;
    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    pageInfoEl.textContent = `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}  ·  page ${page} of ${pages}`;
    document.getElementById('pagePrev').disabled = offset === 0;
    document.getElementById('pageNext').disabled = to >= total;
  }

  // Dragging writes sort_order, which only means anything while the table is
  // actually showing that order. Under any other sort the row positions the
  // admin sees aren't sort_order, so a drag would save an order they never
  // arranged — so it's turned off and the hint says why.
  const manual = sortKey === 'manual' && !query;
  subEl.textContent = manual
    ? 'Drag rows to reorder how they appear in the app. Changes save immediately.'
    : 'Reordering is only available under “Manual order” with no search — switch back to drag rows.';
}

function wireListControls() {
  let t;
  searchEl.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      query = searchEl.value.trim();
      try { await loadPage(); } catch (err) { showToast(err.message, 'error'); }
    }, 250);
  });

  sortEl.addEventListener('change', async () => {
    sortKey = sortEl.value;
    try { await loadPage(); } catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('pagePrev').addEventListener('click', async () => {
    offset = Math.max(0, offset - PAGE_SIZE);
    try { await loadPage({ keepOffset: true }); window.scrollTo({ top: 0 }); }
    catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('pageNext').addEventListener('click', async () => {
    if (offset + PAGE_SIZE >= total) return;
    offset += PAGE_SIZE;
    try { await loadPage({ keepOffset: true }); window.scrollTo({ top: 0 }); }
    catch (err) { showToast(err.message, 'error'); }
  });
}

// ── Table rendering + drag-to-reorder ─────────────────────────────────
function canReorder() {
  return sortKey === 'manual' && !query;
}

function renderTable() {
  if (!recommendations.length) {
    tableWrap.innerHTML = query
      ? `<div class="empty-state"><div class="icon">🔍</div><div class="msg">Nothing matches “${escapeHtml(query)}”.<br>Try a different title.</div></div>`
      : `<div class="empty-state"><div class="icon">🎬</div><div class="msg">No recommendations yet.<br>Click "+ New recommendation" to add the first one.</div></div>`;
    return;
  }
  const drag = canReorder();
  tableWrap.innerHTML = `
    <table class="rec-table">
      <thead class="rec-table-head">
        <tr>${drag ? '<th></th>' : ''}<th></th><th>Title</th><th>Year</th><th>Runtime</th><th>Rating</th><th>Added</th><th>Featured</th><th></th></tr>
      </thead>
      <tbody id="recTbody">
        ${recommendations.map(rowHtml).join('')}
      </tbody>
    </table>`;
  attachRowHandlers();
}

// Short, unambiguous, and locale-aware — the admin only needs to tell recent
// from old at a glance, so the year is dropped for this year's rows.
function addedLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = d.getFullYear() === new Date().getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

function rowHtml(rec) {
  const genres = (rec.genres || []).join(', ');
  const drag = canReorder();
  return `
    <tr class="rec-row" ${drag ? 'draggable="true"' : ''} data-id="${rec.id}">
      ${drag ? '<td><span class="drag-handle" title="Drag to reorder">⠿</span></td>' : ''}
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
      <td class="rec-meta">${addedLabel(rec.createdAt)}</td>
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

  if (!canReorder()) return;

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
    // `offset` matters: these are only the rows on this page, so the server has
    // to number them from where the page starts, not from zero.
    await reorderRecommendations(ids, offset);
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
    const wasEdit = idx >= 0;
    if (wasEdit) {
      // An edit stays on the row the admin is looking at — patching it in place
      // keeps their scroll position and avoids a round trip.
      recommendations[idx] = rec;
      renderTable();
    }
    closeForm();
    showToast(editingId ? 'Recommendation updated.' : 'Recommendation created.');
    // A new row belongs wherever the current sort puts it, which only the server
    // knows — so refetch rather than appending it to the end of this page.
    if (!wasEdit) await reload();
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
    closeDeleteConfirm();
    showToast('Recommendation deleted.');
    // Refetch so the freed slot pulls the next row up from the following page,
    // rather than leaving this page one short until a manual reload.
    total = Math.max(0, total - 1);
    await reload();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Delete permanently';
  }
});
