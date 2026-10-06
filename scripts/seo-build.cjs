// scripts/seo-build.cjs — runs after copy-static (package.json "build"). The site's one metadata/schema system
// (docs/HERAE_GEO_IMPLEMENTATION_LOG.md):
//   1. the Herae entity graph (Organization, WebSite, SoftwareApplication) on the homepage, generated from seo/facts.json
//      with stable @ids, replacing the hand-written copies so the facts can't drift;
//   2. a WebPage + BreadcrumbList block on every public page, tied to that graph by @id, dated from git;
//   3. noindex on every page that is not on the public list (app screens, account pages, the ad landing);
//   4. sitemap.xml (public pages only, lastmod from git) and llms.txt (from facts.json);
//   5. checks — every public page needs a title, a meta description, a self canonical and exactly one <h1>, and every
//      JSON-LD block must parse. Any failure fails the build: nothing ships with broken metadata.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const facts = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo', 'facts.json'), 'utf8'));
const BASE = 'https://herae.app';

// Pages that should be found in search. Everything else in dist/ gets noindex. Order = sitemap order.
const PUBLIC = [
  ['index.html', null],
  ['watch-movies-together-long-distance.html', 'Guides'],
  ['watch-any-website-together.html', 'Guides'],
  ['teleparty-alternative.html', 'Guides'],
  ['best-apps-for-long-distance-couples.html', 'Guides'],
  ['discord-netflix-black-screen.html', 'Guides'],
  ['watch-prime-video-together.html', 'Guides'],
  ['watch-disney-plus-together.html', 'Guides'],
  ['long-distance-movie-night-ideas.html', 'Guides'],
  ['movies-to-watch-long-distance.html', 'Guides'],
  ['things-to-do-on-facetime-long-distance.html', 'Guides'],
  ['long-distance-relationship-gifts.html', 'Guides'],
  ['about.html', null],
  ['pricing.html', null],
  ['gift.html', null],
  ['help.html', null],
  ['contact.html', null],
  ['community.html', 'Policies'],
  ['privacy.html', 'Policies'],
  ['terms.html', 'Policies'],
  ['program-terms.html', 'Policies'],
  ['cookies.html', 'Policies'],
  ['refund_policy.html', 'Policies'],
  ['dmca.html', 'Policies'],
  ['takedown.html', 'Policies'],
];

