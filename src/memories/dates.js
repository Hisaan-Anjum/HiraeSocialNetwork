// dates.js — the "📅 Important Dates" manager: the shared relationship calendar
// either partner can edit. A clean list of saved events with a add/edit form
// (preset event types + fully custom, emoji, date, description, optional cover
// image). Saved dates flow straight into the timeline and become Story
// generators (see the server summary + engine). Covers are downscaled in the
// browser first, so uploads stay tiny.
'use strict';

import { escapeHtml, formatDate } from '../lib/util.js';

const { createImportantDate, updateImportantDate, deleteImportantDate } = window;

const PRESETS = [
  { emoji: '❤️', title: 'First Date' },
  { emoji: '💍', title: 'Engagement' },
  { emoji: '🎂', title: 'Birthday' },
  { emoji: '✈️', title: 'Trip' },
  { emoji: '🎉', title: 'Graduation' },
  { emoji: '🎁', title: 'Surprise' },
  { emoji: '🍿', title: 'Movie Marathon' },
  { emoji: '❤️', title: 'First “I Love You”' },
  { emoji: '⭐', title: 'Custom' },
];

// A cover is shown at banner size, not thumbnail — downscale to ~1000px wide,
// 16:10, center-cropped, JPEG. Keeps the upload to tens of KB.
function fileToCoverDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose an image file.'));
    if (file.size > 12 * 1024 * 1024) return reject(new Error('That image is too large (max 12MB).'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const W = 1000, H = 625;
      const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file doesn't look like an image.")); };
    img.src = url;
  });
}

