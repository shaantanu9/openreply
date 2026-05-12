# Audience personas from real Reddit/HN/etc. users (Phase 1 + 2)

**Date:** 2026-05-03
**Type:** Feature

## Summary

Replaces the LLM-imagined "primary persona" surface across the app with
**clusters of real authors from the corpus**, each backed by citation
links to their actual posts. Users can now click through to the exact
Reddit thread that grounded a persona claim.

Implements Phase 1 + Phase 2 of
`docs/PERSONA_GROUNDING_AND_AUTORESEARCH_PLAN.md`:

- New per-topic `audience_personas(topic, cluster_id)` table.
- Pure-deterministic clustering pipeline (ChromaDB MiniLM embedding +
  k-means at k ∈ {3, 5, 7} picked by silhouette).
- Optional LLM augmentation: one call per cluster writes a label,
  2000-char persona narrative, 3-5 personal-memory bullets, and
  structured demographics — with a hard prompt constraint that every
  claim cite a specific `post_id`.
- New `/audience/<topic>` screen with cluster cards: gradient avatar,
  demographic chips, says/wants/hates 3-quadrant grid, vocab
  signatures, top-subs links, 7×24 activity heatmap, exemplar post
  link, expandable persona narrative + personal memory + members list.
- The existing Launch Brief (`research/launch.py`) now reads from
  `audience_personas` first; falls back to empathy_maps + interviews
  only when no audience build has run yet.
- New sidebar entry "Audience" between "Empathy Maps" and "Interviews".

The deterministic pipeline ALWAYS works (offline-safe), even without
an LLM key — clusters + heatmaps + says/wants/hates render from corpus
data alone. LLM augmentation is purely additive.

## Files Created

- `src/reddit_research/research/_clustering.py` — pure-Python helpers:
  `author_post_blocks`, `filter_min_posts`, `author_concatenated_text`,
  `embed_authors` (palace-backed), `kmeans_with_silhouette`,
  `per_cluster_tightness`, `vocab_signatures`, `top_subs_for_cluster`,
  `activity_heatmap`, `says_wants_hates`, `exemplar_post`. No new deps —
  reuses ChromaDB embedder + transitive sklearn.
- `src/reddit_research/research/audience.py` — orchestrator:
  `build_audience_personas(topic, llm=True, ...)` and
  `get_audience_personas(topic)`. LLM prompt structure adapted from
  `miroclaw_jyotish/oasis_profile_generator`'s individual-persona
  template, hardened with explicit `post_id` citation constraints.
- `app-tauri/src/screens/audience.js` — picker + topic view + Re-build
  CTAs. Renders persona cards in `.topic-grid` for responsive layout.
- `changelogs/2026-05-03_01_audience-personas-from-real-users.md` —
  this file.

## Files Modified

- `src/reddit_research/cli/main.py` — `audience-build` and
  `audience-get` subcommands.
- `src/reddit_research/mcp/server.py` — `reddit_audience_personas`
  (timeout-wrapped) and `reddit_audience_personas_get` MCP tools.
- `src/reddit_research/research/launch.py` — Launch Brief prefers
  `audience_personas` over empathy/interview shapes;
  `_personas_from_audience_table` helper added.
- `app-tauri/src-tauri/src/commands.rs` — `audience_personas_build`
  and `audience_personas_get` Tauri commands.
- `app-tauri/src-tauri/src/main.rs` — registered both in
  `generate_handler!`.
- `app-tauri/src/api.js` — `api.audiencePersonasBuild` and
  `api.audiencePersonasGet`.
- `app-tauri/src/main.js` — `renderAudience` import, two routes
  (`/audience` picker, `/audience/<topic>` view), eye-icon explainer
  slug.
- `app-tauri/index.html` — sidebar entry "Audience" with
  `user-check` icon.
- `app-tauri/src/style.css` — `.aud-card`, `.aud-avatar`,
  `.aud-quad-grid`, `.aud-quad`, says/wants/hates left-accent borders.

## How it ties to the master plan

| Plan phase | Status | What's left for this slice |
|---|---|---|
| **Phase 1** — `audience.py`, `_clustering.py`, table, CLI, MCP, Launch Brief integration | ✅ Shipped | — |
| **Phase 2** — Audience screen, sidebar entry, Tauri commands, api.js, route | ✅ Shipped | — |
| **Phase 3** — Multi-persona deliberation wrapper | Not started | next |
| **Phase 4** — Autoresearch loop skill in `.claude/skills/` | Not started | follow-on |
| **Phase 5** — Evaluation lenses + OASIS synthetic simulation | Not started | optional |

## Verification

- `ast.parse` on every modified Python file — clean.
- `node --check` on every modified JS — clean.
- `cargo check` on `src-tauri` — clean (just the unrelated
  `JWT_DESKTOP_SECRET` warning).
- Functional smoke test of the deterministic helpers:
  - `[deleted]` / `AutoModerator` filtered.
  - `pick_k(20) = [3, 5, 7]`; `pick_k(3) = []` (correctly refuses tiny corpora).
  - `says_wants_hates` correctly classifies "I wish..." → wants and
    "I hate..." → hates from a fixture.
  - `activity_heatmap` produces a 7×24 grid with non-zero cells only at
    posts' UTC-mapped (dow, hour) slots.
  - `exemplar_post` picks highest engagement.

## Defaults adopted (from §8 of the plan)

| Decision | Value |
|---|---|
| Clustering library | ChromaDB MiniLM embed + k-means + silhouette (zero new deps) |
| Min posts per author | 3 |
| Default k candidates | {3, 5, 7} (smallest silhouette winner) |
| LLM call budget | 1 call/cluster, max 2500 tokens, temperature 0.3 |
| Empathy Maps relationship | Sibling — both screens stay; Launch Brief prefers audience clusters |
| Sidebar position | Between "Empathy Maps" and "Interviews" |

## Next

Phase 3 — wire a 5-persona deliberation wrapper around
`synthesize_insights` so every finding lands tagged
`Confirmed / Probable / Minority / Discarded`. Pattern adapted from
`autoresearch:predict`. Uses the new audience clusters as inputs so
the deliberation panel knows *which real personas* would dispute a
finding.
