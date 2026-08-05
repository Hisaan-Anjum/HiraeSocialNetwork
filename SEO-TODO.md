# Outstanding SEO / share work

## 1. OG image — the only blocking item ⚠

`og:image` currently points at `logo.png` (128×128). That is **below the 200×200
minimum** for a large share card, so every page declares `twitter:card = summary`
(the small card) rather than `summary_large_image`.

**Make one image and this upgrades every page at once:**

- **1200 × 630 px**, PNG or JPG, under 1 MB
- Save as `/og-image.png` at the site root
- Content: the headline *"Watch movies together — however far apart you are"*,
  the logo, and `herae.app`. Legible at ~500 px wide, which is how feeds render it.

Then run:

```bash
cd moments-site
sed -i 's|https://herae.app/logo.png|https://herae.app/og-image.png|g' *.html
sed -i 's|content="summary"|content="summary_large_image"|g' *.html
```

Share previews are the most-travelled surface in any viral loop. Until this exists,
every link shared to WhatsApp, iMessage, Discord and Instagram renders as a small
grey box.

## 2. post.html needs server-rendered OG tags

`post.html` is a client-rendered shell. The static tags added today are a generic
fallback — scrapers do not execute JavaScript, so a *specific* shared memory still
previews generically. Server-render `og:title` / `og:image` per moment id
(Operating Manual L10). Roughly one day of work; the single highest-leverage viral fix.

## 3. Verification after deploy

- Google Search Console: submit `https://herae.app/sitemap.xml`
- Rich Results Test: https://search.google.com/test/rich-results
- Facebook Sharing Debugger + LinkedIn Post Inspector — both cache aggressively;
  re-scrape after changing the image.
