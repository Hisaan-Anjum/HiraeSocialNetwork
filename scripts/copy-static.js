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
  // Legal & policy pages — self-contained static pages sharing legal.css.
  // They reference each other and the rest of the site by plain relative
  // links, so they're copied through verbatim rather than Vite-processed.
  'privacy.html',
  'terms.html',
  'cookies.html',
  'community.html',
  'dmca.html',
  'takedown.html',
  'account-deletion.html',
  'contact.html',
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
