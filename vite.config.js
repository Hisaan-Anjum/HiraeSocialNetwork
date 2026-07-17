import { resolve } from 'path';
import { defineConfig } from 'vite';

const __dirname = import.meta.dirname;

// Plain Vite + vanilla ES module JS (no framework) — see the summary at the
// end of the redesign task for why: this site is a handful of pages with
// small, focused interactivity (a feed, a couple of detail views), not an
// app with heavy client state/routing, so React's runtime + JSX toolchain
// would be pure overhead here. Small reusable render functions
// (src/components/*.js, returning HTML strings or DOM nodes) give the same
// componentization benefit at near-zero bundle cost.
//
// index.html, landing.css, admin.html, admin.js, admin.css, config.js and
// api.js are DELIBERATELY left out of rollupOptions.input below — they're
// either owned by someone else right now (index.html/landing.css, being
// redesigned in parallel) or already-working plain scripts that every page
// (including the ones Vite doesn't process) loads via a classic <script>
// tag. scripts/copy-static.js copies all of those into dist/ verbatim after
// the Rollup build below runs, untouched byte-for-byte. See that script's
// own comment for the full list and reasoning.
export default defineConfig({
  root: '.',
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        login: resolve(__dirname, 'login.html'),
        contacts: resolve(__dirname, 'contacts.html'),
        // user.html replaced the old contact.html: a "contact's memories"
        // page and a "user profile" page were the same page (same feed, same
        // grouping, same handlers) with a different heading, so there's one.
        user: resolve(__dirname, 'user.html'),
        memories: resolve(__dirname, 'memories.html'),
        post: resolve(__dirname, 'post.html'),
        session: resolve(__dirname, 'session.html'),
        search: resolve(__dirname, 'search.html'),
        review: resolve(__dirname, 'review.html'),
        movie: resolve(__dirname, 'movie.html'),
      },
    },
  },
  server: {
    port: 5173,
    // Lets the dev server proxy API calls straight to the real backend so
    // `npm run dev` works against real data without CORS gymnastics — the
    // production setup (server/src/index.js serving this site itself) has
    // no such need since it's all one origin there.
    proxy: {
      '/api': 'http://localhost:8080',
      '/media': 'http://localhost:8080',
    },
  },
});
