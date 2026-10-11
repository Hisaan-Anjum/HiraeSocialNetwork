// src-tag.js — which channel a visitor came from, carried all the way to the Chrome Web Store (2026-10-05).
//
// Founder: "automatically learn which strategy works best". Most people install from the store and sign up inside
// the extension, where the site can't see them — so the store link itself has to say where they came from. On the
// first visit we remember the first utm_source(+campaign), in-app browser or referrer (same key api.js uses), and
// every "Add to Chrome" link gets utm_source=<that channel> and utm_campaign=<the page's own label>. The store's
// analytics then splits page views and installs by channel. Nothing identifying: a label and a hostname.
(function () {
  var KEY = 'herae_first_touch';
  var clean = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 60); };
  try {
    if (!localStorage.getItem(KEY)) {
      var q = new URLSearchParams(location.search), tag = '';
      if (q.get('utm_source')) tag = 'utm:' + q.get('utm_source') + (q.get('utm_campaign') ? '.' + q.get('utm_campaign') : '');
      if (!tag) { var ua = navigator.userAgent; if (/Instagram/i.test(ua)) tag = 'app:instagram'; else if (/BytedanceWebview|musical_ly|TikTok/i.test(ua)) tag = 'app:tiktok'; else if (/FBAN|FBAV/i.test(ua)) tag = 'app:facebook'; }
      if (!tag && document.referrer) {
        var host = new URL(document.referrer).hostname.replace(/^www\./, '');
        if (host && !/(^|\.)herae\.app$/.test(host) && host !== location.hostname) tag = 'ref:' + host;
      }
      if (tag) {
        localStorage.setItem(KEY, clean(tag));
        if (/(^|\.)herae\.app$/.test(location.hostname)) document.cookie = 'herae_ft=' + encodeURIComponent(clean(tag)) + '; domain=.herae.app; path=/; max-age=' + (90 * 86400) + '; secure; samesite=lax';
      }
    }
  } catch (e) { /* storage blocked, or an odd referrer */ }
  var label = '';
  try { label = (localStorage.getItem(KEY) || decodeURIComponent((document.cookie.match(/(?:^|; )herae_ft=([^;]+)/) || [])[1] || '')).replace(/^utm:/, '').replace(':', '-'); } catch (e) { /* none */ }
  if (!label) return;
  function tagLink(a) {
    try {
      var u = new URL(a.href);
      if (u.hostname !== 'chromewebstore.google.com' || u.searchParams.get('utm_campaign')) return;
      u.searchParams.set('utm_campaign', u.searchParams.get('utm_source') || 'site');
      u.searchParams.set('utm_source', label);
      a.href = u.toString();
    } catch (e) { /* leave the link as it is */ }
  }
  var all = function () { document.querySelectorAll('a[href*="chromewebstore.google.com/detail/"]').forEach(tagLink); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all); else all();
  // Links some pages render later (invite page, share sheet): tag them as they're clicked.
  document.addEventListener('click', function (ev) { var a = ev.target.closest && ev.target.closest('a[href*="chromewebstore.google.com/detail/"]'); if (a) tagLink(a); }, true);
})();

