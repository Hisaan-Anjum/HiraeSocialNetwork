// confirmDialog.js — the site's own confirmation, used wherever a decision is
// big enough that window.confirm() would be doing it a disservice.
//
// The specific thing confirm() cannot do, and the reason this exists: SHOW the
// person what they are about to lose. "Are you sure?" and "this will
// permanently delete 14 moments from 6 nights, for both of you" are not the
// same question, and only one of them can be answered honestly.
//
// The safe option holds focus, so somebody pressing Enter to dismiss a dialog
// they did not expect ends up having done nothing.
'use strict';

export function confirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'cd-backdrop';
    backdrop.innerHTML = `
      <div class="cd-card" role="alertdialog" aria-modal="true" aria-labelledby="cdTitle" aria-describedby="cdBody">
        <div class="cd-title" id="cdTitle"></div>
        <div class="cd-body" id="cdBody"></div>
        <div class="cd-actions">
          <button type="button" class="btn btn-ghost cd-no"></button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-gold'} cd-yes"></button>
        </div>
      </div>`;

    // textContent throughout — a username reaches these strings, and a
    // confirmation dialog is the last place to start trusting one.
    backdrop.querySelector('.cd-title').textContent = title || '';
    backdrop.querySelector('.cd-body').textContent = body || '';
    const noBtn = backdrop.querySelector('.cd-no');
    const yesBtn = backdrop.querySelector('.cd-yes');
    noBtn.textContent = cancelLabel;
    yesBtn.textContent = confirmLabel;

    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      document.body.classList.remove('cd-open');
      try { previouslyFocused?.focus?.(); } catch (e) { /* it went away */ }
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      // A modal that lets focus wander behind it is a modal in name only.
      if (e.key !== 'Tab') return;
      const focusables = [noBtn, yesBtn];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    noBtn.addEventListener('click', () => close(false));
    yesBtn.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(backdrop);
    document.body.classList.add('cd-open');
    noBtn.focus();
  });
}

// "a, b and c" — a list a person would read out loud, rather than one a
// developer would log.
export function listPhrase(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list[0] || 'nothing';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