const ORG = `${BASE}/#organization`;
const SITE = `${BASE}/#website`;
const APP = `${BASE}/#software`;
const url = (file) => (file === 'index.html' ? `${BASE}/` : `${BASE}/${file}`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Last-modified dates come from git. The production image is built in Docker without .git, so local builds (which
// always run before a commit) save the dates to seo/dates.json and the Docker build reads them from there.
const DATES_FILE = path.join(ROOT, 'seo', 'dates.json');
let savedDates = {}; try { savedDates = JSON.parse(fs.readFileSync(DATES_FILE, 'utf8')); } catch (e) { /* none yet */ }
let gitWorks = true;
const freshDates = {};
function gitDate(file) {
  if (gitWorks) {
    try {
      const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (out) { freshDates[file] = out; return out; }
      // Uncommitted new file: today.
      if (fs.existsSync(path.join(ROOT, file))) { const d = new Date().toISOString(); freshDates[file] = savedDates[file] || d; return freshDates[file]; }
    } catch (e) { gitWorks = false; }
  }
  return savedDates[file] || null;
}

function entityGraph() {
  const offer = (p) => ({
    '@type': 'Offer', name: p.name, price: p.price, priceCurrency: p.currency, url: `${BASE}/pricing.html`,
    priceSpecification: { '@type': 'UnitPriceSpecification', price: p.price, priceCurrency: p.currency, billingDuration: 'P1M', unitText: 'MONTH' },
    description: p.what,
  });
  return [
    {
      '@type': 'Organization', '@id': ORG, name: facts.name, url: facts.url,
      logo: { '@type': 'ImageObject', url: facts.logo }, image: facts.image,
      description: facts.oneLiner, email: facts.support,
      sameAs: facts.sameAs.filter((u) => !u.includes('chromewebstore')),
      contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: facts.support },
    },
    {
      '@type': 'WebSite', '@id': SITE, url: facts.url, name: facts.name, description: facts.short,
      publisher: { '@id': ORG }, inLanguage: 'en',
    },
    {
      '@type': 'SoftwareApplication', '@id': APP, name: facts.name, url: facts.url,
      applicationCategory: 'MultimediaApplication', applicationSubCategory: facts.category,
      operatingSystem: 'Windows, macOS, Linux, ChromeOS', browserRequirements: 'Requires Google Chrome on a desktop or laptop computer',
      description: facts.long, featureList: facts.features, audience: { '@type': 'Audience', audienceType: facts.audience },
      installUrl: facts.chromeWebStore, downloadUrl: facts.chromeWebStore, image: facts.image, screenshot: facts.image,
      publisher: { '@id': ORG }, sameAs: [facts.chromeWebStore],
      offers: [
        { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD', url: `${BASE}/pricing.html`, description: facts.pricing.free },
        offer(facts.pricing.plus), offer(facts.pricing.together),
      ],
    },
  ];
}

const errors = [];
const LD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const MARK_RE = /\n?<!-- seo-build:start -->[\s\S]*?<!-- seo-build:end -->/g;

for (const [file, section] of PUBLIC) {
  const p = path.join(DIST, file);
  if (!fs.existsSync(p)) { errors.push(`${file}: listed as public but not in dist/`); continue; }
  let html = fs.readFileSync(p, 'utf8').replace(MARK_RE, '');
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  const canon = (html.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (!title) errors.push(`${file}: no <title>`);
  if (!desc) errors.push(`${file}: no meta description`);
  if (canon !== url(file)) errors.push(`${file}: canonical is ${canon || 'missing'}, expected ${url(file)}`);
  if (h1 !== 1) errors.push(`${file}: ${h1} <h1> elements (need exactly 1)`);
  if (/<meta name="robots" content="[^"]*noindex/.test(html)) errors.push(`${file}: public page is noindex`);

  if (file === 'index.html') {
    // Replace the hand-written entity nodes with the generated ones; keep everything else (the FAQ).
    html = html.replace(LD_RE, (m, body) => {
      let d; try { d = JSON.parse(body); } catch (e) { return m; }
      if (!d['@graph']) return m;
      const keep = d['@graph'].filter((n) => !['Organization', 'WebSite', 'SoftwareApplication'].includes(n['@type']));
      d['@graph'] = [...entityGraph(), ...keep];
      return `<script type="application/ld+json">${JSON.stringify(d)}</script>`;
    });
  } else {
    const modified = gitDate(file);
    const page = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage', '@id': `${url(file)}#webpage`, url: url(file), name: title ? title.trim() : file,
          description: desc || undefined, isPartOf: { '@id': SITE }, about: { '@id': APP }, publisher: { '@id': ORG },
          inLanguage: 'en', ...(modified ? { dateModified: modified } : {}),
        },
        {
          '@type': 'BreadcrumbList', '@id': `${url(file)}#breadcrumb`,
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Herae', item: `${BASE}/` },
            ...(section ? [{ '@type': 'ListItem', position: 2, name: section }] : []),
            { '@type': 'ListItem', position: section ? 3 : 2, name: title ? title.replace(/\s+[—|–-]\s+Herae\s*$/, '').trim() : file, item: url(file) },
          ],
        },
      ],
    };
    html = html.replace('</head>', `<!-- seo-build:start -->\n<script type="application/ld+json">${JSON.stringify(page)}</script>\n<!-- seo-build:end -->\n</head>`);
  }
  // Every JSON-LD block on the page must parse.
  for (const m of html.matchAll(LD_RE)) { try { JSON.parse(m[1]); } catch (e) { errors.push(`${file}: JSON-LD does not parse (${e.message})`); } }
  fs.writeFileSync(p, html);
}

