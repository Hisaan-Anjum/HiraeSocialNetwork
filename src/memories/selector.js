// selector.js — the "browse your stories" overlay. Two familiar interactions in
// one sheet: (1) big buttons at the top for every story type the engine says is
// available right now (July Together, Anniversary, 100 Movies, Christmas, an
// Important Date, Our Story…), and (2) a Google-Photos-style year selector with
// month circles below — only months that actually have enough content appear.
// Picking anything calls onPick(descriptor) and closes; the caller then
// generates + plays that story.
'use strict';

import { escapeHtml } from '../lib/util.js';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function openStorySelector({ summary, onPick }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay ms-selector-overlay';

  const months = summary.months || [];
  const years = [...new Set(months.map((m) => m.year))].sort((a, b) => b - a);
  let activeYear = years[0];

  overlay.innerHTML = `
    <div class="modal-card ms-selector" role="dialog" aria-modal="true" aria-label="Browse your Memory Stories">
      <div class="ms-sel-head">
        <h2>❤️ Memory Stories</h2>
        <button class="share-close" data-sel="close" aria-label="Close">✕</button>
      </div>

      ${(summary.storyTypes || []).length ? `
        <div class="ms-sel-types">
          ${summary.storyTypes.map((t) => `
            <button class="ms-type-btn" data-sel="type" data-type="${escapeHtml(t.type)}" data-key="${escapeHtml(t.key)}" data-title="${escapeHtml(t.title)}" data-emoji="${escapeHtml(t.emoji)}">
              <span class="ms-type-emoji">${escapeHtml(t.emoji)}</span>
              <span class="ms-type-title">${escapeHtml(t.title)}</span>
            </button>`).join('')}
        </div>` : ''}

      ${years.length ? `
        <div class="ms-sel-monthly">
          <div class="ms-sel-yearbar">
            <button class="ms-year-nav" data-sel="year-prev" aria-label="Previous year">←</button>
            <span class="ms-year-label" id="msYearLabel">${activeYear}</span>
            <button class="ms-year-nav" data-sel="year-next" aria-label="Next year">→</button>
          </div>
          <div class="ms-month-grid" id="msMonthGrid"></div>
          <div class="ms-sel-hint">Only months you filled with memories appear here.</div>
        </div>` : `
        <div class="ms-sel-empty">Monthly stories will appear here once you've shared a few movie nights in the same month. 💜</div>`}
    </div>`;

  document.body.appendChild(overlay);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const grid = overlay.querySelector('#msMonthGrid');
  const yearLabel = overlay.querySelector('#msYearLabel');

  function renderMonths() {
    if (!grid) return;
    if (yearLabel) yearLabel.textContent = activeYear;
    grid.innerHTML = MONTHS_LONG.map((name, i) => {
      const m = months.find((x) => x.year === activeYear && x.month === i + 1);
      if (!m) return `<div class="ms-month-circle is-empty" aria-disabled="true"><span>${MONTHS_SHORT[i]}</span></div>`;
      return `
        <button class="ms-month-circle" data-sel="month" data-key="${escapeHtml(m.key)}" data-title="${escapeHtml(MONTHS_LONG[i])} Together" title="${m.movieNights} movie nights">
          <span class="ms-month-abbr">${MONTHS_SHORT[i]}</span>
          <span class="ms-month-count">${m.count}</span>
        </button>`;
    }).join('');
  }
  renderMonths();

  const close = () => { document.body.style.overflow = prevOverflow; overlay.remove(); };

  overlay.addEventListener('click', (e) => {
    const t = e.target.closest('[data-sel]');
    if (!t && e.target === overlay) return close();
    if (!t) return;
    const act = t.dataset.sel;
    if (act === 'close') return close();
    if (act === 'year-prev') { const i = years.indexOf(activeYear); if (i < years.length - 1) { activeYear = years[i + 1]; renderMonths(); } return; }
    if (act === 'year-next') { const i = years.indexOf(activeYear); if (i > 0) { activeYear = years[i - 1]; renderMonths(); } return; }
    if (act === 'month') { close(); onPick({ type: 'monthly', key: t.dataset.key, title: t.dataset.title, emoji: '❤️' }); return; }
    if (act === 'type') { close(); onPick({ type: t.dataset.type, key: t.dataset.key, title: t.dataset.title, emoji: t.dataset.emoji }); return; }
  });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  return { close };
}
