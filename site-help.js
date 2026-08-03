// site-help.js — the memories site's guides.
//
// Renders the SAME articles the extension's Help Centre does (window.HERAE_HELP,
// from the shared help-content.js). Deliberately a second renderer rather than
// a second copy of the writing: the two surfaces have different chrome and
// different widths, but a wording fix must land on both, and the only way to
// guarantee that is for there to be one source of prose.
//
// Kept plain and dependency-free so it can be copied verbatim by
// scripts/copy-static.js alongside the content it renders.
(function () {
  'use strict';

  const TOPICS = Array.isArray(window.HERAE_HELP) ? window.HERAE_HELP : [];
  // The onboarding above is inline and always renders. If the shared articles
  // did not make it into the build, say so plainly rather than showing an
  // empty index that reads like a broken page.
  if (!TOPICS.length) {
    const nav = document.getElementById('shNav');
    const art = document.getElementById('shArticle');
    if (nav) nav.remove();
    if (art) {
      art.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'sh-empty';
      p.textContent = 'The detailed guides are not available right now. The steps above cover getting started, and the extension\u2019s own Help Centre has the full set.';
      art.appendChild(p);
    }
    return;
  }
  const navEl = document.getElementById('shNav');
  const articleEl = document.getElementById('shArticle');
  const searchEl = document.getElementById('shSearch');
  const emptyEl = document.getElementById('shEmpty');
  if (!navEl || !articleEl) return;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ── Search ────────────────────────────────────────────────────────
  // Scored rather than filtered: a word in the title should beat the same
  // word buried in a troubleshooting answer, or the list reads as noise.
  function score(topic, q) {
    if (!q) return 1;
    const terms = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    if (!terms.length) return 1;
    const hay = [
      topic.title, topic.group, topic.purpose,
      ...(topic.keywords || []),
      ...(topic.how || []), ...(topic.tips || []), ...(topic.best || []),
      ...(topic.issues || []).flat(),
      ...(topic.steps || []).flatMap((s) => [s.title, s.body]),
    ].join(' ').toLowerCase();

    let s = 0;
    for (const t of terms) {
      if (!hay.includes(t)) return 0;              // every term must appear
      if (topic.title.toLowerCase().includes(t)) s += 40;
      if ((topic.keywords || []).some((k) => k.includes(t))) s += 25;
      if (topic.group.toLowerCase().includes(t)) s += 15;
      s += 5;
    }
    return s;
  }

  function renderNav(q) {
    navEl.innerHTML = '';
    const results = TOPICS
      .map((t) => ({ t, s: score(t, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s);

    if (!results.length) {
      emptyEl.hidden = false;
      articleEl.innerHTML = '';
      return [];
    }
    emptyEl.hidden = true;

    // Grouped while browsing; ranked while searching, where category order
    // would scatter the best matches. Collected by group rather than emitting
    // a heading whenever it changes, so the order articles happen to sit in
    // cannot produce the same heading twice.
    if (!q) {
      const byGroup = new Map();
      for (const { t } of results) {
        if (!byGroup.has(t.group)) byGroup.set(t.group, []);
        byGroup.get(t.group).push(t);
      }
      for (const [group, list] of byGroup) {
        navEl.appendChild(el('div', 'sh-group', group));
        list.forEach((t) => navEl.appendChild(button(t)));
      }
    } else {
      results.forEach(({ t }) => navEl.appendChild(button(t)));
    }
    return results.map((r) => r.t);
  }

  function button(t) {
    const b = el('button', 'sh-nav-item');
    b.type = 'button';
    b.dataset.id = t.id;
    b.appendChild(el('span', 'sh-nav-icon', t.icon || '•'));
    b.appendChild(el('span', 'sh-nav-label', t.title));
    b.addEventListener('click', () => select(t.id, { push: true }));
    return b;
  }

  // ── Article ───────────────────────────────────────────────────────
  function list(items, tag) {
    const l = el(tag, 'sh-list');
    items.forEach((i) => l.appendChild(el('li', null, i)));
    return l;
  }

  function section(title, cls, body) {
    const s = el('section', cls);
    s.appendChild(el('h2', 'sh-h2', title));
    s.appendChild(body);
    return s;
  }

  function render(t) {
    articleEl.innerHTML = '';
    articleEl.appendChild(el('div', 'sh-eyebrow', t.group));
    articleEl.appendChild(el('h1', 'sh-title', `${t.icon || ''} ${t.title}`.trim()));
    articleEl.appendChild(el('p', 'sh-purpose', t.purpose));

    if (t.how?.length) articleEl.appendChild(section('How it works', 'sh-sec', list(t.how, 'ol')));

    if (t.steps?.length) {
      const ol = el('ol', 'sh-walk');
      t.steps.forEach((st) => {
        const li = document.createElement('li');
        li.appendChild(el('strong', 'sh-walk-title', st.title));
        li.appendChild(el('span', 'sh-walk-body', st.body));
        ol.appendChild(li);
      });
      articleEl.appendChild(section('Step by step', 'sh-sec', ol));
    }

    if (t.issues?.length) {
      const wrap = el('div', 'sh-issues');
      t.issues.forEach(([q, a]) => {
        const d = el('details', 'sh-issue');
        d.appendChild(el('summary', null, q));
        d.appendChild(el('p', null, a));
        wrap.appendChild(d);
      });
      articleEl.appendChild(section('Common issues', 'sh-sec', wrap));
    }

    if (t.tips?.length) articleEl.appendChild(section('Tips', 'sh-sec', list(t.tips, 'ul')));
    if (t.best?.length) articleEl.appendChild(section('Best practices', 'sh-sec', list(t.best, 'ul')));

    for (const b of navEl.querySelectorAll('.sh-nav-item')) {
      b.classList.toggle('is-active', b.dataset.id === t.id);
    }
    articleEl.focus({ preventScroll: true });
  }

  function select(id, { push = false } = {}) {
    const t = TOPICS.find((x) => x.id === id) || TOPICS[0];
    if (!t) return;
    render(t);
    // Deep-linkable, so the extension's contextual (?) buttons and any link
    // you send someone land on the article rather than the index.
    if (push && location.hash.slice(1) !== t.id) history.pushState(null, '', `#${t.id}`);
  }

  searchEl?.addEventListener('input', () => {
    const q = searchEl.value.trim().toLowerCase();
    const shown = renderNav(q);
    if (q && shown.length) render(shown[0]);
  });

  window.addEventListener('hashchange', () => select(location.hash.slice(1)));

  renderNav('');
  select(location.hash.slice(1) || (TOPICS[0] && TOPICS[0].id));
})();
