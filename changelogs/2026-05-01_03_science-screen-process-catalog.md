# Science screen — full process & framework catalog

**Date:** 2026-05-01
**Type:** UI Enhancement

## Summary

Expanded the Science tab to document every methodology, framework, and
engineering pattern Gap Map applies. 30 distinct processes are grouped
into 7 sections (Data acquisition, Knowledge graph, Semantic extraction,
Synthesis, Decision support, Research outputs, UX foundations,
Reliability). Each card shows an icon, title, and one-line description
by default; a "Know more" expander reveals the full reasoning, where
in the app it's used, and the source citation.

Also expanded the Sources list from 10 to 16 (added Bluesky, Mastodon,
Product Hunt, Dev.to, Stack Overflow, RSS) and the local-storage table
to include products / product_signals / extraction_queue /
extraction_daily_usage rows so users see the full schema, not just the
original five.

## Changes

- 30 new process cards spanning 7 categorical groups, each with title /
  short / full / where / citation fields.
- Collapsible `<details>` cards with chevron-toggle that flips on open;
  lucide icons refresh on first toggle.
- New "Open Playbook →" button on the Science screen for cross-linking
  to the new lifecycle screen.
- Six new Source cards (Bluesky, Mastodon, Product Hunt, Dev.to, Stack
  Overflow, RSS) — each with signal / bias / why / citation fields
  matching the existing pattern.
- Local-storage schema table expanded with products, product_signals,
  extraction_queue, extraction_daily_usage rows.
- Methodology paragraph updated: "16 corpora" instead of "10".

## Files Modified

- `app-tauri/src/screens/science.js` — added `PROCESSES` array (30 entries)
  + `processCard()` / `processGroupSection()` renderers + 6 new SOURCES
  entries; new playbook button; lazy icon refresh on `<details>` toggle.
- `app-tauri/src/style.css` — added `.science-process-card`,
  `.science-process-grid`, `.science-process-icon`,
  `.science-process-toggle`, `.science-process-body`,
  `.science-process-where`, `.science-where`, `.science-process-cite`,
  `.science-group`, `.science-group-head` styles.