// help.html: the 25 Help Center articles are rendered by site-help.js in the browser, so crawlers that don't run
// JavaScript (most AI crawlers) saw 123 words. Write the same articles into the empty article element as plain HTML;
// site-help.js clears that element on load and shows the interactive version, so people see no difference.
(function prerenderHelp() {
  const helpFile = path.join(DIST, 'help.html');
  const dataFile = path.join(DIST, 'help-content.js'); // copy-static put it there (extension repo or vendored copy)
  if (!fs.existsSync(helpFile)) return;
  if (!fs.existsSync(dataFile)) { errors.push('help.html: dist/help-content.js missing, cannot pre-render the articles'); return; }
  const sandbox = { self: {} };
  new Function('self', fs.readFileSync(dataFile, 'utf8'))(sandbox.self);
  const topics = sandbox.self.HERAE_HELP || [];
  const h = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parts = [];
  for (const t of topics) {
    parts.push(`<section id="${h(t.id)}"><h2>${h(t.title)}</h2>`);
    if (t.purpose) parts.push(`<p>${h(t.purpose)}</p>`);
    if (Array.isArray(t.steps) && t.steps.length) parts.push('<ol>' + t.steps.map((x) => `<li><b>${h(x.title)}.</b> ${h(x.body)}</li>`).join('') + '</ol>');
    if (Array.isArray(t.how) && t.how.length) parts.push('<h3>How it works</h3><ul>' + t.how.map((x) => `<li>${h(x)}</li>`).join('') + '</ul>');
    if (Array.isArray(t.issues) && t.issues.length) parts.push('<h3>If something is off</h3><ul>' + t.issues.map((x) => `<li><b>${h(x[0])}.</b> ${h(x[1])}</li>`).join('') + '</ul>');
    if (Array.isArray(t.tips) && t.tips.length) parts.push('<h3>Tips</h3><ul>' + t.tips.map((x) => `<li>${h(x)}</li>`).join('') + '</ul>');
    if (Array.isArray(t.best) && t.best.length) parts.push('<h3>Best practice</h3><ul>' + t.best.map((x) => `<li>${h(x)}</li>`).join('') + '</ul>');
    parts.push('</section>');
  }
  let html = fs.readFileSync(helpFile, 'utf8');
  const empty = '<article id="shArticle" class="sh-article" tabindex="-1"></article>';
  if (!html.includes(empty)) { errors.push('help.html: article element changed — update the pre-render in seo-build.cjs'); return; }
  html = html.replace(empty, `<article id="shArticle" class="sh-article" tabindex="-1">${parts.join('\n')}</article>`);
  fs.writeFileSync(helpFile, html);
  console.log(`seo-build: help.html pre-rendered (${topics.length} articles)`);
})();

// noindex everything that isn't public.
const publicSet = new Set(PUBLIC.map(([f]) => f));
let noindexed = 0;
for (const f of fs.readdirSync(DIST).filter((x) => x.endsWith('.html'))) {
  if (publicSet.has(f)) continue;
  const p = path.join(DIST, f);
  let html = fs.readFileSync(p, 'utf8');
  if (/<meta name="robots"/.test(html)) {
    html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, follow">');
  } else {
    html = html.replace(/<head>/i, '<head>\n<meta name="robots" content="noindex, follow">');
  }
  fs.writeFileSync(p, html); noindexed++;
}

// sitemap.xml
const sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
for (const [file] of PUBLIC) {
  if (!fs.existsSync(path.join(DIST, file))) continue;
  const d = gitDate(file);
  sm.push(`  <url><loc>${url(file)}</loc>${d ? `<lastmod>${d.slice(0, 10)}</lastmod>` : ''}</url>`);
}
sm.push('</urlset>', '');
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sm.join('\n'));

// llms.txt — a plain summary for language-model tools. Not a ranking mechanism (see docs/AI_SEARCH_RESEARCH.md).
const titleOf = (file) => { const h = fs.readFileSync(path.join(DIST, file), 'utf8'); return ((h.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || file).trim(); };
const descOf = (file) => { const h = fs.readFileSync(path.join(DIST, file), 'utf8'); return (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || ''; };
const lines = [
  `# ${facts.name}`, '', `> ${facts.oneLiner}`, '', facts.long, '',
  '## Facts', '',
  `- Category: ${facts.category}`, `- Platforms: ${facts.platforms}`, `- Audience: ${facts.audience}`,
  `- Pricing: ${facts.pricing.free}. ${facts.pricing.plus.name} $${facts.pricing.plus.price}/${facts.pricing.plus.period} (${facts.pricing.plus.what}). ${facts.pricing.together.name} $${facts.pricing.together.price}/${facts.pricing.together.period} (${facts.pricing.together.what}).`,
  ...facts.limitations.map((l) => `- Limitation: ${l}`),
  `- Privacy: ${facts.privacy}`, `- Install: ${facts.chromeWebStore}`, `- Support: ${facts.support}`, '',
  '## Pages', '',
  ...PUBLIC.filter(([f, s]) => s !== 'Policies' && fs.existsSync(path.join(DIST, f))).map(([f]) => `- [${esc(titleOf(f)).replace(/&lt;/g, '<')}](${url(f)}): ${descOf(f)}`),
  '', '## Official profiles', '', ...facts.sameAs.map((u) => `- ${u}`), '',
];
fs.writeFileSync(path.join(DIST, 'llms.txt'), lines.join('\n'));

if (gitWorks && Object.keys(freshDates).length) fs.writeFileSync(DATES_FILE, JSON.stringify(freshDates, null, 1) + '\n');

if (errors.length) {
  console.error('seo-build: FAILED\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log(`seo-build: ${PUBLIC.length} public pages checked + schema, ${noindexed} pages noindex, sitemap.xml and llms.txt written.`);
