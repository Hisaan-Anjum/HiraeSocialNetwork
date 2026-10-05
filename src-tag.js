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
