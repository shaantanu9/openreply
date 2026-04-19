# Gap Map viewer theme matched to app shell

**Date:** 2026-04-19
**Type:** UI Enhancement

## Summary

The Gap Map visualizer (the HTML/D3 graph loaded in the Map tab's iframe) shipped with its own dark navy color scheme — cards, badges, graph background, node strokes and label fills were all tuned for `#0b0e13` bg with `#e6edf3` text. The rest of the app uses the soft-dashboard cream/orange theme (`#F6F3EE` bg, `#1A1614` ink, `#FF8C42` accent), so the iframe visually clashed with everything around it. Swapped the viewer's palette to match the app shell so Map blends with the sidebar, tabs, and topbar instead of punching a dark hole through them.

## Changes

### `src/reddit_research/graph/export.py`

**CSS `:root` tokens swapped** to the app's design-token values:
- `--bg: #0b0e13` → `#F6F3EE`
- `--panel: #141921` → `#FFFFFF`
- `--border: #2a3340` → `#ECE6DC`
- `--text: #e6edf3` → `#1A1614`
- `--muted: #8b949e` → `#8A8278`
- `--accent: #58a6ff` → `#FF8C42`
- `--chronic/--emerging/--fading` mapped to the app's chronic/emerging/fading tokens

**Badge palettes rebuilt** for cream-bg readability. Severity and saturation badges used dark `#3d1216` / `#3d2a12` / `#1a3512` backgrounds with bright text — unreadable on cream. Flipped to pastel `soft` backgrounds with dark text:
- `severity-high`: rose-soft bg + deep rose text
- `severity-medium`: gold-soft + deep gold
- `severity-low`: mint-soft + deep mint
- `sat-*` (saturation) badges: same soft/deep pairing across green/blue/gold/gray

**Executive summary card** — switched gradient from `#1a2332 → #141921` (dark navy) to `#FFF4EA → #FBF8F2` (orange-tinted cream), now visually anchors on the orange accent border instead of glowing against black.

**Graph rendering** — dark-theme holdouts inside the D3 code:
- Default link stroke: `#48505c` → `#C9BEAA` (warm line color matching `var(--line-2)`)
- Node outline stroke: `#0b0e13` → `#F6F3EE` (now a hairline highlight against the cream bg instead of a dark ring)
- Node label fill: `#c9d1d9` → `#1A1614` (app ink; readable directly on cream)
- Highlighted-node outer stroke: `#fff` → `#1A1614` (was invisible on cream)
- Link opacity bumped `0.25 → 0.45` so the graph's edges still read against the softer background

**Node color palette (`KIND_COLORS`)** — rebalanced for cream bg. The old palette was saturated enough for dark, but the product/subreddit lavenders (`#a371f7`, `#d2a8ff`) and the sky (`#58a6ff`) washed out. Deepened each value by ~15–20% lightness so they remain punchy on cream:
- `topic` → `#FF8C42` (app orange — root node matches the brand mark)
- `subreddit` → `#8B6FD4` (deepened lavender)
- `post` → `#4A90C4` (deepened sky)
- `painpoint` → `#E26A6A`, `feature_wish` → `#E69447` (app chronic/emerging)
- `product` → `#D48BA6` (deepened rose), `workaround` → `#7DC9A3` (deepened mint)

**PNG export background** — `htmlToImage.toPng` call used `backgroundColor: "#0b0e13"`; switched to `#F6F3EE` so the saved executive-summary card matches what the user sees on screen.

**Left untouched** — the `srcColors` dict for the per-card source-distribution mini-bar: those are provider brand colors (Reddit orange, HN orange, GitHub pink…) and should stay brand-accurate regardless of theme.

## How to see it

Open any topic → Map tab → click **Rebuild**. The iframe regenerates from the new template; cream bg, orange root node, warm warm-grey lines. No rebuild of the sidecar needed (dev uses the editable venv install).

## Verification

- `python -c "from reddit_research.graph import export_graph_html"` → imports cleanly
- All existing structural selectors preserved — badges, cards, exec-summary, details pane, legend all still match their previous HTML hooks

## Files Modified

- `src/reddit_research/graph/export.py` — `_HTML_TEMPLATE` CSS :root swap, card.active bg, all severity/saturation badge colors, exec gradient + copied-button text, graph link/node stroke/label fills, `KIND_COLORS` node palette, PNG-export background
