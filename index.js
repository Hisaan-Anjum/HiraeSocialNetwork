// index.js — index.html (the landing page) only. If you're already logged
// in (including via the extension's auto-login, which runs before this),
// skip the marketing pitch and go straight to the feed.
'use strict';

if (getAuth()) {
  window.location.href = 'memories.html';
}

// Tasteful on-scroll reveal for the .reveal-marked sections below the
// hero (steps, the "built for the distance" copy, the memories features).
// Elements are visible-by-default in CSS if JS never runs (e.g. blocked),
// so this only ever adds a fade/slide-in, never hides content outright.
if ('IntersectionObserver' in window) {
  document.body.classList.add('reveal-ready');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
}
// No IntersectionObserver support: .reveal stays at its default (fully
// visible, see landing.css) since body never gets 'reveal-ready'.

// ── The sentence somebody has to send their partner ───────────────────
// Every two-sided product carries a cost the founder never feels: the user
// has to advocate on your behalf, to somebody whose enthusiasm they cannot
// control. They are not deciding whether to try Herae — they are deciding
// whether to spend social capital asking someone else to install something.
//
// Writing that sentence for them, in the register they would actually use,
// is the cheapest conversion work on the page. Falls back to selecting the
// text when the clipboard is unavailable (insecure origin, denied
// permission), because a button that silently does nothing is worse than no
// button at all.
document.querySelectorAll('[data-copy]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const src = document.querySelector(btn.dataset.copy);
    if (!src) return;
    const text = src.textContent.trim();
    const said = (msg) => {
      const before = btn.textContent;
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = before; }, 2200);
    };
    try {
      await navigator.clipboard.writeText(text);
      said('Copied — go on then');
    } catch (e) {
      const range = document.createRange();
      range.selectNodeContents(src);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      said('Selected — press Ctrl+C');
    }
  });
});
