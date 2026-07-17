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
