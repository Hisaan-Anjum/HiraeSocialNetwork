// config.js — edit this for your deployment. The login page pre-fills the
// server address from here; whoever logs in can still type a different one
// (same idea as the extension's own "server address" field), which is then
// remembered per-browser for next time.
//
// In the production deployment this value is essentially never used: the site
// is served BY the API server, behind the same CloudFront distribution, so
// api.js resolves the server address from the page's own origin and only falls
// back to this when the site is opened from somewhere else entirely (file://,
// a separate static host). It's kept accurate anyway so that fallback lands
// somewhere real rather than on a developer's laptop.
//
// TO DEPLOY: replace with your CloudFront domain, e.g. 'https://app.herae.com'.
window.MOMENTS_CONFIG = {
  defaultServerUrl: 'https://app.herae.app',
};
