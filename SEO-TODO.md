# Outstanding SEO / share work

## ✅ Done — OG image

`/og-image.png` (1200×630) now exists and all 31 pages declare
`twitter:card = summary_large_image`.

**To regenerate after a copy change**, edit `og-image-source.html` and run:

```bash
google-chrome --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --screenshot=og-image.png --window-size=1200,630 og-image-source.html
```

The source is plain HTML/CSS using the same tokens as `landing.css`, so the card and
the site stay one visual system. Keep the headline to two lines — the font wraps to
three above ~70px and the layout collides with the footer.

## 1. post.html needs server-rendered OG tags ⚠

`post.html` is a client-rendered shell. The static tags on it are a generic fallback —
scrapers do not execute JavaScript, so a *specific* shared memory still previews as the
generic card rather than as that couple's moment.

Server-render `og:title` and `og:image` per moment id (Operating Manual L10). Roughly a
day of work, and the single highest-leverage viral fix available: a share that previews
the actual memory is a fundamentally different object from one that previews a logo.

## 2. Verification after deploy

- Google Search Console → submit `https://herae.app/sitemap.xml`
- Rich Results Test → https://search.google.com/test/rich-results
- Facebook Sharing Debugger → https://developers.facebook.com/tools/debug/
- LinkedIn Post Inspector → https://www.linkedin.com/post-inspector/

Facebook and LinkedIn cache aggressively. After any image change, re-scrape in those
tools or the old preview persists for days.
