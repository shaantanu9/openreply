# Research-applications living log seeded with Transformer paper mapping

**Date:** 2026-04-19
**Type:** Documentation

## Summary

Added `docs/research-applications.md` — a running ledger for mapping external research findings onto OpenReply (product) + the Tauri desktop app (engineering). Seeded with Finding 01 (the Transformer paper, Vaswani 2017) using a reusable 5-slot template so future findings slot in the same way.

## Changes

- Defined a standard entry template: one-line idea, relevance, what-we-have-today, what-it-improves, product upgrades, engineering upgrades, effort/priority/status.
- Fully filled out Finding 01 (Attention Is All You Need) against the current codebase — references `retrieval/`, `find.js`, `graph/semantic.py`, `research/discover.py`, temporal classifier, Chat tab.
- Listed 7 product upgrades + 8 engineering upgrades with effort/priority/status table.
- Cross-linked closures back to `docs/self-gap-analysis.md` (emergent clustering 🔴, diff-mode 🔴) and `docs/product-roadmap.md` (build plan).
- Identified a 1-week quick-win path: unified encoder + ChromaDB per-topic index → semantic near-dup merge → RAG Chat.
- Left a Finding-02 placeholder block with the copy-paste template for the next research input.

## Files Created

- `docs/research-applications.md`
- `changelogs/2026-04-19_23_research-applications-log.md`
