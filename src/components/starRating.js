// starRating.js — a small 1-5 star display (read-only) and an interactive
// picker (review.html's "rate this session" control).
'use strict';

export function renderStars(rating, { size = 'md' } = {}) {
  if (!rating) return '';
  const full = Math.round(rating);
  const stars = Array.from({ length: 5 }, (_, i) => (i < full ? '★' : '☆')).join('');
  // data-rating carries the value in machine-readable form so the inline
  // review editor (see postActions.js) can seed its star picker from what's
  // already rendered instead of re-fetching the review just to learn it.
  return `<span class="star-rating star-rating-${size}" data-rating="${rating}" title="${rating}/5">${stars}</span>`;
}

// Interactive picker — renders 5 clickable stars into `container`, calling
// onChange(value) whenever the selection changes. `initial` is 0-5 (0 =
// none picked yet).
export function renderStarPicker(container, initial, onChange) {
  let value = initial || 0;
  container.innerHTML = `
    <div class="star-picker" role="radiogroup" aria-label="Rating">
      ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-picker-btn" data-value="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}
    </div>
  `;
  const buttons = [...container.querySelectorAll('.star-picker-btn')];

  function paint(v) {
    buttons.forEach((btn) => btn.classList.toggle('star-picker-btn-active', Number(btn.dataset.value) <= v));
  }
  paint(value);

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.value);
      value = value === n ? 0 : n; // clicking the same star again clears it
      paint(value);
      onChange(value);
    });
    btn.addEventListener('mouseenter', () => paint(Number(btn.dataset.value)));
    btn.addEventListener('mouseleave', () => paint(value));
  });

  return { getValue: () => value };
}
