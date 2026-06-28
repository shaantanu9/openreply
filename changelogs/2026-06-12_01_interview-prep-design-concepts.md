# Interview Prep & Design Concepts Document

**Date:** 2026-06-12
**Type:** Documentation

## Summary

Created a comprehensive interview-preparation document capturing every major design concept in the project — both software architecture and UI/UX — broken into What/Why/How/Importance/Tradeoffs, plus a mock-drill Q&A bank, rapid-fire flashcards, and whiteboard diagrams. Intended as a single source for preparing to explain the project in interviews.

## Changes

- Documented 7 architecture concepts: one-engine-three-surfaces, Tauri + Python sidecar, local-first SQLite, provider-agnostic LLM layer (Strategy pattern), staged pipeline + source abstraction, async job queue, knowledge graph + local embeddings
- Documented 5 UI/UX concepts: progressive disclosure (Simple Mode), plain-language explainers, in-app guidance/tours, perceived-performance loaders + SWR cache, performance-under-contention fix
- Added 15-question mock-drill Q&A bank (easy → hard) with model answers and follow-ups
- Added rapid-fire flashcards table and four whiteboard diagrams to memorize

## Files Created

- `docs/INTERVIEW_PREP.md` — full interview-prep and design-concepts reference
- `changelogs/2026-06-12_01_interview-prep-design-concepts.md` — this entry
