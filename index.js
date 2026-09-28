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

// ── On a phone: send yourself the link for the laptop ─────────────────
// Almost everyone arriving from Instagram or TikTok is on a phone, and Herae
// only runs in Chrome on a computer — the store button is a dead end there.
// So on phones every "Add to Chrome" becomes "send it to my laptop": the
// share sheet (to yourself, notes, WhatsApp) or one email with the link
// (server/src/handoff.js; the address is used once and never stored).
(function () {
  const phone = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (window.matchMedia && matchMedia('(pointer: coarse)').matches && window.innerWidth < 900);
  if (!phone) return;
  const params = new URLSearchParams(location.search);
  const ref = (document.referrer.match(/instagram|tiktok|facebook|youtube|reddit|google/i) || [])[0];
  const src = (params.get('utm_source') || params.get('src') || (ref ? ref.toLowerCase() : 'site')).replace(/[^a-z0-9_.-]/gi, '').slice(0, 40) || 'site';
  const share = 'https://herae.app/?utm_source=handoff_share&utm_campaign=' + encodeURIComponent(src);
  const box = () => {
    const el = document.createElement('div');
    el.className = 'handoff';
    el.innerHTML =
      '<p class="handoff-title">On your phone? Herae runs in Chrome on your computer.</p>' +
      '<p class="handoff-sub">Send yourself the link and set it up on your laptop tonight. It takes a minute.</p>' +
      '<form class="handoff-row" novalidate><input type="email" name="email" placeholder="your email" autocomplete="email" inputmode="email" aria-label="Your email" required>' +
      '<button class="btn btn-gold" type="submit">Email me the link</button></form>' +
      (navigator.share ? '<button class="btn btn-ghost handoff-share" type="button">Or share it to yourself</button>' : '') +
      '<p class="handoff-note" role="status">One email with the link. Nothing else.</p>';
    const note = el.querySelector('.handoff-note');
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = el.querySelector('input'); const btn = el.querySelector('button[type=submit]');
      const v = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) { note.textContent = 'That email doesn’t look right.'; input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const r = await fetch('/api/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: v, src }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Something went wrong');
        el.querySelector('form').outerHTML = '<p class="handoff-done">Sent ✓ Check your inbox on your laptop.</p>';
        note.textContent = 'If it’s not there in a minute, look in Promotions or spam.';
      } catch (err) { btn.disabled = false; btn.textContent = 'Email me the link'; note.textContent = err.message; }
    });
    const sb = el.querySelector('.handoff-share');
    if (sb) sb.addEventListener('click', async () => {
      try {
        await navigator.share({ title: 'Herae', text: 'Herae: watch films together in sync, with the call beside it. Set up on my laptop:', url: share });
        fetch('/api/handoff/shared', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src }) }).catch(() => {});
      } catch (e) { /* the share sheet was closed */ }
    });
    return el;
  };
  const done = new Set();
  document.querySelectorAll('a[href*="chromewebstore.google.com"]').forEach((a) => {
    if (a.closest('.hero-topbar')) return;
    a.style.display = 'none';
    const holder = a.parentElement;
    if (!done.has(holder)) { done.add(holder); holder.before(box()); }
  });
  const top = document.querySelector('.hero-topbar a[href*="chromewebstore.google.com"]');
  if (top) { top.textContent = 'Send to my laptop'; top.removeAttribute('target'); top.href = '#'; top.addEventListener('click', (e) => { e.preventDefault(); const f = document.querySelector('.handoff input'); if (f) { f.scrollIntoView({ block: 'center' }); f.focus(); } }); }
})();
