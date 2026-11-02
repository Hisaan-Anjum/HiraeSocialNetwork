// app-nav.js — the ONE navigation for every signed-in page (founder 2026-10-22: "make sure the navbar is perfect
// throughout the app and consistent"). Desktop: brand · Home · Watch buddies · Friends · Parties · search · account menu.
// Phones: a slim top bar + a bottom tab bar (Home · Discover · Chats · Friends · Me) with unread badges.
// Pages keep their old header in the DOM (their scripts still bind to its buttons) but it is hidden.
// Classic global script, loaded after api.js; does nothing for signed-out visitors.
(function () {
  if (typeof getAuth !== 'function' || !getAuth()) return;
  const me = getAuth().username;
  try {
    const page = location.pathname.replace(/^\/|\.html$/g, '') || 'index';
    const key = `herae_visit_${page}`; const day = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(key) !== day && typeof trackEvent === 'function') {
      localStorage.setItem(key, day);
      trackEvent('site_visit', { page, from: new URLSearchParams(location.search).get('from') || '' });
    }
  } catch (e) { /* storage blocked: unmeasured, never broken */ }
  const I = {   // 24×24 stroke icons
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    discover: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    chats: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>',
    friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.7c1.9.7 3.1 2.4 3.5 5.3"/>',
    parties: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8M10 9.5l4.5 2.5-4.5 2.5z"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[k]}</svg>`;
  let page, hash;   // re-read on every check: social.html changes tab by hash without reloading
  const refresh = () => { page = location.pathname.replace(/^.*\//, '') || 'memories.html'; hash = location.hash.replace(/^#/, '').split('/')[0]; };
  refresh();
  const at = (p, h) => page === p && (!h || hash === h || (h === 'discover' && !hash));
  const TOP = [['Home', 'memories.html', 'home', () => /^(memories|movie|post|review|session|search)\.html$/.test(page)],
    ['People', 'social.html#discover', 'discover', () => page === 'social.html' && hash !== 'friends'],
    ['Friends', 'contacts.html', 'friends', () => page === 'contacts.html' || at('social.html', 'friends') || page === 'user.html']];   // Watch parties live under People
  const BOTTOM = [['Home', 'memories.html', 'home', TOP[0][3]], ['People', 'social.html#discover', 'discover', () => at('social.html', 'discover') || at('social.html', 'matches') || at('social.html', 'parties')],
    ['Chats', 'social.html#chats', 'chats', () => at('social.html', 'chats')], ['Friends', 'contacts.html', 'friends', TOP[2][3]],
    ['Profile', 'watch-profile.html', 'me', () => /^(watch-profile|billing|upgrade|refer)\.html$/.test(page)]];

  const css = `
  body.has-app-nav > .topbar, body.has-app-nav > header.h-topbar, body.has-app-nav .topbar:not(.an-top) { display: none !important; }
  .an-top { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 8px; height: 60px; padding: 0 max(16px, calc((100vw - 1120px) / 2));
    background: rgba(15, 23, 42, .86); backdrop-filter: saturate(1.4) blur(12px); -webkit-backdrop-filter: saturate(1.4) blur(12px); border-bottom: 1px solid rgba(148, 163, 184, .16);
    font-family: var(--font-sans, system-ui, sans-serif); }
  .an-brand { display: flex; align-items: center; margin-right: 16px; } .an-brand img { height: 26px; width: auto; display: block; }
  .an-links { display: flex; gap: 2px; flex: 1; }
  .an-links a { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 10px; color: #94A3B8; font-weight: 600; font-size: 14.5px; text-decoration: none; position: relative; }
  .an-links a svg { width: 18px; height: 18px; }
  .an-links a:hover { color: #F8FAFC; background: rgba(148, 163, 184, .1); }
  .an-links a[aria-current="page"] { color: #F8FAFC; background: rgba(99, 102, 241, .16); }
  .an-right { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .an-icon { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #CBD5E1; background: none; border: 0; cursor: pointer; text-decoration: none; }
  .an-bell { position: relative; }   /* the bell's count sits on its corner */
  .an-icon:hover { background: rgba(148, 163, 184, .12); color: #F8FAFC; } .an-icon svg { width: 20px; height: 20px; }
  .an-menu-btn { display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 14px 0 11px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.06); color: #fff; font: 600 14px var(--font-sans, inherit); cursor: pointer; }
  .an-menu-btn svg { width: 20px; height: 20px; }
  .an-menu-btn:hover, .an-menu-btn[aria-expanded="true"] { background: rgba(255,255,255,.14); }
  .an-menu-btn:focus-visible { outline: 2px solid #A78BFA; outline-offset: 2px; }
  @media (max-width: 640px) { .an-menu-btn { width: 40px; padding: 0; justify-content: center; } .an-menu-btn span { display: none; } }
  .an-menu { position: absolute; right: max(16px, calc((100vw - 1120px) / 2)); top: 56px; min-width: 220px; padding: 6px; border-radius: 14px; background: #111827; border: 1px solid #334155;
    box-shadow: 0 18px 48px rgba(2, 6, 23, .55); list-style: none; margin: 0; z-index: 60; }
  .an-menu .an-who { padding: 10px 12px 8px; color: #94A3B8; font-size: 12.5px; border-bottom: 1px solid #1E293B; margin-bottom: 4px; } .an-menu .an-who b { display: block; color: #F8FAFC; font-size: 14px; }
  .an-menu a, .an-menu button { display: block; width: 100%; text-align: left; padding: 10px 12px; border-radius: 9px; color: #E2E8F0; font: 500 14px var(--font-sans, system-ui); text-decoration: none; background: none; border: 0; cursor: pointer; }
  .an-menu a:hover, .an-menu button:hover, .an-menu a:focus-visible, .an-menu button:focus-visible { background: #1E293B; outline: none; }
  .an-badge { position: absolute; top: 4px; right: 4px; min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px; background: #EC4899; color: #fff; font: 700 11px/17px var(--font-sans, system-ui); text-align: center; }
  .an-connect { position: relative; z-index: 45;   /* not sticky (10-28): stuck at the same top as the Discover tabs, it covered them on phones */ display: flex; align-items: center; gap: 12px; padding: 10px max(16px, calc((100vw - 1120px) / 2));
    background: linear-gradient(135deg, rgba(79, 70, 229, .95), rgba(124, 58, 237, .95) 55%, rgba(219, 39, 119, .95)); color: #fff; font: 600 14px/1.35 var(--font-sans, system-ui); }
  .an-connect span { flex: 1; }
  .an-connect a.an-connect-cta, .an-connect button.an-connect-cta { flex: none; padding: 8px 14px; border-radius: 999px; background: #fff; color: #312E81; font-weight: 700; text-decoration: none; white-space: nowrap; }
  .an-connect-x { flex: none; width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, .16); color: #fff; cursor: pointer; }
  /* The push / install bar (founder 11-02): refined red, sticky above the header; phones get icon + two lines + full-width actions. */
  .an-push { position: sticky; top: 0; z-index: 60; color: #fff; font-family: var(--font-sans, system-ui);
    background: linear-gradient(135deg, #E0284A 0%, #B4153A 100%); box-shadow: 0 1px 0 rgba(255,255,255,.12) inset, 0 6px 18px rgba(127, 18, 46, .35); }
  .an-push.is-on { background: linear-gradient(135deg, #16A34A, #15803D); box-shadow: 0 6px 18px rgba(21, 128, 61, .3); }
  .an-push-in { display: flex; align-items: center; gap: 14px; padding: 10px max(16px, calc((100vw - 1120px) / 2)); }
  .an-push-ico { flex: none; width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; font-size: 19px; background: rgba(255,255,255,.16); }
  .an-push-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .an-push-txt b { font-size: 15px; font-weight: 700; letter-spacing: -.01em; line-height: 1.25; }
  .an-push-txt span { font-size: 13px; line-height: 1.35; color: rgba(255,255,255,.86); }
  .an-push-acts { flex: none; display: flex; align-items: center; gap: 8px; }
  .an-push-btn { height: 38px; padding: 0 16px; border-radius: 999px; border: 0; font: 700 14px var(--font-sans, system-ui); cursor: pointer; white-space: nowrap; }
  .an-push-btn.is-primary { background: #fff; color: #B4153A; box-shadow: 0 2px 8px rgba(0,0,0,.18); }
  .an-push-btn.is-ghost { background: transparent; color: #fff; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.7); }
  .an-push-btn.is-quiet { background: transparent; color: rgba(255,255,255,.88); font-weight: 600; padding: 0 8px; }
  .an-push-btn:disabled { opacity: .6; }
  .an-push-x { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(255,255,255,.14); color: #fff; cursor: pointer; }
  .an-top { top: var(--push-h, 0px); }
  @media (max-width: 760px) {
    .an-push-in { flex-wrap: wrap; gap: 10px 12px; padding: 12px 16px; }
    .an-push-txt { flex: 1 1 calc(100% - 52px); }
    .an-push-acts { flex: 1 1 100%; }
    .an-push-btn.is-primary { flex: 1; height: 42px; font-size: 15px; }
    .an-push-btn.is-ghost { flex: 1; height: 42px; }
  }
  .an-ios-tip { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 90; max-width: 300px;
    padding: 14px 18px; border-radius: 16px; background: #fff; color: #111827; font: 700 15px/1.35 var(--font-sans, system-ui); text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
  .an-ios-tip::after { content: ''; position: absolute; left: 50%; bottom: -9px; margin-left: -9px; border: 9px solid transparent; border-bottom: 0; border-top-color: #fff; }
  .an-ios-tip.an-tip-top { top: calc(var(--push-h, 0px) + 12px); bottom: auto; left: auto; right: 10px; transform: none; max-width: 230px; }   /* under the bar, pointing up at Chrome's ⋮ */
  .an-ios-tip.an-tip-top::after { bottom: auto; top: -9px; left: auto; right: 14px; border: 9px solid transparent; border-top: 0; border-bottom-color: #fff; }
  /* The installed app's notifications popup: locks everything until it's on. */
  html.an-locked, html.an-locked body { overflow: hidden !important; }
  .an-lock { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 24px; background: rgba(2, 6, 23, .82);
    -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); font-family: var(--font-sans, system-ui); }
  .an-lock-card { width: 100%; max-width: 360px; padding: 32px 24px 24px; border-radius: 28px; text-align: center; color: #fff;
    background: linear-gradient(180deg, #1E1B4B, #111827); border: 1px solid rgba(255,255,255,.1); box-shadow: 0 30px 80px rgba(0,0,0,.55); }
  .an-lock-ico { width: 76px; height: 76px; margin: 0 auto 18px; border-radius: 24px; display: grid; place-items: center; font-size: 38px;
    background: linear-gradient(135deg, #E0284A, #B4153A); box-shadow: 0 12px 30px rgba(224, 40, 74, .45); }
  .an-lock h2 { margin: 0 0 8px; font-size: 24px; letter-spacing: -.02em; }
  .an-lock p { margin: 0 0 22px; font-size: 15px; line-height: 1.5; color: #CBD5E1; }
  .an-lock-btn { width: 100%; height: 52px; border: 0; border-radius: 16px; font: 700 16px var(--font-sans, system-ui); color: #fff; cursor: pointer;
    background: linear-gradient(135deg, #E0284A, #B4153A); box-shadow: 0 10px 24px rgba(224, 40, 74, .35); }
  .an-lock-btn:disabled { opacity: .6; }
  .an-lock small { display: block; margin-top: 14px; font-size: 13px; line-height: 1.45; color: #94A3B8; }
  .an-lock small:empty { display: none; }
  .an-bottom { display: none; }
  /* Desktop (founder 10-23): the same five destinations as the phone, as a floating dock — one way around the app on
     every screen, Chats and Me included (the top tabs only had Home / Watch buddies / Friends). */
  @media (min-width: 761px) {
    .an-links { display: none; }
    .an-bottom { display: flex; position: fixed; left: 50%; transform: translateX(-50%); bottom: 16px; z-index: 50; gap: 4px; padding: 6px;
      border-radius: 18px; background: rgba(15, 23, 42, .92); border: 1px solid rgba(148, 163, 184, .22); box-shadow: 0 12px 32px rgba(2, 6, 23, .55); backdrop-filter: blur(12px); }
    body .an-bottom a { display: flex; flex-direction: column; align-items: center; gap: 3px; box-sizing: border-box; width: 80px; min-width: 0; min-height: 0; padding: 8px 0; margin: 0; border-radius: 12px;
      color: #94A3B8; font: 600 12px var(--font-sans, system-ui); text-decoration: none; position: relative; }
    .an-bottom a:hover { color: #F8FAFC; background: rgba(148, 163, 184, .1); }
    .an-bottom a svg { width: 22px; height: 22px; }
    .an-bottom a[aria-current="page"] { color: #F8FAFC; background: rgba(99, 102, 241, .18); } .an-bottom a[aria-current="page"] svg { color: #A5B4FC; }
    .an-bottom .an-badge { top: 4px; right: calc(50% - 22px); }
    body.has-app-nav { padding-bottom: 100px; }
    body.has-app-nav.in-thread .an-bottom { display: none; } body.has-app-nav.in-thread { padding-bottom: 0; }
  }
  @media (max-width: 760px) {
    .an-links { display: none; } .an-top { height: 56px; } .an-connect { font-size: 13px; padding: 8px 12px; }   /* no top offset (10-30): left from the sticky days, it slid every banner 56 px down onto the tab row */
    .an-bottom { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; height: calc(60px + env(safe-area-inset-bottom)); padding-bottom: env(safe-area-inset-bottom);
      background: rgba(15, 23, 42, .94); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-top: 1px solid rgba(148, 163, 184, .16); }
    .an-bottom a { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: #94A3B8; font: 600 11px var(--font-sans, system-ui); text-decoration: none; position: relative; }
    .an-bottom a svg { width: 23px; height: 23px; }
    .an-bottom a[aria-current="page"] { color: #F8FAFC; } .an-bottom a[aria-current="page"] svg { color: #A5B4FC; }
    .an-bottom .an-badge { top: 4px; right: calc(50% - 22px); }
    body.has-app-nav { padding-bottom: calc(64px + env(safe-area-inset-bottom)); }
    body.has-app-nav.in-thread .an-bottom { display: none; } body.has-app-nav.in-thread { padding-bottom: 0; }
    /* page action bars that stick to the bottom sit ON TOP of the tab bar, never under it */
    body.has-app-nav .wp-save { bottom: calc(60px + env(safe-area-inset-bottom)); }
  }`;

  function build() {
    if (document.querySelector('.an-top')) return;
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    const top = document.createElement('header'); top.className = 'an-top'; top.setAttribute('role', 'banner');
    top.innerHTML = `<a class="an-brand" href="memories.html" aria-label="herae — home"><img src="herae-logo-on-dark.svg" alt="herae"></a>
      <nav class="an-links" aria-label="Main">${TOP.map(([t, h, i]) => `<a href="${h}" data-key="${i}">${svg(i)}<span>${t}</span></a>`).join('')}</nav>
      <div class="an-right"><a class="an-icon an-bell" href="notifications.html" aria-label="Notifications" data-key="bell">${svg('bell')}</a><a class="an-icon" href="search.html" aria-label="Search" data-search>${svg('search')}</a>
        <button class="an-menu-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Menu">${svg('menu')}<span>Menu</span></button></div>`;
    const bottom = document.createElement('nav'); bottom.className = 'an-bottom'; bottom.setAttribute('aria-label', 'Main');
    bottom.innerHTML = BOTTOM.map(([t, h, i]) => `<a href="${h}" data-key="${i}">${svg(i)}<span>${t}</span></a>`).join('');
    document.body.prepend(top); document.body.append(bottom); document.body.classList.add('has-app-nav');
    // search: pages with their own search overlay keep it
    top.querySelector('[data-search]').onclick = (e) => { const own = document.getElementById('searchTrigger'); if (own) { e.preventDefault(); own.click(); } };
    // account menu
    const btn = top.querySelector('.an-menu-btn'); let menu = null;
    const close = () => { if (menu) { menu.remove(); menu = null; btn.setAttribute('aria-expanded', 'false'); } };
    btn.onclick = () => {
      if (menu) return close();
      menu = document.createElement('ul'); menu.className = 'an-menu'; menu.setAttribute('role', 'menu');
      menu.innerHTML = `<li class="an-who" role="none"><b></b>Signed in</li>
        <li role="none"><a role="menuitem" href="user.html?u=${encodeURIComponent(me)}">Your page</a></li>
        <li role="none"><a role="menuitem" href="watch-profile.html">Watch profile &amp; privacy</a></li>
        <li role="none"><a role="menuitem" href="billing.html">Plan &amp; billing</a></li>
        <li role="none"><a role="menuitem" href="user.html?u=${encodeURIComponent(me)}&amp;settings=1">Account settings</a></li>
        <li role="none"><a role="menuitem" href="refer.html">Invite friends</a></li>
        <li role="none"><a role="menuitem" href="help.html">Help</a></li>
        <li role="none"><button role="menuitem" type="button" data-logout>Log out</button></li>`;
      menu.querySelector('.an-who b').textContent = me;   // text, never markup
      menu.querySelector('[data-logout]').onclick = () => (typeof logout === 'function' ? logout() : (localStorage.removeItem('moments_auth'), location.href = 'index.html'));
      top.append(menu); btn.setAttribute('aria-expanded', 'true'); menu.querySelector('a').focus();
    };
    // btn.contains: a tap on the ☰ icon inside the button is still the button
    document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) { close(); btn.focus(); } });
    mark(); window.addEventListener('hashchange', () => { mark(); });
    badges(); setInterval(badges, 60000);
    pushLock();
    if (typeof webPushState === 'function') webPushState().catch(() => {});   // warms the push key alongside connect-state
    connectBanner();
  }
  // Founder 11-01 (emergency): people in matching weren't hearing about likes. 1 of 12 had push on; 5 had said no to the
  // browser's own box, which a cold prompt on profile save fired, and a "no" there is final. So: a red bar at the very top
  // of every app page, every visit, until this device can notify; ✕ hides it for this page view only. The browser's box
  // only ever opens from its button (a soft ask first, research 11-01). Blocked → the same button (founder 11-01: a button
  // that asks again, not long steps): it asks first, since Chrome lifts its own week-long block after repeated closes; only
  // a real "Block" can't be asked again by any site (Chrome 151 has no <permission> element), and then one line says where.
  // It turns itself on the moment they allow it (no reload). iPhone → Add to Home Screen (iOS push needs it). Never where the extension runs.
  const isIos = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Phones (founder 11-01): push in a phone browser is unreliable, so every phone is first asked to install the app; a
  // "Not now" (7 days) turns the bar into the notifications ask; inside the installed app it asks once for notifications.
  const isPhone = isIos || /Android/.test(navigator.userAgent);
  const inApp = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installEvt = null;   // Chrome on Android hands this over when the app can be installed; prompt() opens its own box
  // It can arrive late (Chrome waits for some use of the page): then the bar is redrawn with the Install button.
  // Chrome only offers install when the app isn't installed, so the offer also clears a stale "installed" mark (deleted app).
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); installEvt = e;
    try { localStorage.removeItem('herae_app_installed'); } catch (x) { /* storage blocked */ }
    if (lastSt) pushBanner(lastSt);
  });
  const markInstalled = () => { try { localStorage.setItem('herae_app_installed', '1'); } catch (e) { /* storage blocked */ } };
  window.addEventListener('appinstalled', markInstalled);
  let lastSt = null;
  // Android Chrome only offers install for a site whose service worker is running (sw.js: push only, no caching).
  if (isPhone && !inApp && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  // Installed app (founder 11-02): it asks for notifications the moment it opens; with the app installed, the phone's
  // browser never asks (the app notifies). Android's app shares the browser's storage; getInstalledRelatedApps also knows.
  if (inApp) { try { localStorage.setItem('herae_app_installed', '1'); } catch (e) { /* storage blocked */ } }
  const appInstalled = async () => {
    try { if (localStorage.getItem('herae_app_installed') === '1') return true; } catch (e) { /* storage blocked */ }
    try { return !!(navigator.getInstalledRelatedApps && (await navigator.getInstalledRelatedApps()).length); } catch (e) { return false; }
  };
  // The one Install app action for every phone bar (founder 11-02: buttons, never steps): Chrome's own box when it has
  // offered one (a tap can bring the offer, so it waits up to 3 s, inside the tap's activation); otherwise a bubble that
  // points at the browser's own install button. Resolves true (installed), false (turned down) or null (bubble shown).
  async function runInstall() {
    for (let i = 0; !isIos && !installEvt && i < 15; i++) await new Promise((r) => setTimeout(r, 200));
    if (installEvt) { const e = installEvt; installEvt = null; e.prompt(); return (await e.userChoice).outcome === 'accepted'; }
    const tip = document.createElement('div'); tip.className = isIos ? 'an-ios-tip' : 'an-ios-tip an-tip-top'; tip.setAttribute('role', 'dialog');
    tip.textContent = isIos ? 'Tap Share ⬆ below, then “Add to Home Screen”.' : 'Tap ⋮ above, then “Install app”.';
    tip.onclick = () => tip.remove(); document.body.append(tip); setTimeout(() => tip.remove(), 12000);
    return null;
  }
  const installSaidNo = () => { try { return Date.now() - Number(localStorage.getItem('herae_install_no') || 0) < 7 * 864e5; } catch (e) { return false; } };
  const unblockLine = () => (/Android/.test(navigator.userAgent) ? 'Your browser said no. Tap ⋮ → Settings → Site settings → Notifications → Herae → Allow.'
    : 'Your browser said no. Click the icon left of the address and set Notifications to Allow.');
  // The bars (founder 11-02: persistent, fast, beautiful on phones): sticky at the very top, above the sticky header, which
  // (and Discover's tabs) move down by the bar's height (--push-h). Icon, a short title and line, one clear button.
  const keepTop = (bar) => {
    const set = () => document.documentElement.style.setProperty('--push-h', `${bar.isConnected ? bar.offsetHeight : 0}px`);
    set(); if (window.ResizeObserver) new ResizeObserver(set).observe(bar);
    new MutationObserver(() => { if (!bar.isConnected) set(); }).observe(document.body, { childList: true });
  };
  const pushOn = () => window.dispatchEvent(new Event('herae:push-on'));   // Discover's button shows ✓ at once
  async function pushBanner(st, text) {
    if (!st || !(st.matching || isPhone) || typeof webPushState !== 'function') return;
    lastSt = st;
    if (isPhone && inApp) return;   // the installed app asks with its own popup (pushLock)
    if (isPhone && !inApp && await appInstalled()) return;   // the app asks there, not this browser
    // Phones can't run the extension: no 1.5 s wait for its answer there.
    const ext = isPhone ? false : await new Promise((resolve) => {
      const on = (e) => { if (e.source === window && e.data && e.data.__heraeExtension === true) { window.removeEventListener('message', on); resolve(e.data); } };
      window.addEventListener('message', on); window.postMessage({ __heraePing: true }, location.origin); setTimeout(() => resolve(false), 1500);
    });
    // The extension notifies on its devices, unless Chrome blocks its notifications (it says so from 2.7.52). Then the site's
    // own push takes over: Chrome's page shows that block as "Blocked by an extension" and won't let anyone change it there,
    // and with the extension silenced the two can't double an alert.
    const extOff = !!ext && ext.notify === 'denied';
    if (extOff && typeof trackEvent === 'function') trackEvent('web_push', { action: 'ext_off_shown' });
    const old = document.getElementById('pushBar'); if (old) old.remove();   // whatever comes next replaces it, or nothing does
    let state = ext && !extOff ? 'ext' : await webPushState().catch(() => 'unsupported');
    // Phone browser (founder 11-02): the install ask first; the notifications bar only once the install was turned down,
    // and then with both buttons (Install app, Turn on notifications).
    if (isPhone && !inApp && !installSaidNo()) state = 'install';
    else if (state === 'unsupported' && isIos && !inApp) return;   // said no to installing: an iPhone browser can't notify, email does
    if (state === 'ext' || state === 'on' || state === 'unsupported') return;
    if (document.getElementById('pushBar')) return;   // a second call raced this one
    const bar = document.createElement('div'); bar.className = 'an-push'; bar.id = 'pushBar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Notifications');
    bar.innerHTML = '<div class="an-push-in"><span class="an-push-ico" aria-hidden="true"></span><div class="an-push-txt"><b></b><span></span></div><div class="an-push-acts"></div></div>';
    const ico = bar.querySelector('.an-push-ico'), title = bar.querySelector('.an-push-txt b'), msg = bar.querySelector('.an-push-txt span'), acts = bar.querySelector('.an-push-acts');
    const say = (i, t, m) => { ico.textContent = i; title.textContent = t; msg.textContent = m; };   // text only, never markup
    const button = (label, onclick, kind = '') => { const b = document.createElement('button'); b.type = 'button'; b.className = `an-push-btn ${kind}`; b.textContent = label; b.onclick = onclick; acts.append(b); return b; };
    const settle = (i, t, m) => { bar.classList.add('is-on'); acts.textContent = ''; say(i, t, m); setTimeout(() => bar.remove(), 3500); };
    const installedNote = () => { markInstalled(); trackEvent('web_push', { action: 'install_yes' }); settle('✓', 'Herae is on your home screen', 'Open it from there. It asks once for notifications.'); };
    const done = () => { pushOn(); settle('✓', 'Notifications are on', 'You’ll hear about likes and messages on this device.'); };
    const waiting = Number(st.likedBy || 0);
    if (state === 'off') {
      if (text) say('🔔', 'Turn on notifications', text);
      else if (waiting) say('💜', waiting === 1 ? 'Someone likes you' : `${waiting} people like you`, 'Turn on notifications so you don’t miss them.');
      else say('🔔', 'Turn on notifications', 'Know the moment someone likes you or says hi.');
      const go = button('Turn on notifications', async () => {
        go.disabled = true;
        if (await enableWebPush()) return done();
        go.disabled = false;
        if (Notification.permission === 'denied') return pushBanner(st, text);
        // Closed the box, or Chrome showed only its quiet crossed-out bell in the address bar.
        msg.textContent = 'Your browser hid the question. Tap the bell in the address bar and choose Allow, or try again.';
      }, 'is-primary');
    } else if (state === 'blocked') {
      say('🔕', 'Notifications are blocked', 'You’ll miss likes and messages.');
      const go = button('Turn on notifications', async () => {
        go.disabled = true;
        if (await enableWebPush()) return done();
        go.disabled = false; msg.textContent = unblockLine();
      }, 'is-primary');
      // Allowed in the site settings while this page is open: subscribe then and there.
      navigator.permissions && navigator.permissions.query({ name: 'notifications' }).then((p) => {
        p.onchange = async () => { if (p.state === 'granted' && await enableWebPush()) { trackEvent('web_push', { action: 'unblocked' }); done(); } };
      }).catch(() => {});
    } else {   // install: the phone's real app box on Android Chrome; on iPhone, Safari's Share button
      const no = () => { try { localStorage.setItem('herae_install_no', String(Date.now())); } catch (e) { /* storage blocked */ }
        trackEvent('web_push', { action: 'install_no' }); pushBanner(st, text); };
      say('📲', 'Get the Herae app', 'Never miss a like or a message.');
      const go = button('Install app', async () => { go.disabled = true; const r = await runInstall(); go.disabled = false; if (r === true) installedNote(); else if (r === false) no(); }, 'is-primary');
      button('Not now', no, 'is-quiet');
    }
    if ((state === 'off' || state === 'blocked') && isPhone && !inApp && !isIos) {
      const again = button('Install app', async () => { again.disabled = true; const r = await runInstall(); again.disabled = false; if (r === true) installedNote(); }, 'is-ghost');
    }
    // Desktop can tuck it away for this page; on phones, once the install was turned down, it stays (founder 11-02).
    if (state !== 'install' && !isPhone) {
      const x = document.createElement('button'); x.type = 'button'; x.className = 'an-push-x'; x.setAttribute('aria-label', 'Hide for now'); x.textContent = '✕';
      x.onclick = () => bar.remove(); bar.querySelector('.an-push-in').append(x);
    }
    document.body.prepend(bar); keepTop(bar);
    const browse = document.querySelector('.an-connect[data-step="browse"]'); if (browse) browse.remove();   // see connectBanner: one bar, not two
    if (typeof trackEvent === 'function') trackEvent('web_push', { action: { off: 'shown', blocked: 'blocked_shown', install: 'install_shown' }[state] });
  }
  // The installed app on a phone (founder 11-02): until notifications are on, a popup that locks the whole app, shown the
  // instant it opens (no network needed to decide). Blocked → the one line to allow it; re-checked whenever they come back.
  function pushLock() {
    if (!(isPhone && inApp) || !('Notification' in window) || !('PushManager' in window) || typeof enableWebPush !== 'function') return;
    if (Notification.permission === 'granted') {   // allowed already: make sure this device is subscribed, silently
      webPushState().then((st) => { if (st === 'off') enableWebPush().then((ok) => ok && pushOn()); }).catch(() => {});
      return;
    }
    if (document.getElementById('pushLock')) return;
    const lock = document.createElement('div'); lock.id = 'pushLock'; lock.className = 'an-lock';
    lock.setAttribute('role', 'dialog'); lock.setAttribute('aria-modal', 'true'); lock.setAttribute('aria-labelledby', 'pushLockT');
    lock.innerHTML = '<div class="an-lock-card"><div class="an-lock-ico" aria-hidden="true">🔔</div><h2 id="pushLockT">Turn on notifications</h2>'
      + '<p></p><button type="button" class="an-lock-btn">Turn on notifications</button><small></small></div>';
    const p = lock.querySelector('p'), btn = lock.querySelector('button'), small = lock.querySelector('small');
    const blocked = () => { p.textContent = 'Notifications are blocked for Herae.'; small.textContent = unblockLine(); btn.textContent = 'I’ve allowed it'; };
    p.textContent = 'Herae tells you the moment someone likes you, messages you or is ready to watch.';
    if (Notification.permission === 'denied') blocked();
    // The popup lives outside <body>, so the whole page (and anything added to it later) is inert behind it.
    const unlock = () => { lock.remove(); document.body.inert = false; document.documentElement.classList.remove('an-locked'); pushOn(); };
    const check = async () => { if (Notification.permission === 'granted' && await enableWebPush()) { trackEvent('web_push', { action: 'on' }); unlock(); } };
    btn.onclick = async () => {
      btn.disabled = true;
      if (Notification.permission === 'default' && await enableWebPush()) { btn.disabled = false; return unlock(); }
      btn.disabled = false;
      if (Notification.permission === 'denied') blocked(); else await check();
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && lock.isConnected) check(); });
    navigator.permissions && navigator.permissions.query({ name: 'notifications' }).then((s) => { s.onchange = () => { if (lock.isConnected) check(); }; }).catch(() => {});
    document.body.inert = true;   // nothing behind it can be reached
    document.documentElement.classList.add('an-locked');
    document.documentElement.append(lock);
    if (typeof trackEvent === 'function') trackEvent('web_push', { action: Notification.permission === 'denied' ? 'blocked_shown' : 'shown' });
    // Push not configured on this server: never trap anyone behind a popup that can't succeed.
    webPushState().then((st) => { if (st === 'unsupported') unlock(); }).catch(() => {});
  }
  // Discover's "after a yes" asks about THAT person through the same bar.
  window.heraePushBar = async (text) => { try { pushBanner(await apiRequest('/api/profile/watch/connect-state'), text); } catch (e) { /* signed out or offline */ } };
  // "Connect fast" (founder 2026-10-22): until someone has a person to watch with, every app page shows the ONE next
  // step for where they are. Dismissing hides it for an hour; it is always there for everyone (founder 10-22: persistent).
  async function connectBanner() {
    let st; try { st = await apiRequest('/api/profile/watch/connect-state'); } catch (e) { return; }
    pushBanner(st);
    // Nobody in between (founder 10-23): no partner and no profile → the choice, from every app page.
    // "Someone I already know" (the fork) holds off the choice for an hour — the server holds 3 days once an invite went out.
    let skipped = false; try { skipped = Date.now() - Number(localStorage.getItem('herae_setup_skipped') || 0) < 36e5; } catch (e) { /* storage blocked */ }
    // A party link (#parties/…) opens the party it came for: joining one is the way to a night, not "in between".
    const partyLink = page === 'social.html' && /^#parties/.test(location.hash);
    // Already chose (sign-up, the install guide, this site's choice screen — founder 10-24: never ask twice): "meet
    // someone new" goes straight to the profile steps, or Discover's one-tap switch for a saved profile; no choice screen.
    const onDiscover = page === 'social.html';
    // Your own profile holds Download my data, Sign out everywhere and Delete account: those are never behind a question.
    const ownProfile = page === 'user.html' && new URLSearchParams(location.search).get('u') === (getAuth() || {}).username;
    if (st.setupFirst && !skipped && !partyLink && !ownProfile && page !== 'watch-profile.html' && !(st.chosen === 'meet' && st.step === 'discovery_off' && onDiscover)) {
      location.replace(st.chosen === 'meet' ? (st.step === 'discovery_off' ? 'social.html#discover' : 'watch-profile.html?start=public&meet=1') : 'watch-profile.html?start=public&gate=1');
      return;
    }
    // Chose "just people I invite" (or the fork's "someone I already know"): their next step is the invite, not a profile.
    let step = st.inviteFirst || (skipped && st.step === 'no_profile') ? 'invite_first' : st.step;
    // A couple who already watch together, while the Founding offer is open (to 31 Oct, program terms): the real next
    // step is that offer, not "find someone new". Never shown to anyone who pays or is covered by a partner who pays.
    if (step === 'connected') {
      try {
        const [cfg, ent] = await Promise.all([apiRequest('/api/subscription/config'), apiRequest('/api/subscription/status')]);
        if (cfg.founding && cfg.founding.open && !['own', 'partner', 'special'].includes(ent.source)) step = 'founding';
      } catch (e) { /* no offer bar if either call fails */ }
    }
    const MSG = {
      // The fastest route for people who signed up before the setup existed (founder 10-23: "old users, fast and quick"):
      // no profile → the 3-step setup that ends in Discover; profile but Discover off → the one-tap switch in Discover.
      invite_first: ['Your first night is two steps away: add Herae to Chrome, then send your person your link.', 'Show me', 'memories.html'],
      no_profile: ['Find someone to watch with tonight — set up your profile in a minute.', 'Set up', 'watch-profile.html?start=public&meet=1'],
      discovery_off: ['Your profile is ready. Start meeting people who love the same films.', 'Start', 'social.html#discover'],
      browse: st.waiting > 0 ? [`${st.waiting} ${st.waiting === 1 ? 'person who is' : 'people who are'} also looking ${st.waiting === 1 ? 'is' : 'are'} on Herae now.`, 'See who', 'social.html#discover']
        : ['You’re meeting people. We’ll notify you the moment someone who shares your taste joins.', 'Invite your person', 'contacts.html'],
      liked: [`${st.likedBy === 1 ? 'Someone wants' : `${st.likedBy} people want`} to watch with you. Say yes back and you’re matched.`, 'See who', 'social.html#discover'],
      say_hi: [`You have ${st.unchatted === 1 ? 'a match' : st.unchatted + ' matches'} waiting for a hello.`, 'Say hi', 'social.html#matches'],
      matched: ['Ready to watch? Suggest a film to your match.', 'Open chats', 'social.html#chats'],
      // Persistent (founder 10-22): even someone with a partner always has one tap to more people to watch with.
      connected: ['Find someone new to watch with: people who love the same films are here.', 'Find someone', 'social.html#discover'],
      founding: ['Founding price until 31 October: a whole year of Herae for both of you for $29 (less in some countries), and it stays that price while you keep it.', 'See the offer', 'upgrade.html?utm_source=app&utm_medium=founding_bar'],
    }[step];
    if (!MSG) return;
    const [text, cta, href] = MSG; const key = `hz-connect-${step}`;
    try { if (Date.now() - Number(localStorage.getItem(key) || 0) < 3600e3) return; } catch (e) { /* storage blocked: still show */ }   // "hide" lasts an hour, then it's back
    const [hPathQ, hTab] = href.split('#'); const hPath = hPathQ.split('?')[0]; const curTab = (location.hash.slice(1) || (hPath === 'social.html' ? 'discover' : '')).split('/')[0];
    if (location.pathname.endsWith(hPath) && (!hTab || curTab === hTab)) return;   // already there (#discover/<someone> is still Discover)
    if (step === 'browse' && document.getElementById('pushBar')) return;   // one bar on a phone: nothing to act on here, and notifications matter more
    const bar = document.createElement('div'); bar.className = 'an-connect'; bar.dataset.step = step; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Next step');
    bar.innerHTML = `<span></span><a class="an-connect-cta"></a><button type="button" class="an-connect-x" aria-label="Hide for now">✕</button>`;
    bar.querySelector('span').textContent = text; const a = bar.querySelector('a'); a.textContent = cta; a.href = href;
    const track = (action) => { if (typeof trackEvent === 'function') trackEvent('connect_nudge', { step, action }); };
    bar.querySelector('button').onclick = () => { try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* fine */ } bar.remove(); track('hide'); };
    a.onclick = () => track('open');
    document.querySelector('.an-top').after(bar);
    track('shown');
  }
  function mark() {
    refresh();
    for (const [links, defs] of [[document.querySelectorAll('.an-links a'), TOP], [document.querySelectorAll('.an-bottom a'), BOTTOM]]) {
      links.forEach((a, k) => { if (defs[k][3]()) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    }
  }
  async function badges() {
    try {
      const [c, f, nt] = await Promise.all([apiRequest('/api/chats'), apiRequest('/api/contacts'), apiRequest('/api/notifications/count').catch(() => ({ unread: 0 }))]);
      const unread = (c.conversations || []).reduce((s, x) => s + (x.unread || 0), 0); const reqs = (f.incoming || []).length;
      const set = (key, n) => document.querySelectorAll(`[data-key="${key}"]`).forEach((a) => { let b = a.querySelector('.an-badge'); if (!n) { if (b) b.remove(); return; }
        if (!b) { b = document.createElement('span'); b.className = 'an-badge'; a.append(b); } b.textContent = n > 9 ? '9+' : String(n); b.setAttribute('aria-label', `${n} new`); });
      set('chats', unread); set('friends', reqs); set('bell', page === 'notifications.html' ? 0 : nt.unread);
    } catch (e) { /* badges are a convenience */ }
  }
  window.heraeNavBadges = () => badges();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