export function openImportantDates({ username, dates = [], onChange }) {
  let list = dates.slice();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay ms-dates-overlay';
  overlay.innerHTML = `
    <div class="modal-card ms-dates" role="dialog" aria-modal="true" aria-label="Important dates">
      <div class="ms-sel-head">
        <h2>📅 Important Dates</h2>
        <button class="share-close" data-dt="close" aria-label="Close">✕</button>
      </div>
      <div class="ms-dates-body" id="msDatesBody"></div>
      <div class="ms-dates-foot">
        <button class="btn btn-primary" data-dt="add">＋ Add a date</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const body = overlay.querySelector('#msDatesBody');

  function close() { document.body.style.overflow = prevOverflow; overlay.remove(); }

  function renderList() {
    if (!list.length) {
      body.innerHTML = `<div class="ms-dates-empty">No dates yet. Add the moments that matter — your first date, a trip, a birthday — and they'll live in your timeline forever. 💜</div>`;
      return;
    }
    body.innerHTML = `<div class="ms-dates-list">${list
      .slice().sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((d) => `
        <div class="ms-date-row" data-id="${d.id}">
          ${d.coverUrl ? `<div class="ms-date-cover" style="background-image:url('${escapeHtml(d.coverUrl)}')"></div>` : `<div class="ms-date-emoji">${escapeHtml(d.emoji || '📅')}</div>`}
          <div class="ms-date-main">
            <div class="ms-date-title">${escapeHtml(d.emoji || '')} ${escapeHtml(d.title)}</div>
            <div class="ms-date-sub">${escapeHtml(formatDate(d.date))}${d.description ? ` · ${escapeHtml(d.description)}` : ''}</div>
          </div>
          <div class="ms-date-actions">
            <button class="ms-icon-btn" data-dt="edit" data-id="${d.id}" aria-label="Edit">✎</button>
            <button class="ms-icon-btn" data-dt="del" data-id="${d.id}" aria-label="Delete">🗑</button>
          </div>
        </div>`).join('')}</div>`;
  }

  function renderForm(existing) {
    const e = existing || { emoji: '❤️', title: '', date: new Date().toISOString().slice(0, 10), description: '', coverUrl: null };
    let coverDataUrl = null; // set when a new cover is picked
    body.innerHTML = `
      <form class="ms-date-form" id="msDateForm">
        <div class="ms-preset-row">
          ${PRESETS.map((p) => `<button type="button" class="ms-preset" data-emoji="${escapeHtml(p.emoji)}" data-title="${escapeHtml(p.title)}">${escapeHtml(p.emoji)} ${escapeHtml(p.title)}</button>`).join('')}
        </div>
        <div class="ms-form-grid">
          <label class="ms-field ms-field-emoji">
            <span>Emoji</span>
            <input type="text" id="dfEmoji" maxlength="8" value="${escapeHtml(e.emoji || '')}">
          </label>
          <label class="ms-field ms-field-title">
            <span>Title</span>
            <input type="text" id="dfTitle" maxlength="80" placeholder="First Date" value="${escapeHtml(e.title || '')}">
          </label>
          <label class="ms-field">
            <span>Date</span>
            <input type="date" id="dfDate" value="${escapeHtml(e.date || '')}">
          </label>
        </div>
        <label class="ms-field">
          <span>Description <em>(optional)</em></span>
          <textarea id="dfDesc" maxlength="500" rows="2" placeholder="The night everything began…">${escapeHtml(e.description || '')}</textarea>
        </label>
        <label class="ms-field">
          <span>Cover image <em>(optional)</em></span>
          <input type="file" id="dfCover" accept="image/*">
        </label>
        ${e.coverUrl ? `<div class="ms-form-cover" style="background-image:url('${escapeHtml(e.coverUrl)}')"></div>` : ''}
        <div class="ms-form-err" id="dfErr"></div>
        <div class="ms-form-actions">
          <button type="button" class="btn btn-ghost" data-dt="cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="dfSave">${existing ? 'Save changes' : 'Add date'}</button>
        </div>
      </form>`;

    const form = body.querySelector('#msDateForm');
    const errEl = body.querySelector('#dfErr');
    body.querySelectorAll('.ms-preset').forEach((btn) => btn.addEventListener('click', () => {
      body.querySelector('#dfEmoji').value = btn.dataset.emoji;
      const titleInput = body.querySelector('#dfTitle');
      if (!titleInput.value || btn.dataset.title !== 'Custom') titleInput.value = btn.dataset.title === 'Custom' ? '' : btn.dataset.title;
    }));
    body.querySelector('#dfCover').addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try { coverDataUrl = await fileToCoverDataUrl(file); errEl.textContent = ''; }
      catch (err) { errEl.textContent = err.message; }
    });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errEl.textContent = '';
      const payload = {
        emoji: body.querySelector('#dfEmoji').value.trim() || '📅',
        title: body.querySelector('#dfTitle').value.trim(),
        date: body.querySelector('#dfDate').value,
        description: body.querySelector('#dfDesc').value.trim() || undefined,
      };
      if (!payload.title) { errEl.textContent = 'Give it a title.'; return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) { errEl.textContent = 'Pick a date.'; return; }
      if (coverDataUrl) payload.cover = coverDataUrl;
      const saveBtn = body.querySelector('#dfSave');
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try {
        const saved = existing
          ? await updateImportantDate(username, existing.id, payload)
          : await createImportantDate(username, payload);
        list = existing ? list.map((d) => (d.id === existing.id ? saved : d)) : [...list, saved];
        onChange?.(list);
        renderList();
      } catch (err) {
        errEl.textContent = err.message || 'Could not save that.';
        saveBtn.disabled = false; saveBtn.textContent = existing ? 'Save changes' : 'Add date';
      }
    });
  }

  body.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-dt]');
    if (!t) return;
    const act = t.dataset.dt;
    if (act === 'cancel') return renderList();
    if (act === 'edit') return renderForm(list.find((d) => String(d.id) === t.dataset.id));
    if (act === 'del') {
      const d = list.find((x) => String(x.id) === t.dataset.id);
      if (!d || !confirm(`Remove "${d.title}"?`)) return;
      try { await deleteImportantDate(username, d.id); list = list.filter((x) => x.id !== d.id); onChange?.(list); renderList(); }
      catch (err) { alert(err.message || 'Could not delete that.'); }
    }
  });

  overlay.addEventListener('click', (e) => {
    const t = e.target.closest('[data-dt]');
    if (t?.dataset.dt === 'close') return close();
    if (t?.dataset.dt === 'add') return renderForm(null);
    if (e.target === overlay) close();
  });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  renderList();
  return { close };
}