// ── On a phone, "Add to Chrome" is a dead end: send it to the laptop instead (2026-10-11) ──
// Search and ChatGPT traffic lands on the guides and signs up on the site — 8 of 10 site sign-ups since 09-20 never
// used the extension, and the phone path explains it: the Chrome Web Store can't install anything on a phone, and
// every page here only offered "Add to Chrome". The home page already had a handoff box (index.js); this gives every
// store link on every page the same thing: one email with the link, or the share sheet to yourself. Same endpoint
// (server/src/handoff.js — the address is used once and never stored).
(function () {
  var phone = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (window.matchMedia && matchMedia('(pointer: coarse)').matches && window.innerWidth < 900);
  if (!phone) return;
  var SEL = 'a[href*="chromewebstore.google.com/detail/"]';
  var page = (location.pathname.split('/').pop() || 'home').replace(/\.html$/, '').replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || 'home';
  var src = 'phone-' + page;
  function relabel() {
    document.querySelectorAll(SEL).forEach(function (a) {
      if (a.dataset.handoff) return;
      a.dataset.handoff = '1';
      if (/add to chrome|get herae|install|try herae/i.test(a.textContent)) a.textContent = 'Send it to my laptop';
    });
  }
  var sheet = null;
  function open() {
    if (sheet) { sheet.style.display = 'flex'; return; }
    sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Send Herae to your laptop');
    sheet.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.55);font-family:inherit';
    sheet.innerHTML =
      '<div style="width:100%;max-width:480px;background:#17171d;color:#f5f5f7;border-radius:20px 20px 0 0;padding:22px 18px 26px;box-shadow:0 -12px 40px rgba(0,0,0,.5)">' +
      '<p style="font-weight:700;font-size:18px;margin:0 0 6px">Herae runs in Chrome on a computer</p>' +
      '<p style="font-size:15px;color:#a8a8b3;margin:0 0 16px;line-height:1.5">Send yourself the link and add it on your laptop tonight. It takes a minute.</p>' +
      '<form novalidate style="display:flex;flex-direction:column;gap:10px">' +
      '<input type="email" placeholder="your email" autocomplete="email" inputmode="email" aria-label="Your email" required style="font:inherit;font-size:16px;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:inherit">' +
      '<button type="submit" style="font:inherit;font-weight:700;font-size:16px;padding:13px;border-radius:12px;border:0;background:linear-gradient(135deg,#f5b942,#e0901a);color:#1a1205">Email me the link</button></form>' +
      (navigator.share ? '<button type="button" data-share style="margin-top:10px;width:100%;font:inherit;font-size:15px;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit">Or share it to yourself</button>' : '') +
      '<p role="status" data-note style="font-size:13px;color:#8a8a96;margin:12px 0 0;min-height:1em">One email with the link. Nothing else.</p>' +
      '<button type="button" data-close style="margin-top:6px;width:100%;font:inherit;font-size:14px;padding:10px;border:0;background:transparent;color:#8a8a96">Not now</button></div>';
    document.body.appendChild(sheet);
    var note = sheet.querySelector('[data-note]'), form = sheet.querySelector('form'), input = sheet.querySelector('input');
    sheet.addEventListener('click', function (e) { if (e.target === sheet || e.target.hasAttribute('data-close')) sheet.style.display = 'none'; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim(), btn = form.querySelector('button');
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) { note.textContent = 'That email doesn’t look right.'; input.focus(); return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      fetch('/api/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: v, src: src }) })
        .then(function (r) { if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || 'Something went wrong'); }); })
        .then(function () { form.outerHTML = '<p style="font-weight:700;font-size:16px;margin:4px 0">Sent ✓ Check your inbox on your laptop.</p>'; note.textContent = 'If it’s not there in a minute, look in Promotions or spam.'; })
        .catch(function (err) { btn.disabled = false; btn.textContent = 'Email me the link'; note.textContent = err.message; });
    });
    var sb = sheet.querySelector('[data-share]');
    if (sb) sb.addEventListener('click', function () {
      navigator.share({ title: 'Herae', text: 'Herae: watch films together in sync, with the call beside it. Set up on my laptop:', url: 'https://herae.app/?utm_source=handoff_share&utm_campaign=' + encodeURIComponent(src) })
        .then(function () { fetch('/api/handoff/shared', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: src }) }).catch(function () {}); })
        .catch(function () { /* the share sheet was closed */ });
    });
    setTimeout(function () { try { input.focus(); } catch (e) { /* fine */ } }, 50);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', relabel); else relabel();
  setTimeout(relabel, 1500); setTimeout(relabel, 4000);   // links some pages render later (the memories page's steps)
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest(SEL);
    if (!a) return;
    ev.preventDefault(); ev.stopPropagation(); relabel(); open();
  }, true);
})();
