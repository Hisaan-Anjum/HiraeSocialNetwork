#!/usr/bin/env node
// scripts/copy-static.js — runs after `vite build` (see package.json's
// "build" script). Copies every file Vite deliberately doesn't process
// (see vite.config.js's comment) straight into dist/, unchanged.
//
// Why these specific files aren't Vite entries:
//   - index.html, landing.css   — the landing page, owned by a teammate
//                                  redesigning it in parallel; copied
//                                  byte-for-byte so this build can never
//                                  clobber or reformat their work.
//   - admin.html, admin.js,
//     admin.css                 — the recommendations admin panel, a
//                                  separate already-working surface, not
//                                  part of this redesign's scope.
//   - config.js, api.js         — the shared auth/fetch helpers. Every page
//                                  (old and new) loads these as a classic
//                                  global <script>, not an ES module, so
//                                  there's exactly one copy of the auth
//                                  model everywhere, verbatim.
//   - index.js                  — index.html's own tiny redirect-if-
//                                  logged-in script.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const FILES = [
  // Crawler-facing files. Neither is referenced by any page, so nothing in the
  // build graph pulls them in — they have to be listed here explicitly or they
  // simply do not exist in production, which is exactly what happened: the
  // sitemap was written, committed, and 404ing at herae.app/sitemap.xml.
  'robots.txt',
  'sitemap.xml',
  // The social share card. Same reason: referenced only from <meta> tags,
  // which Vite does not follow.
  'og-image.png',
  'og-image-source.html',
  'index.html',
  'index.js',
  'landing.css',
  'admin.html',
  'admin.js',
  'admin.css',
  // The admin analytics dashboard — a self-contained page (inline styles + a
  // classic script hitting GET /api/admin/analytics), admin-gated server-side.
  'analytics.html',
  'config.js',
  'api.js',
  // Show/hide password eye toggle — a classic global <script> loaded by every
  // auth page (login/signup/reset), same passthrough treatment as config.js.
  'pw-toggle.js',
  // "Continue with Google" — a classic global <script> for the same reason
  // pw-toggle.js is: login.html is Vite-processed but signup.html is copied
  // verbatim, and one global keeps both on one implementation.
  'google-signin.js',
  // Auth flows that live outside login: password reset (request + set) and
  // email confirmation. Plain self-contained pages (their own inline scripts,
  // no bundled module) so they work whether the site is served by the Node
  // server in production or Vite's dev server locally — copied through verbatim
  // like the other passthrough pages above.
  'forgot.html',
  'reset.html',
  'verify.html',
  // Standalone signup page for Herae Moments — a plain self-contained page
  // (its own inline module-less script hitting /api/signup), copied verbatim
  // like the other auth pages so it works under both the Node server and Vite.
  'signup.html',
  // The page behind /invite/<CODE>. Served by an express route (there is no such
  // file at that path), and self-contained like the other auth-adjacent pages so
  // it works under both the Node server and Vite.
  'invite.html',
  // Legal & policy pages — self-contained static pages sharing legal.css.
  // They reference each other and the rest of the site by plain relative
  // links, so they're copied through verbatim rather than Vite-processed.
  'privacy.html',
  'terms.html',
  'cookies.html',
  'community.html',
  // The guides page and its renderer. help-content.js is NOT listed here —
  // it lives in the extension and is copied in by the step below, so the
  // site and the Help Centre cannot drift apart.
  'help.html',
  'site-help.js',
  'site-help.css',
  'dmca.html',
  'takedown.html',
  'account-deletion.html',
  'contact.html',
  // Subscription pages — self-contained, load Paddle.js from its CDN and the
  // shared config.js/api.js helpers, copied verbatim like the other app pages.
  'upgrade.html',
  'billing.html',
  'claim.html',
  'pricing.html',
  'refund_policy.html',
  'legal.css',
  // Also copied unhashed to dist root so index.html/admin.html's plain
  // <link href="style.css"> keeps resolving — the Vite-processed pages
  // additionally get their own hashed copy automatically as a build asset.
  'style.css',
  // The Herae mark — the extension's own icon, so the site and the
  // extension are visibly one product. Referenced by a plain, unhashed
  // <img src="logo.png"> from every page's brand lockup (including the
  // ones Vite doesn't process, like index.html), so it's copied through
  // verbatim rather than hashed as a build asset.
  'logo.png',
];

if (!fs.existsSync(DIST)) {
  console.error(`error: ${DIST} does not exist — run "vite build" first.`);
  process.exit(1);
}

for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) {
    console.warn(`warning: ${f} not found — skipping.`);
    continue;
  }
  fs.copyFileSync(src, path.join(DIST, f));
}

console.log(`Copied ${FILES.length} static passthrough file(s) into dist/.`);

// ── The shared Help articles ──────────────────────────────────────────
// help-content.js belongs to the EXTENSION. The site renders the same
// articles with its own chrome (site-help.js), so the prose has exactly one
// home and a wording fix lands on both surfaces at once. Two copies of this
// text would drift within a week, and the drift would be invisible until
// somebody happened to read both.
//
// Located relative to this repo rather than assumed: the site builds both as
// a submodule of the extension repo and standalone in CI, and the parent is
// not always there.
{
  const candidates = [
    path.join(ROOT, '..', 'help-content.js'),   // built inside the extension repo
    path.join(ROOT, 'help-content.js'),         // vendored copy, if one was placed
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) {
    fs.copyFileSync(found, path.join(DIST, 'help-content.js'));
    console.log('Copied the shared Help articles from ' + path.relative(ROOT, found) + '.');
  } else {
    // Not fatal: the site still builds and every other page works. The guides
    // page renders its onboarding and reports that the articles are missing,
    // which is a far better failure than a silently empty index.
    console.warn('warning: help-content.js not found — help.html will have no articles.');
  }
}
