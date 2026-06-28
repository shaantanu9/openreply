# Marketing RSS — Live URL Validation + Catalog Pruning

**Date:** 2026-04-28
**Type:** Fix

## Summary

Validated all 24 newly-added RSS feed URLs across the `marketing`, `persuasion`,
and `swipe` categories. 9 were broken (404/500/wrong-URL), 3 were bot-protected
but real, 3 sites no longer publish public feeds. Pruned dead entries and
swapped in correct URLs where alternatives exist. Catalog now reports 15 live
sources (12 cleanly verifiable + 3 retained with bot-protection caveats).

## Changes

- Pruned 9 dead/non-existent feed URLs:
  - `marketing`: Marketing Examples, Reforge Blog, Indie Hackers Marketing, Really Good Emails, Animalz, Content Marketing Institute, First Round Review (no usable feed found — only `/glossary/rss/` works and is too narrow)
  - `swipe`: AdAge Creativity, Ads of the World
- Corrected URLs:
  - `Demand Curve` → `https://www.demandcurve.com/blog/rss.xml`
  - `Stacked Marketer` → `https://www.stackedmarketer.com/feed/`
  - `Choice Hacking` → `https://choicehacking.substack.com/feed`
- Retained with caveat (bot-protected on bare urllib, expected to work in production via httpx + Retry-After):
  - CXL, CXL Institute (403 to Mozilla UA)
  - Growth.Design (429 throttled)
- Added inline comments noting verification date + caveats next to each retained entry.

## Files Modified

- `src/reddit_research/sources/rss_catalog.py` — pruned dead entries from `marketing`, `persuasion`, `swipe`; corrected 3 URLs; added validation comments.

## Final per-category counts

| Category   | Before | After | Verified live |
|------------|-------:|------:|--------------:|
| marketing  | 15     | 8     | 6 (+2 bot-protected: CXL, CXL Institute) |
| persuasion | 6      | 6     | 5 (+1 throttled: Growth.Design) |
| swipe      | 3      | 1     | 1 |

## Sites that no longer publish public RSS (route via OpenCLI / scrape later)

- Marketing Examples (marketingexamples.com)
- Reforge (reforge.com/blog)
- Really Good Emails (reallygoodemails.com)
- Animalz (animalz.co/blog)
- AdAge Creativity (adage.com)
- Ads of the World (adsoftheworld.com)
- First Round Review (review.firstround.com — only `/glossary/rss/` exists)
- Indie Hackers tag-feeds (only main `feed.xml` works, already covered in `products` category)

These belong in a future `oc_marketing_*` adapter or a Playwright-based
scrape worker — out of scope for this changelog.

## Validation

```bash
# Re-run the live check after any catalog edit:
python3 - <<'PY'
import importlib.util, urllib.request, urllib.error, ssl, socket
spec = importlib.util.spec_from_file_location('rc', 'src/reddit_research/sources/rss_catalog.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
socket.setdefaulttimeout(8)
for cat in ['marketing','persuasion','swipe']:
    for n,u in m.CATALOG[cat]:
        try:
            req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0 Chrome/126'})
            r=urllib.request.urlopen(req,context=ctx,timeout=8)
            print(f"OK   [{cat:11}] {n}")
        except urllib.error.HTTPError as e:
            print(f"{e.code}  [{cat:11}] {n}")
        except Exception as e:
            print(f"ERR  [{cat:11}] {n} :: {type(e).__name__}")
PY
```

Latest run: **12/15 OK**, 3 expected non-200s (CXL ×2 → 403, Growth.Design → 429).
