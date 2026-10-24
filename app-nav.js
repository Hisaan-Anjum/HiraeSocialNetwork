// app-nav.js — the ONE navigation for every signed-in page (founder 2026-10-22: "make sure the navbar is perfect
// throughout the app and consistent"). Desktop: brand · Home · Watch buddies · Friends · Parties · search · account menu.
// Phones: a slim top bar + a bottom tab bar (Home · Discover · Chats · Friends · Me) with unread badges.
// Pages keep their old header in the DOM (their scripts still bind to its buttons) but it is hidden.
// Classic global script, loaded after api.js; does nothing for signed-out visitors.
(function () {
  if (typeof getAuth !== 'function' || !getAuth()) return;
  const me = getAuth().username;
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
    ['Watch buddies', 'social.html#discover', 'discover', () => page === 'social.html' && hash !== 'friends'],
    ['Friends', 'contacts.html', 'friends', () => page === 'contacts.html' || at('social.html', 'friends') || page === 'user.html']];   // Parties lives under Watch buddies
  const BOTTOM = [['Home', 'memories.html', 'home', TOP[0][3]], ['Discover', 'social.html#discover', 'discover', () => at('social.html', 'discover') || at('social.html', 'matches') || at('social.html', 'parties')],
    ['Chats', 'social.html#chats', 'chats', () => at('social.html', 'chats')], ['Friends', 'contacts.html', 'friends', TOP[2][3]],
    ['Me', 'watch-profile.html', 'me', () => /^(watch-profile|billing|upgrade|refer)\.html$/.test(page)]];

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
  .an-connect { position: sticky; top: 60px; z-index: 45; display: flex; align-items: center; gap: 12px; padding: 10px max(16px, calc((100vw - 1120px) / 2));
    background: linear-gradient(135deg, rgba(79, 70, 229, .95), rgba(124, 58, 237, .95) 55%, rgba(219, 39, 119, .95)); color: #fff; font: 600 14px/1.35 var(--font-sans, system-ui); }
  .an-connect span { flex: 1; }
  .an-connect-cta { flex: none; padding: 8px 14px; border-radius: 999px; background: #fff; color: #312E81; font-weight: 700; text-decoration: none; white-space: nowrap; }
  .an-connect-x { flex: none; width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(255, 255, 255, .16); color: #fff; cursor: pointer; }
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
    .an-links { display: none; } .an-top { height: 56px; } .an-connect { top: 56px; font-size: 13px; padding: 8px 12px; }
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
    connectBanner();
  }
  // "Connect fast" (founder 2026-10-22): until someone has a person to watch with, every app page shows the ONE next
  // step for where they are. Dismissing hides it for an hour; it is always there for everyone (founder 10-22: persistent).
  async function connectBanner() {
    let st; try { st = await apiRequest('/api/profile/watch/connect-state'); } catch (e) { return; }
    // Nobody in between (founder 10-23): no partner and no profile → the choice, from every app page.
    // "Someone I already know" (the fork) holds off the choice for 3 days — time to bring their person in — then it asks again.
    let skipped = false; try { skipped = Date.now() - Number(localStorage.getItem('herae_setup_skipped') || 0) < 3 * 864e5; } catch (e) { /* storage blocked */ }
    // A party link (#parties/…) opens the party it came for: joining one is the way to a night, not "in between".
    const partyLink = page === 'social.html' && /^#parties/.test(location.hash);
    if (st.setupFirst && !skipped && !partyLink && page !== 'watch-profile.html') { location.replace('watch-profile.html?start=public&gate=1'); return; }
    // Chose "just people I invite" (or the fork's "someone I already know"): their next step is the invite, not a profile.
    const step = st.inviteFirst || (skipped && st.step === 'no_profile') ? 'invite_first' : st.step;
    const MSG = {
      // The fastest route for people who signed up before the setup existed (founder 10-23: "old users, fast and quick"):
      // no profile → the 3-step setup that ends in Discover; profile but Discover off → the one-tap switch in Discover.
      invite_first: ['Your first night is two steps away: add Herae to Chrome, then send your person your link.', 'Show me', 'memories.html'],
      no_profile: ['Find someone to watch with tonight — set up your profile in a minute.', 'Set up', 'watch-profile.html?start=public&meet=1'],
      discovery_off: ['Your profile is ready — turn on Discover to meet people who love the same films.', 'Turn it on', 'social.html#discover'],
      browse: st.waiting > 0 ? [`${st.waiting} ${st.waiting === 1 ? 'person who is' : 'people who are'} also looking ${st.waiting === 1 ? 'is' : 'are'} in Discover.`, 'See who', 'social.html#discover']
        : ['You’re in Discover. We’ll notify you the moment someone who shares your taste joins.', 'Invite your person', 'contacts.html'],
      say_hi: [`You have ${st.unchatted === 1 ? 'a match' : st.unchatted + ' matches'} waiting for a hello.`, 'Say hi', 'social.html#matches'],
      matched: ['Ready to watch? Suggest a film to your match.', 'Open chats', 'social.html#chats'],
      // Persistent (founder 10-22): even someone with a partner always has one tap to more people to watch with.
      connected: ['Find someone new to watch with — people who love the same films are in Discover.', 'Find someone', 'social.html#discover'],
    }[step];
    if (!MSG) return;
    const [text, cta, href] = MSG; const key = `hz-connect-${step}`;
    try { if (Date.now() - Number(localStorage.getItem(key) || 0) < 3600e3) return; } catch (e) { /* storage blocked: still show */ }   // "hide" lasts an hour, then it's back
    const [hPathQ, hTab] = href.split('#'); const hPath = hPathQ.split('?')[0]; const curTab = (location.hash.slice(1) || (hPath === 'social.html' ? 'discover' : '')).split('/')[0];
    if (location.pathname.endsWith(hPath) && (!hTab || curTab === hTab)) return;   // already there (#discover/<someone> is still Discover)
    const bar = document.createElement('div'); bar.className = 'an-connect'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Next step');
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
