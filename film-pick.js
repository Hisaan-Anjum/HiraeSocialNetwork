// film-pick.js — picking a film from Herae's catalogue, on any screen (founder 10-23: "this dropdown isn't working";
// "in chat suggest film allow both movie drop down suggestion and/or open the catalog dialog like in add to watch list").
//
// heraeTypeahead(input, fetchItems, { onPick }) — a real dropdown under the field. It replaces <datalist>, which
//   Android Chrome shows only as keyboard chips beside a ▼ that does nothing. fetchItems(q) → [[value, label, item]].
//   Typing anything else still works: it suggests, never restricts.
// heraeCatalogPick({ withUser, withName, title }) → Promise<film|null> — the catalogue browser (search, ranked posters, more
//   as you scroll), the same /api/recommendations the shared Watchlist's "Add a movie" uses.
//
// Both open inside a modal <dialog> when the field is in one: a modal dialog sits in the browser's top layer, and
// anything appended to <body> would be drawn underneath it.
(function () {
  'use strict';
  const css = `
.fp-list{position:fixed;z-index:2147483000;margin:0;padding:4px;list-style:none;background:var(--h-surface-2,#1e293b);border:1px solid var(--h-line-strong,#475569);
  border-radius:var(--h-r-md,12px);box-shadow:var(--h-shadow,0 8px 24px rgba(0,0,0,.5));max-height:min(320px,45vh);overflow:auto;color:var(--h-text,#f1f5f9)}
.fp-list[hidden]{display:none}
.fp-opt{display:flex;gap:10px;align-items:center;min-height:var(--h-tap,44px);padding:6px 10px;border-radius:var(--h-r-sm,8px);cursor:pointer}
.fp-opt[aria-selected=true],.fp-opt:hover{background:var(--h-surface-3,#273449)}
.fp-opt img,.fp-opt .fp-ph{width:28px;height:42px;border-radius:4px;object-fit:cover;flex:none;background:var(--h-surface,#0f172a)}
.fp-opt b{font-weight:600}.fp-opt small{color:var(--h-text-3,#94a3b8);margin-left:auto;padding-left:8px}
.fp-dlg{width:min(720px,94vw);max-height:88vh;padding:0;border:1px solid var(--h-line-strong,#475569);border-radius:var(--h-r-lg,16px);background:var(--h-bg,#0b1120);color:var(--h-text,#f1f5f9)}
.fp-dlg::backdrop{background:rgba(2,6,23,.7)}
.fp-head{display:flex;align-items:center;gap:8px;padding:14px 16px 8px}.fp-head h2{margin:0;font-size:var(--h-size-lg,19px);flex:1}
.fp-x{min-width:var(--h-tap,44px);min-height:var(--h-tap,44px);background:none;border:0;color:inherit;font-size:20px;cursor:pointer}
.fp-search{margin:0 16px;width:calc(100% - 32px);box-sizing:border-box;min-height:var(--h-tap,44px);padding:0 12px;border-radius:var(--h-r-md,12px);
  border:1px solid var(--h-line-strong,#475569);background:var(--h-surface-2,#1e293b);color:inherit;font-size:16px}
.fp-kick{padding:10px 16px 4px;color:var(--h-text-3,#94a3b8);font-size:var(--h-size-sm,14px)}
.fp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:12px;padding:8px 16px 16px;overflow:auto;max-height:calc(88vh - 150px)}
.fp-card{display:flex;flex-direction:column;gap:4px;padding:0;border:0;background:none;color:inherit;text-align:left;cursor:pointer;font:inherit}
.fp-card:focus-visible{outline:2px solid var(--h-focus,#a5b4fc);outline-offset:3px;border-radius:8px}
.fp-art{aspect-ratio:2/3;border-radius:8px;background:var(--h-surface-2,#1e293b) center/cover no-repeat;display:grid;place-items:center;font-size:28px}
.fp-name{font-size:var(--h-size-sm,14px);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fp-year{font-size:var(--h-size-xs,12px);color:var(--h-text-3,#94a3b8)}.fp-empty{grid-column:1/-1;color:var(--h-text-3,#94a3b8);padding:24px 0;text-align:center}`;
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  const layerOf = (node) => (node && node.closest && node.closest('dialog[open]')) || document.body;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let seq = 0;

  function heraeTypeahead(input, fetchItems, { onPick } = {}) {
    const list = document.createElement('ul'); list.className = 'fp-list'; list.id = `fp-list-${++seq}`; list.setAttribute('role', 'listbox'); list.hidden = true;
    input.removeAttribute('list'); input.setAttribute('autocomplete', 'off'); input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false');
    let items = [], active = -1, timer = null, token = 0;
    const place = () => { const r = input.getBoundingClientRect(); list.style.left = `${r.left}px`; list.style.top = `${r.bottom + 4}px`; list.style.width = `${r.width}px`; };
    const close = () => { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
    const mark = () => { [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      if (active >= 0) { input.setAttribute('aria-activedescendant', list.children[active].id); list.children[active].scrollIntoView({ block: 'nearest' }); } };
    const pick = (i) => { const it = items[i]; if (!it) return; input.value = it[0]; close(); if (onPick) onPick(it[2] || null, it[0]); input.focus(); };
    const render = () => {
      list.innerHTML = '';
      items.forEach(([value, label, item], i) => {
        const li = document.createElement('li'); li.className = 'fp-opt'; li.id = `${list.id}-${i}`; li.setAttribute('role', 'option');
        li.innerHTML = `${item && 'posterUrl' in item ? (item.posterUrl ? `<img alt="" src="${esc(item.posterUrl)}">` : '<span class="fp-ph"></span>') : ''}<b>${esc(value)}</b>${label ? `<small>${esc(label)}</small>` : ''}`;
        // pointerdown, not click: on a phone the input's blur (which closes the list) would otherwise win the race.
        li.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(i); });
        list.append(li);
      });
      if (!items.length) return close();
      if (list.parentNode !== layerOf(input)) layerOf(input).append(list);
      place(); list.hidden = false; input.setAttribute('aria-expanded', 'true'); mark();
    };
    input.addEventListener('input', () => {
      clearTimeout(timer); const q = input.value.trim(); if (q.length < 2) { items = []; return close(); }
      const mine = ++token;
      timer = setTimeout(async () => { const got = await Promise.resolve(fetchItems(q)).catch(() => []); if (mine !== token || input.value.trim() !== q) return;
        items = (got || []).slice(0, 8); active = -1; render(); }, 180);
    });
    // Registered before the page's own Enter-to-add handlers (callers set this up first), so choosing a highlighted
    // suggestion with Enter fills the field instead of adding the half-typed text.
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % items.length; mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % items.length; mark(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopImmediatePropagation(); pick(active); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    window.addEventListener('resize', () => { if (!list.hidden) place(); });
    window.addEventListener('scroll', () => { if (!list.hidden) place(); }, true);
    return { close };
  }

  function heraeCatalogPick({ withUser = '', withName = '', title = 'Pick a film or series' } = {}) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog'); dlg.className = 'fp-dlg'; dlg.setAttribute('aria-label', title);
      dlg.innerHTML = `<div class="fp-head"><h2>🍿 ${esc(title)}</h2><button type="button" class="fp-x" aria-label="Close">✕</button></div>
        <input type="search" class="fp-search" placeholder="Search films and series…" autocomplete="off" aria-label="Search the catalogue">
        <div class="fp-kick"></div><div class="fp-grid" role="list"></div>`;
      // Its own modal: showModal() stacks it above an open dialog, and returns focus there on close.
      document.body.append(dlg);
      const grid = dlg.querySelector('.fp-grid'), kick = dlg.querySelector('.fp-kick'), search = dlg.querySelector('.fp-search');
      let chosen = null, token = 0, cursor = null, done = true, busy = false, timer = null;
      const finish = () => { if (dlg.open) dlg.close(); };
      dlg.addEventListener('close', () => { dlg.remove(); resolve(chosen); });
      dlg.querySelector('.fp-x').onclick = finish;
      dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(); });
      const card = (m) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'fp-card'; b.setAttribute('role', 'listitem');
        b.innerHTML = `<span class="fp-art"${m.posterUrl ? ` style="background-image:url('${esc(m.posterUrl)}')"` : ''}>${m.posterUrl ? '' : '🎬'}</span>
          <span class="fp-name">${esc(m.title)}</span>${m.releaseYear ? `<span class="fp-year">${esc(m.releaseYear)}</span>` : ''}`;
        b.onclick = () => { chosen = m; finish(); }; return b; };
      const page = async (fresh) => {
        const q = search.value.trim(); const mine = fresh ? ++token : token;
        if (fresh) { cursor = null; done = false; grid.innerHTML = '<div class="fp-empty">Loading…</div>';
          kick.textContent = q ? `Results for “${q}”` : withUser ? `Recommended for you & ${withName || withUser}` : 'Recommended for you'; }
        busy = true;
        try {
          const r = await window.getRecommendations(cursor, q || undefined, withUser || undefined);
          if (mine !== token) return;
          if (fresh) grid.innerHTML = '';
          (r.recommendations || []).forEach((m) => grid.append(card(m)));
          cursor = r.nextCursor ?? null; done = r.nextCursor == null;
          if (!grid.children.length) grid.innerHTML = '<div class="fp-empty">Nothing matches that. You can still type any title in the suggestion.</div>';
        } catch (e) { if (mine === token) { done = true; if (fresh) grid.innerHTML = `<div class="fp-empty">${esc(e.message || 'Could not load the catalogue.')}</div>`; } }
        finally { busy = false; }
      };
      grid.addEventListener('scroll', () => { if (!done && !busy && grid.scrollTop + grid.clientHeight > grid.scrollHeight - 300) page(false); });
      search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => page(true), 220); });
      dlg.showModal(); page(true); setTimeout(() => search.focus(), 30);
    });
  }

  window.heraeTypeahead = heraeTypeahead;
  window.heraeCatalogPick = heraeCatalogPick;
})();
